import { z } from 'zod'
import type { ReaderArchive, ReaderPdfPosition, ReaderTab, ReaderWebPosition } from './model'

/**
 * Leitura e gravação do arquivo do Leitor no formato do `JSONEncoder` do Swift. Arquivos
 * antigos têm só `tabs` e `selectedID`; abas antigas não têm data, posições nem confirmação.
 */

function dropNulls(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) if (item !== null) result[key] = item
  return result
}

function withoutUndefined<T extends object>(value: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = item
  return result as T
}

const pdfPositionSchema = z.preprocess(
  dropNulls,
  z.object({
    page: z.number().int(),
    x: z.number(),
    y: z.number(),
    scale: z.number(),
    autoScales: z.boolean(),
  }),
)

const webPositionSchema = z.preprocess(dropNulls, z.object({ x: z.number(), y: z.number() }))

const tabSchema = z.preprocess(
  dropNulls,
  z.object({
    id: z.string().min(1),
    title: z.string(),
    kind: z.enum(['pdf', 'web']),
    location: z.string(),
    physicalPage: z.number().int(),
    reference: z.string().optional(),
    sermonDateKey: z.string().optional(),
    includedInReview: z.boolean(),
    reviewInclusionConfirmed: z.boolean().optional(),
    pdfPosition: pdfPositionSchema.optional(),
    webPositions: z.record(z.string(), webPositionSchema).optional(),
    navigationID: z.string().optional(),
  }),
)

const archiveSchema = z.preprocess(
  dropNulls,
  z.object({
    tabs: z.array(z.unknown()),
    selectedID: z.string().optional(),
    activeSermonDateKey: z.string().optional(),
    selectedBySermon: z.record(z.string(), z.string()).optional(),
    closedTabs: z.array(z.unknown()).optional(),
  }),
)

function decodeParsedTab(value: z.output<typeof tabSchema>): ReaderTab {
  let webPositions: Record<string, ReaderWebPosition> | undefined
  if (value.webPositions) {
    webPositions = {}
    for (const [url, position] of Object.entries(value.webPositions))
      webPositions[url] = { x: position.x, y: position.y }
  }
  return withoutUndefined({
    id: value.id,
    title: value.title,
    kind: value.kind,
    location: value.location,
    physicalPage: value.physicalPage,
    reference: value.reference,
    sermonDateKey: value.sermonDateKey,
    includedInReview: value.includedInReview,
    reviewInclusionConfirmed: value.reviewInclusionConfirmed,
    pdfPosition: value.pdfPosition ? ({ ...value.pdfPosition } as ReaderPdfPosition) : undefined,
    webPositions,
    navigationID: value.navigationID,
  })
}

export function decodeReaderTab(value: unknown): ReaderTab | null {
  const parsed = tabSchema.safeParse(value)
  return parsed.success ? decodeParsedTab(parsed.data) : null
}

function decodeTabs(values: readonly unknown[]): ReaderTab[] {
  return values.map(decodeReaderTab).filter((tab): tab is ReaderTab => tab !== null)
}

/**
 * Arquivo do Leitor, compatível com versões antigas. Diferente do Swift, uma aba inválida é
 * descartada sem perder as demais; `null` só quando o arquivo não tem a lista de abas.
 */
export function decodeReaderArchive(value: unknown): ReaderArchive | null {
  const parsed = archiveSchema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data
  return withoutUndefined({
    tabs: decodeTabs(data.tabs),
    selectedID: data.selectedID,
    activeSermonDateKey: data.activeSermonDateKey,
    selectedBySermon: data.selectedBySermon ? { ...data.selectedBySermon } : undefined,
    closedTabs: data.closedTabs ? decodeTabs(data.closedTabs) : undefined,
  })
}

/** Páginas lembradas por PDF e passagem (`reader.section-links.v1`). */
export function decodeRememberedPages(value: unknown): Record<string, number> {
  const parsed = z.record(z.string(), z.number().int()).safeParse(value)
  return parsed.success ? { ...parsed.data } : {}
}

export function encodeReaderTab(tab: ReaderTab): object {
  let webPositions: Record<string, object> | undefined
  if (tab.webPositions) {
    webPositions = {}
    for (const [url, position] of Object.entries(tab.webPositions))
      webPositions[url] = { x: position.x, y: position.y }
  }
  const position = tab.pdfPosition
  return withoutUndefined({
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    location: tab.location,
    physicalPage: tab.physicalPage,
    reference: tab.reference ?? undefined,
    sermonDateKey: tab.sermonDateKey ?? undefined,
    includedInReview: tab.includedInReview,
    reviewInclusionConfirmed: tab.reviewInclusionConfirmed ?? undefined,
    pdfPosition: position
      ? {
          page: position.page,
          x: position.x,
          y: position.y,
          scale: position.scale,
          autoScales: position.autoScales,
        }
      : undefined,
    webPositions,
    navigationID: tab.navigationID ?? undefined,
  })
}

/** Objeto pronto para `JSON.stringify`, com os campos na ordem do Swift. */
export function encodeReaderArchive(archive: ReaderArchive): object {
  return withoutUndefined({
    tabs: archive.tabs.map(encodeReaderTab),
    selectedID: archive.selectedID ?? undefined,
    activeSermonDateKey: archive.activeSermonDateKey ?? undefined,
    selectedBySermon: archive.selectedBySermon ? { ...archive.selectedBySermon } : undefined,
    closedTabs: archive.closedTabs?.map(encodeReaderTab),
  })
}
