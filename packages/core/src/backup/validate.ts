/**
 * Validação completa do pacote antes de qualquer restauração, como `PregarBackupService.load`:
 * manifesto, versão, caminhos permitidos, links simbólicos, SHA-256 de cada arquivo, esquema
 * dos JSON, preferências sem credenciais, PDFs referenciados presentes e contagens.
 */
import { sortRevisions } from '../history/model'
import { BackupError } from './errors'
import { assertPackageRoot, isValidAssetPath, readPackageFile, verifyChecksums } from './fs'
import type { BackupFileSystem } from './fs'
import { decodeJSON, decodeUTF8 } from './json'
import {
  BACKUP_FILES,
  BACKUP_FORMAT_VERSION,
  BACKUP_ROOT_FILES,
  LEGACY_BACKUP_FORMAT_VERSION,
  backupManifestSchema,
  backupSchemas,
  historyDateKey,
  referencedPdfPaths,
} from './format'
import type { BackupData, BackupHistoryFile, BackupManifest } from './format'
import { isBackupPreferenceKey } from './preferences'

export interface BackupContents extends BackupData {
  manifest: BackupManifest
  /** `Files/<sha>.pdf`, em ordem. */
  assetPaths: string[]
}

export interface ValidateBackupOptions {
  /** Preferências aceitas; sem lista, qualquer chave que não seja credencial. */
  preferenceKeys?: ReadonlySet<string>
}

export type BackupFormat = 'v2' | 'legacy-v1'

/** Lê só o manifesto para decidir entre o formato atual e o do app Swift. */
export async function detectBackupFormat(fs: BackupFileSystem): Promise<BackupFormat> {
  const manifest = await readManifestObject(fs)
  if (manifest.formatVersion === BACKUP_FORMAT_VERSION) return 'v2'
  if (manifest.formatVersion === LEGACY_BACKUP_FORMAT_VERSION) return 'legacy-v1'
  throw BackupError.unsupportedVersion()
}

/** Manifesto como objeto JSON qualquer, com links simbólicos recusados. */
export async function readManifestObject(fs: BackupFileSystem): Promise<Record<string, unknown>> {
  await assertPackageRoot(fs)
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUTF8(await readPackageFile(fs, BACKUP_FILES.manifest)))
  } catch (error) {
    throw BackupError.invalidPackage(error)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw BackupError.invalidPackage()
  return parsed as Record<string, unknown>
}

export async function validateBackup(
  fs: BackupFileSystem,
  options: ValidateBackupOptions = {},
): Promise<BackupContents> {
  const raw = await readManifestObject(fs)
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) {
    if (typeof raw.formatVersion === 'number') throw BackupError.unsupportedVersion()
    throw BackupError.invalidPackage()
  }
  const parsedManifest = backupManifestSchema.safeParse(raw)
  if (!parsedManifest.success) throw BackupError.invalidPackage(parsedManifest.error)
  const manifest: BackupManifest = parsedManifest.data

  const contents = await verifyChecksums(fs, manifest.files, (path) => !isValidAssetPath(path))
  if (!BACKUP_ROOT_FILES.every((path) => contents.has(path))) throw BackupError.invalidPackage()
  const file = (path: string) => contents.get(path)!

  const sermons = decodeJSON(file(BACKUP_FILES.sermons), backupSchemas.sermons)
  const libraryRecords = decodeJSON(file(BACKUP_FILES.library), backupSchemas.library)
  const readerArchive = decodeJSON(file(BACKUP_FILES.reader), backupSchemas.reader)
  const sectionLinks = decodeJSON(file(BACKUP_FILES.sectionLinks), backupSchemas.sectionLinks)
  const preferences = decodeJSON(file(BACKUP_FILES.preferences), backupSchemas.preferences)
  const favoriteSources = decodeJSON(file(BACKUP_FILES.favoriteSources), backupSchemas.favoriteSources)
  const reviewReports = decodeJSON(file(BACKUP_FILES.reviewReports), backupSchemas.reviewReports)

  if (!Object.keys(preferences).every((key) => isBackupPreferenceKey(key, options.preferenceKeys))) {
    throw BackupError.invalidPackage()
  }

  const history: BackupHistoryFile[] = []
  for (const path of Object.keys(manifest.files).sort()) {
    const dateKey = historyDateKey(path)
    if (dateKey === null) continue
    const revisions = decodeJSON(file(path), backupSchemas.history)
    history.push({ dateKey, revisions: sortRevisions(revisions) })
  }

  const assetPaths = Object.keys(manifest.files).filter(isValidAssetPath).sort()
  const assets = new Set(assetPaths)
  const data = { sermons, libraryRecords, readerArchive, sectionLinks }
  if (!referencedPdfPaths(data).every((path) => assets.has(path))) throw BackupError.missingAsset()

  const counts = manifest.counts
  const revisionCount = history.reduce((total, item) => total + item.revisions.length, 0)
  const reportCount = Object.values(reviewReports).reduce((total, reports) => total + reports.length, 0)
  if (
    counts.sermons !== sermons.length ||
    counts.libraryRecords !== libraryRecords.length ||
    counts.historyFiles !== history.length ||
    counts.revisions !== revisionCount ||
    counts.assets !== assetPaths.length ||
    counts.reviewReports !== reportCount
  ) {
    throw BackupError.invalidPackage()
  }

  return {
    manifest,
    sermons,
    history,
    libraryRecords,
    readerArchive,
    sectionLinks,
    preferences,
    favoriteSources,
    reviewReports,
    assetPaths,
  }
}
