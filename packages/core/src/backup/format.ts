/**
 * Formato 2 do pacote de backup, o do app multiplataforma. Uma pasta com:
 *
 * - `Manifest.json`: versão, data, versão do app, contagens e SHA-256 de cada arquivo;
 * - `Sermons.json`, `Library.json`, `Reader.json`, `SectionLinks.json`, `Preferences.json`,
 *   `FavoriteSources.json`, `ReviewReports.json`;
 * - `History/yyyy-MM-dd.json`: revisões de cada sermão;
 * - `Files/<sha256>.pdf`: cada PDF uma vez só, referenciado pelos JSON por esse caminho.
 *
 * Credenciais nunca entram. O formato 1 (app Swift) é lido por `readLegacyBackup`.
 */
import { z } from 'zod'
import { isDateKey, isSermonKey } from '../util/dates'
import { manuscriptContentSchema, sermonRevisionListSchema } from '../history/model'
import type { ManuscriptContent, SermonRevision } from '../history/model'
import type { JsonValue } from './json'
import { isValidAssetPath, isValidDigest } from './fs'

export const BACKUP_FORMAT_VERSION = 2
export const LEGACY_BACKUP_FORMAT_VERSION = 1

export const BACKUP_FILES = {
  manifest: 'Manifest.json',
  sermons: 'Sermons.json',
  library: 'Library.json',
  reader: 'Reader.json',
  sectionLinks: 'SectionLinks.json',
  preferences: 'Preferences.json',
  favoriteSources: 'FavoriteSources.json',
  reviewReports: 'ReviewReports.json',
} as const

export const BACKUP_ROOT_FILES: readonly string[] = [
  BACKUP_FILES.sermons,
  BACKUP_FILES.library,
  BACKUP_FILES.reader,
  BACKUP_FILES.sectionLinks,
  BACKUP_FILES.preferences,
  BACKUP_FILES.favoriteSources,
  BACKUP_FILES.reviewReports,
]

const HISTORY_PATH = /^History\/(\d{4}-\d{2}-\d{2}(?:-[a-z0-9]{4})?)\.json$/

export function historyPathFor(dateKey: string): string {
  return `History/${dateKey}.json`
}

export function historyDateKey(path: string): string | null {
  const key = HISTORY_PATH.exec(path)?.[1]
  return key && isDateKey(key) ? key : null
}

export function isValidManifestPath(path: string): boolean {
  return BACKUP_ROOT_FILES.includes(path) || isValidAssetPath(path) || historyDateKey(path) !== null
}

// MARK: - Dados

/** Sermão como sai do banco local; campos extras são preservados. */
export interface BackupSermon {
  dateKey: string
  title: string
  content: ManuscriptContent | null
  plainText?: string
  liturgicalOccasion?: string | null
  liturgicalCelebration?: string | null
  liturgicalSeason?: string | null
  prayerBookId?: string | null
  mainReadingReference?: string | null
  mainReadingSlot?: string | null
  /** Caminho do PDF do tablet: absoluto na origem, `Files/<sha>.pdf` dentro do pacote. */
  tabletPdfPath?: string | null
  tabletPdfUpdatedAt?: string | null
  googleDriveDraftKey?: string | null
  googleDriveDocumentId?: string | null
  googleDriveRevisionId?: string | null
  googleDriveSyncedAt?: string | null
  googleDriveSyncedContentHash?: string | null
  googleDriveSyncError?: string | null
  /** ISO 8601. */
  modifiedAt: string
  [key: string]: unknown
}

export interface BackupHistoryFile {
  dateKey: string
  revisions: SermonRevision[]
}

/** Registro da Biblioteca; `path` aponta para o PDF. */
export interface BackupLibraryRecord {
  path: string
  [key: string]: unknown
}

export interface BackupReaderTab {
  kind: string
  /** URL (aba web) ou caminho do PDF (aba pdf). */
  location: string
  [key: string]: unknown
}

export interface BackupReaderArchive {
  tabs: BackupReaderTab[]
  closedTabs?: BackupReaderTab[] | null
  [key: string]: unknown
}

export interface BackupFavoriteSources {
  sites: JsonValue[]
  authors: JsonValue[]
}

/** Conteúdo lógico de um backup, sem os PDFs. */
export interface BackupData {
  sermons: BackupSermon[]
  history: BackupHistoryFile[]
  libraryRecords: BackupLibraryRecord[]
  readerArchive: BackupReaderArchive
  /** "caminho do PDF|referência" → página física lembrada. */
  sectionLinks: Record<string, number>
  preferences: Record<string, JsonValue>
  favoriteSources: BackupFavoriteSources
  /** Relatórios de revisão por data do sermão, no esquema do contrato de revisão. */
  reviewReports: Record<string, JsonValue[]>
}

export interface BackupCounts {
  sermons: number
  historyFiles: number
  revisions: number
  libraryRecords: number
  assets: number
  reviewReports: number
}

export interface BackupManifest {
  formatVersion: typeof BACKUP_FORMAT_VERSION
  /** ISO 8601. */
  createdAt: string
  appVersion: string
  counts: BackupCounts
  /** Caminho relativo → SHA-256 em hexadecimal minúsculo. */
  files: Record<string, string>
}

// MARK: - Esquemas

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Data ISO 8601 inválida.')
const dateKey = z
  .string()
  .refine(isSermonKey, 'Chave de preparação inválida (yyyy-MM-dd ou yyyy-MM-dd-xxxx).')
const optionalText = z.string().nullable().optional()
const count = z.number().int().nonnegative()

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const backupManifestSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  createdAt: isoDate,
  appVersion: z.string(),
  counts: z.object({
    sermons: count,
    historyFiles: count,
    revisions: count,
    libraryRecords: count,
    assets: count,
    reviewReports: count,
  }),
  files: z
    .record(z.string(), z.string())
    .refine((files) =>
      Object.entries(files).every(([path, digest]) => isValidManifestPath(path) && isValidDigest(digest)),
    ),
})

export const backupSermonSchema = z.looseObject({
  dateKey,
  title: z.string(),
  content: manuscriptContentSchema.nullable(),
  plainText: z.string().optional(),
  liturgicalOccasion: optionalText,
  liturgicalCelebration: optionalText,
  liturgicalSeason: optionalText,
  prayerBookId: optionalText,
  mainReadingReference: optionalText,
  mainReadingSlot: optionalText,
  tabletPdfPath: optionalText,
  tabletPdfUpdatedAt: isoDate.nullable().optional(),
  googleDriveDraftKey: optionalText,
  googleDriveDocumentId: optionalText,
  googleDriveRevisionId: optionalText,
  googleDriveSyncedAt: isoDate.nullable().optional(),
  googleDriveSyncedContentHash: optionalText,
  googleDriveSyncError: optionalText,
  modifiedAt: isoDate,
})

export const backupLibraryRecordSchema = z.looseObject({ path: z.string() })
export const backupReaderTabSchema = z.looseObject({ kind: z.string(), location: z.string() })
export const backupReaderArchiveSchema = z.looseObject({
  tabs: z.array(backupReaderTabSchema),
  closedTabs: z.array(backupReaderTabSchema).nullable().optional(),
})
export const sectionLinksSchema = z.record(z.string(), z.number().int())
export const preferencesSchema = z.record(z.string(), jsonValueSchema)
export const favoriteSourcesSchema = z.object({
  sites: z.array(jsonValueSchema),
  authors: z.array(jsonValueSchema),
})
export const reviewReportsSchema = z
  .record(z.string(), z.array(jsonValueSchema))
  .refine((reports) => Object.keys(reports).every(isSermonKey), 'Chave de preparação inválida.')

export const backupSchemas = {
  sermons: z.array(backupSermonSchema),
  library: z.array(backupLibraryRecordSchema),
  reader: backupReaderArchiveSchema,
  sectionLinks: sectionLinksSchema,
  preferences: preferencesSchema,
  favoriteSources: favoriteSourcesSchema,
  reviewReports: reviewReportsSchema,
  history: sermonRevisionListSchema,
}

// MARK: - Referências a PDFs

export const PDF_TAB_KIND = 'pdf'

/** Caminho do PDF de uma chave "caminho|referência" das páginas lembradas. */
export function sectionLinkPath(key: string): string | null {
  const separator = key.lastIndexOf('|')
  return separator === -1 ? null : key.slice(0, separator)
}

/** Todos os caminhos de PDF citados pelos dados (tablet, Biblioteca, abas abertas e fechadas, vínculos). */
export function referencedPdfPaths(data: PdfReferencingData): string[] {
  const paths = new Set<string>()
  for (const sermon of data.sermons) if (sermon.tabletPdfPath) paths.add(sermon.tabletPdfPath)
  for (const record of data.libraryRecords) paths.add(record.path)
  for (const tab of [...data.readerArchive.tabs, ...(data.readerArchive.closedTabs ?? [])]) {
    if (tab.kind === PDF_TAB_KIND) paths.add(tab.location)
  }
  for (const key of Object.keys(data.sectionLinks)) {
    const path = sectionLinkPath(key)
    if (path !== null) paths.add(path)
  }
  return [...paths]
}

/**
 * Substitui os caminhos de PDF dos dados. `map` devolve o novo caminho ou `null` quando o PDF não
 * está disponível; os chamadores decidem se isso é erro (`onMissing`) ou descarte.
 */
export type PdfReferencingData = Pick<
  BackupData,
  'sermons' | 'libraryRecords' | 'readerArchive' | 'sectionLinks'
>

export function remapPdfPaths(
  data: PdfReferencingData,
  map: (path: string) => string | null,
  onMissing: () => never,
): PdfReferencingData {
  const required = (path: string) => map(path) ?? onMissing()
  const sermons = data.sermons.map((sermon) =>
    sermon.tabletPdfPath ? { ...sermon, tabletPdfPath: required(sermon.tabletPdfPath) } : { ...sermon },
  )
  const libraryRecords = data.libraryRecords.map((record) => ({ ...record, path: required(record.path) }))
  const remapTab = (tab: BackupReaderTab) =>
    tab.kind === PDF_TAB_KIND ? { ...tab, location: required(tab.location) } : { ...tab }
  // Abas fechadas cujo PDF sumiu são descartadas, como no Swift.
  const closedTabs = data.readerArchive.closedTabs
    ?.filter((tab) => tab.kind !== PDF_TAB_KIND || map(tab.location) !== null)
    .map(remapTab)
  const readerArchive: BackupReaderArchive = {
    ...data.readerArchive,
    tabs: data.readerArchive.tabs.map(remapTab),
  }
  if (closedTabs !== undefined) readerArchive.closedTabs = closedTabs
  // Vínculos de PDFs ausentes são descartados.
  const sectionLinks: Record<string, number> = {}
  for (const [key, page] of Object.entries(data.sectionLinks)) {
    const path = sectionLinkPath(key)
    const replacement = path === null ? null : map(path)
    if (replacement === null) continue
    Object.defineProperty(sectionLinks, `${replacement}|${key.slice(path!.length + 1)}`, {
      value: page,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return { sermons, libraryRecords, readerArchive, sectionLinks }
}
