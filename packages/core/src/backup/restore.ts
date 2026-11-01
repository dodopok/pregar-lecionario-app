/**
 * Restauração em duas partes, como no Swift (`installAssets` + `restore`):
 *
 * 1. `installBackupAssets` copia os PDFs do pacote para a pasta do app, conferindo o SHA-256 e
 *    recusando colisões e links simbólicos; `discardInstalledAssets` desfaz se algo falhar depois.
 * 2. `planRestore` calcula o que gravar: caminhos de PDF reescritos para o destino, hash do Drive
 *    redefinido para não reenviar o conteúdo restaurado e preferências a gravar e a apagar,
 *    sem tocar em credenciais. O processo principal aplica o plano numa transação do banco.
 */
import { sha256Hex } from '../util/hash'
import type { ManuscriptContent } from '../history/model'
import { BackupError } from './errors'
import { lastPathComponent, readPackageFile } from './fs'
import type { BackupFileSystem } from './fs'
import { remapPdfPaths } from './format'
import type {
  BackupData,
  BackupFavoriteSources,
  BackupHistoryFile,
  BackupLibraryRecord,
  BackupReaderArchive,
  BackupSermon,
} from './format'
import type { JsonValue } from './json'
import { planPreferenceRestore } from './preferences'
import type { PreferenceRestorePlan } from './preferences'

export interface InstalledAssets {
  /** Caminho no pacote (`Files/<sha>.pdf`) → nome do arquivo na pasta de destino. */
  fileNames: Record<string, string>
  /** Arquivos criados por esta instalação, removidos por `discardInstalledAssets`. */
  created: string[]
}

export interface InstallAssetsOptions {
  /** Pacote validado. */
  source: BackupFileSystem
  /** Pasta de PDFs restaurados do app (no Swift, `Application Support/Pregar/BackupFiles`). */
  destination: BackupFileSystem
  /** Resultado de `validateBackup` ou de `readLegacyBackup`. */
  contents: { assetPaths: readonly string[]; manifest: { files: Record<string, string> } }
  newId?: () => string
}

export async function installBackupAssets(options: InstallAssetsOptions): Promise<InstalledAssets> {
  const { source, destination, contents } = options
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID())
  await destination.mkdir('')
  const fileNames: Record<string, string> = {}
  const created: string[] = []
  try {
    for (const packagePath of contents.assetPaths) {
      const expected = contents.manifest.files[packagePath]
      if (expected === undefined) throw BackupError.missingAsset()
      const fileName = lastPathComponent(packagePath)
      const existing = await destination.stat(fileName)
      if (existing?.isSymbolicLink) throw BackupError.assetCollision()
      if (existing) {
        if (!existing.isFile || (await sha256Hex(await destination.readFile(fileName))) !== expected) {
          throw BackupError.assetCollision()
        }
      } else {
        const temporary = `.${newId()}.tmp`
        try {
          await destination.writeFile(temporary, await readPackageFile(source, packagePath))
          if ((await sha256Hex(await destination.readFile(temporary))) !== expected)
            throw BackupError.corruptedFile()
          await destination.rename(temporary, fileName)
          created.push(fileName)
        } catch (error) {
          await destination.remove(temporary).catch(() => undefined)
          throw error
        }
      }
      fileNames[packagePath] = fileName
    }
  } catch (error) {
    await discardInstalledAssets(destination, { fileNames, created })
    throw error
  }
  return { fileNames, created }
}

export async function discardInstalledAssets(
  destination: BackupFileSystem,
  installed: InstalledAssets,
): Promise<void> {
  for (const fileName of installed.created) await destination.remove(fileName).catch(() => undefined)
}

export interface RestorePlanOptions {
  /** Caminho final do PDF instalado, por exemplo `${userData}/BackupFiles/${fileName}`. */
  assetLocation: (fileName: string) => string
  /** Chaves de preferência existentes no destino, para apagar as que o backup não traz. */
  currentPreferenceKeys?: Iterable<string>
  preferenceKeys?: ReadonlySet<string>
  /** Hash do conteúdo sincronizado com o Drive; padrão: SHA-256 de `content.data`. */
  syncedContentHash?: (content: ManuscriptContent) => Promise<string>
}

export interface RestorePlan {
  /** Substituem todos os sermões do destino. */
  sermons: BackupSermon[]
  /** Substitui todo o histórico do destino. */
  history: BackupHistoryFile[]
  libraryRecords: BackupLibraryRecord[]
  readerArchive: BackupReaderArchive
  sectionLinks: Record<string, number>
  preferences: PreferenceRestorePlan
  favoriteSources: BackupFavoriteSources
  reviewReports: Record<string, JsonValue[]>
  /** PDFs a instalar: caminho no pacote e caminho final. */
  assets: { packagePath: string; fileName: string; destinationPath: string }[]
}

/** Pacote validado (`validateBackup`) ou backup antigo convertido (`convertLegacyBackup`). */
export interface RestorableBackup extends BackupData {
  /** `Files/<sha>.pdf` presentes no pacote. */
  assetPaths: readonly string[]
}

export async function planRestore(
  contents: RestorableBackup,
  options: RestorePlanOptions,
): Promise<RestorePlan> {
  const assets = contents.assetPaths.map((packagePath) => {
    const fileName = lastPathComponent(packagePath)
    return { packagePath, fileName, destinationPath: options.assetLocation(fileName) }
  })
  const destinations = new Map(assets.map((asset) => [asset.packagePath, asset.destinationPath]))
  const mapped = remapPdfPaths(
    contents,
    (path) => destinations.get(path) ?? null,
    () => {
      throw BackupError.missingAsset()
    },
  )

  const hash = options.syncedContentHash ?? ((content: ManuscriptContent) => sha256Hex(content.data))
  const sermons: BackupSermon[] = []
  for (const sermon of mapped.sermons) {
    // Com documento vinculado, o conteúdo restaurado passa por sincronizado: nada sobe sozinho.
    if (sermon.googleDriveDocumentId && sermon.content) {
      sermons.push({ ...sermon, googleDriveSyncedContentHash: await hash(sermon.content) })
    } else {
      sermons.push(sermon)
    }
  }

  return {
    sermons,
    history: contents.history.map((item) => ({ dateKey: item.dateKey, revisions: [...item.revisions] })),
    libraryRecords: mapped.libraryRecords,
    readerArchive: mapped.readerArchive,
    sectionLinks: mapped.sectionLinks,
    preferences: planPreferenceRestore(
      contents.preferences,
      options.currentPreferenceKeys ?? [],
      options.preferenceKeys,
    ),
    favoriteSources: contents.favoriteSources,
    reviewReports: contents.reviewReports,
    assets,
  }
}
