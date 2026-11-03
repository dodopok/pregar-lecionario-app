/**
 * Citação em bloco do manuscrito: a do StarterKit mais o atributo `kind`, que distingue a prosa
 * citada ("quote") do poema ou hino ("poem": versos sem itálico, com recuo pendente nas linhas que
 * quebram). Documentos antigos, sem o atributo, continuam válidos como "quote".
 */
import { Blockquote } from '@tiptap/extension-blockquote'
import type { NodeType } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

export type BlockquoteKind = 'quote' | 'poem'

export const BLOCKQUOTE_KINDS: ReadonlyArray<BlockquoteKind> = ['quote', 'poem']

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    manuscriptBlockquote: {
      /**
       * Define o tipo (prosa ou poema) das citações tocadas pela seleção; fora de citação, envolve
       * os blocos da seleção numa citação já desse tipo.
       */
      setBlockquoteKind: (kind: BlockquoteKind) => ReturnType
    }
  }
}

/** Posições das citações tocadas pela seleção, na ordem do documento. */
function blockquotesInSelection(state: EditorState, type: NodeType): number[] {
  const positions: number[] = []
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.type === type && !positions.includes(pos)) positions.push(pos)
      return true
    })
  }
  return positions
}

export const ManuscriptBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: 'quote',
        parseHTML: (element) => (element.getAttribute('data-kind') === 'poem' ? 'poem' : 'quote'),
        renderHTML: (attributes) => ({ 'data-kind': attributes.kind === 'poem' ? 'poem' : 'quote' }),
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setBlockquoteKind:
        (kind) =>
        ({ state, tr, dispatch, commands }) => {
          if (!BLOCKQUOTE_KINDS.includes(kind)) return false
          const positions = blockquotesInSelection(state, this.type)
          if (!positions.length) return commands.wrapIn(this.name, { kind })
          if (dispatch) for (const pos of positions) tr.setNodeAttribute(pos, 'kind', kind)
          return true
        },
    }
  },
})
