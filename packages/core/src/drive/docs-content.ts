/**
 * Conversão do manuscrito (modelo neutro `RichDocument`) para o corpo do `documents.batchUpdate`
 * da Google Docs API. Os intervalos são em unidades UTF-16, como os índices da API; o texto é
 * inserido a partir do índice 1, então cada intervalo local soma 1.
 */

import {
  BODY_FONT_FAMILY,
  BODY_FONT_SIZE_PT,
  QUOTE_INDENT_PT,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
} from '../document/model'
import type { ParagraphAlignment, RichDocument, RichParagraph, RichRun } from '../document/model'
import { sha256Hex } from '../util/hash'

export interface GoogleDocsRange {
  location: number
  length: number
}

/** Componentes RGB de 0 a 1, no formato `rgbColor` da API. */
export interface GoogleDocsRGBColor {
  red: number
  green: number
  blue: number
}

export interface GoogleDocsStyleRun {
  range: GoogleDocsRange
  fontName: string
  fontSize: number
  bold: boolean
  italic: boolean
  superscript: boolean
  underline: boolean
  strikethrough: boolean
  subscript: boolean
  linkURL?: string
  foregroundColor?: GoogleDocsRGBColor
  backgroundColor?: GoogleDocsRGBColor
}

export interface GoogleDocsParagraphRun {
  range: GoogleDocsRange
  indentStart: number
  indentFirstLine: number
  indentEnd: number
  /** `HEADING_1` a `HEADING_6`, `TITLE` ou `SUBTITLE`. */
  headingType?: string
  spacingBefore: number
  spacingAfter: number
  /** `START`, `CENTER`, `END` ou `JUSTIFIED`. */
  alignment?: string
  /** Entrelinha em porcentagem (115 = 1,15). */
  lineSpacing?: number
}

export interface GoogleDocsContent {
  text: string
  styles: GoogleDocsStyleRun[]
  paragraphs: GoogleDocsParagraphRun[]
}

export type GoogleDocsRequest = Record<string, unknown>

export interface GoogleDocsBatchUpdateBody {
  requests: GoogleDocsRequest[]
  writeControl: { requiredRevisionId: string }
}

/** Estilo de base aplicado a todo o texto antes dos trechos formatados (igual ao app Swift). */
export const DOCS_BASE_FONT_FAMILY = 'Arial'
export const DOCS_BASE_FONT_SIZE_PT = 10
/** Cores da citação em bloco no editor Swift (`quoteForegroundColor`/`quoteBackgroundColor`). */
export const DOCS_QUOTE_FOREGROUND_COLOR: GoogleDocsRGBColor = { red: 0.17, green: 0.32, blue: 0.24 }
export const DOCS_QUOTE_BACKGROUND_COLOR: GoogleDocsRGBColor = { red: 0.91, green: 0.94, blue: 0.91 }
/** Recuo à direita da citação (`tailIndent = -12`). */
export const DOCS_QUOTE_INDENT_END_PT = 12
/** Notas no fim do documento, como o editor Swift as inseria (corpo 10 pt). */
export const DOCS_FOOTNOTE_TEXT_SIZE_PT = 10
/** Recuo por nível de lista aninhada (o mesmo passo de `changeIndent`). */
export const DOCS_LIST_LEVEL_INDENT_PT = 36
/** Quebra de linha dentro do parágrafo no Google Docs. */
export const DOCS_LINE_BREAK = '\u000b'

/** Tamanho dos estilos semânticos de título no editor (`DocumentParagraphStyle.pointSize`). */
const HEADING_POINT_SIZES = [BODY_FONT_SIZE_PT, 20, 16, 14, 12, 11, 11]

const TEXT_STYLE_FIELDS =
  'bold,italic,underline,strikethrough,baselineOffset,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link'
/** Campos de parágrafo controlados pelo app; listados sem valor voltam ao padrão do estilo nomeado. */
const PARAGRAPH_RESET_FIELDS =
  'namedStyleType,alignment,indentStart,indentFirstLine,indentEnd,spaceAbove,spaceBelow,lineSpacing'

export function googleDocsStyleRun(
  values: Pick<GoogleDocsStyleRun, 'range' | 'fontName' | 'fontSize' | 'bold' | 'italic' | 'superscript'> &
    Partial<GoogleDocsStyleRun>,
): GoogleDocsStyleRun {
  return { underline: false, strikethrough: false, subscript: false, ...values }
}

export function googleDocsParagraphRun(
  values: Pick<GoogleDocsParagraphRun, 'range' | 'indentStart' | 'indentFirstLine' | 'indentEnd'> &
    Partial<GoogleDocsParagraphRun>,
): GoogleDocsParagraphRun {
  return { spacingBefore: 0, spacingAfter: 0, ...values }
}

/** `#rrggbb` ou `#rgb` → componentes de 0 a 1. */
export function docsRGBColorFromHex(value: string | undefined): GoogleDocsRGBColor | undefined {
  if (!value) return undefined
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return undefined
  let hex = match[1] as string
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('')
  const component = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255
  return { red: component(0), green: component(2), blue: component(4) }
}

/**
 * Prepara o texto de um trecho para `insertText`: quebras viram quebra de linha do Docs, e saem
 * os caracteres que a API descartaria (controles e área de uso privado), para que os índices
 * calculados aqui continuem valendo no documento remoto.
 */
export function sanitizeDocsText(text: string): string {
  return (
    text
      .replace(/\r\n|[\n\r\u2028\u2029]/g, DOCS_LINE_BREAK)
      // eslint-disable-next-line no-control-regex -- são justamente os controles que a API descarta
      .replace(/[\u0000-\u0008\u000c-\u001f\ue000-\uf8ff]/g, '')
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
  )
}

function docsAlignment(alignment: ParagraphAlignment | undefined): string | undefined {
  switch (alignment) {
    case 'left':
      return 'START'
    case 'center':
      return 'CENTER'
    case 'right':
      return 'END'
    case 'justify':
      return 'JUSTIFIED'
    default:
      return undefined
  }
}

function listMarker(paragraph: RichParagraph): string {
  const list = paragraph.list
  if (!list) return ''
  switch (list.kind) {
    case 'bullet':
      return '• '
    case 'check':
      return list.checked ? '☑ ' : '☐ '
    case 'ordered':
      return `${list.ordinal ?? 1}. `
  }
}

function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

type RunStyle = Omit<GoogleDocsStyleRun, 'range'>

interface BaseStyle {
  fontName: string
  fontSize: number
  foregroundColor?: GoogleDocsRGBColor
  backgroundColor?: GoogleDocsRGBColor
}

function runStyle(run: RichRun, base: BaseStyle): RunStyle {
  const isFootnote = run.footnote !== undefined
  const superscript = isFootnote || Boolean(run.superscript)
  const style: RunStyle = {
    fontName: run.fontFamily?.trim() || (run.code ? 'Courier New' : base.fontName),
    fontSize: positive(run.fontSizePt) ?? base.fontSize,
    bold: Boolean(run.bold),
    italic: Boolean(run.italic),
    superscript,
    underline: Boolean(run.underline),
    strikethrough: Boolean(run.strike),
    subscript: !superscript && Boolean(run.subscript),
  }
  const link = isFootnote ? undefined : run.link?.trim()
  if (link) style.linkURL = link
  const foreground = docsRGBColorFromHex(run.color) ?? base.foregroundColor
  if (foreground) style.foregroundColor = foreground
  const background = docsRGBColorFromHex(run.highlight) ?? base.backgroundColor
  if (background) style.backgroundColor = background
  return style
}

function sameColor(left: GoogleDocsRGBColor | undefined, right: GoogleDocsRGBColor | undefined): boolean {
  if (!left || !right) return left === right
  return left.red === right.red && left.green === right.green && left.blue === right.blue
}

function sameStyle(left: RunStyle, right: RunStyle): boolean {
  return (
    left.fontName === right.fontName &&
    left.fontSize === right.fontSize &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.superscript === right.superscript &&
    left.underline === right.underline &&
    left.strikethrough === right.strikethrough &&
    left.subscript === right.subscript &&
    left.linkURL === right.linkURL &&
    sameColor(left.foregroundColor, right.foregroundColor) &&
    sameColor(left.backgroundColor, right.backgroundColor)
  )
}

/** Parágrafo já resolvido para a saída: estilo de parágrafo, estilo de base e trechos. */
interface LayoutParagraph {
  source: RichParagraph
  baseFontSize: number
  runs: RichRun[]
}

class ContentBuilder {
  private readonly parts: string[] = []
  private length = 0
  readonly styles: GoogleDocsStyleRun[] = []
  readonly paragraphs: GoogleDocsParagraphRun[] = []

  get position(): number {
    return this.length
  }

  append(text: string, style: RunStyle): void {
    if (text.length === 0) return
    const location = this.length
    this.parts.push(text)
    this.length += text.length
    const last = this.styles[this.styles.length - 1]
    if (last && last.range.location + last.range.length === location && sameStyle(last, style)) {
      last.range = { location: last.range.location, length: last.range.length + text.length }
    } else {
      this.styles.push({ range: { location, length: text.length }, ...style })
    }
  }

  get text(): string {
    return this.parts.join('')
  }
}

function paragraphRun(layout: LayoutParagraph, range: GoogleDocsRange): GoogleDocsParagraphRun | null {
  const paragraph = layout.source
  const quoted = Boolean(paragraph.quote || paragraph.attribution)
  const level = Math.min(6, Math.max(0, Math.floor(paragraph.headingLevel || 0)))
  const listIndent = paragraph.list
    ? DOCS_LIST_LEVEL_INDENT_PT * Math.max(0, Math.floor(paragraph.list.level || 0))
    : 0
  // Recuos absolutos a partir da margem, como no Docs e no AppKit; sem recuo de primeira linha
  // explícito, a primeira linha acompanha o recuo do parágrafo.
  const indentStart = Math.max(0, paragraph.indentStartPt ?? (quoted ? QUOTE_INDENT_PT : 0) + listIndent)
  const indentFirstLine = Math.max(0, paragraph.indentFirstLinePt ?? indentStart)
  const run = googleDocsParagraphRun({
    range,
    indentStart,
    indentFirstLine,
    indentEnd: quoted ? DOCS_QUOTE_INDENT_END_PT : 0,
    spacingBefore: Math.max(0, paragraph.spaceBeforePt ?? (quoted ? QUOTE_SPACE_BEFORE_PT : 0)),
    spacingAfter: Math.max(0, paragraph.spaceAfterPt ?? (quoted ? QUOTE_SPACE_AFTER_PT : 0)),
  })
  if (level > 0) run.headingType = `HEADING_${level}`
  const alignment = docsAlignment(paragraph.alignment)
  if (alignment) run.alignment = alignment
  const lineHeight = positive(paragraph.lineHeight)
  if (lineHeight !== undefined) run.lineSpacing = Math.round(lineHeight * 1000) / 10
  const hasStyle =
    run.indentStart > 0 ||
    run.indentFirstLine > 0 ||
    run.indentEnd > 0 ||
    run.headingType !== undefined ||
    run.spacingBefore > 0 ||
    run.spacingAfter > 0 ||
    run.alignment !== undefined ||
    run.lineSpacing !== undefined
  return hasStyle && range.length > 0 ? run : null
}

function isEmptyParagraph(paragraph: RichParagraph): boolean {
  return (
    !paragraph.list &&
    paragraph.runs.every((run) => !run.hardBreak && run.footnote === undefined && !run.text)
  )
}

/**
 * Monta o texto, os trechos e os parágrafos do Google Doc. Marcadores de lista ficam literais no
 * texto ("• ", "1. ", "☐ "), como no RTF do app Swift; chamadas de nota viram números sobrescritos
 * e as notas são acrescentadas ao fim, cada uma depois de uma linha em branco.
 */
export function googleDocsContentFromDocument(document: RichDocument): GoogleDocsContent {
  const body = [...document.paragraphs]
  while (body.length > 0 && isEmptyParagraph(body[body.length - 1] as RichParagraph)) body.pop()

  const layout: LayoutParagraph[] = body.map((paragraph) => {
    const level = Math.min(6, Math.max(0, Math.floor(paragraph.headingLevel || 0)))
    return {
      source: paragraph,
      baseFontSize: HEADING_POINT_SIZES[level] ?? BODY_FONT_SIZE_PT,
      runs: paragraph.runs,
    }
  })
  for (const note of document.footnotes) {
    const plain: RichParagraph = { headingLevel: 0, runs: [] }
    layout.push({ source: plain, baseFontSize: DOCS_FOOTNOTE_TEXT_SIZE_PT, runs: [] })
    layout.push({
      source: plain,
      baseFontSize: DOCS_FOOTNOTE_TEXT_SIZE_PT,
      runs: [{ text: '', footnote: note.number }, { text: ' ' }, ...note.runs],
    })
  }

  const builder = new ContentBuilder()
  layout.forEach((item, index) => {
    const paragraph = item.source
    const quoted = Boolean(paragraph.quote || paragraph.attribution)
    const base: BaseStyle = { fontName: BODY_FONT_FAMILY, fontSize: item.baseFontSize }
    if (quoted) {
      base.foregroundColor = DOCS_QUOTE_FOREGROUND_COLOR
      base.backgroundColor = DOCS_QUOTE_BACKGROUND_COLOR
    }
    const start = builder.position
    let lastStyle = runStyle({ text: '' }, base)
    const marker = listMarker(paragraph)
    if (marker) {
      // O marcador leva a formatação do início do parágrafo, sem link nem deslocamento de linha.
      const first: RichRun = item.runs[0] ?? { text: '' }
      const style = runStyle(
        { ...first, footnote: undefined, superscript: false, subscript: false, link: undefined },
        base,
      )
      builder.append(marker, style)
      lastStyle = style
    }
    for (const run of item.runs) {
      const text = run.hardBreak
        ? DOCS_LINE_BREAK
        : run.footnote !== undefined
          ? String(run.footnote)
          : sanitizeDocsText(run.text ?? '')
      if (!text) continue
      const style = runStyle(run, base)
      builder.append(text, style)
      lastStyle = style
    }
    if (index < layout.length - 1) {
      // A quebra de parágrafo segue o último trecho, sem link nem deslocamento de linha.
      const { linkURL: _link, ...plain } = lastStyle
      builder.append('\n', { ...plain, superscript: false, subscript: false })
    }
    const run = paragraphRun(item, { location: start, length: builder.position - start })
    if (run) builder.paragraphs.push(run)
  })
  return { text: builder.text, styles: builder.styles, paragraphs: builder.paragraphs }
}

function dimension(magnitude: number): { magnitude: number; unit: 'PT' } {
  return { magnitude, unit: 'PT' }
}

function colorValue(color: GoogleDocsRGBColor): Record<string, unknown> {
  return { color: { rgbColor: { red: color.red, green: color.green, blue: color.blue } } }
}

/**
 * Corpo do `batchUpdate` que substitui todo o conteúdo do documento. Exige a revisão remota lida
 * antes (`writeControl.requiredRevisionId`), para que uma edição externa no meio do caminho falhe
 * em vez de ser sobrescrita.
 */
export function googleDocsBatchUpdateBody(
  content: GoogleDocsContent,
  currentEndIndex: number,
  requiredRevisionId: string,
): GoogleDocsBatchUpdateBody {
  const length = content.text.length
  const requests: GoogleDocsRequest[] = []
  if (currentEndIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: currentEndIndex - 1 } } })
  }
  if (length > 0) {
    requests.push({ insertText: { location: { index: 1 }, text: content.text } })
    // O texto inserido herda o estilo do parágrafo que restou; volta tudo ao texto normal.
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: length + 1 },
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
        fields: PARAGRAPH_RESET_FIELDS,
      },
    })
    requests.push({
      updateTextStyle: {
        range: { startIndex: 1, endIndex: length + 1 },
        textStyle: {
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          baselineOffset: 'BASELINE',
          weightedFontFamily: { fontFamily: DOCS_BASE_FONT_FAMILY },
          fontSize: dimension(DOCS_BASE_FONT_SIZE_PT),
        },
        fields: TEXT_STYLE_FIELDS,
      },
    })
    for (const style of content.styles) {
      const styled =
        style.bold ||
        style.italic ||
        style.superscript ||
        style.subscript ||
        style.underline ||
        style.strikethrough ||
        style.linkURL !== undefined ||
        style.fontSize !== DOCS_BASE_FONT_SIZE_PT ||
        style.fontName !== DOCS_BASE_FONT_FAMILY ||
        style.foregroundColor !== undefined ||
        style.backgroundColor !== undefined
      if (!styled || style.range.length <= 0) continue
      const textStyle: Record<string, unknown> = {
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strikethrough: style.strikethrough,
        baselineOffset: style.superscript ? 'SUPERSCRIPT' : style.subscript ? 'SUBSCRIPT' : 'BASELINE',
        weightedFontFamily: { fontFamily: style.fontName },
        fontSize: dimension(style.fontSize),
      }
      if (style.foregroundColor) textStyle.foregroundColor = colorValue(style.foregroundColor)
      if (style.backgroundColor) textStyle.backgroundColor = colorValue(style.backgroundColor)
      if (style.linkURL !== undefined) textStyle.link = { url: style.linkURL }
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: style.range.location + 1,
            endIndex: style.range.location + style.range.length + 1,
          },
          textStyle,
          fields: TEXT_STYLE_FIELDS,
        },
      })
    }
    for (const paragraph of content.paragraphs) {
      const paragraphStyle: Record<string, unknown> = {}
      const fields: string[] = []
      if (paragraph.indentStart > 0) {
        paragraphStyle.indentStart = dimension(paragraph.indentStart)
        fields.push('indentStart')
      }
      if (paragraph.indentFirstLine > 0) {
        paragraphStyle.indentFirstLine = dimension(paragraph.indentFirstLine)
        fields.push('indentFirstLine')
      }
      if (paragraph.indentEnd > 0) {
        paragraphStyle.indentEnd = dimension(paragraph.indentEnd)
        fields.push('indentEnd')
      }
      if (paragraph.spacingBefore > 0) {
        paragraphStyle.spaceAbove = dimension(paragraph.spacingBefore)
        fields.push('spaceAbove')
      }
      if (paragraph.spacingAfter > 0) {
        paragraphStyle.spaceBelow = dimension(paragraph.spacingAfter)
        fields.push('spaceBelow')
      }
      if (paragraph.headingType !== undefined) {
        paragraphStyle.namedStyleType = paragraph.headingType
        fields.push('namedStyleType')
      }
      if (paragraph.alignment !== undefined) {
        paragraphStyle.alignment = paragraph.alignment
        fields.push('alignment')
      }
      if (paragraph.lineSpacing !== undefined) {
        paragraphStyle.lineSpacing = paragraph.lineSpacing
        fields.push('lineSpacing')
      }
      if (fields.length === 0 || paragraph.range.length <= 0) continue
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: paragraph.range.location + 1,
            endIndex: paragraph.range.location + paragraph.range.length + 1,
          },
          paragraphStyle,
          fields: fields.join(','),
        },
      })
    }
  }
  return { requests, writeControl: { requiredRevisionId } }
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Hash do conteúdo enviado ao Docs. Equivale ao hash do RTF no app Swift: a sincronização
 * automática só acontece quando ele muda.
 */
export function googleDocsContentHash(content: GoogleDocsContent): Promise<string> {
  return sha256Hex(canonicalJSON(content))
}

// MARK: - Leitura de documentos

/** Texto corrido de `body.content` (parágrafos, tabelas e sumário) de um documento do Docs. */
export function plainTextFromDocsContent(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  let result = ''
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    const paragraph = item.paragraph as Record<string, unknown> | undefined
    const table = item.table as Record<string, unknown> | undefined
    const contents = item.tableOfContents as Record<string, unknown> | undefined
    if (paragraph && typeof paragraph === 'object' && Array.isArray(paragraph.elements)) {
      for (const element of paragraph.elements as unknown[]) {
        const textRun = (element as Record<string, unknown> | null)?.textRun as
          Record<string, unknown> | undefined
        if (textRun && typeof textRun.content === 'string') result += textRun.content
      }
    } else if (table && typeof table === 'object' && Array.isArray(table.tableRows)) {
      for (const row of table.tableRows as unknown[]) {
        const cells = (row as Record<string, unknown> | null)?.tableCells
        if (!Array.isArray(cells)) continue
        for (const cell of cells)
          result += plainTextFromDocsContent((cell as Record<string, unknown> | null)?.content)
      }
    } else if (contents && typeof contents === 'object') {
      result += plainTextFromDocsContent(contents.content)
    }
  }
  return result
}
