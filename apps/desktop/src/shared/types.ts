/** Tipos compartilhados entre o processo principal e as janelas. */

export type AIProviderId = 'openai' | 'anthropic' | 'google' | 'perplexity'

export type SecretName = 'estevao' | 'openai' | 'anthropic' | 'google' | 'perplexity' | 'driveApiKey'

export type SecretStatus = Record<SecretName, boolean> & { encryptionAvailable: boolean }

export type WindowKind = 'mesa' | 'leitor' | 'biblioteca' | 'arquivo' | 'biblia' | 'preferencias'

export interface AppInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  userDataPath: string
  isPackaged: boolean
  electron: string
}

export type SermonPreparationState = 'empty' | 'inProgress' | 'exported'

export interface SermonDriveLink {
  draftKey: string | null
  documentId: string | null
  revisionId: string | null
  syncedAt: string | null
  syncedContentHash: string | null
  syncError: string | null
}

export interface SermonRecord {
  dateKey: string
  title: string
  liturgicalOccasion: string | null
  liturgicalCelebration: string | null
  liturgicalSeason: string | null
  prayerBookId: string | null
  mainReadingReference: string | null
  mainReadingSlot: string | null
  /** Documento do editor (JSON do TipTap) serializado. */
  doc: string | null
  plainText: string
  wordCount: number
  tabletPdfPath: string | null
  tabletPdfUpdatedAt: string | null
  drive: SermonDriveLink
  createdAt: string
  modifiedAt: string
}

export type SermonPatch = Partial<Omit<SermonRecord, 'dateKey' | 'createdAt' | 'modifiedAt' | 'drive'>> & {
  drive?: Partial<SermonDriveLink>
}

export interface SermonSummary {
  dateKey: string
  title: string
  liturgicalOccasion: string | null
  liturgicalCelebration: string | null
  liturgicalSeason: string | null
  mainReadingReference: string | null
  wordCount: number
  modifiedAt: string
  state: SermonPreparationState
  driveSyncedAt: string | null
  tabletPdfUpdatedAt: string | null
  /** Trecho ao redor da ocorrência na busca de texto. */
  snippet?: string
}

export type ArchiveSearchMode = 'passage' | 'occasion' | 'date' | 'text'

/** Preparação anterior relacionada com o dia aberto ("Já preguei sobre isto"). */
export interface RelatedSermon extends SermonSummary {
  relation: 'passage' | 'occasion'
  /** Como a passagem principal daquela preparação se relaciona com a leitura do dia. */
  relationKind: 'exact' | 'contains' | 'partial' | 'context' | null
  /** Leitura do dia com a qual a preparação casou. */
  matchedReference: string | null
}

export interface PregarAPIErrorInfo {
  code: string
  message: string
  status: number
}

/** Resultado padronizado de IPC: erros viram mensagens em português para a interface. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: PregarAPIErrorInfo }
