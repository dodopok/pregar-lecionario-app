/**
 * Conversão do JSON do editor para o modelo neutro (`RichDocument`) e derivados: texto corrido
 * da revisão, âncoras de bloco, contagem de palavras e lista de notas. Funciona só com JSON, sem
 * esquema nem editor. As anotações (notas do pregador para si) ficam fora de tudo o que deriva do
 * texto falado, salvo pedido explícito (`includeAnnotations`).
 */
import type { JSONContent } from '@tiptap/core'
import { Fragment, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import {
  documentPlainText,
  paragraphText,
  type ListKind,
  type ParagraphAlignment,
  type RichDocument,
  type RichFootnote,
  type RichParagraph,
  type RichRun,
} from '@pregar/core/document/model'
import { countWords } from '@pregar/core/util/text'
import { isSafeLinkHref, normalizeColor, parseLengthPt, primaryFontFamily } from './util'

type JSONMark = NonNullable<JSONContent['marks']>[number]

/** Conteúdo aceito pelos conversores: JSON do editor, nó, fragmento ou slice do ProseMirror. */
export type ManuscriptContent = JSONContent | ProseMirrorNode | Fragment | Slice

const LEAF_TYPES = new Set(['hardBreak', 'footnote', 'horizontalRule', 'image'])
const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading'])
const LIST_TYPES: Record<string, ListKind> = {
  bulletList: 'bullet',
  orderedList: 'ordered',
  taskList: 'check',
}
const INLINE_TYPES = new Set(['text', 'hardBreak', 'footnote'])
/** Anotação: nota do pregador para si, fora do texto falado. */
const ANNOTATION_TYPE = 'annotation'

export interface FlatPiece {
  kind: 'text' | 'break' | 'footnote'
  /** Texto do trecho; "\n" na quebra de linha; vazio na nota. */
  text: string
  marks: JSONMark[]
  /** Posição ProseMirror do início do trecho. */
  pos: number
  note?: string
  footnoteId?: string
}

export interface FlatParagraph {
  id?: string
  headingLevel: number
  attrs: Record<string, unknown>
  quote: boolean
  attribution: boolean
  /** Parágrafo dentro de uma anotação; só aparece com `includeAnnotations`. */
  annotation?: boolean
  list?: { kind: ListKind; level: number; checked?: boolean; ordinal?: number }
  /** Posição ProseMirror do início do conteúdo do parágrafo. */
  contentPos: number
  pieces: FlatPiece[]
}

/** Normaliza qualquer entrada aceita para um JSON de documento. */
export function toDocumentJSON(content: ManuscriptContent): JSONContent {
  if (content instanceof Slice) return wrapDocument(content.content.toJSON() as JSONContent[] | null)
  if (content instanceof Fragment) return wrapDocument(content.toJSON() as JSONContent[] | null)
  if (content instanceof ProseMirrorNode) {
    const json = content.toJSON() as JSONContent
    return json.type === 'doc' ? json : wrapDocument([json])
  }
  if (content.type === 'doc') return content
  return wrapDocument([content])
}

function wrapDocument(nodes: JSONContent[] | null | undefined): JSONContent {
  const content: JSONContent[] = []
  let inline: JSONContent[] = []
  for (const node of nodes ?? []) {
    if (INLINE_TYPES.has(node.type ?? '')) {
      inline.push(node)
      continue
    }
    if (inline.length) content.push({ type: 'paragraph', content: inline })
    inline = []
    content.push(node)
  }
  if (inline.length) content.push({ type: 'paragraph', content: inline })
  return { type: 'doc', content }
}

/** Tamanho do nó em posições do ProseMirror, calculado a partir do JSON. */
export function jsonNodeSize(node: JSONContent): number {
  if (node.type === 'text') return node.text?.length ?? 0
  if (LEAF_TYPES.has(node.type ?? '')) return 1
  let size = 2
  for (const child of node.content ?? []) size += jsonNodeSize(child)
  return size
}

interface WalkContext {
  quote: boolean
  level: number
  list?: FlatParagraph['list']
  annotation: boolean
  includeAnnotations: boolean
}

export interface FlattenOptions {
  /**
   * Inclui os parágrafos das anotações, marcados com `annotation: true`. Padrão: false, porque
   * tudo o que deriva do texto falado (exportações, revisão, contagem) ignora as anotações.
   */
  includeAnnotations?: boolean
}

/** Lista os parágrafos do documento na ordem de leitura, com posições e contexto de bloco. */
export function flattenDocument(content: ManuscriptContent, options: FlattenOptions = {}): FlatParagraph[] {
  const doc = toDocumentJSON(content)
  const result: FlatParagraph[] = []
  const context: WalkContext = {
    quote: false,
    level: -1,
    annotation: false,
    includeAnnotations: options.includeAnnotations === true,
  }
  let pos = 0
  for (const child of doc.content ?? []) {
    visitBlock(child, pos, context, result)
    pos += jsonNodeSize(child)
  }
  return result
}

function visitBlock(node: JSONContent, start: number, context: WalkContext, out: FlatParagraph[]): void {
  const type = node.type ?? ''
  if (TEXTBLOCK_TYPES.has(type)) {
    out.push(flattenTextblock(node, start, context))
    return
  }
  if (type === ANNOTATION_TYPE) {
    // Fora do texto falado: só entra quando pedida, e então marcada.
    if (context.includeAnnotations)
      visitChildren(node, start, { ...context, annotation: true, list: undefined }, out)
    return
  }
  if (type === 'blockquote') {
    visitChildren(node, start, { ...context, quote: true, list: undefined }, out)
    return
  }
  const kind = LIST_TYPES[type]
  if (kind) {
    const level = context.level + 1
    const first = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
    let pos = start + 1
    let index = 0
    for (const item of node.content ?? []) {
      const list: NonNullable<FlatParagraph['list']> = { kind, level }
      if (kind === 'ordered') list.ordinal = first + index
      if (kind === 'check') list.checked = item.attrs?.checked === true
      let itemPos = pos + 1
      let marked = false
      for (const child of item.content ?? []) {
        const isTextblock = TEXTBLOCK_TYPES.has(child.type ?? '')
        const childList = isTextblock && !marked ? list : undefined
        if (isTextblock) marked = true
        visitBlock(child, itemPos, { ...context, level, list: childList }, out)
        itemPos += jsonNodeSize(child)
      }
      pos += jsonNodeSize(item)
      index += 1
    }
    return
  }
  if (LEAF_TYPES.has(type) || INLINE_TYPES.has(type)) return
  visitChildren(node, start, context, out)
}

function visitChildren(node: JSONContent, start: number, context: WalkContext, out: FlatParagraph[]): void {
  let pos = start + 1
  for (const child of node.content ?? []) {
    visitBlock(child, pos, context, out)
    pos += jsonNodeSize(child)
  }
}

function flattenTextblock(node: JSONContent, start: number, context: WalkContext): FlatParagraph {
  const attrs = node.attrs ?? {}
  const pieces: FlatPiece[] = []
  let pos = start + 1
  for (const child of node.content ?? []) {
    const marks = child.marks ?? []
    if (child.type === 'text' && child.text) {
      pieces.push({ kind: 'text', text: child.text, marks, pos })
    } else if (child.type === 'hardBreak') {
      pieces.push({ kind: 'break', text: '\n', marks, pos })
    } else if (child.type === 'footnote') {
      const piece: FlatPiece = {
        kind: 'footnote',
        text: '',
        marks,
        pos,
        note: typeof child.attrs?.note === 'string' ? child.attrs.note : '',
      }
      if (typeof child.attrs?.id === 'string') piece.footnoteId = child.attrs.id
      pieces.push(piece)
    }
    pos += jsonNodeSize(child)
  }
  const paragraph: FlatParagraph = {
    headingLevel: node.type === 'heading' ? clampLevel(attrs.level) : 0,
    attrs,
    quote: context.quote,
    attribution: context.quote && attrs.attribution === true,
    contentPos: start + 1,
    pieces,
  }
  if (typeof attrs.id === 'string' && attrs.id) paragraph.id = attrs.id
  if (context.list) paragraph.list = context.list
  if (context.annotation) paragraph.annotation = true
  return paragraph
}

function clampLevel(value: unknown): number {
  const level = typeof value === 'number' ? Math.round(value) : Number(value)
  return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1
}

// MARK: - Modelo neutro

const ALIGNMENTS = new Set<ParagraphAlignment>(['left', 'center', 'right', 'justify'])

/** Atributos de caractere do modelo a partir das marcas do editor. */
export function runStyleFromMarks(marks: readonly JSONMark[]): Omit<RichRun, 'text'> {
  const style: Omit<RichRun, 'text'> = {}
  for (const mark of marks) {
    const attrs = mark.attrs ?? {}
    switch (mark.type) {
      case 'bold':
        style.bold = true
        break
      case 'italic':
        style.italic = true
        break
      case 'underline':
        style.underline = true
        break
      case 'strike':
        style.strike = true
        break
      case 'superscript':
        style.superscript = true
        break
      case 'subscript':
        style.subscript = true
        break
      case 'code':
        style.code = true
        break
      case 'link':
        if (isSafeLinkHref(attrs.href)) style.link = attrs.href.trim()
        break
      case 'highlight':
        style.highlight = normalizeColor(attrs.color) ?? '#ffff00'
        break
      case 'textStyle': {
        const color = normalizeColor(attrs.color)
        if (color) style.color = color
        const background = normalizeColor(attrs.backgroundColor)
        if (background && !style.highlight) style.highlight = background
        const family = primaryFontFamily(attrs.fontFamily)
        if (family) style.fontFamily = family
        const size = parseLengthPt(attrs.fontSize)
        if (size !== undefined && size > 0) style.fontSizePt = size
        break
      }
    }
  }
  return style
}

const RUN_KEYS: ReadonlyArray<keyof RichRun> = [
  'bold',
  'italic',
  'underline',
  'strike',
  'superscript',
  'subscript',
  'code',
  'link',
  'color',
  'highlight',
  'fontFamily',
  'fontSizePt',
  'footnote',
  'hardBreak',
]

function sameRunStyle(a: RichRun, b: RichRun): boolean {
  return RUN_KEYS.every((key) => a[key] === b[key])
}

function pushRun(runs: RichRun[], run: RichRun): void {
  const last = runs[runs.length - 1]
  if (
    last &&
    !last.hardBreak &&
    !run.hardBreak &&
    last.footnote === undefined &&
    run.footnote === undefined &&
    sameRunStyle(last, run)
  ) {
    last.text += run.text
  } else {
    runs.push(run)
  }
}

function paragraphFromFlat(
  flat: FlatParagraph,
  nextFootnote: () => number,
  footnotes: RichFootnote[],
): RichParagraph {
  const runs: RichRun[] = []
  for (const piece of flat.pieces) {
    const style = runStyleFromMarks(piece.marks)
    if (piece.kind === 'text') {
      pushRun(runs, { text: piece.text, ...style })
    } else if (piece.kind === 'break') {
      pushRun(runs, { text: '\n', ...style, hardBreak: true })
    } else {
      const number = nextFootnote()
      footnotes.push({ number, runs: piece.note ? [{ text: piece.note }] : [] })
      pushRun(runs, { text: String(number), ...style, superscript: true, footnote: number })
    }
  }
  const paragraph: RichParagraph = { headingLevel: flat.headingLevel, runs }
  if (flat.id) paragraph.id = flat.id
  const attrs = flat.attrs
  if (typeof attrs.textAlign === 'string' && ALIGNMENTS.has(attrs.textAlign as ParagraphAlignment)) {
    paragraph.alignment = attrs.textAlign as ParagraphAlignment
  }
  const numeric = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const indentStart = numeric(attrs.indentStart)
  const indentFirstLine = numeric(attrs.indentFirstLine)
  const spaceBefore = numeric(attrs.spaceBefore)
  const spaceAfter = numeric(attrs.spaceAfter)
  const lineHeight = numeric(attrs.lineHeight)
  if (indentStart !== undefined) paragraph.indentStartPt = indentStart
  if (indentFirstLine !== undefined) paragraph.indentFirstLinePt = indentFirstLine
  if (spaceBefore !== undefined) paragraph.spaceBeforePt = spaceBefore
  if (spaceAfter !== undefined) paragraph.spaceAfterPt = spaceAfter
  if (lineHeight !== undefined && lineHeight > 0) paragraph.lineHeight = lineHeight
  if (flat.list) paragraph.list = { ...flat.list }
  if (flat.quote) paragraph.quote = true
  if (flat.attribution) paragraph.attribution = true
  return paragraph
}

export interface RichDocumentOptions extends FlattenOptions {
  title?: string
}

/**
 * Converte o documento do editor no modelo neutro. Notas de rodapé são numeradas na ordem do
 * texto; listas numeradas recebem o ordinal de cada item. As anotações não entram (nem as notas
 * dentro delas), a menos que `includeAnnotations` seja pedido.
 */
export function toRichDocument(content: ManuscriptContent, options: RichDocumentOptions = {}): RichDocument {
  const footnotes: RichFootnote[] = []
  let counter = 0
  const next = () => (counter += 1)
  const paragraphs = flattenDocument(content, options).map((flat) => paragraphFromFlat(flat, next, footnotes))
  const document: RichDocument = { paragraphs, footnotes }
  if (options.title !== undefined) document.title = options.title
  return document
}

/**
 * Texto falado do manuscrito, um parágrafo por linha, igual a `documentPlainText` do modelo
 * neutro: é o que a revisão recebe e contra o que as citações são conferidas. As anotações ficam
 * de fora, salvo `includeAnnotations`; `includeFootnotes` acrescenta a área de notas no fim.
 */
export function manuscriptPlainText(
  content: ManuscriptContent,
  options: { includeFootnotes?: boolean; includeAnnotations?: boolean } = {},
): string {
  return documentPlainText(
    toRichDocument(content, { includeAnnotations: options.includeAnnotations }),
    options,
  )
}

/**
 * Palavras do texto falado, para a estimativa de tempo de pregação: títulos, parágrafos, citações
 * e itens de lista, sem as anotações, sem os marcadores de lista e sem os números das chamadas de
 * nota (nem o texto das notas). Conta como `countWords` do núcleo, que é o contador do editor.
 */
export function manuscriptWordCount(content: ManuscriptContent): number {
  let total = 0
  for (const paragraph of flattenDocument(content)) {
    total += countWords(paragraph.pieces.map((piece) => piece.text).join(''))
  }
  return total
}

export interface BlockAnchor {
  /** Identificador estável do parágrafo (atributo `id`). */
  id: string
  /** Texto do parágrafo, sem o marcador de lista. */
  text: string
  /** Início e fim do texto em `manuscriptPlainText` (sem notas). */
  start: number
  end: number
}

function listPrefix(paragraph: RichParagraph): string {
  const list = paragraph.list
  if (!list) return ''
  if (list.kind === 'bullet') return '• '
  if (list.kind === 'check') return `${list.checked ? '☑' : '☐'} `
  return `${list.ordinal ?? 1}. `
}

/**
 * Âncoras de bloco para a revisão: id do parágrafo → texto e intervalo no texto corrido. Como o
 * texto corrido, não inclui as anotações.
 */
export function blockAnchors(content: ManuscriptContent): BlockAnchor[] {
  const anchors: BlockAnchor[] = []
  let offset = 0
  for (const paragraph of toRichDocument(content).paragraphs) {
    const prefix = listPrefix(paragraph)
    const text = paragraphText(paragraph)
    const start = offset + prefix.length
    if (paragraph.id) anchors.push({ id: paragraph.id, text, start, end: start + text.length })
    offset = start + text.length + 1
  }
  return anchors
}

export interface FootnoteEntry {
  id?: string
  number: number
  note: string
  /** Posição ProseMirror da chamada. */
  pos: number
}

/**
 * Notas na ordem do texto, para a lista exibida no fim do documento. Inclui as notas dentro de
 * anotações, porque o editor também as numera; nas exportações elas somem junto com a anotação.
 */
export function footnotesOf(content: ManuscriptContent): FootnoteEntry[] {
  const entries: FootnoteEntry[] = []
  for (const paragraph of flattenDocument(content, { includeAnnotations: true })) {
    for (const piece of paragraph.pieces) {
      if (piece.kind !== 'footnote') continue
      const entry: FootnoteEntry = { number: entries.length + 1, note: piece.note ?? '', pos: piece.pos }
      if (piece.footnoteId) entry.id = piece.footnoteId
      entries.push(entry)
    }
  }
  return entries
}

/**
 * Texto corrido com o mapa de posições: para cada caractere, a posição ProseMirror onde começa e
 * onde termina; caracteres sintéticos (marcadores de lista, quebras entre parágrafos) têm -1.
 * Sem as anotações, como o texto da revisão de onde vêm as citações procuradas.
 */
export function plainTextWithPositions(content: ManuscriptContent): {
  text: string
  starts: number[]
  ends: number[]
} {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  const push = (value: string, start: number, end: number) => {
    for (let index = 0; index < value.length; index += 1) {
      starts.push(start < 0 ? -1 : start)
      ends.push(end < 0 ? -1 : end)
    }
    text += value
  }
  let footnote = 0
  flattenDocument(content).forEach((flat, index) => {
    if (index > 0) push('\n', -1, -1)
    const list = flat.list
    if (list) {
      const prefix =
        list.kind === 'bullet'
          ? '• '
          : list.kind === 'check'
            ? `${list.checked ? '☑' : '☐'} `
            : `${list.ordinal ?? 1}. `
      push(prefix, -1, -1)
    }
    for (const piece of flat.pieces) {
      if (piece.kind === 'text') {
        for (let offset = 0; offset < piece.text.length; offset += 1) {
          starts.push(piece.pos + offset)
          ends.push(piece.pos + offset + 1)
        }
        text += piece.text
      } else if (piece.kind === 'break') {
        push('\n', piece.pos, piece.pos + 1)
      } else {
        footnote += 1
        push(String(footnote), piece.pos, piece.pos + 1)
      }
    }
  })
  return { text, starts, ends }
}
