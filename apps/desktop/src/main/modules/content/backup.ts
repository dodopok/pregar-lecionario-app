import { app, BrowserWindow, dialog } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  convertLegacyBackup,
  createBackup,
  detectBackupFormat,
  discardInstalledAssets,
  installBackupAssets,
  planRestore,
  readLegacyBackup,
  validateBackup,
} from '@pregar/core/backup'
import type { BackupData, BackupSermon, RestorableBackup, RestorePlan } from '@pregar/core/backup'
import { rtfToTiptap } from '@pregar/editor/rtf'
import { manuscriptPlainText } from '@pregar/editor/richDocument'
import type { Idea } from '@shared/ipc-ideas'
import type { SermonRecord } from '@shared/types'
import type { MainContext } from '../../context'
import { handle, UserFacingError } from '../../ipc/router'
import { nodeBackupFileSystem } from '../../storage/backup-fs'
import { ReviewReportRepository } from '../../storage/reviews'

const SETTINGS_KEY = 'pregar.settings.v2'
/** As ideias locais viajam no bloco de preferências do backup, sem mudar o formato dos arquivos. */
const IDEAS_KEY = 'pregar.ideas.v1'

function toBackupSermon(record: SermonRecord): BackupSermon {
  return {
    dateKey: record.dateKey,
    title: record.title,
    content: record.doc ? { format: 'tiptap-json', data: record.doc } : null,
    plainText: record.plainText,
    liturgicalOccasion: record.liturgicalOccasion,
    liturgicalCelebration: record.liturgicalCelebration,
    liturgicalSeason: record.liturgicalSeason,
    prayerBookId: record.prayerBookId,
    mainReadingReference: record.mainReadingReference,
    mainReadingSlot: record.mainReadingSlot,
    tabletPdfPath: record.tabletPdfPath,
    tabletPdfUpdatedAt: record.tabletPdfUpdatedAt,
    googleDriveDraftKey: record.drive.draftKey,
    googleDriveDocumentId: record.drive.documentId,
    googleDriveRevisionId: record.drive.revisionId,
    googleDriveSyncedAt: record.drive.syncedAt,
    googleDriveSyncedContentHash: record.drive.syncedContentHash,
    googleDriveSyncError: record.drive.syncError,
    modifiedAt: record.modifiedAt,
    createdAt: record.createdAt,
  }
}

function fromBackupSermon(sermon: BackupSermon): SermonRecord {
  const doc = sermon.content?.format === 'tiptap-json' ? sermon.content.data : null
  return {
    dateKey: sermon.dateKey,
    title: sermon.title ?? '',
    liturgicalOccasion: sermon.liturgicalOccasion ?? null,
    liturgicalCelebration: sermon.liturgicalCelebration ?? null,
    liturgicalSeason: sermon.liturgicalSeason ?? null,
    prayerBookId: sermon.prayerBookId ?? null,
    mainReadingReference: sermon.mainReadingReference ?? null,
    mainReadingSlot: sermon.mainReadingSlot ?? null,
    doc,
    plainText: sermon.plainText ?? '',
    wordCount: 0,
    tabletPdfPath: sermon.tabletPdfPath ?? null,
    tabletPdfUpdatedAt: sermon.tabletPdfUpdatedAt ?? null,
    drive: {
      draftKey: sermon.googleDriveDraftKey ?? null,
      documentId: sermon.googleDriveDocumentId ?? null,
      revisionId: sermon.googleDriveRevisionId ?? null,
      syncedAt: sermon.googleDriveSyncedAt ?? null,
      syncedContentHash: sermon.googleDriveSyncedContentHash ?? null,
      syncError: sermon.googleDriveSyncError ?? null,
    },
    createdAt: typeof sermon.createdAt === 'string' ? sermon.createdAt : sermon.modifiedAt,
    modifiedAt: sermon.modifiedAt,
  }
}

/** Converte o RTF do app Swift para o documento do editor. */
function convertRTF(rtf: string) {
  const json = rtfToTiptap(rtf)
  const content = { format: 'tiptap-json' as const, data: JSON.stringify(json) }
  return { content, plainText: manuscriptPlainText(content) }
}

export function registerBackup(context: MainContext): void {
  const reviews = new ReviewReportRepository(context.database)
  const restoredFiles = join(context.paths.root, 'BackupFiles')

  function collectData(): BackupData {
    const library = context.modules.library
    const reader = context.modules.reviewMaterials
    const sources = context.kv('sources')
    const history = context.database
      .all<{ date_key: string }>('select distinct date_key from sermon_revisions')
      .map((row) => ({
        dateKey: row.date_key,
        revisions: context.database
          .all<{ payload: string }>('select payload from sermon_revisions where date_key = ? order by version', row.date_key)
          .map((item) => JSON.parse(item.payload)),
      }))
    return {
      sermons: context.sermons.all().map(toBackupSermon),
      history,
      libraryRecords: (library?.exportRecords() ?? []) as BackupData['libraryRecords'],
      readerArchive: (reader?.exportArchive() ?? { tabs: [] }) as BackupData['readerArchive'],
      sectionLinks: library?.exportSectionLinks() ?? {},
      preferences: {
        [SETTINGS_KEY]: JSON.parse(JSON.stringify(context.settings.get())),
        [IDEAS_KEY]: JSON.parse(JSON.stringify(context.ideas.all())),
      },
      favoriteSources: {
        sites: JSON.parse(sources.get<string>('profiles.sites') ?? '[]'),
        authors: JSON.parse(sources.get<string>('profiles.authors') ?? '[]'),
      },
      reviewReports: reviews.all() as BackupData['reviewReports'],
    }
  }

  async function apply(plan: RestorePlan): Promise<void> {
    context.sermons.replaceAll(plan.sermons.map(fromBackupSermon))
    context.database.transaction(() => {
      context.database.run('delete from sermon_revisions')
      for (const file of plan.history) {
        for (const revision of file.revisions) {
          context.database.run(
            'insert into sermon_revisions (id, date_key, version, payload, created_at) values (?, ?, ?, ?, ?)',
            revision.id,
            file.dateKey,
            revision.version,
            JSON.stringify(revision),
            revision.createdAt,
          )
        }
      }
    })
    reviews.replaceAll(plan.reviewReports)
    const settings = plan.preferences.set[SETTINGS_KEY]
    if (settings && typeof settings === 'object') {
      // O endereço da API e o estado do primeiro uso continuam os desta instalação.
      const current = context.settings.get()
      context.settings.update({ ...(settings as object), apiBaseURL: current.apiBaseURL, onboarding: current.onboarding })
      context.windows.broadcast('settings:changed', context.settings.get())
    }
    const ideas = plan.preferences.set[IDEAS_KEY]
    if (Array.isArray(ideas)) {
      try {
        context.ideas.replaceAll(ideas as unknown as Idea[])
      } catch {
        // Ideias de um backup antigo ou malformado não impedem a restauração do resto.
      }
    }
    const sources = context.kv('sources')
    if (plan.favoriteSources.sites.length > 0) sources.set('profiles.sites', JSON.stringify(plan.favoriteSources.sites))
    if (plan.favoriteSources.authors.length > 0) sources.set('profiles.authors', JSON.stringify(plan.favoriteSources.authors))
    await context.modules.library?.replaceRecords(plan.libraryRecords)
    context.modules.library?.replaceSectionLinks(plan.sectionLinks)
    context.modules.reviewMaterials?.replaceArchive(plan.readerArchive)
  }

  async function restoreFrom(folder: string, legacyOnly: boolean): Promise<{ restored: boolean; message: string }> {
    const source = nodeBackupFileSystem(folder)
    const format = await detectBackupFormat(source)
    if (legacyOnly && format !== 'legacy-v1') {
      throw new UserFacingError('Esta pasta não é um backup do Pregar para Mac. Use "Restaurar backup" para backups deste app.')
    }
    let contents: RestorableBackup & { manifest: { files: Record<string, string> } }
    if (format === 'v2') {
      contents = await validateBackup(source)
    } else {
      const legacy = await readLegacyBackup(source)
      const converted = await convertLegacyBackup(legacy, { convertRTF })
      contents = { ...converted, manifest: legacy.manifest as unknown as { files: Record<string, string> } }
    }
    const destination = nodeBackupFileSystem(restoredFiles)
    const installed = await installBackupAssets({ source, destination, contents })
    try {
      const plan = await planRestore(contents, {
        assetLocation: (fileName) => join(restoredFiles, installed.fileNames[`Files/${fileName}`] ?? fileName),
      })
      await apply(plan)
    } catch (error) {
      await discardInstalledAssets(destination, installed)
      throw error
    }
    for (const window of context.windows.all()) window.webContents.reload()
    const count = contents.sermons.length
    return {
      restored: true,
      message: `${count} ${count === 1 ? 'preparação restaurada' : 'preparações restauradas'}. As chaves e a conta deste computador foram mantidas.`,
    }
  }

  async function chooseFolder(title: string, sender: Electron.WebContents, create = false): Promise<string | null> {
    const parent = BrowserWindow.fromWebContents(sender) ?? undefined
    const result = await dialog.showOpenDialog(parent!, {
      title,
      properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
      defaultPath: app.getPath('documents'),
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  handle('backup:create', async (_request, event) => {
    const folder = await chooseFolder('Escolha uma pasta privada para o backup', event.sender, true)
    if (!folder) return null
    const created = await createBackup({
      target: nodeBackupFileSystem(folder),
      data: collectData(),
      readPdf: async (path) => {
        try {
          return new Uint8Array(await readFile(path))
        } catch {
          return null
        }
      },
      appVersion: app.getVersion(),
    })
    return { path: join(folder, created.folderName) }
  })

  handle('backup:restore', async (_request, event) => {
    const folder = await chooseFolder('Escolha a pasta do backup do Pregar', event.sender)
    if (!folder) return { restored: false, message: 'Nenhum backup escolhido.' }
    return restoreFrom(folder, false)
  })

  handle('backup:importLegacy', async (_request, event) => {
    const folder = await chooseFolder('Escolha a pasta do backup feito no Pregar para Mac', event.sender)
    if (!folder) return { imported: false, message: 'Nenhum backup escolhido.' }
    const result = await restoreFrom(folder, true)
    return { imported: result.restored, message: result.message }
  })
}
