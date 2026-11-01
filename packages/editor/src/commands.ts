/**
 * Comandos do manuscrito, portados de EditorCommands (Swift): estilos de parágrafo, citação,
 * epígrafe, recuo, espaçamentos, fonte fracionária, cores, links, copiar/colar formatação e
 * limpar formatação. Os atalhos (Google Docs para Mac) ficam em ManuscriptKeymap.
 */
import { Extension, getMarkAttributes, getMarkRange, isNodeActive } from '@tiptap/core'
import type { Mark, Node as ProseMirrorNode, NodeType, Schema } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { canJoin, findWrapping, liftTarget } from '@tiptap/pm/transform'
import { findTextRange } from './findText'
import {
  BODY_FONT_SIZE_PT,
  DEFAULT_EPIGRAPH_ATTRIBUTION,
  headingFontSizePt,
  INDENT_STEP_PT,
  MAX_FONT_SIZE_PT,
  MAX_LINE_SPACING,
  MAX_PARAGRAPH_SPACING_PT,
  MIN_FONT_SIZE_PT,
  MIN_LINE_SPACING,
  type ParagraphStyleName,
} from './styles'
import { clamp, cssNumber, isSafeLinkHref, parseLengthPt, roundTo } from './util'

export interface CopiedFormatting {
  marks: readonly Mark[]
  block: { type: string; attrs: Record<string, unknown> } | null
}

export interface ManuscriptStorage {
  copiedFormatting: CopiedFormatting | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    manuscript: {
      /** Aplica "Texto normal" ou "Título 1–6" aos parágrafos da seleção (⌥⌘0–6). */
      setParagraphStyle: (style: ParagraphStyleName) => ReturnType
      /** Alterna a citação em bloco em todos os parágrafos da seleção. */
      toggleQuote: () => ReturnType
      /** Alterna a linha de atribuição ("— Autor") no parágrafo atual de uma citação. */
      toggleAttribution: () => ReturnType
      /** Insere um texto (a coleta do dia) como epígrafe no início: citação com atribuição. */
      insertEpigraph: (text: string, attribution?: string) => ReturnType
      clearFormatting: () => ReturnType
      copyFormatting: () => ReturnType
      pasteFormatting: () => ReturnType
      /** ⌘]: aumenta o recuo em 36 pt, ou aprofunda o item de lista. */
      indent: () => ReturnType
      /** ⌘[: diminui o recuo, ou sobe o item de lista. */
      outdent: () => ReturnType
      /** Entrelinha como multiplicador, de 0,5 a 5. */
      setLineSpacing: (multiple: number) => ReturnType
      /** Espaço antes/depois do parágrafo em pontos (0 a 400). */
      setParagraphSpacing: (spacing: { before?: number; after?: number }) => ReturnType
      /** Tamanho da fonte em pontos, fracionário permitido (1 a 400). */
      setFontSizePt: (size: number) => ReturnType
      increaseFontSize: () => ReturnType
      decreaseFontSize: () => ReturnType
      /** Cor do texto em CSS; null volta ao automático. */
      setTextColor: (color: string | null) => ReturnType
      /** Cor de realce; null remove. */
      setHighlightColor: (color: string | null) => ReturnType
      /**
       * Insere, edita ou remove link como a folha do Swift: com o cursor dentro de um link, age
       * sobre o link inteiro; texto diferente do atual substitui o trecho; href null remove.
       */
      applyLink: (link: { href: string | null; text?: string }) => ReturnType
      /** Seleciona um trecho literal citado pela revisão (tolerante a espaços e aspas). */
      selectQuote: (quote: string) => ReturnType
    }
  }

  interface Storage {
    manuscript: ManuscriptStorage
  }
}

const FORMATTED_TEXTBLOCKS = new Set(['paragraph', 'heading'])
const LIST_ITEM_TYPES = ['listItem', 'taskItem']

export interface PositionedNode {
  node: ProseMirrorNode
  pos: number
}

/** Parágrafos e títulos tocados pela seleção (o parágrafo do cursor quando vazia). */
export function selectedTextblocks(state: EditorState): PositionedNode[] {
  const found = new Map<number, ProseMirrorNode>()
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.isTextblock) {
        found.set(pos, node)
        return false
      }
      return true
    })
  }
  const { $from } = state.selection
  if (!found.size && $from.parent.isTextblock && $from.depth > 0) found.set($from.before(), $from.parent)
  return [...found.entries()].sort(([a], [b]) => a - b).map(([pos, node]) => ({ node, pos }))
}

function isInside(doc: ProseMirrorNode, pos: number, typeName: string): boolean {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) if ($pos.node(depth).type.name === typeName) return true
  return false
}

function canBecome(doc: ProseMirrorNode, pos: number, type: NodeType): boolean {
  const $pos = doc.resolve(pos)
  return $pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)
}

/** Remove tamanho, cores e realce do texto (aplicar um estilo de parágrafo, como no Swift). */
function stripStyleMarks(tr: Transaction, from: number, to: number): void {
  const { schema } = tr.doc.type
  const highlight = schema.marks.highlight
  if (highlight) tr.removeMark(from, to, highlight)
  const textStyle = schema.marks.textStyle
  if (!textStyle) return
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true
    const mark = node.marks.find((candidate) => candidate.type === textStyle)
    if (!mark) return false
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    const attrs = { ...mark.attrs, fontSize: null, color: null, backgroundColor: null }
    tr.removeMark(start, end, textStyle)
    if (Object.values(attrs).some((value) => value !== null && value !== undefined && value !== '')) {
      tr.addMark(start, end, textStyle.create(attrs))
    }
    return false
  })
}

/** Tira da citação os blocos da seleção; trechos parciais dividem a citação. */
function liftQuotes(tr: Transaction, from: number, to: number): void {
  const blockquote = tr.doc.type.schema.nodes.blockquote
  if (!blockquote) return
  const quotes: number[] = []
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === blockquote) {
      quotes.push(pos)
      return false
    }
    return true
  })
  for (const pos of quotes.reverse()) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    const innerFrom = Math.max(from, pos + 1)
    const innerTo = Math.min(to, pos + node.nodeSize - 1)
    const range = tr.doc.resolve(innerFrom).blockRange(tr.doc.resolve(innerTo), (parent) => parent.type === blockquote)
    if (!range) continue
    const target = liftTarget(range)
    if (target !== null) tr.lift(range, target)
  }
}

/** Envolve os blocos de nível superior da seleção numa citação, unindo-a às vizinhas. */
function wrapInQuote(tr: Transaction, from: number, to: number): boolean {
  const { schema } = tr.doc.type
  const blockquote = schema.nodes.blockquote
  if (!blockquote) return false
  const range = tr.doc.resolve(from).blockRange(tr.doc.resolve(to), (parent) => parent.type === schema.topNodeType)
  if (!range) return false
  const wrapping = findWrapping(range, blockquote)
  if (!wrapping) return false
  tr.wrap(range, wrapping)
  const start = range.start
  const quote = tr.doc.nodeAt(start)
  if (!quote) return true
  const end = start + quote.nodeSize
  if (tr.doc.resolve(end).nodeAfter?.type === blockquote && canJoin(tr.doc, end)) tr.join(end)
  if (tr.doc.resolve(start).nodeBefore?.type === blockquote && canJoin(tr.doc, start)) tr.join(start)
  return true
}

function paragraphAttrsFor(node: ProseMirrorNode, type: NodeType, overrides: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  for (const name of Object.keys(type.spec.attrs ?? {})) {
    if (name in overrides) attrs[name] = overrides[name]
    else if (name === 'id' || name === 'textAlign') attrs[name] = node.attrs[name] ?? null
  }
  return attrs
}

function setTextblockStyle(tr: Transaction, blocks: PositionedNode[], level: number, keepFormat: boolean): void {
  const { schema } = tr.doc.type
  const heading = schema.nodes.heading
  const paragraph = schema.nodes.paragraph
  if (!heading || !paragraph) return
  const type = level > 0 ? heading : paragraph
  const mapFrom = tr.steps.length
  for (const { node, pos } of blocks) {
    if (!FORMATTED_TEXTBLOCKS.has(node.type.name)) continue
    const mapped = tr.mapping.slice(mapFrom).map(pos)
    if (node.type !== type && !canBecome(tr.doc, mapped, type)) continue
    const overrides: Record<string, unknown> = level > 0 ? { level } : {}
    if (keepFormat) {
      for (const name of ['indentStart', 'indentFirstLine', 'spaceBefore', 'spaceAfter', 'lineHeight']) overrides[name] = node.attrs[name] ?? null
    }
    tr.setNodeMarkup(mapped, type, paragraphAttrsFor(node, type, overrides))
    stripStyleMarks(tr, mapped + 1, mapped + node.nodeSize - 1)
  }
}

function adjustIndent(tr: Transaction, blocks: PositionedNode[], delta: number): boolean {
  let changed = false
  for (const { node, pos } of blocks) {
    if (!FORMATTED_TEXTBLOCKS.has(node.type.name)) continue
    if (LIST_ITEM_TYPES.some((name) => isInside(tr.doc, pos, name))) continue
    const start = typeof node.attrs.indentStart === 'number' ? node.attrs.indentStart : 0
    const first = typeof node.attrs.indentFirstLine === 'number' ? node.attrs.indentFirstLine : start
    const nextStart = Math.max(0, start + delta)
    const nextFirst = Math.max(0, first + delta)
    tr.setNodeAttribute(pos, 'indentStart', nextStart > 0 ? nextStart : null)
    tr.setNodeAttribute(pos, 'indentFirstLine', nextFirst !== nextStart ? nextFirst : null)
    changed = true
  }
  return changed
}

function setBlockAttribute(tr: Transaction, blocks: PositionedNode[], name: string, value: unknown): boolean {
  let changed = false
  for (const { node, pos } of blocks) {
    if (!FORMATTED_TEXTBLOCKS.has(node.type.name)) continue
    tr.setNodeAttribute(pos, name, value)
    changed = true
  }
  return changed
}

/** Tamanho efetivo no início da seleção: marca textStyle ou padrão do parágrafo. */
export function currentFontSizePt(state: EditorState): number {
  const size = parseLengthPt(getMarkAttributes(state, 'textStyle').fontSize)
  if (size !== undefined && size > 0) return size
  const parent = state.selection.$from.parent
  return parent.type.name === 'heading' ? headingFontSizePt(Number(parent.attrs.level)) : BODY_FONT_SIZE_PT
}

function epigraphContent(schema: Schema, text: string, attribution: string): ProseMirrorNode | null {
  const blockquote = schema.nodes.blockquote
  const paragraph = schema.nodes.paragraph
  const hardBreak = schema.nodes.hardBreak
  if (!blockquote || !paragraph) return null
  const quoted = /^[“"«]/.test(text) ? text : `“${text}”`
  const inline: ProseMirrorNode[] = []
  quoted.split(/\r?\n/).forEach((line, index) => {
    if (index > 0 && hardBreak) inline.push(hardBreak.create())
    if (line) inline.push(schema.text(line))
  })
  const children = [paragraph.create(null, inline)]
  const author = attribution.trim()
  if (author) children.push(paragraph.create({ attribution: true }, schema.text(`— ${author}`)))
  return blockquote.create(null, children)
}

export const ManuscriptCommands = Extension.create<Record<string, never>, ManuscriptStorage>({
  name: 'manuscript',
  // Prioridade baixa: estes comandos substituem os homônimos das extensões padrão (toggleHeading).
  priority: 50,

  addStorage() {
    return { copiedFormatting: null }
  },

  addCommands() {
    return {
      setParagraphStyle:
        (style) =>
        ({ state, tr, dispatch }) => {
          const level = style === 'normal' ? 0 : Number(style.replace('heading', ''))
          if (!Number.isInteger(level) || level < 0 || level > 6) return false
          const blocks = selectedTextblocks(state).filter(({ node }) => FORMATTED_TEXTBLOCKS.has(node.type.name))
          if (!blocks.length) return false
          if (dispatch) setTextblockStyle(tr, blocks, level, false)
          return true
        },

      toggleHeading:
        (attributes) =>
        ({ state, commands }) => {
          const level = attributes.level
          const blocks = selectedTextblocks(state).filter(({ node }) => FORMATTED_TEXTBLOCKS.has(node.type.name))
          if (!blocks.length) return false
          const active = blocks.every(({ node }) => node.type.name === 'heading' && node.attrs.level === level)
          return commands.setParagraphStyle(active ? 'normal' : (`heading${level}` as ParagraphStyleName))
        },

      toggleQuote:
        () =>
        ({ state, tr, dispatch }) => {
          if (!state.schema.nodes.blockquote) return false
          const blocks = selectedTextblocks(state)
          if (!blocks.length) return false
          const allQuoted = blocks.every(({ pos }) => isInside(state.doc, pos, 'blockquote'))
          if (!dispatch) return true
          const { from, to } = state.selection
          const mapFrom = tr.steps.length
          liftQuotes(tr, from, to)
          const mapping = tr.mapping.slice(mapFrom)
          if (!allQuoted) wrapInQuote(tr, mapping.map(from), mapping.map(to))
          tr.scrollIntoView()
          return true
        },

      toggleAttribution:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          if ($from.parent.type.name !== 'paragraph' || $from.depth < 2 || $from.node(-1).type.name !== 'blockquote') return false
          if (dispatch) tr.setNodeAttribute($from.before(), 'attribution', $from.parent.attrs.attribution !== true)
          return true
        },

      insertEpigraph:
        (text, attribution = DEFAULT_EPIGRAPH_ATTRIBUTION) =>
        ({ state, tr, dispatch }) => {
          const body = text.trim()
          if (!body) return false
          const quote = epigraphContent(state.schema, body, attribution)
          const paragraph = state.schema.nodes.paragraph
          if (!quote || !paragraph) return false
          if (dispatch) {
            tr.insert(0, quote)
            const after = quote.nodeSize
            if (after >= tr.doc.content.size) tr.insert(after, paragraph.create())
            tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
          }
          return true
        },

      clearFormatting:
        () =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) return true
          if (state.selection.empty) {
            tr.setStoredMarks([])
            return true
          }
          const { from, to } = state.selection
          const blocks = selectedTextblocks(state)
          const mapFrom = tr.steps.length
          for (const range of state.selection.ranges) tr.removeMark(range.$from.pos, range.$to.pos, null)
          setTextblockStyle(tr, blocks, 0, false)
          for (const { pos } of blocks) {
            const mapped = tr.mapping.slice(mapFrom).map(pos)
            const node = tr.doc.nodeAt(mapped)
            if (node?.type.name !== 'paragraph') continue
            for (const name of ['textAlign', 'indentStart', 'indentFirstLine', 'spaceBefore', 'spaceAfter', 'lineHeight']) {
              if (node.attrs[name] !== null && node.attrs[name] !== undefined) tr.setNodeAttribute(mapped, name, null)
            }
          }
          const mapping = tr.mapping.slice(mapFrom)
          liftQuotes(tr, mapping.map(from), mapping.map(to))
          return true
        },

      copyFormatting:
        () =>
        ({ state }) => {
          const { selection } = state
          let marks: readonly Mark[]
          if (selection.empty) {
            marks = state.storedMarks ?? selection.$from.marks()
          } else {
            const found: { marks: readonly Mark[] | null } = { marks: null }
            state.doc.nodesBetween(selection.from, selection.to, (node) => {
              if (found.marks) return false
              if (node.isText) found.marks = node.marks
              return true
            })
            marks = found.marks ?? selection.$from.marks()
          }
          const parent = selection.$from.parent
          this.storage.copiedFormatting = {
            marks: marks.filter((mark) => mark.type.name !== 'link'),
            block: FORMATTED_TEXTBLOCKS.has(parent.type.name)
              ? {
                  type: parent.type.name,
                  attrs: Object.fromEntries(Object.entries(parent.attrs).filter(([name]) => name !== 'id' && name !== 'attribution')),
                }
              : null,
          }
          return true
        },

      pasteFormatting:
        () =>
        ({ state, tr, dispatch }) => {
          const copied = this.storage.copiedFormatting
          if (!copied) return false
          if (!dispatch) return true
          const { selection, schema } = state
          if (selection.empty) {
            tr.setStoredMarks(copied.marks)
            return true
          }
          for (const range of selection.ranges) {
            const from = range.$from.pos
            const to = range.$to.pos
            for (const type of Object.values(schema.marks)) if (type.name !== 'link') tr.removeMark(from, to, type)
            for (const mark of copied.marks) tr.addMark(from, to, mark)
          }
          const block = copied.block
          const type = block ? schema.nodes[block.type] : undefined
          if (block && type) {
            for (const { node, pos } of selectedTextblocks(state)) {
              if (!FORMATTED_TEXTBLOCKS.has(node.type.name)) continue
              if (node.type !== type && !canBecome(tr.doc, pos, type)) continue
              tr.setNodeMarkup(pos, type, { ...block.attrs, id: node.attrs.id ?? null })
            }
          }
          return true
        },

      indent:
        () =>
        ({ state, tr, dispatch, commands }) => {
          for (const name of LIST_ITEM_TYPES) if (isNodeActive(state, name)) return commands.sinkListItem(name)
          const blocks = selectedTextblocks(state)
          return dispatch ? adjustIndent(tr, blocks, INDENT_STEP_PT) : blocks.length > 0
        },

      outdent:
        () =>
        ({ state, tr, dispatch, commands }) => {
          for (const name of LIST_ITEM_TYPES) if (isNodeActive(state, name)) return commands.liftListItem(name)
          const blocks = selectedTextblocks(state)
          return dispatch ? adjustIndent(tr, blocks, -INDENT_STEP_PT) : blocks.length > 0
        },

      setLineSpacing:
        (multiple) =>
        ({ state, tr, dispatch }) => {
          if (!Number.isFinite(multiple) || multiple < MIN_LINE_SPACING || multiple > MAX_LINE_SPACING) return false
          const blocks = selectedTextblocks(state)
          return dispatch ? setBlockAttribute(tr, blocks, 'lineHeight', roundTo(multiple, 3)) : blocks.length > 0
        },

      setParagraphSpacing:
        ({ before, after }) =>
        ({ state, tr, dispatch }) => {
          if ([before, after].some((value) => value !== undefined && !Number.isFinite(value))) return false
          if (before === undefined && after === undefined) return false
          const blocks = selectedTextblocks(state)
          if (!dispatch) return blocks.length > 0
          let changed = false
          if (before !== undefined) changed = setBlockAttribute(tr, blocks, 'spaceBefore', clamp(before, 0, MAX_PARAGRAPH_SPACING_PT)) || changed
          if (after !== undefined) changed = setBlockAttribute(tr, blocks, 'spaceAfter', clamp(after, 0, MAX_PARAGRAPH_SPACING_PT)) || changed
          return changed
        },

      setFontSizePt:
        (size) =>
        ({ commands }) => {
          if (!Number.isFinite(size)) return false
          const value = roundTo(clamp(size, MIN_FONT_SIZE_PT, MAX_FONT_SIZE_PT), 2)
          return commands.setMark('textStyle', { fontSize: `${cssNumber(value)}pt` })
        },

      increaseFontSize:
        () =>
        ({ state, commands }) =>
          commands.setFontSizePt(Math.min(MAX_FONT_SIZE_PT, currentFontSizePt(state) + 1)),

      decreaseFontSize:
        () =>
        ({ state, commands }) =>
          commands.setFontSizePt(Math.max(MIN_FONT_SIZE_PT, currentFontSizePt(state) - 1)),

      setTextColor:
        (color) =>
        ({ commands }) =>
          color ? commands.setColor(color) : commands.unsetColor(),

      setHighlightColor:
        (color) =>
        ({ commands }) => {
          commands.unsetHighlight()
          if (commands.unsetBackgroundColor) commands.unsetBackgroundColor()
          return color ? commands.setHighlight({ color }) : true
        },

      applyLink:
        ({ href, text }) =>
        ({ state, tr, dispatch }) => {
          const linkType = state.schema.marks.link
          if (!linkType) return false
          const { selection } = state
          let { from, to } = selection
          if (selection.empty) {
            const range = getMarkRange(selection.$from, linkType)
            if (range) ({ from, to } = range)
          }
          if (href === null) {
            if (dispatch) {
              if (from < to) tr.removeMark(from, to, linkType)
              tr.removeStoredMark(linkType)
            }
            return true
          }
          const safe = href.trim()
          if (!isSafeLinkHref(safe)) return false
          const existing = state.doc.textBetween(from, to, '\n', '')
          const display = text && text.length > 0 ? text : existing || safe
          if (!dispatch) return true
          if (from < to && display === existing) {
            tr.removeMark(from, to, linkType)
            tr.addMark(from, to, linkType.create({ href: safe }))
          } else {
            const marks = state.doc.resolve(from).marks().filter((mark) => mark.type !== linkType)
            tr.replaceWith(from, to, state.schema.text(display, [...marks, linkType.create({ href: safe })]))
            tr.setSelection(TextSelection.create(tr.doc, from + display.length))
          }
          return true
        },

      selectQuote:
        (quote) =>
        ({ state, tr, dispatch }) => {
          const range = findTextRange(state.doc, quote)
          if (!range) return false
          if (dispatch) tr.setSelection(TextSelection.create(tr.doc, range.from, range.to)).scrollIntoView()
          return true
        },
    }
  },
})

/** Texto e endereço do link sob o cursor, para preencher a folha "Inserir ou editar link". */
export function linkEditingState(state: EditorState): { text: string; href: string } {
  const linkType = state.schema.marks.link
  const { selection } = state
  let { from, to } = selection
  if (selection.empty && linkType) {
    const range = getMarkRange(selection.$from, linkType)
    if (range) ({ from, to } = range)
  }
  const href = linkType ? getMarkAttributes(state, linkType).href : undefined
  return { text: state.doc.textBetween(from, to, '\n', ''), href: typeof href === 'string' ? href : '' }
}
