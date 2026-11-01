import { BrowserWindow, app, clipboard } from 'electron'
import { decodeReaderArchive, materialsMarkedForReview } from '@pregar/core/reader'
import { SermonReviewMaterialError, type ReviewMaterialSource } from '@pregar/core/library'
import type { MainContext } from '../../context'
import { UserFacingError, handle } from '../../ipc/router'
import { copySource, markedMaterial, textWithSource } from './helpers'
import { popupReaderMenu } from './menus'
import { ReaderService } from './service'
import { ReaderWebManager } from './web'

/**
 * Leitor: abas de PDFs e sites por preparação. O estado vive no processo principal (redutores
 * de `@pregar/core/reader`, gravado em `kv('reader')`); as páginas web são WebContentsViews
 * presas à janela do Leitor; os PDFs são desenhados pela janela com o PDF.js.
 */
export function registerReader(context: MainContext): void {
  const service = new ReaderService(context, context.kv('reader'))
  const hooked = new WeakSet<BrowserWindow>()

  const leitor = (): BrowserWindow | undefined => {
    const window = context.windows.get('leitor')
    if (window) hookWindow(window)
    return window
  }

  const web = new ReaderWebManager(service, {
    window: leitor,
    send: (state) => {
      const window = context.windows.get('leitor')
      if (window) context.windows.send(window, 'reader:webChanged', state)
    },
    shortcut: (command) => {
      const window = leitor()
      if (!window) return
      // Atalhos que levam o cursor a um campo da janela tiram o foco da página web.
      if (command === 'focusAddress' || command === 'newTab') window.webContents.focus()
      context.windows.send(window, 'reader:shortcut', { command })
    },
    notice: (message, url) => {
      const window = context.windows.get('leitor')
      if (window) context.windows.send(window, 'reader:notice', { message, url })
    },
  })
  service.onApplied = () => web.sync()

  function hookWindow(window: BrowserWindow): void {
    if (hooked.has(window)) return
    hooked.add(window)
    window.on('close', () => {
      service.flush()
      void web.captureAll().finally(() => service.flush())
    })
    window.on('closed', () => {
      void web.closeAll().finally(() => service.flush())
    })
  }

  // A Biblioteca registra antes do Leitor; o banco fecha num `before-quit` registrado depois deste.
  app.on('before-quit', () => service.flush())

  handle('reader:open', async (request) => {
    const { selected } = await service.open(request)
    if (selected) hookWindow(context.windows.open('leitor'))
  })

  handle('reader:tabsForSermon', ({ dateKey }) =>
    service.state.tabs.filter((tab) => tab.sermonDateKey === dateKey).map((tab) => ({ ...tab, webPositions: undefined })),
  )

  handle('reader:activateSermon', ({ dateKey, reference }) => service.activateSermon(dateKey, reference))

  handle('reader:setReviewInclusion', ({ tabID, included }) => service.setReviewInclusion(tabID, included))

  handle('reader:state', (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && context.windows.kindOf(window) === 'leitor') hookWindow(window)
    return service.snapshot()
  })

  handle('reader:command', (command) => service.command(command))

  handle('reader:webStates', () => web.states())

  handle('reader:web', ({ tabID, action, url }) => web.act(tabID, action, url))

  handle('reader:webViewport', ({ tabID, bounds }, event) => {
    // Só a janela do Leitor posiciona as páginas web.
    if (event.sender !== leitor()?.webContents) return
    web.setViewport(tabID, bounds)
  })

  handle('reader:menu', (request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) popupReaderMenu(service, window, request)
  })

  handle('reader:copyWithSource', async ({ tabID, text }) => {
    const tab = service.tab(tabID)
    if (!tab) return false
    let value = text ?? ''
    let url: string | null = null
    if (tab.kind === 'web') {
      const selection = await web.selectionText(tabID)
      value = selection?.text ?? ''
      url = selection?.url ?? null
    }
    const copied = textWithSource(value, copySource(tab, url))
    if (copied === null) return false
    clipboard.writeText(copied)
    return true
  })

  context.modules.reviewMaterials = {
    marked: (dateKey) => materialsMarkedForReview(service.state, dateKey).map(markedMaterial),
    collect: async (dateKey, mainReference) => {
      const sources: ReviewMaterialSource[] = []
      for (const tab of materialsMarkedForReview(service.state, dateKey)) {
        if (tab.kind === 'web') {
          sources.push(await web.reviewSource(tab))
          continue
        }
        const library = context.modules.library
        if (!library) throw SermonReviewMaterialError.sourceUnavailable(tab.title)
        const reference = mainReference.trim() !== '' ? mainReference : (tab.reference ?? null)
        try {
          sources.push(
            ...(await library.extractReviewSources({ path: tab.location, title: tab.title, reference, physicalPage: tab.physicalPage })),
          )
        } catch (error) {
          if (error instanceof SermonReviewMaterialError || error instanceof UserFacingError) throw error
          console.error('[leitor] extração do PDF marcado falhou', error)
          throw SermonReviewMaterialError.sourceUnavailable(tab.title)
        }
      }
      return sources
    },
    exportArchive: () => service.exportArchive(),
    replaceArchive: (archive) => {
      const decoded = decodeReaderArchive(archive)
      if (!decoded) throw new UserFacingError('O arquivo do Leitor no backup não pôde ser lido.')
      web.reset()
      service.replace(decoded)
    },
  }
}
