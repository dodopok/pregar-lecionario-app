import { parseAllReferences, parseHeadingReference } from '../bible/reference'
import { enrichFeastingSections } from './feasting'
import { countBookmarks, flattenOutline, scanHeadings } from './headings'
import { sameIndexedReference } from './matching'
import {
  authorsFromPdfMetadata,
  copyLabelFromFilename,
  filenameFromPath,
  isFeastingTitle,
  titleFromPdfMetadata,
} from './metadata'
import {
  swiftDateFromDate,
  type PdfLibraryOcrResult,
  type PdfLibraryRecord,
  type PdfSectionLocation,
  type PdfTextSpan,
} from './model'
import { cachedPdfTextSource, pdfPageString, type PdfTextSource } from './text-source'
import { localizedStandardCompare, nonBlank, trimWhitespace } from './text-utils'

/**
 * Versão atual do índice. A 4 delimita o texto bíblico e as perspectivas do Feasting com
 * offsets dentro da página e autores.
 */
export const PDF_LIBRARY_INDEX_VERSION = 4

/** Arquivo indexado. Tamanho e data permitem reaproveitar o OCR enquanto o PDF não mudar. */
export interface PdfFileInfo {
  /** Caminho do PDF; vira `id` e `path` do registro. */
  path: string
  sizeBytes?: number | null
  /** `Date` ou segundos desde 2001-01-01 UTC, como gravado pelo Swift. */
  modificationDate?: Date | number | null
}

export interface IndexPdfOptions {
  previousRecord?: PdfLibraryRecord | null
  /** Miniatura JPEG da primeira página em base64, gerada pelo app. */
  coverJPEG?: string | null
  signal?: AbortSignal
}

/** Diferença tolerada entre datas de modificação, para absorver o arredondamento entre plataformas. */
const MODIFICATION_DATE_TOLERANCE_SECONDS = 0.001

function hasSameFileContents(
  record: PdfLibraryRecord,
  previous: PdfLibraryRecord | null | undefined,
): boolean {
  if (!previous) return false
  const { fileSizeBytes: size, fileModificationDate: date } = record
  const { fileSizeBytes: previousSize, fileModificationDate: previousDate } = previous
  if (size === undefined || previousSize === undefined || date === undefined || previousDate === undefined)
    return false
  return (
    record.path === previous.path &&
    size === previousSize &&
    Math.abs(date - previousDate) <= MODIFICATION_DATE_TOLERANCE_SECONDS
  )
}

/**
 * Junta seções achadas por OCR às existentes, sem repetir passagens já indexadas (pelo título
 * ou pelo contexto), e ordena por página e título.
 */
export function mergeOcrSections(
  ocrSections: readonly PdfSectionLocation[],
  sections: readonly PdfSectionLocation[],
): PdfSectionLocation[] {
  const merged = [...sections]
  for (const candidate of ocrSections) {
    if (candidate.findingMethod !== 'ocrHeading') continue
    const reference = parseHeadingReference(candidate.title)
    if (!reference) continue
    const alreadyIndexed = merged.some((section) =>
      [section.title, section.context]
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) => parseAllReferences(value))
        .some((existing) => sameIndexedReference(existing, reference)),
    )
    if (!alreadyIndexed) merged.push(candidate)
  }
  return merged.sort((a, b) =>
    a.startPage === b.startPage ? localizedStandardCompare(a.title, b.title) : a.startPage - b.startPage,
  )
}

async function makeRecord(
  source: PdfTextSource,
  file: PdfFileInfo,
  options: IndexPdfOptions,
): Promise<PdfLibraryRecord | null> {
  if (source.pageCount <= 0) return null
  const { signal } = options
  const metadata = await source.metadata()
  const filename = filenameFromPath(file.path)
  const metadataTitle =
    metadata.title === null || metadata.title === undefined ? null : trimWhitespace(metadata.title)
  const metadataAuthor =
    metadata.author === null || metadata.author === undefined ? null : trimWhitespace(metadata.author)
  const title = titleFromPdfMetadata(metadataTitle, filename)
  const author = authorsFromPdfMetadata(metadataAuthor, title)
  const outline = await source.outline()
  const bookmarks = flattenOutline(outline, source.pageCount)
  const rawSections = bookmarks.length === 0 ? await scanHeadings(source, { signal }) : bookmarks
  signal?.throwIfAborted()
  const sections = await enrichFeastingSections(rawSections, source, title)
  const copyLabel = copyLabelFromFilename(filename)

  const record: PdfLibraryRecord = {
    id: file.path,
    title,
    path: file.path,
    pageCount: source.pageCount,
    bookmarkCount: countBookmarks(outline),
  }
  if (author !== undefined) record.author = author
  if (options.coverJPEG) record.coverJPEG = options.coverJPEG
  record.sections = sections
  record.indexVersion = PDF_LIBRARY_INDEX_VERSION
  if (copyLabel !== undefined) record.copyLabel = copyLabel
  if (file.sizeBytes !== null && file.sizeBytes !== undefined) record.fileSizeBytes = file.sizeBytes
  const modification = file.modificationDate
  if (modification !== null && modification !== undefined) {
    record.fileModificationDate =
      typeof modification === 'number' ? modification : swiftDateFromDate(modification)
  }

  const previous = options.previousRecord
  if (previous && hasSameFileContents(record, previous)) {
    if (previous.ocrPageNumbers !== undefined) record.ocrPageNumbers = [...previous.ocrPageNumbers]
    if (previous.ocrTextByPage !== undefined) record.ocrTextByPage = { ...previous.ocrTextByPage }
    const merged = mergeOcrSections(
      (previous.sections ?? []).filter((section) => section.findingMethod === 'ocrHeading'),
      record.sections ?? [],
    )
    record.sections = await enrichFeastingSections(merged, source, title, previous.ocrTextByPage ?? {})
  }
  return record
}

/**
 * Indexa um PDF: título e autoria dos metadados, seções pelos bookmarks (ou por cabeçalhos
 * textuais quando não há sumário), componentes do Feasting e, se o arquivo não mudou desde o
 * registro anterior, o OCR já feito. A correção de metadados é aplicada à parte, com
 * `preservingMetadata`. Devolve `null` para PDFs sem páginas.
 */
export async function indexPdf(
  source: PdfTextSource,
  file: PdfFileInfo,
  options: IndexPdfOptions = {},
): Promise<PdfLibraryRecord | null> {
  return makeRecord(cachedPdfTextSource(source), file, options)
}

export interface RecognizeScannedPagesOptions extends IndexPdfOptions {
  /** OCR da página `pageIndex` (0-based); `null` ou texto vazio quando nada foi reconhecido. */
  recognizePage: (pageIndex: number, signal?: AbortSignal) => Promise<string | null>
  /** Progresso: páginas concluídas e total desta execução (a cada 8 páginas e no fim). */
  onProgress?: (completed: number, total: number) => void
}

/**
 * OCR sob demanda: reconhece só as páginas sem texto selecionável que ainda não foram
 * examinadas, procura cabeçalhos nelas e guarda o texto reconhecido por página no registro.
 * O PDF não é alterado. Cancelamento via `signal` rejeita a promessa (o índice anterior fica).
 */
export async function recognizeScannedPages(
  source: PdfTextSource,
  file: PdfFileInfo,
  options: RecognizeScannedPagesOptions,
): Promise<PdfLibraryOcrResult | null> {
  const cached = cachedPdfTextSource(source)
  const record = await makeRecord(cached, file, options)
  if (!record) return null
  const { signal } = options

  const scanned = new Set(record.ocrPageNumbers ?? [])
  const candidatePages: number[] = []
  for (let pageNumber = 1; pageNumber <= cached.pageCount; pageNumber += 1) {
    if (nonBlank(await pdfPageString(cached, pageNumber)) === null) candidatePages.push(pageNumber)
  }
  const pagesToScan = candidatePages.filter((page) => !scanned.has(page))
  const recognizedText: Record<number, string> = {}
  let recognizedCount = 0
  const attempted = new Set(scanned)
  options.onProgress?.(0, pagesToScan.length)

  for (const [offset, pageNumber] of pagesToScan.entries()) {
    signal?.throwIfAborted()
    const text = await options.recognizePage(pageNumber - 1, signal)
    if (text !== null && text !== '') {
      recognizedText[pageNumber] = text
      recognizedCount += 1
    }
    attempted.add(pageNumber)
    if ((offset + 1) % 8 === 0 || offset + 1 === pagesToScan.length)
      options.onProgress?.(offset + 1, pagesToScan.length)
  }
  signal?.throwIfAborted()

  const recognizedSections =
    recognizedCount === 0
      ? []
      : await scanHeadings(cached, { ocrTextByPage: recognizedText, documentTitle: record.title, signal })
  const previousSectionCount = record.sections?.length ?? 0
  const mergedSections = mergeOcrSections(recognizedSections, record.sections ?? [])
  const allOcrText: Record<number, string> = { ...record.ocrTextByPage, ...recognizedText }
  record.sections = await enrichFeastingSections(mergedSections, cached, record.title, allOcrText)
  record.ocrPageNumbers = [...attempted].sort((a, b) => a - b)
  record.ocrTextByPage = allOcrText
  return {
    record,
    candidatePageCount: candidatePages.length,
    scannedPageCount: pagesToScan.length,
    recognizedTextPageCount: recognizedCount,
    sectionsFound: Math.max(0, record.sections.length - previousSectionCount),
  }
}

export interface SectionsForDocumentOptions {
  /** Título da obra (exibido); sem ele, usa os metadados e `filename`. */
  title?: string | null
  filename?: string
}

/** Seções de um PDF aberto no Leitor que ainda não está no acervo. */
export async function sectionsForDocument(
  source: PdfTextSource,
  options: SectionsForDocumentOptions = {},
): Promise<PdfSectionLocation[]> {
  const cached = cachedPdfTextSource(source)
  const bookmarks = flattenOutline(await cached.outline(), cached.pageCount)
  const rawSections = bookmarks.length === 0 ? await scanHeadings(cached) : bookmarks
  let title = options.title ?? null
  if (title === null) {
    const metadata = await cached.metadata()
    const metadataTitle =
      metadata.title === null || metadata.title === undefined ? null : trimWhitespace(metadata.title)
    title = titleFromPdfMetadata(metadataTitle, options.filename ?? '')
  }
  return enrichFeastingSections(rawSections, cached, title)
}

/**
 * Registros que precisam ser reindexados: sem seções, anteriores à versão 2, ou de versão
 * antiga quando são Feasting (pelo título extraído, não pela correção) ou não têm bookmarks.
 */
export function requiresReindex(record: PdfLibraryRecord): boolean {
  if (record.sections === undefined) return true
  const version = record.indexVersion ?? 0
  if (version < 2) return true
  return version < PDF_LIBRARY_INDEX_VERSION && (isFeastingTitle(record.title) || record.bookmarkCount === 0)
}

/** Em PDFs com bookmarks, seções antigas sem origem vieram dos bookmarks; as demais ficam como estão. */
export function backfillBookmarkMethod(
  sections: readonly PdfSectionLocation[],
  bookmarkCount: number,
): PdfSectionLocation[] {
  if (bookmarkCount <= 0) return [...sections]
  return sections.map((section) =>
    section.findingMethod === undefined || section.findingMethod === 'unknown'
      ? { ...section, findingMethod: 'bookmark' }
      : section,
  )
}

export interface LibraryMigration {
  records: PdfLibraryRecord[]
  /** Caminhos a reindexar em segundo plano. */
  pathsToReindex: string[]
}

/**
 * Migração ao abrir a Biblioteca: os registros que precisam de reindexação ficam como estão e
 * são listados; nos demais, a origem bookmark é preenchida e a versão passa à atual, sem
 * reprocessar o acervo.
 */
export function migrateLibraryRecords(records: readonly PdfLibraryRecord[]): LibraryMigration {
  const pathsToReindex = new Set(records.filter(requiresReindex).map((record) => record.path))
  const migrated = records.map((record) => {
    if (pathsToReindex.has(record.path)) return record
    const current: PdfLibraryRecord = { ...record, indexVersion: PDF_LIBRARY_INDEX_VERSION }
    if (current.sections !== undefined)
      current.sections = backfillBookmarkMethod(current.sections, current.bookmarkCount)
    return current
  })
  return { records: migrated, pathsToReindex: [...pathsToReindex] }
}

/** Texto de revisão da página: camada de texto do PDF ou, sem ela, o OCR salvo. */
export async function reviewPageText(
  pageNumber: number,
  source: PdfTextSource,
  ocrTextByPage: Readonly<Record<number, string>> = {},
): Promise<string | null> {
  if (pageNumber <= 0 || pageNumber > source.pageCount) return null
  return nonBlank(await pdfPageString(source, pageNumber)) ?? nonBlank(ocrTextByPage[pageNumber])
}

/** Texto de um intervalo com offsets; páginas inteiras no meio, unidas por quebra de linha. */
export async function extractSpanText(
  span: PdfTextSpan,
  source: PdfTextSource,
  ocrTextByPage: Readonly<Record<number, string>> = {},
): Promise<string> {
  if (span.start.page <= 0 || span.start.page > span.end.page || span.end.page > source.pageCount) return ''
  const fragments: string[] = []
  for (let pageNumber = span.start.page; pageNumber <= span.end.page; pageNumber += 1) {
    const text =
      nonBlank(await pdfPageString(source, pageNumber)) ?? nonBlank(ocrTextByPage[pageNumber]) ?? ''
    const start = pageNumber === span.start.page ? Math.min(span.start.utf16Offset, text.length) : 0
    const end = pageNumber === span.end.page ? Math.min(span.end.utf16Offset, text.length) : text.length
    if (end < start) return ''
    fragments.push(text.slice(start, end))
  }
  return fragments.join('\n')
}

export const OCR_CANCELLED_NOTICE = 'OCR interrompido; o índice anterior foi preservado.'

/** Aviso exibido na Biblioteca depois do OCR. */
export function ocrResultNotice(result: PdfLibraryOcrResult): string {
  if (result.candidatePageCount === 0) return 'Nenhuma página sem texto selecionável foi encontrada.'
  if (result.scannedPageCount === 0) return 'As páginas digitalizadas deste arquivo já foram examinadas.'
  return `OCR examinou ${result.scannedPageCount} de ${result.candidatePageCount} páginas, reconheceu texto em ${result.recognizedTextPageCount} e identificou ${result.sectionsFound} novas referências.`
}
