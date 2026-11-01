import { app, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'
import { libraryKey } from './files'
import { registerLibraryProtocols } from './protocol'
import { LibraryService } from './service'
import { LibraryStore } from './store'
import { TessdataManager } from './tessdata'
import { pdfURLForPath } from './urls'
import { IndexerClient } from './worker-client'

const id = z.string().min(1).max(4096)
const reference = z.string().trim().min(1).max(200)
const overrides = z.object({
  title: z.string().max(500),
  author: z.string().max(500),
  publisher: z.string().max(500),
  year: z.string().max(500),
  volume: z.string().max(500),
  edition: z.string().max(500),
  language: z.string().max(500),
})

/** Biblioteca de PDFs: importação, índice no processo utilitário, OCR, capas e protocolos. */
export function registerLibrary(context: MainContext): void {
  const client = new IndexerClient()
  const store = new LibraryStore(context.database, context.kv('library-section-links'))
  const service = new LibraryService(store, client, context.paths.thumbnails, {
    changed: (revision) => context.windows.broadcast('library:changed', { revision }),
    status: (status) => context.windows.broadcast('library:status', status),
  })
  const tessdata = new TessdataManager(context.paths.tessdata, (loaded, total) =>
    context.windows.broadcast('library:ocrDownload', { loaded, total }),
  )

  registerLibraryProtocols({
    registeredPath: (path) => service.registeredPath(path),
    thumbnailsFolder: context.paths.thumbnails,
    tessdataFolder: context.paths.tessdata,
  })
  app.on('before-quit', () => client.dispose())

  handle('library:matches', ({ reference: value }) => {
    const parsed = reference.safeParse(value)
    return parsed.success ? service.matches(parsed.data) : []
  })
  handle('library:count', () => service.count())
  handle('library:sectionsForPath', ({ path }) => service.sectionsForPath(id.parse(path)))
  handle('library:matchCounts', ({ references }) =>
    service.matchCounts(z.array(z.string().max(200)).max(2000).parse(references)),
  )

  handle('library:works', () => service.works())
  handle('library:sections', ({ id: value }) => service.sections(id.parse(value)))
  handle('library:status', () => service.status())
  handle('library:import', async (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Importar PDF',
      buttonLabel: 'Importar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf', 'PDF'] }],
    }
    const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (chosen.canceled || chosen.filePaths.length === 0) return null
    const { result } = await service.importPaths(chosen.filePaths, { strict: false })
    return result
  })
  handle('library:importPaths', async ({ paths }) => {
    const list = z.array(z.string().min(1).max(4096)).min(1).max(200).parse(paths)
    const { result } = await service.importPaths(list, { strict: true })
    return result
  })
  handle('library:reindex', (request) => service.reindex(request?.id === undefined ? undefined : id.parse(request.id)))
  handle('library:remove', ({ id: value }) => service.remove(id.parse(value)))
  handle('library:saveMetadata', ({ id: value, metadata }) =>
    service.saveMetadata(id.parse(value), metadata === null ? null : overrides.parse(metadata)),
  )
  handle('library:saveCover', async ({ id: value, jpeg }) => ({ coverURL: await service.saveCover(id.parse(value), jpeg) }))

  handle('library:ocrCandidates', ({ id: value }) => service.ocrCandidates(id.parse(value)))
  handle('library:ocrLanguages', async () => {
    await tessdata.ensure()
    return { langPath: tessdata.langPath }
  })
  handle('library:ocrApply', ({ id: value, texts }) => service.ocrApply(id.parse(value), texts))

  handle('library:rememberedPage', ({ path, reference: value }) => service.rememberedPage(id.parse(path), reference.parse(value)))
  handle('library:rememberPage', ({ path, reference: value, page }) =>
    service.rememberPage(id.parse(path), reference.parse(value), page === null ? null : z.number().int().parse(page)),
  )

  context.modules.library = {
    extractReviewSources: (input) => service.extractReviewSources(input),
    isRegisteredPath: (path) => typeof path === 'string' && service.isRegistered(path),
    // O protocolo só serve caminhos registrados; a URL de um caminho fora da Biblioteca responde 404.
    pdfURL: (path) => pdfURLForPath(service.registeredPath(path) ?? libraryKey(path)),
    importFiles: async (paths) => {
      const { done } = await service.importPaths(paths, { strict: false, reindexExisting: true })
      await done
    },
    exportRecords: () => service.exportRecords(),
    replaceRecords: (records) => service.replaceRecords(records),
    exportSectionLinks: () => service.exportSectionLinks(),
    replaceSectionLinks: (links) => service.replaceSectionLinks(links),
  }
}
