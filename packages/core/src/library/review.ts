import { parseReference } from '../bible/reference'
import { extractSpanText, reviewPageText, sectionsForDocument } from './indexer'
import { matchSection, referencesEqual } from './matching'
import type { PdfLibraryRecord, PdfSectionLocation } from './model'
import { recordDisplayAuthor, recordDisplayTitle } from './record'
import { cachedPdfTextSource, type PdfTextSource } from './text-source'
import { lineRanges, trimWhitespace, utf8ByteLength } from './text-utils'

/**
 * Fonte de material enviada à revisão por IA. Estruturalmente idêntica a `SermonReviewSource`
 * de `src/ai` (definida aqui para não acoplar o índice ao módulo de IA).
 */
export interface ReviewMaterialSource {
  id: string
  title: string
  citation: string
  text: string
}

/** Limite por fonte; acima dele o envio é bloqueado, sem cortes parciais. */
export const REVIEW_MAX_BYTES_PER_SOURCE = 24_000
/** Seções sem componentes delimitados só são extraídas até este número de páginas. */
export const REVIEW_MAX_PAGES_PER_SOURCE = 36

export type SermonReviewMaterialErrorCode =
  'pageStillLoading' | 'pageUnavailable' | 'sourceUnavailable' | 'sectionNotFound' | 'sourceTooLarge'

function reviewMaterialMessage(code: SermonReviewMaterialErrorCode, title: string): string {
  switch (code) {
    case 'pageStillLoading':
      return 'Uma página marcada para revisão ainda está carregando. Aguarde e tente novamente.'
    case 'pageUnavailable':
      return 'Não foi possível extrair o texto da página marcada para revisão.'
    case 'sourceUnavailable':
      return `Não foi possível abrir o material “${title}” marcado para revisão.`
    case 'sectionNotFound':
      return `Não encontrei uma seção legível em “${title}”. Desmarque-a ou escolha a seção no Leitor.`
    case 'sourceTooLarge':
      return `A extração de “${title}” excede os limites e não será enviada parcialmente. Desmarque esta aba para continuar.`
  }
}

/** Erros da preparação dos materiais marcados para revisão (mensagens do app Swift). */
export class SermonReviewMaterialError extends Error {
  readonly code: SermonReviewMaterialErrorCode
  /** Título do material, nos casos que o citam. */
  readonly materialTitle: string | undefined

  constructor(code: SermonReviewMaterialErrorCode, materialTitle?: string) {
    super(reviewMaterialMessage(code, materialTitle ?? ''))
    this.name = 'SermonReviewMaterialError'
    this.code = code
    this.materialTitle = materialTitle
  }

  static pageStillLoading(): SermonReviewMaterialError {
    return new SermonReviewMaterialError('pageStillLoading')
  }

  static pageUnavailable(): SermonReviewMaterialError {
    return new SermonReviewMaterialError('pageUnavailable')
  }

  static sourceUnavailable(title: string): SermonReviewMaterialError {
    return new SermonReviewMaterialError('sourceUnavailable', title)
  }

  static sectionNotFound(title: string): SermonReviewMaterialError {
    return new SermonReviewMaterialError('sectionNotFound', title)
  }

  static sourceTooLarge(title: string): SermonReviewMaterialError {
    return new SermonReviewMaterialError('sourceTooLarge', title)
  }
}

/** Campos da aba do Leitor usados na extração (`ReaderTab` satisfaz esta forma). */
export interface ReviewTabInput {
  id: string
  title: string
  /** Caminho do PDF. */
  location: string
  physicalPage: number
  reference?: string | null
}

export interface ExtractPdfReviewSourcesOptions {
  tab: ReviewTabInput
  /** Passagem da preparação; vazia ou ausente usa a referência da aba. */
  targetReference?: string | null
  /** PDF aberto a partir de `tab.location`; `null` quando não foi possível abri-lo. */
  source: PdfTextSource | null
  /** Acervo da Biblioteca, para usar seções, OCR e metadados já indexados. */
  libraryRecords?: readonly PdfLibraryRecord[]
}

function selectedSectionIndex(
  sections: readonly PdfSectionLocation[],
  reference: string | null,
  page: number,
): number {
  const target = reference === null ? null : parseReference(reference)
  if (target) {
    const exact = sections.findIndex((section) => matchSection(section, target) === 'exact')
    if (exact >= 0) return exact
    const partial = sections.findIndex((section) => matchSection(section, target) === 'partial')
    if (partial >= 0) return partial
  }
  return sections.findIndex((section) => page >= section.startPage && page <= section.endPage)
}

/**
 * Recorta a página aos limites da seção: na página inicial, depois da linha do título; na página
 * em que a próxima seção começa, antes do título dela.
 */
function sectionBoundedText(
  pageText: string,
  pageNumber: number,
  section: PdfSectionLocation,
  nextSection: PdfSectionLocation | undefined,
): string {
  let start = 0
  let end = pageText.length
  const lines = lineRanges(pageText).map((line) => ({ ...line, content: trimWhitespace(line.text) }))
  if (pageNumber === section.startPage) {
    const target = parseReference(section.title)
    const heading = target
      ? lines.find((line) => referencesEqual(parseReference(line.content), target))
      : undefined
    if (heading) start = heading.end
  }
  if (nextSection && pageNumber === nextSection.startPage) {
    const target = parseReference(nextSection.title)
    const heading = target
      ? lines.find((line) => referencesEqual(parseReference(line.content), target))
      : undefined
    if (heading) end = heading.start
  }
  if (end < start) return ''
  return trimWhitespace(pageText.slice(start, end))
}

/**
 * Extrai o texto da seção marcada para revisão. No Feasting, cada perspectiva vira uma fonte
 * com autor; nas demais obras, a seção inteira (até 36 páginas) respeitando o início e o fim
 * dentro de páginas compartilhadas. Usa o OCR salvo quando a página não tem texto. Qualquer
 * página ilegível ou excesso de tamanho bloqueia o envio com `SermonReviewMaterialError`.
 */
export async function extractPdfReviewSources(
  options: ExtractPdfReviewSourcesOptions,
): Promise<ReviewMaterialSource[]> {
  const { tab } = options
  if (!options.source || options.source.pageCount <= 0)
    throw SermonReviewMaterialError.sourceUnavailable(tab.title)
  const source = cachedPdfTextSource(options.source)

  const record = options.libraryRecords?.find((item) => item.path === tab.location)
  const ocrTextByPage = record?.ocrTextByPage ?? {}
  const workTitle = record ? recordDisplayTitle(record) : tab.title
  const sections =
    record?.sections && record.sections.length > 0
      ? record.sections
      : await sectionsForDocument(source, { title: workTitle })
  const preferredReference =
    options.targetReference !== null &&
    options.targetReference !== undefined &&
    options.targetReference !== ''
      ? options.targetReference
      : (tab.reference ?? null)
  const selectedIndex = selectedSectionIndex(sections, preferredReference, tab.physicalPage)
  const section = sections[selectedIndex]
  if (!section) throw SermonReviewMaterialError.sectionNotFound(tab.title)
  const author = record ? recordDisplayAuthor(record) : undefined

  if (section.components && section.components.length > 0) {
    const comments = section.components.filter((component) => component.kind !== 'biblicalText')
    const sources: ReviewMaterialSource[] = []
    for (const [index, component] of comments.entries()) {
      for (let page = component.content.start.page; page <= component.content.end.page; page += 1) {
        if ((await reviewPageText(page, source, ocrTextByPage)) === null)
          throw SermonReviewMaterialError.pageUnavailable()
      }
      const text = trimWhitespace(await extractSpanText(component.content, source, ocrTextByPage))
      if (text === '') continue
      if (utf8ByteLength(text) > REVIEW_MAX_BYTES_PER_SOURCE) {
        throw SermonReviewMaterialError.sourceTooLarge(`${workTitle} — ${component.title}`)
      }
      const authorLine = component.author !== undefined ? ` · ${component.author}` : ''
      sources.push({
        id: `pdf:${tab.id}:${index}`,
        title: `${workTitle} — ${component.title}${authorLine}`,
        citation: `${section.title} · página física ${component.location.start.page}`,
        text,
      })
    }
    if (sources.length > 0) return sources
  }

  const lastPage = Math.min(
    section.endPage,
    section.startPage + REVIEW_MAX_PAGES_PER_SOURCE - 1,
    source.pageCount,
  )
  if (lastPage !== section.endPage) throw SermonReviewMaterialError.sourceTooLarge(tab.title)
  const nextSection = sections[selectedIndex + 1]
  const pages: string[] = []
  for (let pageNumber = section.startPage; pageNumber <= lastPage; pageNumber += 1) {
    const pageText = await reviewPageText(pageNumber, source, ocrTextByPage)
    if (pageText === null) throw SermonReviewMaterialError.pageUnavailable()
    const bounded = sectionBoundedText(pageText, pageNumber, section, nextSection)
    if (bounded !== '') pages.push(bounded)
  }
  const text = trimWhitespace(pages.join('\n\n'))
  if (text === '') throw SermonReviewMaterialError.sectionNotFound(tab.title)
  if (utf8ByteLength(text) > REVIEW_MAX_BYTES_PER_SOURCE)
    throw SermonReviewMaterialError.sourceTooLarge(tab.title)

  const authorLine = author !== undefined ? ` · ${author}` : ''
  const pageRange =
    section.startPage === section.endPage
      ? `física ${section.startPage}`
      : `físicas ${section.startPage}–${section.endPage}`
  return [
    {
      id: `pdf:${tab.id}:section`,
      title: `${workTitle}${authorLine}`,
      citation: `${section.title} · páginas ${pageRange}`,
      text,
    },
  ]
}

/** Endereço citado como fonte: sem consulta nem fragmento. */
export function webReviewCitation(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.href
  } catch {
    return url
  }
}

export interface WebReviewPage {
  /** `document.title` da página. */
  title: string
  /** Texto visível do `article`, do `main` ou do corpo. */
  text: string
  /** Endereço atual da aba. */
  url: string
}

/**
 * Fonte de uma aba web marcada para revisão: bloqueia se a página ainda carrega, se não há texto
 * ou se ultrapassa o limite por fonte.
 */
export function makeWebReviewSource(
  tab: Pick<ReviewTabInput, 'id' | 'title'>,
  page: WebReviewPage,
  options: { isLoading?: boolean } = {},
): ReviewMaterialSource {
  if (options.isLoading) throw SermonReviewMaterialError.pageStillLoading()
  if (trimWhitespace(page.text) === '') throw SermonReviewMaterialError.pageUnavailable()
  if (utf8ByteLength(page.text) > REVIEW_MAX_BYTES_PER_SOURCE)
    throw SermonReviewMaterialError.sourceTooLarge(tab.title)
  return {
    id: `web:${tab.id}`,
    title: page.title === '' ? tab.title : page.title,
    citation: webReviewCitation(page.url),
    text: page.text,
  }
}
