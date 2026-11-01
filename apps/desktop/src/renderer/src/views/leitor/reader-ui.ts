/**
 * Funções puras da janela do Leitor (testadas em test/unit/reader-ui.test.ts).
 */
import type { PdfSectionLocation, ReaderPdfPosition } from '@pregar/core/reader'
import type { ReaderRect, ReaderTabView } from '@shared/ipc-reader'

/** Escala mínima e máxima do visor (as do PDFKit no Swift). */
export const PDF_MIN_SCALE = 0.1
export const PDF_MAX_SCALE = 8
export const PDF_ZOOM_STEP = 1.2
/** Ajuste automático: largura da página, como o `autoScales` do PDFKit em página contínua. */
export const PDF_FIT_VALUE = 'page-width'

export function clampPage(page: number, pageCount: number): number {
  if (!(pageCount > 0)) return Math.max(1, Math.round(page) || 1)
  return Math.min(Math.max(Math.round(page) || 1, 1), pageCount)
}

/** Campo "Página física": só números; fora do intervalo vai para a primeira ou a última. */
export function parsePageField(text: string, pageCount: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return clampPage(Number(trimmed), pageCount)
}

export function nextZoomScale(current: number, direction: 1 | -1): number {
  const base = Number.isFinite(current) && current > 0 ? current : 1
  const next = direction > 0 ? base * PDF_ZOOM_STEP : base / PDF_ZOOM_STEP
  return Math.min(PDF_MAX_SCALE, Math.max(PDF_MIN_SCALE, Math.round(next * 1000) / 1000))
}

/** `page-width`, `page-fit` e `auto` são ajustes automáticos; números são escala fixa. */
export function isAutoScaleValue(value: string | null | undefined): boolean {
  return value === 'page-width' || value === 'page-fit' || value === 'auto' || value === 'page-actual'
}

/** Posição publicada a partir do `location` do PDF.js (canto superior esquerdo visível, em pontos do PDF). */
export function positionFromLocation(
  location: { pageNumber: number; top: number; left: number } | null | undefined,
  scale: number,
  autoScales: boolean,
): ReaderPdfPosition | null {
  if (!location) return null
  const position = { page: location.pageNumber, x: location.left, y: location.top, scale, autoScales }
  const valid =
    Number.isInteger(position.page) &&
    position.page > 0 &&
    [position.x, position.y].every((value) => Number.isFinite(value) && Math.abs(value) < 1e7) &&
    Number.isFinite(scale) &&
    scale > 0 &&
    scale < 100
  return valid ? position : null
}

export type PdfLinkDestination = { kind: 'named'; name: string } | { kind: 'explicit'; dest: unknown[] }

/** Destino de um link interno do PDF.js (`href="#..."`, nome ou matriz em JSON escapado). */
export function destinationFromHash(href: string): PdfLinkDestination | null {
  const index = href.indexOf('#')
  if (index < 0) return null
  const raw = href.slice(index + 1)
  if (raw === '') return null
  let decoded: string
  try {
    decoded = unescape(raw)
  } catch {
    return null
  }
  if (decoded.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(decoded)
      return Array.isArray(value) ? { kind: 'explicit', dest: value } : null
    } catch {
      return null
    }
  }
  if (decoded.includes('=')) return null
  return { kind: 'named', name: decoded }
}

/** Ponto de um destino explícito `XYZ`, em pontos do PDF; outros tipos vão ao topo da página. */
export function destinationPoint(dest: readonly unknown[]): { x: number; y: number } | null {
  const type = dest[1] as { name?: unknown } | undefined
  if (!type || type.name !== 'XYZ') return null
  const x = typeof dest[2] === 'number' ? dest[2] : 0
  const y = dest[3]
  return typeof y === 'number' && Number.isFinite(y) ? { x, y } : null
}

/** Páginas da seção como no Swift: "física 12" ou "físicas 12–14 · impressas x–xii". */
export function sectionPageRange(
  section: Pick<PdfSectionLocation, 'startPage' | 'endPage'>,
  printed: (page: number) => string | null,
): string {
  const physical =
    section.startPage === section.endPage ? `física ${section.startPage}` : `físicas ${section.startPage}–${section.endPage}`
  const start = printed(section.startPage)
  const end = printed(section.endPage)
  return start !== null && end !== null ? `${physical} · impressas ${start}–${end}` : physical
}

export type ConfidenceTone = 'high' | 'medium' | 'low' | 'unknown'

/** Selo da confiança: bookmark (alta), cabeçalho textual (média), OCR (baixa), sem origem. */
export function confidenceTone(section: Pick<PdfSectionLocation, 'findingMethod'>): ConfidenceTone {
  switch (section.findingMethod) {
    case 'bookmark':
      return 'high'
    case 'textHeading':
      return 'medium'
    case 'ocrHeading':
      return 'low'
    default:
      return 'unknown'
  }
}

export function tabTooltip(tab: Pick<ReaderTabView, 'title' | 'kind' | 'physicalPage' | 'location'>, currentURL?: string): string {
  return tab.kind === 'pdf' ? `${tab.title} · página ${tab.physicalPage}` : `${tab.title} · ${currentURL ?? tab.location}`
}

/** Rolagem horizontal que deixa a aba inteira visível (centralizada quando preciso). */
export function scrollToReveal(scrollLeft: number, viewportWidth: number, itemLeft: number, itemWidth: number): number {
  if (itemLeft >= scrollLeft && itemLeft + itemWidth <= scrollLeft + viewportWidth) return scrollLeft
  return Math.max(0, Math.round(itemLeft + itemWidth / 2 - viewportWidth / 2))
}

/** Soltar na metade direita coloca a aba depois da alvo. */
export function dropsAfter(offsetX: number, width: number): boolean {
  return offsetX > width / 2
}

export function sameRect(a: ReaderRect | null, b: ReaderRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Texto da seleção com a origem (o mesmo formato do processo principal). */
export function pdfCopySource(title: string, page: number): string {
  return `${title}, página física ${page}`
}

/** Grupo de linhas do PDF.js (itens com `hasEOL`) em texto com quebras, para o índice de seções. */
export function textFromItems(items: readonly { str?: string; hasEOL?: boolean }[]): string {
  let text = ''
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text.replace(/[ \t]+\n/g, '\n').trim()
}
