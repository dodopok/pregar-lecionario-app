/**
 * Nota de rodapé: um átomo em linha que guarda o texto da nota. O editor mostra a chamada como
 * sobrescrito numerado na ordem do texto; o aplicativo lista as notas no fim do documento.
 */
import { mergeAttributes, Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { defaultIdGenerator, type IdGenerator } from './util'

export interface FootnoteOptions {
  generateId: IdGenerator
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /**
       * Insere a chamada no fim da seleção, sem apagar texto. Com o cursor logo após um espaço, a
       * chamada fica colada à palavra anterior e o cursor continua depois do espaço; caso
       * contrário, o cursor fica logo após a chamada.
       */
      insertFootnote: (options?: { note?: string; id?: string }) => ReturnType
      /** Atualiza o texto da nota com este id. */
      updateFootnote: (id: string, note: string) => ReturnType
      /** Remove a chamada (e a nota) com este id. */
      removeFootnote: (id: string) => ReturnType
    }
  }
}

export const footnoteNumberingKey = new PluginKey<DecorationSet>('manuscriptFootnoteNumbers')

function numberingDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  let number = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') {
      number += 1
      const note = typeof node.attrs.note === 'string' ? node.attrs.note : ''
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-footnote-number': String(number), title: note }))
      return false
    }
    return !node.isTextblock || node.childCount > 0
  })
  return DecorationSet.create(doc, decorations)
}

function findFootnote(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'footnote' && node.attrs.id === id) {
      found = { node, pos }
      return false
    }
    return true
  })
  return found
}

export const Footnote = Node.create<FootnoteOptions>({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { generateId: defaultIdGenerator, HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-footnote-id'),
        renderHTML: (attributes) => (attributes.id ? { 'data-footnote-id': attributes.id } : {}),
      },
      note: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-note') ?? '',
        renderHTML: (attributes) => ({ 'data-note': typeof attributes.note === 'string' ? attributes.note : '' }),
      },
    }
  },

  parseHTML() {
    // Prioridade acima da marca de sobrescrito, que também lê <sup>.
    return [{ tag: 'sup[data-footnote]', priority: 100 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes({ 'data-footnote': '', class: 'manuscript-footnote' }, this.options.HTMLAttributes, HTMLAttributes)]
  },

  renderText() {
    return ''
  },

  addCommands() {
    return {
      insertFootnote:
        (options = {}) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes[this.name]
          if (!type) return false
          const { selection } = state
          let pos = selection.to
          const $pos = state.doc.resolve(pos)
          if (!$pos.parent.inlineContent || !$pos.parent.type.contentMatch.matchType(type)) return false
          const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 2), $pos.parentOffset, undefined, '￼')
          const afterSpace = selection.empty && before.length === 2 && before[1] === ' ' && !/\s/.test(before[0] ?? ' ')
          if (afterSpace) pos -= 1
          if (dispatch) {
            const node = type.create({ id: options.id ?? this.options.generateId('footnote'), note: options.note ?? '' })
            tr.insert(pos, node)
            tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize + (afterSpace ? 1 : 0)))
            tr.scrollIntoView()
          }
          return true
        },
      updateFootnote:
        (id, note) =>
        ({ tr, dispatch }) => {
          const found = findFootnote(tr.doc, id)
          if (!found) return false
          if (dispatch) tr.setNodeAttribute(found.pos, 'note', note)
          return true
        },
      removeFootnote:
        (id) =>
        ({ tr, dispatch }) => {
          const found = findFootnote(tr.doc, id)
          if (!found) return false
          if (dispatch) tr.delete(found.pos, found.pos + found.node.nodeSize)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: footnoteNumberingKey,
        state: {
          init: (_, state) => numberingDecorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? numberingDecorations(tr.doc) : previous),
        },
        props: {
          decorations: (state) => footnoteNumberingKey.getState(state),
        },
      }),
    ]
  },
})
