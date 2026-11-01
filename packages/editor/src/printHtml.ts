/**
 * HTML para o PDF do tablet (porta de TabletPDFExporter): cabeçalho com título e ocasião, uma
 * família e um tamanho base escolhidos, tamanhos relativos preservados e notas opcionais. Ao
 * omitir as notas, as chamadas também saem do texto.
 */
import type { RichDocument, RichParagraph, RichRun } from '@pregar/core/document/model'
import {
  BODY_FONT_FAMILY,
  BODY_FONT_SIZE_PT,
  BODY_LINE_HEIGHT,
  defaultFontSizePt,
  HEADING_SPACE_AFTER_PT,
  HEADING_SPACE_BEFORE_PT,
  LINK_COLOR,
  QUOTE_INDENT_END_PT,
  QUOTE_INDENT_PT,
  QUOTE_INK_COLOR,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
} from './styles'
import { clamp, cssNumber, escapeHTML, isSafeLinkHref } from './util'

export interface PrintOptions {
  /** Título do cabeçalho; padrão: `document.title`. */
  title?: string
  /** Linha abaixo do título (ocasião, data litúrgica, leituras). */
  occasion?: string
  /** Família usada em todo o texto (padrão Arial). */
  fontFamily?: string
  /** Tamanho base do corpo em pontos (padrão 14, como a cópia do tablet). */
  fontSizePt?: number
  /** Inclui as notas no fim; false remove também as chamadas (padrão: true). */
  includeFootnotes?: boolean
  /** Margem da página em pontos (padrão 48, como o Swift). */
  pageMarginPt?: number
  /** Tamanho da página CSS (padrão A4). */
  pageSize?: string
}

const LIST_HANG_PT = 18

function scaled(size: number, base: number): number {
  // Como o Swift: tamanhos relativos ao corpo, limitados a 8–42 pt.
  return clamp((base * size) / BODY_FONT_SIZE_PT, 8, 42)
}

function runHTML(run: RichRun, base: number, defaultSize: number, includeFootnotes: boolean): string {
  if (run.footnote !== undefined) return includeFootnotes ? `<sup class="note-ref">${run.footnote}</sup>` : ''
  if (run.hardBreak) return '<br>'
  let inline = escapeHTML(run.text).replace(/[\u2028\u000b\n]/g, '<br>')
  const css: string[] = []
  if (run.bold) css.push('font-weight:700')
  if (run.italic) css.push('font-style:italic')
  const decorations = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean)
  if (decorations.length) css.push(`text-decoration:${decorations.join(' ')}`)
  if (run.color) css.push(`color:${run.color}`)
  if (run.highlight) css.push(`background-color:${run.highlight}`)
  if (run.fontSizePt !== undefined && run.fontSizePt !== defaultSize) css.push(`font-size:${cssNumber(scaled(run.fontSizePt, base))}pt`)
  if (run.link && isSafeLinkHref(run.link)) inline = `<a href="${escapeHTML(run.link)}">${inline}</a>`
  if (run.superscript) inline = `<sup>${inline}</sup>`
  else if (run.subscript) inline = `<sub>${inline}</sub>`
  return css.length ? `<span style="${escapeHTML(css.join(';'))}">${inline}</span>` : inline
}

function listMarker(paragraph: RichParagraph): string {
  const list = paragraph.list
  if (!list) return ''
  if (list.kind === 'bullet') return '• '
  if (list.kind === 'check') return list.checked ? '☑ ' : '☐ '
  return `${list.ordinal ?? 1}. `
}

function paragraphHTML(paragraph: RichParagraph, position: { first: boolean; last: boolean }, base: number, includeFootnotes: boolean): string {
  const level = Math.min(6, Math.max(0, paragraph.headingLevel))
  const defaultSize = defaultFontSizePt(level)
  const quote = paragraph.quote === true
  const listIndent = paragraph.list ? (paragraph.list.level + 1) * LIST_HANG_PT : 0
  const start = (paragraph.indentStartPt ?? 0) + (quote ? QUOTE_INDENT_PT : 0) + listIndent
  const firstLine = (paragraph.indentFirstLinePt ?? paragraph.indentStartPt ?? 0) + (quote ? QUOTE_INDENT_PT : 0) + (paragraph.list ? listIndent - LIST_HANG_PT : 0)
  const before = paragraph.spaceBeforePt ?? (quote && position.first ? QUOTE_SPACE_BEFORE_PT : level > 0 ? HEADING_SPACE_BEFORE_PT : 0)
  const after = paragraph.spaceAfterPt ?? (quote && position.last ? QUOTE_SPACE_AFTER_PT : level > 0 ? HEADING_SPACE_AFTER_PT : 0)
  const css: string[] = []
  if (start) css.push(`margin-left:${cssNumber(start)}pt`)
  if (firstLine !== start) css.push(`text-indent:${cssNumber(firstLine - start)}pt`)
  if (quote) css.push(`margin-right:${QUOTE_INDENT_END_PT}pt`, `color:${QUOTE_INK_COLOR}`)
  if (before) css.push(`margin-top:${cssNumber(before)}pt`)
  if (after) css.push(`margin-bottom:${cssNumber(after)}pt`)
  if (paragraph.alignment && paragraph.alignment !== 'left') css.push(`text-align:${paragraph.alignment}`)
  if (paragraph.lineHeight !== undefined && paragraph.lineHeight !== BODY_LINE_HEIGHT) css.push(`line-height:${cssNumber(paragraph.lineHeight)}`)
  if (level > 0) css.push(`font-size:${cssNumber(scaled(defaultSize, base))}pt`)
  const tag = level > 0 ? `h${level}` : 'p'
  const marker = escapeHTML(listMarker(paragraph))
  const content = marker + paragraph.runs.map((run) => runHTML(run, base, defaultSize, includeFootnotes)).join('')
  const style = css.length ? ` style="${escapeHTML(css.join(';'))}"` : ''
  const classes = [quote ? 'quote' : '', paragraph.attribution ? 'attribution' : ''].filter(Boolean).join(' ')
  return `<${tag}${classes ? ` class="${classes}"` : ''}${style}>${content || '<br>'}</${tag}>`
}

/** Documento HTML completo, pronto para `printToPDF`. */
export function htmlForPrint(document: RichDocument, options: PrintOptions = {}): string {
  const base = clamp(options.fontSizePt ?? 14, 6, 42)
  const family = (options.fontFamily ?? BODY_FONT_FAMILY).replace(/["\\;{}<>]/g, '')
  const includeFootnotes = options.includeFootnotes ?? true
  const margin = clamp(options.pageMarginPt ?? 48, 0, 144)
  const pageSize = (options.pageSize ?? 'A4').replace(/[^a-zA-Z0-9 .]/g, '')
  const title = (options.title ?? document.title ?? '').trim()
  const occasion = options.occasion?.trim() ?? ''
  const titleSize = Math.min(base + 4, 28)
  const occasionSize = Math.max(9, base - 3)

  let body = ''
  if (title) body += `<h1 class="print-title">${escapeHTML(title)}</h1>`
  if (occasion) body += `<p class="print-occasion">${escapeHTML(occasion)}</p>`
  if (title || occasion) body += '<p class="print-gap"><br></p>'
  document.paragraphs.forEach((paragraph, index) => {
    const position = { first: !document.paragraphs[index - 1]?.quote, last: !document.paragraphs[index + 1]?.quote }
    body += paragraphHTML(paragraph, position, base, includeFootnotes)
  })
  if (includeFootnotes && document.footnotes.length) {
    body += '<section class="print-notes"><hr><p class="print-notes-title">Notas</p>'
    for (const note of document.footnotes) {
      const text = note.runs.map((run) => runHTML(run, base, BODY_FONT_SIZE_PT, false)).join('')
      body += `<p class="print-note"><sup>${note.number}</sup> ${text}</p>`
    }
    body += '</section>'
  }

  const css = `
@page { size: ${pageSize}; margin: ${cssNumber(margin)}pt; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "${family}", Arial, sans-serif; font-size: ${cssNumber(base)}pt; line-height: ${BODY_LINE_HEIGHT}; color: #000; }
p, h1, h2, h3, h4, h5, h6 { margin: 0; white-space: pre-wrap; orphans: 2; widows: 2; }
h1, h2, h3, h4, h5, h6 { font-weight: 400; break-after: avoid; page-break-after: avoid; }
h1.print-title { font-size: ${cssNumber(titleSize)}pt; font-weight: 700; margin: 0 0 3pt; }
p.print-occasion { font-size: ${cssNumber(occasionSize)}pt; color: #666; }
a { color: ${LINK_COLOR}; }
sup { font-size: 0.7em; line-height: 0; }
.print-notes { margin-top: 18pt; font-size: ${cssNumber(Math.max(9, base - 2))}pt; }
.print-notes hr { border: 0; border-top: 1px solid #999; width: 30%; margin: 0 0 6pt; }
.print-notes-title { font-weight: 700; margin-bottom: 4pt; }
.print-note { margin-bottom: 3pt; }
`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHTML(title || 'Manuscrito')}</title><style>${css}</style></head><body>${body}</body></html>`
}
