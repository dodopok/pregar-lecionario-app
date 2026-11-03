import { createServer } from 'node:http'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { SERMON_KEY_PATTERN } from '@pregar/core/util/dates'
import { shell } from 'electron'
import { GoogleDrivePublicPDFImporter, GoogleDriveStore, googleDocURL } from '@pregar/core/drive'
import type { GoogleDriveSermonLink, GoogleDriveSettingKey, LoopbackReceiver } from '@pregar/core/drive'
import type { RichDocument } from '@pregar/core/document/model'
import type { DriveStatus, IdeaNote } from '@shared/ipc-content'
import type { SermonRecord } from '@shared/types'
import type { MainContext } from '../../context'
import { handle, UserFacingError } from '../../ipc/router'

const dateKey = z.string().regex(SERMON_KEY_PATTERN)

/** Servidor de retorno do OAuth: só 127.0.0.1, porta aleatória, uma resposta por pedido. */
function loopbackReceiver(): LoopbackReceiver {
  let server: ReturnType<typeof createServer> | null = null
  return {
    start(onRequest) {
      return new Promise((resolve, reject) => {
        server = createServer((request, response) => {
          const result = onRequest(request.url ?? '/')
          response.writeHead(result.status, { ...result.headers, Connection: 'close' })
          response.end(result.body)
        })
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
          const address = server?.address()
          if (address && typeof address === 'object') resolve(address.port)
          else reject(new Error('Não foi possível abrir a porta local do login do Google.'))
        })
      })
    },
    stop() {
      server?.close()
      server = null
    },
  }
}

function linkFromRecord(record: SermonRecord): GoogleDriveSermonLink {
  return {
    draftKey: record.drive.draftKey,
    documentId: record.drive.documentId,
    revisionId: record.drive.revisionId,
    syncedAt: record.drive.syncedAt ? new Date(record.drive.syncedAt) : null,
    syncedContentHash: record.drive.syncedContentHash,
    syncError: record.drive.syncError,
  }
}

function ideaNotes(text: string): IdeaNote[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n\n')
    .map((note) => note.trim())
    .filter(Boolean)
    .map((note, index) => ({ id: `idea-${index}`, text: note }))
}

const documentSchema = z.custom<RichDocument>(
  (value) => Boolean(value && typeof value === 'object' && Array.isArray((value as RichDocument).paragraphs)),
  { message: 'Documento inválido.' },
)

export function registerDrive(context: MainContext): void {
  const settings = context.kv('drive')
  const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? ''
  const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? ''

  const store = new GoogleDriveStore({
    http: context.http(),
    client: { clientId, clientSecret: clientSecret || undefined },
    settings: {
      get: async (key: GoogleDriveSettingKey) => settings.get<string>(key) ?? null,
      set: async (key: GoogleDriveSettingKey, value: string | null) => {
        if (value === null) settings.delete(key)
        else settings.set(key, value)
      },
    },
    refreshTokens: {
      read: async () => context.secrets.get('googleRefreshToken'),
      save: async (token) => context.secrets.set('googleRefreshToken', token),
      delete: async () => context.secrets.delete('googleRefreshToken'),
    },
    authorization: {
      receiver: loopbackReceiver,
      openBrowser: async (url: string) => {
        await shell.openExternal(url)
      },
    },
    onChange: () => context.windows.broadcast('drive:status', status()),
  })
  const loaded = store.load().catch(() => undefined)

  function status(): DriveStatus {
    const state = store.state
    const available = clientId.trim().length > 0
    return {
      available,
      connected: state.isConnected,
      ideasDocumentURL: state.ideasDocumentId ? googleDocURL(state.ideasDocumentId) : null,
      message: !available
        ? 'A conexão com o Google Drive não está configurada nesta versão do app.'
        : (state.errorMessage ?? (state.isConnected ? 'Conectado ao Google Drive.' : 'Não conectado.')),
    }
  }

  function writeLink(day: string) {
    return async (link: GoogleDriveSermonLink) => {
      context.sermons.save(day, {
        drive: {
          draftKey: link.draftKey ?? null,
          documentId: link.documentId ?? null,
          revisionId: link.revisionId ?? null,
          syncedAt: link.syncedAt ? link.syncedAt.toISOString() : null,
          syncedContentHash: link.syncedContentHash ?? null,
          syncError: link.syncError ?? null,
        },
      })
    }
  }

  function draftFor(day: string, document: RichDocument) {
    const record = context.sermons.get(day)
    if (!record) throw new UserFacingError('Escreva o sermão antes de enviar ao Google Drive.')
    return {
      record,
      draft: {
        title: record.title,
        mainReadingReference: record.mainReadingReference,
        liturgicalDate: day,
        document,
        drive: linkFromRecord(record),
      },
    }
  }

  handle('drive:status', async () => {
    await loaded
    return status()
  })
  handle('drive:connect', async () => {
    await loaded
    if (!clientId) throw new UserFacingError(status().message)
    await store.connect()
    if (store.state.errorMessage && !store.state.isConnected)
      throw new UserFacingError(store.state.errorMessage)
    return status()
  })
  handle('drive:disconnect', async () => {
    await store.disconnect()
    return status()
  })
  handle('drive:saveSermon', async ({ dateKey: key, document, overwriteRemote }) => {
    await loaded
    const day = dateKey.parse(key)
    const { draft } = draftFor(day, documentSchema.parse(document))
    const link = await store.saveSermon(draft, writeLink(day), { overwriteRemote: Boolean(overwriteRemote) })
    return {
      record: context.sermons.get(day)!,
      documentURL: link.documentId ? googleDocURL(link.documentId) : null,
    }
  })
  handle('drive:sync', async ({ dateKey: key, document }) => {
    await loaded
    const day = dateKey.parse(key)
    const { draft } = draftFor(day, documentSchema.parse(document))
    try {
      const result = await store.syncIfNeeded(draft, writeLink(day))
      return { status: result, record: context.sermons.get(day), message: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const conflict = (error as { kind?: string }).kind === 'documentConflict'
      return { status: conflict ? 'conflict' : 'notConnected', record: context.sermons.get(day), message }
    }
  })
  handle('drive:ideas', async ({ create }) => {
    await loaded
    if (!store.state.isConnected) return { notes: [], documentURL: null }
    if (create || !store.state.ideasDocumentId) await store.ensureIdeasDocument()
    await store.refreshIdeas()
    return {
      notes: ideaNotes(store.state.ideasText),
      documentURL: store.state.ideasDocumentId ? googleDocURL(store.state.ideasDocumentId) : null,
    }
  })

  const importer = new GoogleDrivePublicPDFImporter({
    http: context.http(),
    sink: {
      async writeFile(directory, fileName, data) {
        const folder = join(context.paths.root, ...directory)
        mkdirSync(folder, { recursive: true })
        const target = join(folder, fileName)
        const temporary = `${target}.download`
        writeFileSync(temporary, data)
        renameSync(temporary, target)
        return target
      },
    },
    keyStore: {
      read: async () =>
        context.secrets.get('driveApiKey') ?? (import.meta.env.MAIN_VITE_DRIVE_API_KEY || null),
      save: async (key) => context.secrets.set('driveApiKey', key),
    },
    onChange: (state) =>
      context.windows.broadcast('drive:importProgress', {
        done: state.completedCount,
        total: state.totalCount,
        current: state.status,
      }),
  })
  handle('drive:importFolder', async ({ link, includeSubfolders, apiKey }) => {
    const result = await importer.importPDFs(
      z.string().trim().min(10).max(500).parse(link),
      z.string().trim().max(200).optional().parse(apiKey) ?? '',
      Boolean(includeSubfolders),
    )
    if (result.localPaths.length > 0) await context.modules.library?.importFiles(result.localPaths)
    return {
      imported: result.localPaths.length,
      failed: result.failures.map((message) => ({ name: '', message })),
    }
  })
}
