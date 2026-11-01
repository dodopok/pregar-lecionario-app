/**
 * Leitura do backup do app Swift (formato 1, `PregarBackupService`) para a migração. Aplica as
 * mesmas verificações do `load` do Swift — manifesto, caminhos, links simbólicos, SHA-256,
 * preferências permitidas, PDFs referenciados e contagens — e devolve os dados tipados, com o
 * RTF dos manuscritos e do histórico como texto. A conversão do RTF fica no pacote do editor.
 */
import { z } from 'zod'
import { dateKey as localDateKey, isDateKey } from '../util/dates'
import type { ManuscriptContent, SermonRevision } from '../history/model'
import { BinaryPlistError, parseBinaryPlist } from './bplist'
import type { PlistDictionary, PlistValue } from './bplist'
import { BackupError } from './errors'
import { isSafeRelativePath, isValidAssetPath, isValidDigest, lastPathComponent, verifyChecksums } from './fs'
import type { BackupFileSystem } from './fs'
import { decodeJSON, decodeUTF8 } from './json'
import type { JsonObject, JsonValue } from './json'
import { LEGACY_BACKUP_FORMAT_VERSION, PDF_TAB_KIND, sectionLinkPath } from './format'
import type { BackupData, BackupLibraryRecord, BackupReaderArchive, BackupSermon } from './format'
import { LEGACY_PREFERENCE_KEYS } from './preferences'
import {
  decodeRTFBytes,
  plistToJSON,
  swiftDataSchema,
  swiftISODateSchema,
  swiftReferenceDateSchema,
} from './swift'
import { readManifestObject } from './validate'

export const LEGACY_BACKUP_FILES = {
  drafts: 'Drafts.json',
  library: 'Library.json',
  preferences: 'Preferences.plist',
  reader: 'Reader.json',
  sectionLinks: 'SectionLinks.json',
} as const

const LEGACY_ROOT_FILES: readonly string[] = Object.values(LEGACY_BACKUP_FILES)

/** `History/<nome>.json` sem subpastas, como `isValidManifestPath` do Swift. */
function isLegacyHistoryPath(path: string): boolean {
  return /^History\/[^/]+\.json$/.test(path) && isSafeRelativePath(path)
}

function isLegacyManifestPath(path: string): boolean {
  return LEGACY_ROOT_FILES.includes(path) || isValidAssetPath(path) || isLegacyHistoryPath(path)
}

// MARK: - Tipos

export interface LegacyManifest {
  formatVersion: typeof LEGACY_BACKUP_FORMAT_VERSION
  createdAt: Date
  appVersion: string
  draftCount: number
  libraryCount: number
  historyFileCount: number
  assetCount: number
  files: Record<string, string>
}

/** `SermonDraftBackup`, com o RTF já como texto e o PDF do tablet relativo ao pacote. */
export interface LegacyDraft {
  liturgicalDate: Date
  title: string
  liturgicalOccasion: string | null
  liturgicalCelebration: string | null
  liturgicalSeason: string | null
  prayerBookID: string | null
  mainReadingReference: string | null
  mainReadingSlot: string | null
  /** `Files/<sha>.pdf`. */
  tabletPDFPath: string | null
  tabletPDFUpdatedAt: Date | null
  googleDriveDraftKey: string | null
  googleDriveDocumentID: string | null
  googleDriveRevisionID: string | null
  googleDriveSyncedAt: Date | null
  googleDriveSyncedContentHash: string | null
  googleDriveSyncError: string | null
  modifiedAt: Date
  rtf: string | null
}

/** `SermonRevision` do Swift. */
export interface LegacyRevision {
  id: string
  version: number
  createdAt: Date
  summary: string
  title: string
  mainReadingReference: string | null
  mainReadingSlot: string | null
  rtf: string | null
  wordCount: number
}

export interface LegacyHistoryFile {
  /** Caminho no pacote, `History/2026-10-04.json`. */
  path: string
  /** Data do sermão tirada do nome do arquivo; `null` se o nome não for yyyy-MM-dd. */
  dateKey: string | null
  revisions: LegacyRevision[]
  /** O arquivo passou no hash mas não é um histórico legível; as revisões ficam vazias. */
  unreadable: boolean
}

export interface LegacyReaderTab {
  id?: string
  title?: string
  kind: string
  location: string
  physicalPage?: number
  [key: string]: unknown
}

export interface LegacyReaderArchive {
  tabs: LegacyReaderTab[]
  selectedID?: string | null
  activeSermonDateKey?: string | null
  selectedBySermon?: Record<string, string> | null
  closedTabs?: LegacyReaderTab[] | null
  [key: string]: unknown
}

export interface LegacyBackup {
  manifest: LegacyManifest
  drafts: LegacyDraft[]
  history: LegacyHistoryFile[]
  /** `PDFLibraryRecord` em JSON bruto; `path` relativo ao pacote. */
  libraryRecords: (JsonObject & { path: string })[]
  readerArchive: LegacyReaderArchive
  /** "Files/<sha>.pdf|referência" → página física. */
  sectionLinks: Record<string, number>
  preferences: PlistDictionary
  /** `Files/<sha>.pdf`, em ordem. */
  assetPaths: string[]
}

// MARK: - Esquemas

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? null)
const optionalDate = swiftISODateSchema.nullish().transform((value) => value ?? null)

const legacyManifestSchema = z.object({
  formatVersion: z.literal(LEGACY_BACKUP_FORMAT_VERSION),
  createdAt: swiftISODateSchema,
  appVersion: z.string(),
  draftCount: z.number().int().nonnegative(),
  libraryCount: z.number().int().nonnegative(),
  historyFileCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  files: z.record(z.string(), z.string()),
})

const legacyDraftSchema = z
  .object({
    liturgicalDate: swiftISODateSchema,
    title: z.string(),
    liturgicalOccasion: optionalText,
    liturgicalCelebration: optionalText,
    liturgicalSeason: optionalText,
    prayerBookID: optionalText,
    mainReadingReference: optionalText,
    mainReadingSlot: optionalText,
    tabletPDFPath: optionalText,
    tabletPDFUpdatedAt: optionalDate,
    googleDriveDraftKey: optionalText,
    googleDriveDocumentID: optionalText,
    googleDriveRevisionID: optionalText,
    googleDriveSyncedAt: optionalDate,
    googleDriveSyncedContentHash: optionalText,
    googleDriveSyncError: optionalText,
    modifiedAt: swiftISODateSchema,
    rtfData: swiftDataSchema.nullish(),
  })
  .transform(({ rtfData, ...draft }): LegacyDraft => ({
    ...draft,
    rtf: rtfData ? decodeRTFBytes(rtfData) : null,
  }))

const legacyRevisionSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    createdAt: swiftReferenceDateSchema,
    summary: z.string(),
    title: z.string(),
    mainReadingReference: optionalText,
    mainReadingSlot: optionalText,
    rtfData: swiftDataSchema.nullish(),
    wordCount: z.number().int(),
  })
  .transform(({ rtfData, ...revision }): LegacyRevision => ({
    ...revision,
    rtf: rtfData ? decodeRTFBytes(rtfData) : null,
  }))

const legacyLibrarySchema = z.array(z.looseObject({ path: z.string() }))
const legacyTabSchema = z.looseObject({ kind: z.string(), location: z.string() })
const legacyReaderSchema = z.looseObject({
  tabs: z.array(legacyTabSchema),
  closedTabs: z.array(legacyTabSchema).nullish(),
})
const legacySectionLinksSchema = z.record(z.string(), z.number().int())

// MARK: - Leitura

/** Lê e valida um backup do app Swift. Erros são `BackupError`, como no `load` do Swift. */
export async function readLegacyBackup(fs: BackupFileSystem): Promise<LegacyBackup> {
  const raw = await readManifestObject(fs)
  if (raw.formatVersion !== LEGACY_BACKUP_FORMAT_VERSION) {
    if (typeof raw.formatVersion === 'number') throw BackupError.unsupportedVersion()
    throw BackupError.invalidPackage()
  }
  const parsedManifest = legacyManifestSchema.safeParse(raw)
  if (!parsedManifest.success) throw BackupError.invalidPackage(parsedManifest.error)
  const manifest: LegacyManifest = parsedManifest.data
  if (
    !Object.entries(manifest.files).every(
      ([path, digest]) => isLegacyManifestPath(path) && isValidDigest(digest),
    )
  ) {
    throw BackupError.invalidPackage()
  }

  const contents = await verifyChecksums(fs, manifest.files, (path) => !isValidAssetPath(path))
  if (!LEGACY_ROOT_FILES.every((path) => contents.has(path))) throw BackupError.invalidPackage()
  const file = (path: string) => contents.get(path)!

  const drafts = decodeJSON(file(LEGACY_BACKUP_FILES.drafts), z.array(legacyDraftSchema))
  const libraryRecords = decodeJSON(
    file(LEGACY_BACKUP_FILES.library),
    legacyLibrarySchema,
  ) as LegacyBackup['libraryRecords']
  const readerArchive = decodeJSON(
    file(LEGACY_BACKUP_FILES.reader),
    legacyReaderSchema,
  ) as LegacyReaderArchive
  const sectionLinks = decodeJSON(file(LEGACY_BACKUP_FILES.sectionLinks), legacySectionLinksSchema)
  const preferences = parsePreferences(file(LEGACY_BACKUP_FILES.preferences))

  const assetPaths = Object.keys(manifest.files).filter(isValidAssetPath).sort()
  const assets = new Set(assetPaths)
  const referenced = [
    ...drafts.flatMap((draft) => (draft.tabletPDFPath ? [draft.tabletPDFPath] : [])),
    ...libraryRecords.map((record) => record.path),
    ...[...readerArchive.tabs, ...(readerArchive.closedTabs ?? [])]
      .filter((tab) => tab.kind === PDF_TAB_KIND)
      .map((tab) => tab.location),
    ...Object.keys(sectionLinks).flatMap((key) => sectionLinkPath(key) ?? []),
  ]
  if (!referenced.every((path) => assets.has(path))) throw BackupError.missingAsset()

  const historyPaths = Object.keys(manifest.files).filter(isLegacyHistoryPath).sort()
  if (
    manifest.draftCount !== drafts.length ||
    manifest.libraryCount !== libraryRecords.length ||
    manifest.historyFileCount !== historyPaths.length ||
    manifest.assetCount !== assetPaths.length
  ) {
    throw BackupError.invalidPackage()
  }

  const history = historyPaths.map((path) => parseLegacyHistoryFile(path, file(path)))
  return { manifest, drafts, history, libraryRecords, readerArchive, sectionLinks, preferences, assetPaths }
}

function parsePreferences(bytes: Uint8Array): PlistDictionary {
  let value: PlistValue
  try {
    value = parseBinaryPlist(bytes)
  } catch (error) {
    if (error instanceof BinaryPlistError) throw BackupError.invalidPackage(error)
    throw error
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Uint8Array ||
    value instanceof Date
  ) {
    throw BackupError.invalidPackage()
  }
  const dictionary = value as PlistDictionary
  if (!Object.keys(dictionary).every((key) => LEGACY_PREFERENCE_KEYS.has(key)))
    throw BackupError.invalidPackage()
  return dictionary
}

/**
 * Um arquivo de `SermonRevisionStore` (`[SermonRevision]` do `JSONEncoder` padrão). O backup
 * Swift não decodifica o histórico; aqui um arquivo ilegível não impede a migração do resto.
 */
export function parseLegacyHistoryFile(path: string, bytes: Uint8Array): LegacyHistoryFile {
  const stem = lastPathComponent(path).replace(/\.json$/, '')
  const dateKey = isDateKey(stem) ? stem : null
  try {
    const parsed = z.array(legacyRevisionSchema).safeParse(JSON.parse(decodeUTF8(bytes)))
    if (parsed.success) {
      const revisions = parsed.data.sort((a, b) => a.version - b.version)
      return { path, dateKey, revisions, unreadable: false }
    }
  } catch {
    // JSON inválido: cai no retorno abaixo.
  }
  return { path, dateKey, revisions: [], unreadable: true }
}

// MARK: - Conversão para o formato atual

/** Resultado da conversão de um RTF pelo pacote do editor. */
export interface ConvertedManuscript {
  content: ManuscriptContent
  plainText: string
}

export interface ConvertLegacyOptions {
  /** Converte RTF para o documento do editor; sem conversor, o RTF segue como `format: 'rtf'`. */
  convertRTF?: (rtf: string) => ConvertedManuscript | null | Promise<ConvertedManuscript | null>
  /** Chave yyyy-MM-dd da data litúrgica (meia-noite local no Mac de origem). Padrão: fuso local. */
  dateKeyOf?: (date: Date) => string
}

/** Dados do backup antigo no formato atual, prontos para `planRestore`. */
export interface ConvertedLegacyBackup extends BackupData {
  assetPaths: string[]
  /** Arquivos de histórico ilegíveis ou com nome fora de yyyy-MM-dd, deixados de fora. */
  skippedHistoryFiles: string[]
}

const FAVORITE_SITES_KEY = 'pregar.favorite-sites.v1'
const FAVORITE_AUTHORS_KEY = 'pregar.favorite-authors.v1'

export async function convertLegacyBackup(
  legacy: LegacyBackup,
  options: ConvertLegacyOptions = {},
): Promise<ConvertedLegacyBackup> {
  const dateKeyOf = options.dateKeyOf ?? localDateKey
  const convert = async (
    rtf: string | null,
  ): Promise<{ content: ManuscriptContent | null; plainText: string }> => {
    if (rtf === null) return { content: null, plainText: '' }
    const converted = options.convertRTF ? await options.convertRTF(rtf) : null
    return converted ?? { content: { format: 'rtf', data: rtf }, plainText: '' }
  }

  const sermons: BackupSermon[] = []
  for (const draft of legacy.drafts) {
    const { content, plainText } = await convert(draft.rtf)
    sermons.push({
      dateKey: dateKeyOf(draft.liturgicalDate),
      title: draft.title,
      content,
      plainText,
      liturgicalOccasion: draft.liturgicalOccasion,
      liturgicalCelebration: draft.liturgicalCelebration,
      liturgicalSeason: draft.liturgicalSeason,
      prayerBookId: draft.prayerBookID,
      mainReadingReference: draft.mainReadingReference,
      mainReadingSlot: draft.mainReadingSlot,
      tabletPdfPath: draft.tabletPDFPath,
      tabletPdfUpdatedAt: draft.tabletPDFUpdatedAt?.toISOString() ?? null,
      googleDriveDraftKey: draft.googleDriveDraftKey,
      googleDriveDocumentId: draft.googleDriveDocumentID,
      googleDriveRevisionId: draft.googleDriveRevisionID,
      googleDriveSyncedAt: draft.googleDriveSyncedAt?.toISOString() ?? null,
      googleDriveSyncedContentHash: draft.googleDriveSyncedContentHash,
      googleDriveSyncError: draft.googleDriveSyncError,
      modifiedAt: draft.modifiedAt.toISOString(),
    })
  }

  const history: BackupData['history'] = []
  const skippedHistoryFiles: string[] = []
  for (const item of legacy.history) {
    if (item.unreadable || item.dateKey === null) {
      skippedHistoryFiles.push(item.path)
      continue
    }
    const revisions: SermonRevision[] = []
    for (const revision of item.revisions) {
      const { content, plainText } = await convert(revision.rtf)
      revisions.push({
        id: revision.id,
        version: revision.version,
        createdAt: revision.createdAt.toISOString(),
        summary: revision.summary,
        title: revision.title,
        mainReadingReference: revision.mainReadingReference,
        mainReadingSlot: revision.mainReadingSlot,
        content,
        plainText,
        wordCount: revision.wordCount,
      })
    }
    history.push({ dateKey: item.dateKey, revisions })
  }

  const preferences: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(legacy.preferences)) {
    if (key === FAVORITE_SITES_KEY || key === FAVORITE_AUTHORS_KEY) continue
    Object.defineProperty(preferences, key, {
      value: plistToJSON(value),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  const favoriteList = (key: string): JsonValue[] => {
    const value = legacy.preferences[key]
    const decoded = value === undefined ? null : plistToJSON(value)
    return Array.isArray(decoded) ? decoded : []
  }

  return {
    sermons,
    history,
    libraryRecords: legacy.libraryRecords as BackupLibraryRecord[],
    readerArchive: legacy.readerArchive as BackupReaderArchive,
    sectionLinks: { ...legacy.sectionLinks },
    preferences,
    favoriteSources: { sites: favoriteList(FAVORITE_SITES_KEY), authors: favoriteList(FAVORITE_AUTHORS_KEY) },
    // O backup Swift não inclui os relatórios de revisão (pasta AIReviews).
    reviewReports: {},
    assetPaths: [...legacy.assetPaths],
    skippedHistoryFiles,
  }
}
