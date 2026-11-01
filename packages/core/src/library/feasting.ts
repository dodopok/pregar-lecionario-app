import { parseReference, type ScriptureReference } from '../bible/reference'
import { isReferenceHeading } from './headings'
import { isFeastingTitle } from './metadata'
import type {
  PdfSectionComponent,
  PdfSectionComponentKind,
  PdfSectionLocation,
  PdfTextPosition,
} from './model'
import { pdfPageString, type PdfTextSource } from './text-source'
import { equalsIgnoringCase, lineRanges, nonBlank, splitWords, trimWhitespace } from './text-utils'

/** As quatro perspectivas do Feasting, na ordem em que aparecem depois do texto bíblico. */
export const FEASTING_PERSPECTIVES: readonly { kind: PdfSectionComponentKind; title: string }[] = [
  { kind: 'theological', title: 'Theological Perspective' },
  { kind: 'pastoral', title: 'Pastoral Perspective' },
  { kind: 'exegetical', title: 'Exegetical Perspective' },
  { kind: 'homiletical', title: 'Homiletical Perspective' },
]

export const BIBLICAL_TEXT_COMPONENT_TITLE = 'Texto bíblico'

interface IndexedLine {
  page: number
  start: number
  end: number
  text: string
}

function startOf(line: IndexedLine): PdfTextPosition {
  return { page: line.page, utf16Offset: line.start }
}

function endOf(line: IndexedLine): PdfTextPosition {
  return { page: line.page, utf16Offset: line.end }
}

function isPerspectiveHeading(line: string, expected: string): boolean {
  return equalsIgnoringCase(trimWhitespace(line), expected)
}

const AUTHOR_CHARACTERS = /^[\p{L}\p{M}\s\u0085.\-'’]*$/u
const LETTER = /[\p{L}\p{M}]/gu

/**
 * Assinatura de ensaio: só letras, espaços e `.-'’`, ao menos duas palavras e quatro letras,
 * toda em maiúsculas ("MARVIN A. MCMICKLE"). Devolve o nome aparado ou `null`.
 */
export function authorSignature(line: string): string | null {
  const name = trimWhitespace(line)
  const letters = name.match(LETTER)?.length ?? 0
  if (letters < 4) return null
  if (splitWords(name).length < 2) return null
  if (name !== name.toUpperCase()) return null
  if (!AUTHOR_CHARACTERS.test(name)) return null
  return name
}

function pageEntries(
  pageTexts: ReadonlyMap<number, string> | Readonly<Record<number, string>>,
): [number, string][] {
  const entries: [number, string][] =
    pageTexts instanceof Map
      ? [...pageTexts.entries()]
      : Object.entries(pageTexts).map(([page, text]): [number, string] => [Number(page), text])
  return entries.filter(([page]) => Number.isInteger(page)).sort((a, b) => a[0] - b[0])
}

/**
 * Delimita o texto bíblico e as quatro perspectivas de uma leitura do Feasting, com offsets
 * dentro das páginas (inclusive páginas compartilhadas com a leitura anterior ou seguinte).
 * A autoria de cada ensaio é a última assinatura antes do próximo componente, procurada de trás
 * para frente para aceitar notas numeradas depois da assinatura (caso McMickle).
 */
export function feastingComponents(
  section: Pick<PdfSectionLocation, 'startPage'>,
  target: ScriptureReference,
  pageTexts: ReadonlyMap<number, string> | Readonly<Record<number, string>>,
): PdfSectionComponent[] | null {
  const lines: IndexedLine[] = pageEntries(pageTexts).flatMap(([page, text]) =>
    lineRanges(text).map((line) => ({ page, start: line.start, end: line.end, text: line.text })),
  )
  const scriptureIndex = lines.findIndex(
    (line) => line.page >= section.startPage && isReferenceHeading(line.text, target),
  )
  const scripture = lines[scriptureIndex]
  if (scriptureIndex < 0 || !scripture) return null

  const perspectives: { kind: PdfSectionComponentKind; title: string; index: number }[] = []
  let searchFrom = scriptureIndex + 1
  for (const perspective of FEASTING_PERSPECTIVES) {
    let found = -1
    for (let index = searchFrom; index < lines.length; index += 1) {
      if (isPerspectiveHeading(lines[index]?.text ?? '', perspective.title)) {
        found = index
        break
      }
    }
    if (found < 0) return null
    perspectives.push({ kind: perspective.kind, title: perspective.title, index: found })
    searchFrom = found + 1
  }

  const lastPerspectiveIndex = perspectives.at(-1)?.index ?? -1
  let followingReferenceIndex = -1
  for (let index = lastPerspectiveIndex + 1; index < lines.length; index += 1) {
    const text = lines[index]?.text ?? ''
    if (isReferenceHeading(text) && !isReferenceHeading(text, target)) {
      followingReferenceIndex = index
      break
    }
  }
  const sectionBoundaryIndex = followingReferenceIndex >= 0 ? followingReferenceIndex : lines.length
  const firstPerspective = perspectives[0]
  const firstPerspectiveLine = firstPerspective ? lines[firstPerspective.index] : undefined
  if (!firstPerspectiveLine) return null

  const components: PdfSectionComponent[] = [
    {
      kind: 'biblicalText',
      title: BIBLICAL_TEXT_COMPONENT_TITLE,
      location: { start: startOf(scripture), end: startOf(firstPerspectiveLine) },
      content: { start: endOf(scripture), end: startOf(firstPerspectiveLine) },
    },
  ]

  for (const [position, heading] of perspectives.entries()) {
    const boundaryIndex = perspectives[position + 1]?.index ?? sectionBoundaryIndex
    // Sem leitura seguinte, o limite é o início da última linha disponível (como no Swift).
    const boundary = boundaryIndex < lines.length ? lines[boundaryIndex] : lines.at(-1)
    const headingLine = lines[heading.index]
    if (!boundary || !headingLine) return null
    let authorLine: IndexedLine | undefined
    let author: string | null = null
    for (let index = boundaryIndex - 1; index > heading.index; index -= 1) {
      const line = lines[index]
      const signature = line ? authorSignature(line.text) : null
      if (line && signature !== null) {
        authorLine = line
        author = signature
        break
      }
    }
    const component: PdfSectionComponent = {
      kind: heading.kind,
      title: heading.title,
      location: { start: startOf(headingLine), end: startOf(boundary) },
      content: { start: endOf(headingLine), end: startOf(authorLine ?? boundary) },
    }
    if (author !== null) component.author = author
    components.push(component)
  }
  return components
}

/**
 * Acrescenta os componentes às seções do Feasting cujo título é uma passagem com versículos.
 * Usa a camada de texto e, nas páginas sem texto, o OCR salvo. A seção se estende até a página
 * em que o último componente termina.
 */
export async function enrichFeastingSections(
  sections: readonly PdfSectionLocation[],
  source: PdfTextSource,
  title: string,
  ocrTextByPage: Readonly<Record<number, string>> = {},
): Promise<PdfSectionLocation[]> {
  if (!isFeastingTitle(title)) return [...sections]
  const pageTextCache = new Map<number, string>()
  const result: PdfSectionLocation[] = []
  for (const section of sections) {
    const lastPage = Math.min(section.endPage + 1, source.pageCount)
    const target = parseReference(section.title)
    if (section.startPage > lastPage || !target || target.startVerse === null) {
      result.push(section)
      continue
    }
    const pageTexts = new Map<number, string>()
    for (let pageNumber = section.startPage; pageNumber <= lastPage; pageNumber += 1) {
      const cached = pageTextCache.get(pageNumber)
      if (cached !== undefined) {
        pageTexts.set(pageNumber, cached)
        continue
      }
      const text = nonBlank(await pdfPageString(source, pageNumber)) ?? nonBlank(ocrTextByPage[pageNumber])
      if (text !== null) {
        pageTextCache.set(pageNumber, text)
        pageTexts.set(pageNumber, text)
      }
    }
    const components = feastingComponents(section, target, pageTexts)
    const end = components?.at(-1)?.location.end
    if (!components || !end) {
      result.push(section)
      continue
    }
    const lastIncludedPage = end.utf16Offset === 0 ? Math.max(section.startPage, end.page - 1) : end.page
    const enriched: PdfSectionLocation = {
      title: section.title,
      startPage: section.startPage,
      endPage: Math.max(section.endPage, lastIncludedPage),
    }
    if (section.context !== undefined) enriched.context = section.context
    enriched.components = components
    if (section.findingMethod !== undefined) enriched.findingMethod = section.findingMethod
    result.push(enriched)
  }
  return result
}
