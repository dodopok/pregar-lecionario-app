/**
 * Atalhos do manuscrito (Google Docs para Mac, tabela do README) e conveniências de digitação do
 * Swift: Return no fim de título começa corpo, Return numa linha vazia de citação sai da citação,
 * Backspace logo após o marcador de lista remove o marcador.
 */
import { Extension, isNodeActive } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { liftTarget } from '@tiptap/pm/transform'
import type { ParagraphStyleName } from './styles'
import { defaultIdGenerator, type IdGenerator } from './util'

/** Ações que dependem da interface do aplicativo (folhas, zoom, salvar, imprimir). */
export type ManuscriptShortcutAction =
  | 'link'
  | 'find'
  | 'replace'
  | 'save'
  | 'print'
  | 'commandSearch'
  | 'shortcuts'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'footnoteInserted'

/**
 * Recebe as ações de interface. Devolva false para deixar o evento seguir; qualquer outro valor
 * consome a tecla. Sem handler, as teclas seguem para o navegador.
 */
export type ManuscriptShortcutHandler = (action: ManuscriptShortcutAction, detail?: { footnoteId?: string }) => boolean | void

export interface ManuscriptKeymapOptions {
  onShortcut: ManuscriptShortcutHandler | null
  generateId: IdGenerator
}

const LIST_ITEM_TYPES = ['listItem', 'taskItem']

export const ManuscriptKeymap = Extension.create<ManuscriptKeymapOptions>({
  name: 'manuscriptKeymap',
  // Prioridade alta: os atalhos do Docs vencem os padrões (⌥⌘1 define, não alterna; ⇧⌘H não realça).
  priority: 1000,

  addOptions() {
    return { onShortcut: null, generateId: defaultIdGenerator }
  },

  addKeyboardShortcuts() {
    const editor = this.editor
    const app = (action: ManuscriptShortcutAction) => () => {
      const handler = this.options.onShortcut
      return handler ? handler(action) !== false : false
    }
    const style = (name: ParagraphStyleName) => () => editor.commands.setParagraphStyle(name)
    const increase = () => editor.commands.increaseFontSize()
    const decrease = () => editor.commands.decreaseFontSize()
    const zoomIn = app('zoomIn')

    return {
      'Mod-Shift-x': () => editor.commands.toggleStrike(),
      'Mod-Alt-0': style('normal'),
      'Mod-Alt-1': style('heading1'),
      'Mod-Alt-2': style('heading2'),
      'Mod-Alt-3': style('heading3'),
      'Mod-Alt-4': style('heading4'),
      'Mod-Alt-5': style('heading5'),
      'Mod-Alt-6': style('heading6'),
      'Mod-]': () => editor.commands.indent(),
      'Mod-[': () => editor.commands.outdent(),
      'Mod-Shift-.': increase,
      'Mod->': increase,
      'Mod-Shift-,': decrease,
      'Mod-<': decrease,
      'Mod-Alt-c': () => editor.commands.copyFormatting(),
      'Mod-Alt-v': () => editor.commands.pasteFormatting(),
      'Mod-\\': () => editor.commands.clearFormatting(),
      'Mod-Shift-b': () => editor.commands.toggleQuote(),
      'Mod-Alt-f': () => {
        const footnoteId = this.options.generateId('footnote')
        const inserted = editor.commands.insertFootnote({ id: footnoteId })
        if (inserted) this.options.onShortcut?.('footnoteInserted', { footnoteId })
        return inserted
      },
      'Mod-Shift-h': app('replace'),
      'Mod-k': app('link'),
      'Mod-f': app('find'),
      'Mod-s': app('save'),
      'Mod-p': app('print'),
      'Alt-/': app('commandSearch'),
      'Mod-/': app('shortcuts'),
      'Mod-=': zoomIn,
      'Mod-+': zoomIn,
      'Mod-Shift-=': zoomIn,
      'Mod--': app('zoomOut'),
      'Mod-0': app('zoomReset'),

      Enter: ({ editor: current }) => {
        const { state } = current
        const { selection } = state
        if (!selection.empty) return false
        const { $from } = selection
        const parent = $from.parent
        // Return no fim de um título começa um parágrafo de corpo, sem herdar o estilo.
        if (parent.type.name === 'heading' && parent.content.size > 0 && $from.parentOffset === parent.content.size) {
          return current.commands.command(({ tr, dispatch }) => {
            const paragraph = state.schema.nodes.paragraph
            const after = $from.after()
            const $after = tr.doc.resolve(after)
            if (!paragraph || !$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)) return false
            if (dispatch) {
              tr.insert(after, paragraph.create())
              tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
            }
            return true
          })
        }
        // Return numa linha vazia de citação tira a linha da citação.
        if (parent.isTextblock && parent.content.size === 0 && $from.depth >= 2 && $from.node(-1).type.name === 'blockquote') {
          return current.commands.command(({ tr, dispatch }) => {
            const range = $from.blockRange()
            const target = range ? liftTarget(range) : null
            if (!range || target === null) return false
            if (dispatch) tr.lift(range, target).scrollIntoView()
            return true
          })
        }
        return false
      },

      Backspace: ({ editor: current }) => {
        const { selection } = current.state
        if (!selection.empty) return false
        const { $from } = selection
        if ($from.parentOffset !== 0 || $from.depth < 2) return false
        const item = $from.node(-1)
        if (!LIST_ITEM_TYPES.includes(item.type.name) || $from.index(-1) !== 0) return false
        return current.commands.liftListItem(item.type.name)
      },

      Tab: ({ editor: current }) => {
        if (LIST_ITEM_TYPES.some((name) => isNodeActive(current.state, name))) return false
        return current.commands.command(({ tr, dispatch }) => {
          if (dispatch) tr.insertText('\t')
          return true
        })
      },
    }
  },
})
