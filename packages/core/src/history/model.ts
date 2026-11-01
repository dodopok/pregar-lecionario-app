/**
 * Modelo do histórico de versões do sermão, porte de `SermonRevisionSnapshot`/`SermonRevision`
 * (SermonHistory.swift). O conteúdo do manuscrito é opaco: JSON do editor no app novo ou RTF
 * herdado do app Swift, para que snapshots antigos sejam carregados sem conversão.
 */
import { z } from 'zod'
import { countWords } from '../util/text'

export type ManuscriptFormat = 'tiptap-json' | 'rtf'

export interface ManuscriptContent {
  readonly format: ManuscriptFormat
  /** Documento serializado (JSON do editor ou RTF), sem interpretação aqui. */
  readonly data: string
}

/** Valor imutável capturado do rascunho antes do atraso de inatividade. */
export interface SermonRevisionSnapshot {
  readonly title: string
  readonly mainReadingReference: string | null
  readonly mainReadingSlot: string | null
  readonly content: ManuscriptContent | null
  /** Texto simples, usado na comparação lado a lado e na contagem de palavras. */
  readonly plainText: string
  readonly wordCount: number
}

export interface SermonRevision extends SermonRevisionSnapshot {
  readonly id: string
  readonly version: number
  /** ISO 8601. */
  readonly createdAt: string
  readonly summary: string
}

export interface SnapshotInput {
  title: string
  mainReadingReference?: string | null
  mainReadingSlot?: string | null
  content?: ManuscriptContent | null
  plainText?: string
  /** Quando ausente, é calculada a partir de `plainText`. */
  wordCount?: number
}

/** Cria um snapshot congelado; nenhuma edição posterior do rascunho o altera. */
export function createRevisionSnapshot(input: SnapshotInput): SermonRevisionSnapshot {
  const plainText = input.plainText ?? ''
  const content = input.content
    ? Object.freeze({ format: input.content.format, data: input.content.data })
    : null
  return Object.freeze({
    title: input.title,
    mainReadingReference: input.mainReadingReference ?? null,
    mainReadingSlot: input.mainReadingSlot ?? null,
    content,
    plainText,
    wordCount: input.wordCount ?? countWords(plainText),
  })
}

/** Snapshot da revisão (cópia imutável, sem id, versão, data e resumo). */
export function revisionSnapshot(revision: SermonRevision): SermonRevisionSnapshot {
  return createRevisionSnapshot(revision)
}

export function contentEquals(a: ManuscriptContent | null, b: ManuscriptContent | null): boolean {
  if (a === null || b === null) return a === b
  return a.format === b.format && a.data === b.data
}

/**
 * Igualdade usada na deduplicação, como `matches` no Swift: título, leitura principal e conteúdo.
 * A contagem de palavras e o texto simples são derivados e não entram na comparação.
 */
export function snapshotsMatch(a: SermonRevisionSnapshot, b: SermonRevisionSnapshot): boolean {
  return (
    a.title === b.title &&
    (a.mainReadingReference ?? null) === (b.mainReadingReference ?? null) &&
    (a.mainReadingSlot ?? null) === (b.mainReadingSlot ?? null) &&
    contentEquals(a.content ?? null, b.content ?? null)
  )
}

export function createRevision(fields: {
  id: string
  version: number
  createdAt: string
  summary: string
  snapshot: SermonRevisionSnapshot
}): SermonRevision {
  const snapshot = createRevisionSnapshot(fields.snapshot)
  return Object.freeze({
    id: fields.id,
    version: fields.version,
    createdAt: fields.createdAt,
    summary: fields.summary,
    ...snapshot,
  })
}

export function sortRevisions(revisions: readonly SermonRevision[]): SermonRevision[] {
  return [...revisions].sort((a, b) => a.version - b.version)
}

export const manuscriptContentSchema = z.object({
  format: z.enum(['tiptap-json', 'rtf']),
  data: z.string(),
})

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data ISO 8601 inválida.')

/** Esquema de uma revisão persistida (armazenamento local e backup). */
export const sermonRevisionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: isoDateString,
  summary: z.string(),
  title: z.string(),
  mainReadingReference: z.string().nullable(),
  mainReadingSlot: z.string().nullable(),
  content: manuscriptContentSchema.nullable(),
  plainText: z.string(),
  wordCount: z.number().int().nonnegative(),
})

export const sermonRevisionListSchema = z.array(sermonRevisionSchema)
