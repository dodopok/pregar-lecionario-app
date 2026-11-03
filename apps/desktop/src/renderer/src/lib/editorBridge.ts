import { shallowRef } from 'vue'
import type { Editor } from '@tiptap/core'
import { manuscriptPlainText, toRichDocument, applyLanguageEdits } from '@pregar/editor'
import type { LanguageCorrection } from '@pregar/editor'
import type { RichDocument } from '@pregar/core/document/model'

/**
 * Acesso ao editor do manuscrito para os painéis e folhas da Mesa (selecionar trecho citado pela
 * revisão, inserir ideia ou epígrafe, exportar). Um editor por janela.
 */
export const selectedSpellingFinding = shallowRef<string | null>(null)

export const activeEditor = shallowRef<Editor | null>(null)

export function editorJSON(): object | null {
  return activeEditor.value?.getJSON() ?? null
}

export function editorPlainText(): string {
  const json = editorJSON()
  return json ? manuscriptPlainText(json as never) : ''
}

export function editorRichDocument(title?: string): RichDocument | null {
  const json = editorJSON()
  return json ? toRichDocument(json as never, title ? { title } : {}) : null
}

/** Seleciona o trecho literal citado (revisão, perguntas, mapa) e rola até ele. */
export function selectQuote(quote: string): boolean {
  const editor = activeEditor.value
  if (!editor || !quote.trim()) return false
  const found = (editor.commands as unknown as { selectQuote(q: string): boolean }).selectQuote(quote)
  if (found) {
    editor.commands.focus(undefined, { scrollIntoView: false })
    requestAnimationFrame(() => {
      if (activeEditor.value !== editor || editor.isDestroyed) return
      const { from, to } = editor.state.selection
      const start = editor.view.coordsAtPos(from),
        end = editor.view.coordsAtPos(to)
      const surface = editor.view.dom.closest('.manuscript__surface') as HTMLElement | null
      if (surface) {
        const bounds = surface.getBoundingClientRect()
        surface.scrollBy({
          top: (start.top + end.bottom) / 2 - (bounds.top + bounds.height / 2),
          behavior: 'smooth',
        })
      }
    })
  }
  return found
}

export function insertTextAtCursor(text: string): void {
  const editor = activeEditor.value
  if (!editor) return
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => ({
    type: 'paragraph',
    content: paragraph.trim() ? [{ type: 'text', text: paragraph.trim() }] : [],
  }))
  editor.chain().focus().insertContent(paragraphs).run()
}

export function insertEpigraph(text: string, attribution = 'Coleta do dia'): void {
  const editor = activeEditor.value
  if (!editor) return
  ;(editor.chain().focus() as unknown as { insertEpigraph(t: string, a: string): { run(): boolean } })
    .insertEpigraph(text, attribution)
    .run()
}

export function applyLanguageCorrections(items: readonly LanguageCorrection[]): string[] {
  const editor = activeEditor.value
  return editor ? applyLanguageEdits(editor, items) : []
}
