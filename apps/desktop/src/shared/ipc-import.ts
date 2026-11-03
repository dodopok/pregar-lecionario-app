import type { MetadataSource } from '@pregar/core/import/metadata'
import type { SermonRecord } from './types'

export type ImportFormat = 'docx' | 'rtf' | 'txt' | 'md'

/** Um arquivo escolhido para importação, já convertido e com os metadados detectados. */
export interface ImportCandidate {
  id: string
  path: string
  fileName: string
  format: ImportFormat
  detected: {
    dateKey: string | null
    /** Passagem na forma gravada em `mainReadingReference` ("Mateus 25:1-13"). */
    reference: string | null
    title: string
    /** De onde vieram a data e a passagem (nome do arquivo, primeiras linhas ou nada). */
    confidence: { date: MetadataSource; reference: MetadataSource }
  }
  wordCount: number
  /** Avisos de conversão (formatação perdida, data ambígua...). */
  warnings: string[]
  /** Por que o arquivo não pode ser importado (não convertido, grande demais...); nulo quando está pronto. */
  error: string | null
}

export interface ImportConfirmItem {
  id: string
  dateKey: string
  title: string
  mainReadingReference: string | null
}

export interface ImportResult {
  id: string
  status: 'imported' | 'skipped' | 'failed'
  dateKey: string
  message: string | null
  record: SermonRecord | null
}

/** Canais da importação de sermões antigos (módulo `modules/content/import`). */
export interface ImportInvokeChannels {
  /** Abre o seletor de arquivos, converte cada um e devolve os candidatos (nada é gravado ainda). */
  'import:pick': { req: void; res: ImportCandidate[] }
  /** Grava os candidatos confirmados; uma data já ocupada por um sermão com texto é pulada. */
  'import:confirm': { req: { items: ImportConfirmItem[] }; res: ImportResult[] }
  /** Descarta os candidatos em memória. */
  'import:cancel': { req: void; res: void }
}
