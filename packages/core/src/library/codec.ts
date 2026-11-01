import { z } from 'zod'
import {
  PDF_SECTION_COMPONENT_KINDS,
  PDF_SECTION_FINDING_METHODS,
  type PdfLibraryMetadataOverrides,
  type PdfLibraryRecord,
  type PdfSectionComponent,
  type PdfSectionLocation,
  type PdfTextSpan,
} from './model'
import { parseSwiftInt } from './text-utils'

/**
 * Leitura e gravação do JSON do índice no formato do `JSONEncoder` do app Swift: opcionais
 * ausentes ou `null` viram `undefined`, `Data` é base64, `Date` são segundos desde 2001 e
 * dicionários com chave inteira usam números em texto ("1").
 */

/** `decodeIfPresent` aceita `null`; aqui `null` vira ausência antes da validação. */
function dropNulls(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) if (item !== null) result[key] = item
  return result
}

const int = z.number().int()

const positionSchema = z.preprocess(dropNulls, z.object({ page: int, utf16Offset: int }))
const spanSchema = z.preprocess(dropNulls, z.object({ start: positionSchema, end: positionSchema }))

const componentSchema = z.preprocess(
  dropNulls,
  z.object({
    kind: z.enum(PDF_SECTION_COMPONENT_KINDS as [string, ...string[]]),
    title: z.string(),
    author: z.string().optional(),
    location: spanSchema,
    content: spanSchema,
  }),
)

const sectionSchema = z.preprocess(
  dropNulls,
  z.object({
    title: z.string(),
    startPage: int,
    endPage: int,
    context: z.string().optional(),
    components: z.array(componentSchema).optional(),
    findingMethod: z.enum(PDF_SECTION_FINDING_METHODS as [string, ...string[]]).optional(),
  }),
)

const overridesSchema = z.preprocess(
  dropNulls,
  z.object({
    title: z.string(),
    author: z.string(),
    publisher: z.string(),
    year: z.string(),
    volume: z.string(),
    edition: z.string(),
    language: z.string(),
  }),
)

/** `[Int: String]`: todas as chaves precisam ser inteiras, senão o registro é inválido (como no Swift). */
const intKeyedTextSchema = z.record(z.string(), z.string()).transform((value, context) => {
  const result: Record<number, string> = {}
  for (const [key, text] of Object.entries(value)) {
    const page = parseSwiftInt(key)
    if (page === null) {
      context.addIssue({ code: 'custom', message: `Chave de página inválida: ${key}` })
      return z.NEVER
    }
    result[page] = text
  }
  return result
})

const recordSchema = z.preprocess(
  dropNulls,
  z.object({
    id: z.string(),
    title: z.string(),
    path: z.string(),
    pageCount: int,
    bookmarkCount: int,
    author: z.string().optional(),
    coverJPEG: z.string().optional(),
    sections: z.array(sectionSchema).optional(),
    indexVersion: int.optional(),
    copyLabel: z.string().optional(),
    metadataOverrides: overridesSchema.optional(),
    ocrPageNumbers: z.array(int).optional(),
    ocrTextByPage: intKeyedTextSchema.optional(),
    fileSizeBytes: int.optional(),
    fileModificationDate: z.number().optional(),
  }),
)

function withoutUndefined<T extends object>(value: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = item
  return result as T
}

function decodeSpan(value: z.output<typeof spanSchema>): PdfTextSpan {
  return { start: { ...value.start }, end: { ...value.end } }
}

function decodeComponent(value: z.output<typeof componentSchema>): PdfSectionComponent {
  return withoutUndefined({
    kind: value.kind as PdfSectionComponent['kind'],
    title: value.title,
    author: value.author,
    location: decodeSpan(value.location),
    content: decodeSpan(value.content),
  })
}

function decodeParsedSection(value: z.output<typeof sectionSchema>): PdfSectionLocation {
  return withoutUndefined({
    title: value.title,
    startPage: value.startPage,
    endPage: value.endPage,
    context: value.context,
    components: value.components?.map(decodeComponent),
    findingMethod: value.findingMethod as PdfSectionLocation['findingMethod'],
  })
}

/** Seção gravada pelo Swift; registros antigos não têm componentes nem origem. */
export function decodeSectionLocation(value: unknown): PdfSectionLocation | null {
  const parsed = sectionSchema.safeParse(value)
  return parsed.success ? decodeParsedSection(parsed.data) : null
}

/** Um registro do acervo, ou `null` quando não é um registro válido. */
export function decodeLibraryRecord(value: unknown): PdfLibraryRecord | null {
  const parsed = recordSchema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data
  return withoutUndefined({
    id: data.id,
    title: data.title,
    path: data.path,
    pageCount: data.pageCount,
    bookmarkCount: data.bookmarkCount,
    author: data.author,
    coverJPEG: data.coverJPEG,
    sections: data.sections?.map(decodeParsedSection),
    indexVersion: data.indexVersion,
    copyLabel: data.copyLabel,
    metadataOverrides: data.metadataOverrides
      ? ({ ...data.metadataOverrides } as PdfLibraryMetadataOverrides)
      : undefined,
    ocrPageNumbers: data.ocrPageNumbers,
    ocrTextByPage: data.ocrTextByPage,
    fileSizeBytes: data.fileSizeBytes,
    fileModificationDate: data.fileModificationDate,
  })
}

/**
 * Lista de registros (`pregar.library.records.v1`). Diferente do Swift, um registro inválido é
 * descartado sem perder os demais.
 */
export function decodeLibraryRecords(value: unknown): PdfLibraryRecord[] {
  if (!Array.isArray(value)) return []
  return value.map(decodeLibraryRecord).filter((record): record is PdfLibraryRecord => record !== null)
}

function encodeSpan(span: PdfTextSpan): object {
  return {
    start: { page: span.start.page, utf16Offset: span.start.utf16Offset },
    end: { page: span.end.page, utf16Offset: span.end.utf16Offset },
  }
}

function encodeComponent(component: PdfSectionComponent): object {
  return withoutUndefined({
    kind: component.kind,
    title: component.title,
    author: component.author ?? undefined,
    location: encodeSpan(component.location),
    content: encodeSpan(component.content),
  })
}

/** Objeto pronto para `JSON.stringify`, com os campos na ordem do Swift e sem nulos. */
export function encodeSectionLocation(section: PdfSectionLocation): object {
  return withoutUndefined({
    title: section.title,
    startPage: section.startPage,
    endPage: section.endPage,
    context: section.context ?? undefined,
    components: section.components?.map(encodeComponent),
    findingMethod: section.findingMethod ?? undefined,
  })
}

export function encodeLibraryRecord(record: PdfLibraryRecord): object {
  let ocrTextByPage: Record<string, string> | undefined
  if (record.ocrTextByPage) {
    ocrTextByPage = {}
    for (const [page, text] of Object.entries(record.ocrTextByPage)) ocrTextByPage[String(page)] = text
  }
  const overrides = record.metadataOverrides
  return withoutUndefined({
    id: record.id,
    title: record.title,
    path: record.path,
    pageCount: record.pageCount,
    bookmarkCount: record.bookmarkCount,
    author: record.author ?? undefined,
    coverJPEG: record.coverJPEG ?? undefined,
    sections: record.sections?.map(encodeSectionLocation),
    indexVersion: record.indexVersion ?? undefined,
    copyLabel: record.copyLabel ?? undefined,
    metadataOverrides: overrides
      ? {
          title: overrides.title,
          author: overrides.author,
          publisher: overrides.publisher,
          year: overrides.year,
          volume: overrides.volume,
          edition: overrides.edition,
          language: overrides.language,
        }
      : undefined,
    ocrPageNumbers: record.ocrPageNumbers ? [...record.ocrPageNumbers] : undefined,
    ocrTextByPage,
    fileSizeBytes: record.fileSizeBytes ?? undefined,
    fileModificationDate: record.fileModificationDate ?? undefined,
  })
}

export function encodeLibraryRecords(records: readonly PdfLibraryRecord[]): object[] {
  return records.map(encodeLibraryRecord)
}
