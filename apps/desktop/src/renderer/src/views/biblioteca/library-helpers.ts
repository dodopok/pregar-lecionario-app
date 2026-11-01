/**
 * Funções puras da janela da Biblioteca: filtro de obras e seções (sem acentos e com traços
 * unificados), realce do trecho encontrado, matemática da lista virtualizada e rótulos.
 */
import { parseReference } from '@pregar/core/bible/reference'
import { matchSection, type PdfSectionMatchKind } from '@pregar/core/library/matching'
import { normalizeSectionQuery, sectionMatchesSearch } from '@pregar/core/library/section'
import type { Component } from 'vue'
import type { LibrarySectionRow, LibraryWork } from '@shared/ipc-library'

/** Item do menu de ações de uma obra. */
export interface WorkMenuItem {
  id: string
  label: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

// MARK: Filtro

/** Obras cujo título, autoria, créditos ou nome do arquivo contêm a consulta. */
export function filterWorks(works: readonly LibraryWork[], query: string): LibraryWork[] {
  const needle = normalizeSectionQuery(query)
  if (needle === '') return [...works]
  return works.filter((work) =>
    [work.title, work.author ?? '', ...work.credits, fileName(work.path)].some((value) =>
      normalizeSectionQuery(value).includes(needle),
    ),
  )
}

export interface FilteredSection {
  row: LibrarySectionRow
  /** Relação com a passagem digitada, quando a consulta é uma referência bíblica. */
  match: PdfSectionMatchKind | null
}

/**
 * Seções que contêm o texto digitado (título ou contexto, sem acentos e com traços unificados)
 * ou, se a consulta é uma passagem ("Romanos 13:8-14"), que correspondem a ela em qualquer
 * idioma. `kinds` traz as relações já calculadas pelo índice do processo principal (por id da
 * seção); sem ele, a relação é calculada aqui. Consulta vazia devolve todas.
 */
export function filterSections(
  rows: readonly LibrarySectionRow[],
  query: string,
  kinds?: ReadonlyMap<string, PdfSectionMatchKind> | null,
): FilteredSection[] {
  const trimmed = query.trim()
  if (trimmed === '') return rows.map((row) => ({ row, match: null }))
  const target = kinds ? null : parseReference(trimmed)
  const result: FilteredSection[] = []
  for (const row of rows) {
    const section = { title: row.title, context: row.context ?? undefined }
    const match = kinds ? (kinds.get(row.id) ?? null) : target ? matchSection(section, target) : null
    if (match !== null || sectionMatchesSearch(section, trimmed)) result.push({ row, match })
  }
  return result
}

/** A consulta parece uma passagem bíblica (vale consultar o índice de correspondências)? */
export function isReferenceQuery(query: string): boolean {
  return parseReference(query.trim()) !== null
}

export const MATCH_LABELS: Record<PdfSectionMatchKind, string> = {
  exact: 'passagem coincidente',
  partial: 'sobreposição',
  context: 'contexto',
}

// MARK: Realce

/** Caractere dobrado como no filtro: sem diacríticos, minúsculo e com traços unificados. */
function foldCharacter(char: string): string {
  return char
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[‐-―−]/g, '-')
}

/**
 * Intervalos `[início, fim)` do texto original onde a consulta aparece, comparando como o
 * filtro (acentos, caixa, traços e espaços repetidos não importam).
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const needle = normalizeSectionQuery(query)
  if (needle === '') return []
  let folded = ''
  const origin: number[] = []
  let previousSpace = true
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)!
    const char = String.fromCodePoint(codePoint)
    const width = char.length
    if (/\s/u.test(char)) {
      if (!previousSpace) {
        folded += ' '
        origin.push(index)
      }
      previousSpace = true
    } else {
      for (const piece of foldCharacter(char)) {
        folded += piece
        origin.push(index)
      }
      previousSpace = false
    }
    index += width
  }
  const ranges: [number, number][] = []
  let from = 0
  for (;;) {
    const found = folded.indexOf(needle, from)
    if (found < 0) break
    const start = origin[found]!
    const lastOrigin = origin[found + needle.length - 1]!
    const lastWidth = String.fromCodePoint(text.codePointAt(lastOrigin)!).length
    ranges.push([start, lastOrigin + lastWidth])
    from = found + needle.length
  }
  return ranges
}

/** Partes do texto para renderizar com `<mark>`. */
export function highlightParts(text: string, query: string): { text: string; marked: boolean }[] {
  const ranges = highlightRanges(text, query)
  if (ranges.length === 0) return [{ text, marked: false }]
  const parts: { text: string; marked: boolean }[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), marked: false })
    parts.push({ text: text.slice(start, end), marked: true })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), marked: false })
  return parts
}

// MARK: Lista virtualizada

/** Alturas das linhas de seção, como no app Swift: 37 pt sem contexto, 44 com contexto. */
export const SECTION_ROW_HEIGHT = 37
export const SECTION_ROW_HEIGHT_WITH_CONTEXT = 44

export function sectionRowHeight(row: Pick<LibrarySectionRow, 'context'>): number {
  return row.context ? SECTION_ROW_HEIGHT_WITH_CONTEXT : SECTION_ROW_HEIGHT
}

/** Somas acumuladas: `offsets[i]` é o topo da linha `i`; o último valor é a altura total. */
export function buildOffsets(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1)
  offsets[0] = 0
  for (let index = 0; index < heights.length; index += 1) offsets[index + 1] = offsets[index]! + heights[index]!
  return offsets
}

/** Primeira linha cujo fim passa de `position` (busca binária). */
export function rowAtOffset(offsets: readonly number[], position: number): number {
  const count = offsets.length - 1
  if (count <= 0) return 0
  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle + 1]! <= position) low = middle + 1
    else high = middle
  }
  return low
}

/** Linhas a montar para a janela visível, com margem `overscan` acima e abaixo; `end` exclusivo. */
export function visibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 6,
): { start: number; end: number } {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  const first = rowAtOffset(offsets, top)
  const last = rowAtOffset(offsets, top + Math.max(0, viewportHeight) - 1)
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) }
}

/** Rolagem mínima para deixar a linha `index` inteira à vista. */
export function scrollToReveal(offsets: readonly number[], index: number, scrollTop: number, viewportHeight: number): number {
  const top = offsets[index] ?? 0
  const bottom = offsets[index + 1] ?? top
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return scrollTop
}

// MARK: Divisor

export const SIDEBAR_FRACTION_DEFAULT = 0.38
export const SIDEBAR_MIN = 320
export const SIDEBAR_MAX = 768
/** Espaço mínimo do detalhe (o Swift reservava 459 pt). */
export const DETAIL_MIN = 459

/** Largura da lista de obras: fração da janela, entre 320 e 768 px, sem esmagar o detalhe. */
export function sidebarWidth(fraction: number, available: number): number {
  const maximum = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, available - DETAIL_MIN))
  return Math.round(Math.min(maximum, Math.max(SIDEBAR_MIN, available * fraction)))
}

// MARK: Rótulos

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR')
}

export function pageRange(row: Pick<LibrarySectionRow, 'startPage' | 'endPage'>): string {
  return row.startPage === row.endPage ? `${row.startPage}` : `${row.startPage}–${row.endPage}`
}

/** "10 obras · 7.435 páginas · 878 seções". */
export function libraryTotals(works: readonly LibraryWork[]): string {
  const pages = works.reduce((total, work) => total + work.pageCount, 0)
  const sections = works.reduce((total, work) => total + work.sectionCount, 0)
  return `${formatNumber(works.length)} obras · ${formatNumber(pages)} páginas · ${formatNumber(sections)} seções`
}

/** Terceira linha da obra na lista: cópia, seções, bookmarks ou "sem sumário". */
export function workSummaryLine(work: LibraryWork): string {
  if (work.copyLabel) return work.copyLabel
  if (work.sectionCount > 0) return `${formatNumber(work.sectionCount)} seções`
  if (work.bookmarkCount > 0) return `${formatNumber(work.bookmarkCount)} bookmarks`
  return 'sem sumário'
}

/** "Tom Wright · Westminster · 2011 · 184 páginas físicas". */
export function metadataLine(work: LibraryWork): string {
  return work.credits.length === 0
    ? `${work.pageCount} páginas físicas`
    : `${work.credits.join(' · ')} · ${work.pageCount} páginas físicas`
}

export type CoverTone = 'blue' | 'brown' | 'stone'

/** Cor da capa tipográfica (sem miniatura), como no app Swift. */
export function coverTone(title: string): CoverTone {
  const lowered = title.toLocaleLowerCase('en-US')
  if (lowered.includes('feasting')) return 'blue'
  if (lowered.includes('wright') || lowered.includes('everyone')) return 'brown'
  return 'stone'
}

/** Iniciais para a capa tipográfica ("Paul for Everyone" → "PE"). */
export function coverInitials(title: string): string {
  const words = title
    .replace(/[:–—-].*$/u, '')
    .split(/\s+/)
    .filter((word) => /^\p{Lu}/u.test(word))
  const letters = (words.length > 0 ? words : title.split(/\s+/)).slice(0, 2).map((word) => word.charAt(0))
  return letters.join('').toLocaleUpperCase('pt-BR')
}

/** Rótulo do sistema para "mostrar o arquivo na pasta". */
export function revealLabel(platform: 'darwin' | 'win32' | 'linux'): string {
  if (platform === 'darwin') return 'Mostrar no Finder'
  if (platform === 'win32') return 'Mostrar no Explorador de Arquivos'
  return 'Mostrar na pasta'
}
