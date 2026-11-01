/**
 * Identificadores estáveis de bloco. Todo bloco de nível superior e todo parágrafo ou título
 * (inclusive dentro de citações e listas) recebe um `id`, usado para ancorar as observações da
 * revisão. Notas de rodapé também têm `id`. Ao colar uma cópia, o original conserva o id e a
 * cópia recebe outro; recortar e colar (mover) conserva o id.
 */
import { combineTransactionSteps, Extension, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { defaultIdGenerator, type IdGenerator } from './util'

export const BLOCK_ID_TYPES = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList']

export interface BlockIdOptions {
  types: string[]
  generateId: IdGenerator
}

export const blockIdPluginKey = new PluginKey('manuscriptBlockId')

interface Occurrence {
  pos: number
  node: ProseMirrorNode
  touched: boolean
  kind: 'block' | 'footnote'
}

/**
 * Corrige ids ausentes ou repetidos e atribuições fora de citação. Devolve null quando o
 * documento já está consistente.
 */
export function normalizeDocument(
  state: EditorState,
  options: { types: readonly string[]; generateId: IdGenerator; changed?: ReadonlyArray<{ from: number; to: number }> },
): Transaction | null {
  const { doc } = state
  const types = new Set(options.types)
  const occurrences = new Map<string, Occurrence[]>()
  const missing: Occurrence[] = []
  const attributionFixes: number[] = []
  const isTouched = (from: number, to: number) =>
    options.changed ? options.changed.some((range) => range.from <= to && range.to >= from) : false

  doc.descendants((node, pos, parent) => {
    if (node.isText) return false
    const isFootnote = node.type.name === 'footnote'
    const needsId = isFootnote || (types.has(node.type.name) && (node.isTextblock || parent === doc))
    if (needsId) {
      const occurrence: Occurrence = { pos, node, touched: isTouched(pos, pos + node.nodeSize), kind: isFootnote ? 'footnote' : 'block' }
      const id = node.attrs.id as unknown
      if (typeof id === 'string' && id) {
        const list = occurrences.get(id)
        if (list) list.push(occurrence)
        else occurrences.set(id, [occurrence])
      } else {
        missing.push(occurrence)
      }
    }
    if (node.attrs.attribution === true && parent?.type.name !== 'blockquote') attributionFixes.push(pos)
    return !node.isLeaf
  })

  const regenerate: Occurrence[] = [...missing]
  for (const list of occurrences.values()) {
    if (list.length < 2) continue
    // Fica com o id o bloco que não mudou; entre os alterados, o de mais texto (divisão de parágrafo).
    const keeper =
      list.find((occurrence) => !occurrence.touched) ??
      list.reduce((best, occurrence) => (occurrence.node.textContent.length > best.node.textContent.length ? occurrence : best))
    for (const occurrence of list) if (occurrence !== keeper) regenerate.push(occurrence)
  }
  if (!regenerate.length && !attributionFixes.length) return null

  const used = new Set(occurrences.keys())
  const fresh = (kind: 'block' | 'footnote') => {
    let id = options.generateId(kind)
    while (used.has(id)) id = options.generateId(kind)
    used.add(id)
    return id
  }
  const tr = state.tr
  for (const occurrence of regenerate) {
    tr.setNodeAttribute(occurrence.pos, 'id', fresh(occurrence.kind))
  }
  for (const pos of attributionFixes) tr.setNodeAttribute(pos, 'attribution', false)
  return tr
}

/** Atribui ids ao documento carregado (o editor também o faz na primeira transação). */
export function ensureBlockIds(view: { state: EditorState; dispatch: (tr: Transaction) => void }, options: Pick<BlockIdOptions, 'types' | 'generateId'>): void {
  if (blockIdPluginKey.getState(view.state) === true) return
  const tr = normalizeDocument(view.state, options) ?? view.state.tr
  view.dispatch(tr.setMeta(blockIdPluginKey, true).setMeta('addToHistory', false))
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',

  addOptions() {
    return { types: BLOCK_ID_TYPES, generateId: defaultIdGenerator }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => (typeof attributes.id === 'string' && attributes.id ? { 'data-block-id': attributes.id } : {}),
          },
        },
      },
    ]
  },

  onCreate() {
    ensureBlockIds(this.editor.view, this.options)
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [
      new Plugin<boolean>({
        key: blockIdPluginKey,
        // Estado: o documento já passou pela primeira normalização.
        state: {
          init: () => false,
          apply: (tr, normalized) => normalized || tr.getMeta(blockIdPluginKey) === true,
        },
        appendTransaction: (transactions, oldState, newState) => {
          if (transactions.every((transaction) => transaction.getMeta(blockIdPluginKey) === true)) return null
          const initialized = blockIdPluginKey.getState(oldState) === true
          if (initialized && !transactions.some((transaction) => transaction.docChanged)) return null
          // A primeira transação (mesmo só de seleção) normaliza o documento inicial inteiro.
          const changed = initialized
            ? getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions])).map(({ newRange }) => newRange)
            : undefined
          const tr = normalizeDocument(newState, changed ? { ...options, changed } : options) ?? (initialized ? null : newState.tr)
          return tr ? tr.setMeta(blockIdPluginKey, true).setMeta('addToHistory', initialized) : null
        },
      }),
    ]
  },
})
