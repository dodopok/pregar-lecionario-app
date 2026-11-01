/**
 * Copiar e recortar publicam o HTML com estilos inline (para Google Docs e outros editores web)
 * e o texto corrido. O próprio slice vai embutido no HTML, então colar de volta no manuscrito
 * conserva notas, citações e atributos sem perda. ⇧⌘V continua colando só o texto.
 */
import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { clipboardHTML, decodeClipboardPayload } from './clipboardHtml'
import { manuscriptPlainText } from './richDocument'

export const manuscriptClipboardKey = new PluginKey('manuscriptClipboard')

/** Texto simples da seleção, um parágrafo por linha, com marcadores e notas no fim. */
export function clipboardPlainText(slice: Slice): string {
  return manuscriptPlainText(slice, { includeFootnotes: true })
}

function writeSelection(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const { state } = view
  const data = event.clipboardData
  if (state.selection.empty || !data) return false
  const slice = state.selection.content()
  data.clearData()
  data.setData('text/html', clipboardHTML(slice, { embed: { slice: slice.toJSON() } }))
  data.setData('text/plain', clipboardPlainText(slice))
  event.preventDefault()
  if (cut && view.editable) view.dispatch(state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'))
  return true
}

export const ManuscriptClipboard = Extension.create({
  name: 'manuscriptClipboard',

  addProseMirrorPlugins() {
    let plainPaste = false
    return [
      new Plugin({
        key: manuscriptClipboardKey,
        props: {
          handleKeyDown(_view, event) {
            plainPaste = event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v'
            return false
          },
          handleDOMEvents: {
            copy: (view, event) => writeSelection(view, event, false),
            cut: (view, event) => writeSelection(view, event, true),
          },
          handlePaste(view, event) {
            const wantsPlain = plainPaste
            plainPaste = false
            if (wantsPlain) return false
            const html = event.clipboardData?.getData('text/html')
            if (!html) return false
            const payload = decodeClipboardPayload(html) as { slice?: unknown } | undefined
            if (!payload?.slice) return false
            try {
              const slice = Slice.fromJSON(view.state.schema, payload.slice)
              view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
              return true
            } catch {
              return false
            }
          },
        },
      }),
    ]
  },
})
