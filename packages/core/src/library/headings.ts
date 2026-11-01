import { parseHeadingReference, parseReference, type ScriptureReference } from '../bible/reference'
import { sameIndexedReference } from './matching'
import { isFeastingTitle } from './metadata'
import type { PdfSectionFindingMethod, PdfSectionLocation } from './model'
import { pdfPageString, type PdfOutlineItem, type PdfTextSource } from './text-source'
import { exceedsCharacterCount, splitNewlines, trimWhitespace } from './text-utils'

/** Linhas examinadas no topo de cada página; títulos de seção ficam no início da página. */
export const HEADING_LINE_LIMIT = 12
/** No OCR do Feasting, o título da leitura pode vir depois do fim do ensaio anterior. */
export const FEASTING_OCR_HEADING_LINE_LIMIT = 48
/** A partir de três referências distintas, a página é sumário ou tabela, não início de seção. */
const DENSE_PAGE_REFERENCE_COUNT = 3

interface SectionEntry {
  title: string
  page: number
  context?: string
  method: PdfSectionFindingMethod
  order: number
}

/** Cada seção vai da sua página até a página anterior à próxima seção (a última, até o fim). */
function addPageRanges(entries: SectionEntry[], pageCount: number): PdfSectionLocation[] {
  const sorted = [...entries].sort((a, b) => (a.page === b.page ? a.order - b.order : a.page - b.page))
  return sorted.map((entry, index) => {
    const nextPage = sorted[index + 1]?.page ?? pageCount + 1
    const section: PdfSectionLocation = {
      title: entry.title,
      startPage: entry.page,
      endPage: Math.max(entry.page, nextPage - 1),
    }
    if (entry.context !== undefined) section.context = entry.context
    section.findingMethod = entry.method
    return section
  })
}

/** Seções a partir dos bookmarks, com o título do bookmark pai como contexto. */
export function flattenOutline(outline: readonly PdfOutlineItem[], pageCount: number): PdfSectionLocation[] {
  const entries: SectionEntry[] = []
  let order = 0
  const walk = (items: readonly PdfOutlineItem[], ancestors: string[]): void => {
    for (const child of items) {
      const title = child.title === null ? null : trimWhitespace(child.title)
      const page = child.pageIndex === null ? null : child.pageIndex + 1
      if (title !== null && title !== '' && page !== null && Number.isInteger(page) && page > 0) {
        const entry: SectionEntry = { title, page, method: 'bookmark', order }
        const context = ancestors.at(-1)
        if (context !== undefined) entry.context = context
        entries.push(entry)
        order += 1
      }
      walk(child.children, title === null ? ancestors : [...ancestors, title])
    }
  }
  walk(outline, [])
  return addPageRanges(entries, pageCount)
}

/** Total de itens do sumário, inclusive os sem destino. */
export function countBookmarks(outline: readonly PdfOutlineItem[]): number {
  return outline.reduce((total, item) => total + 1 + countBookmarks(item.children), 0)
}

const REFERENCE_HEADING =
  /^(?:(?:1|2|3|I|II|III)\s+)?[\p{L}][\p{L}.]*(?:\s+[\p{L}][\p{L}.]*){0,3}\s+\d+\s*[:.]\s*\d+(?:\s*[-–—]\s*(?:\d+\s*[:.]\s*)?\d+)?\s*$/u

/**
 * Linha que é só uma referência com versículos ("Romans 13:8-14"), como os títulos das leituras
 * no Feasting. Com `target`, a referência também precisa ser a mesma passagem.
 */
export function isReferenceHeading(line: string, target?: ScriptureReference | null): boolean {
  const value = trimWhitespace(line)
  if (exceedsCharacterCount(value, 80) || !REFERENCE_HEADING.test(value)) return false
  const reference = parseReference(value)
  if (!reference || reference.startVerse === null) return false
  return target ? sameIndexedReference(reference, target) : true
}

export interface PageHeadingCandidate {
  title: string
  reference: ScriptureReference
}

function referenceKey(reference: ScriptureReference): string {
  const endChapter = reference.endChapter ?? reference.chapter
  const endVerse = reference.endVerse ?? reference.startVerse ?? 0
  return `${reference.book}|${reference.chapter}|${reference.startVerse ?? 0}|${endChapter}|${endVerse}`
}

/**
 * Cabeçalhos no topo de uma página: linhas que começam com a referência (com versículos), sem
 * outras citações e com título em maiúscula. Páginas com três ou mais referências distintas
 * (sumários, tabelas do lecionário) não geram seções.
 */
export function pageHeadingCandidates(text: string, lineLimit = HEADING_LINE_LIMIT): PageHeadingCandidate[] {
  const candidates: PageHeadingCandidate[] = []
  for (const line of splitNewlines(text).slice(0, lineLimit)) {
    const candidate = trimWhitespace(line)
    if (exceedsCharacterCount(candidate, 100)) continue
    const reference = parseHeadingReference(candidate)
    if (reference) candidates.push({ title: candidate, reference })
  }
  const unique = new Set(candidates.map((entry) => referenceKey(entry.reference)))
  return unique.size < DENSE_PAGE_REFERENCE_COUNT ? candidates : []
}

export interface ScanHeadingsOptions {
  /** Texto OCR por página física; tem prioridade sobre a camada de texto e marca a origem como OCR. */
  ocrTextByPage?: Readonly<Record<number, string>>
  /** Título da obra, para aplicar a janela ampliada do OCR do Feasting. */
  documentTitle?: string | null
  signal?: AbortSignal
}

/**
 * Fallback para PDFs sem bookmarks: procura cabeçalhos de passagem página a página. A primeira
 * ocorrência de cada referência vale; as seções vão até a página anterior à próxima.
 */
export async function scanHeadings(
  source: PdfTextSource,
  options: ScanHeadingsOptions = {},
): Promise<PdfSectionLocation[]> {
  const ocrTextByPage = options.ocrTextByPage ?? {}
  const feastingOcr =
    options.documentTitle !== null &&
    options.documentTitle !== undefined &&
    isFeastingTitle(options.documentTitle)
  const entries: SectionEntry[] = []
  const seen = new Set<string>()
  for (let pageNumber = 1; pageNumber <= source.pageCount; pageNumber += 1) {
    if (pageNumber % 32 === 0) options.signal?.throwIfAborted()
    const ocrText = ocrTextByPage[pageNumber]
    const text = ocrText ?? (await pdfPageString(source, pageNumber))
    if (text === null) continue
    const usesOcr = ocrText !== undefined
    const method: PdfSectionFindingMethod = usesOcr ? 'ocrHeading' : 'textHeading'
    const lineLimit = usesOcr && feastingOcr ? FEASTING_OCR_HEADING_LINE_LIMIT : HEADING_LINE_LIMIT
    for (const entry of pageHeadingCandidates(text, lineLimit)) {
      const key = referenceKey(entry.reference)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ title: entry.title, page: pageNumber, method, order: entries.length })
    }
  }
  options.signal?.throwIfAborted()
  return addPageRanges(entries, source.pageCount)
}
