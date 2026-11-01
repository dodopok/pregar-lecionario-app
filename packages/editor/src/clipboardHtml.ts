/**
 * HTML da área de transferência para editores web (porta de DocumentClipboardHTML do Swift):
 * estilos inline em cada bloco e trecho, blocos explícitos inclusive vazios, `br` nas quebras de
 * linha, `white-space:pre-wrap`, texto escapado e nenhum link executável.
 */
import type { RichParagraph, RichRun } from '@pregar/core/document/model'
import { toRichDocument, type ManuscriptContent } from './richDocument'
import {
  BODY_FONT_FAMILY,
  BODY_LINE_HEIGHT,
  defaultFontSizePt,
  FOOTNOTE_TEXT_FONT_SIZE_PT,
  HEADING_SPACE_AFTER_PT,
  HEADING_SPACE_BEFORE_PT,
  QUOTE_INDENT_END_PT,
  QUOTE_INDENT_PT,
  QUOTE_INK_COLOR,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
} from './styles'
import { cssNumber, escapeHTML, hexToRgb, isSafeLinkHref } from './util'

export interface ClipboardHTMLOptions {
  /** Inclui as notas da seleção no fim, como a área de notas do Swift (padrão: true). */
  includeFootnotes?: boolean
  /** Dados do slice para colar de volta no próprio editor sem perdas (ver clipboard.ts). */
  embed?: unknown
}

const EMBED_ATTRIBUTE = 'data-pregar-slice'

function rgba(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},1)`
}

function fontCSS(family: string, size: number): string {
  const escapedFamily = family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `font-family:"${escapedFamily}";font-size:${cssNumber(size)}pt`
}

interface ParagraphContext {
  defaultSize: number
  quote: boolean
}

function runCSS(run: RichRun, context: ParagraphContext): string {
  const css = [
    fontCSS(run.fontFamily ?? BODY_FONT_FAMILY, run.fontSizePt ?? context.defaultSize),
    `font-weight:${run.bold ? '700' : '400'}`,
    `font-style:${run.italic ? 'italic' : 'normal'}`,
    'white-space:pre-wrap',
  ]
  const decorations = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean)
  css.push(`text-decoration:${decorations.length ? decorations.join(' ') : 'none'}`)
  css.push(`color:${rgba(run.color ?? (context.quote ? QUOTE_INK_COLOR : '#000000'))}`)
  if (run.highlight) css.push(`background-color:${rgba(run.highlight)}`)
  return css.join(';')
}

function runHTML(run: RichRun, context: ParagraphContext): string {
  let inline = run.hardBreak ? '<br>' : escapeHTML(run.text).replace(/[\u2028\u000b\n]/g, '<br>')
  if (run.link && isSafeLinkHref(run.link)) {
    inline = `<a href="${escapeHTML(run.link)}" style="color:inherit;text-decoration:inherit">${inline}</a>`
  }
  if (run.superscript || run.footnote !== undefined) inline = `<sup style="font-size:inherit">${inline}</sup>`
  else if (run.subscript) inline = `<sub style="font-size:inherit">${inline}</sub>`
  return `<span style="${escapeHTML(runCSS(run, context))}">${inline}</span>`
}

function listMarker(paragraph: RichParagraph): string {
  const list = paragraph.list
  if (list?.kind !== 'check') return ''
  return list.checked ? '☑ ' : '☐ '
}

function paragraphHTML(paragraph: RichParagraph, position: { first: boolean; last: boolean }, includeFootnotes: boolean): string {
  const level = Math.min(6, Math.max(0, paragraph.headingLevel))
  const context: ParagraphContext = { defaultSize: defaultFontSizePt(level), quote: paragraph.quote === true }
  const runs = includeFootnotes ? paragraph.runs : paragraph.runs.filter((run) => run.footnote === undefined)
  const first = runs.find((run) => !run.hardBreak) ?? runs[0]
  const tag = level > 0 ? `h${level}` : 'p'
  const quote = paragraph.quote === true
  const indentStart = (paragraph.indentStartPt ?? 0) + (quote ? QUOTE_INDENT_PT : 0)
  const firstLine = (paragraph.indentFirstLinePt ?? paragraph.indentStartPt ?? 0) + (quote ? QUOTE_INDENT_PT : 0)
  const before = paragraph.spaceBeforePt ?? (quote && position.first ? QUOTE_SPACE_BEFORE_PT : level > 0 ? HEADING_SPACE_BEFORE_PT : 0)
  const after = paragraph.spaceAfterPt ?? (quote && position.last ? QUOTE_SPACE_AFTER_PT : level > 0 ? HEADING_SPACE_AFTER_PT : 0)
  const css = [
    fontCSS(first?.fontFamily ?? BODY_FONT_FAMILY, first?.fontSizePt ?? context.defaultSize),
    'font-weight:normal',
    'font-style:normal',
    'white-space:pre-wrap',
    `margin-top:${cssNumber(before)}pt`,
    `margin-bottom:${cssNumber(after)}pt`,
    `margin-left:${cssNumber(indentStart)}pt`,
    `margin-right:${cssNumber(quote ? QUOTE_INDENT_END_PT : 0)}pt`,
    `text-indent:${cssNumber(firstLine - indentStart)}pt`,
    `text-align:${paragraph.alignment ?? 'start'}`,
    `line-height:${cssNumber(paragraph.lineHeight ?? BODY_LINE_HEIGHT)}`,
  ]
  const marker = listMarker(paragraph)
  let content = runs.map((run) => runHTML(run, context)).join('')
  if (marker) content = runHTML({ text: marker, ...(first ? { fontFamily: first.fontFamily, fontSizePt: first.fontSizePt } : {}) }, context) + content
  return `<${tag} style="${escapeHTML(css.join(';'))}">${content || '<br>'}</${tag}>`
}

type OpenList = { kind: 'bullet' | 'ordered'; tag: 'ul' | 'ol' }

function blocksHTML(paragraphs: RichParagraph[], includeFootnotes: boolean): string {
  let html = ''
  const open: OpenList[] = []
  const closeTo = (depth: number) => {
    while (open.length > depth) html += `</li></${open.pop()?.tag}>`
  }
  paragraphs.forEach((paragraph, index) => {
    const previous = paragraphs[index - 1]
    const next = paragraphs[index + 1]
    const position = { first: !previous?.quote, last: !next?.quote }
    const list = paragraph.list
    if (!list || list.kind === 'check') {
      closeTo(0)
      html += paragraphHTML(paragraph, position, includeFootnotes)
      return
    }
    const depth = Math.max(0, list.level) + 1
    closeTo(depth)
    const top = open[depth - 1]
    if (top && top.kind !== list.kind) closeTo(depth - 1)
    if (open.length === depth) {
      html += '</li>'
    }
    while (open.length < depth) {
      const tag = list.kind === 'ordered' ? 'ol' : 'ul'
      const start = list.kind === 'ordered' && open.length === depth - 1 && list.ordinal && list.ordinal !== 1 ? ` start="${list.ordinal}"` : ''
      html += `<${tag}${start} style="margin-top:0;margin-bottom:0">`
      open.push({ kind: list.kind, tag })
      if (open.length < depth) html += `<li style="list-style-type:none">`
    }
    html += `<li style="list-style-type:${list.kind === 'ordered' ? 'decimal' : 'disc'}">`
    html += paragraphHTML(paragraph, position, includeFootnotes)
  })
  closeTo(0)
  return html
}

function footnotesHTML(notes: ReturnType<typeof toRichDocument>['footnotes']): string {
  if (!notes.length) return ''
  const edge = { first: true, last: true }
  // Área de notas como no Swift: linha em branco e "¹ Texto da nota" em 10 pt.
  let html = paragraphHTML({ headingLevel: 0, runs: [] }, edge, true)
  for (const note of notes) {
    const text = note.runs.map((run) => run.text).join('')
    const runs: RichRun[] = [
      { text: String(note.number), superscript: true, fontSizePt: FOOTNOTE_TEXT_FONT_SIZE_PT },
      { text: ` ${text}`, fontSizePt: FOOTNOTE_TEXT_FONT_SIZE_PT },
    ]
    html += paragraphHTML({ headingLevel: 0, runs }, edge, true)
  }
  return html
}

/** Codifica dados (JSON) em base64 UTF-8 para o atributo do fragmento. */
export function encodeClipboardPayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/** Lê os dados embutidos por `clipboardHTML(..., { embed })`, ou undefined. */
export function decodeClipboardPayload(html: string): unknown {
  const match = new RegExp(`${EMBED_ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(html)
  if (!match?.[1]) return undefined
  try {
    const binary = atob(match[1])
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return undefined
  }
}

/** HTML da seleção (ou do documento) para a área de transferência. */
export function clipboardHTML(content: ManuscriptContent, options: ClipboardHTMLOptions = {}): string {
  const includeFootnotes = options.includeFootnotes ?? true
  const document = toRichDocument(content)
  const paragraphs = document.paragraphs.length ? document.paragraphs : [{ headingLevel: 0, runs: [] }]
  let body = blocksHTML(paragraphs, includeFootnotes)
  if (includeFootnotes) body += footnotesHTML(document.footnotes)
  const embed = options.embed === undefined ? '' : ` ${EMBED_ATTRIBUTE}="${encodeClipboardPayload(options.embed)}"`
  return `<html><head><meta charset="utf-8"></head><body><!--StartFragment--><div${embed}>${body}</div><!--EndFragment--></body></html>`
}
