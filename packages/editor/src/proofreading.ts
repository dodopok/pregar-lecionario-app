/** Marcas efêmeras da revisão: não são gravadas nem exportadas com o manuscrito. */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findMatches } from './findReplace'
import { isLanguageCorrection } from '@pregar/core/ai/language'

export interface LanguageCorrection {
  id: string
  quote: string
  correction: string
  observation?: string
}
export interface LanguageEdit extends LanguageCorrection {
  from: number
  to: number
}

/** Só aplica âncoras literais únicas. Conflitos e sobreposições ficam para conferência manual. */
export function languageEdits(doc: ProseMirrorNode, items: readonly LanguageCorrection[]): LanguageEdit[] {
  const candidates = items.flatMap((item) => {
    if (!isLanguageCorrection(item.quote, item.correction)) return []
    const matches = findMatches(doc, item.quote, true)
    return matches.length === 1 ? [{ ...item, ...matches[0]! }] : []
  })
  return candidates.filter(
    (item, index) =>
      !candidates.some((other, j) => j !== index && item.from < other.to && other.from < item.to),
  )
}

export const proofreadingKey = new PluginKey<DecorationSet>('proofreading')

/** A marcação visual nunca deve disparar o salvamento, nem durante a normalização dos IDs. */
export function setLanguageCorrections(editor: Editor, items: readonly LanguageCorrection[]): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(proofreadingKey, items)
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true),
  )
}

export const Proofreading = Extension.create({
  name: 'proofreading',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: proofreadingKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const items = tr.getMeta(proofreadingKey) as LanguageCorrection[] | undefined
            if (items)
              return DecorationSet.create(
                tr.doc,
                languageEdits(tr.doc, items).map((item) =>
                  Decoration.inline(
                    item.from,
                    item.to,
                    {
                      class: 'manuscript-proofreading',
                      'data-spelling-id': item.id,
                      title: `${item.quote} → ${item.correction}${item.observation ? `\n${item.observation}` : ''}`,
                    },
                    { quote: item.quote },
                  ),
                ),
              )
            if (!tr.docChanged) return previous
            const mapped = previous.map(tr.mapping, tr.doc)
            const invalid = mapped
              .find()
              .filter((mark) => tr.doc.textBetween(mark.from, mark.to) !== mark.spec.quote)
            return mapped.remove(invalid)
          },
        },
        props: { decorations: (state) => proofreadingKey.getState(state) ?? DecorationSet.empty },
      }),
    ]
  },
})

/** Diferenças por caractere preservam as marcas das partes que não mudaram. */
function correctionChunks(before: string, after: string): Array<{ from: number; to: number; text: string }> {
  const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      rows[i]![j] =
        before[i] === after[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!)
    }
  }
  const chunks: Array<{ from: number; to: number; text: string }> = []
  let i = 0,
    j = 0,
    current: { from: number; to: number; text: string } | null = null
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      if (current) {
        chunks.push(current)
        current = null
      }
      i++
      j++
    } else {
      current ??= { from: i, to: i, text: '' }
      if (i < before.length && (j === after.length || rows[i + 1]![j]! >= rows[i]![j + 1]!)) {
        i++
        current.to = i
      } else {
        current.text += after[j]
        j++
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** Uma transação para o lote inteiro, isolada das edições anteriores e seguintes no desfazer. */
export function applyLanguageEdits(editor: Editor, items: readonly LanguageCorrection[]): string[] {
  if (!editor.isEditable) return []
  const edits = languageEdits(editor.state.doc, items).sort((a, b) => b.from - a.from)
  const tr = closeHistory(editor.state.tr)
  for (const edit of edits) {
    for (const chunk of correctionChunks(edit.quote, edit.correction).reverse()) {
      const from = edit.from + chunk.from,
        to = edit.from + chunk.to
      const marks = tr.doc.resolve(from).marks()
      if (chunk.text) tr.replaceWith(from, to, editor.state.schema.text(chunk.text, marks))
      else tr.delete(from, to)
    }
  }
  if (edits.length) {
    editor.view.dispatch(tr)
    editor.view.dispatch(
      closeHistory(editor.state.tr).setMeta('addToHistory', false).setMeta('preventUpdate', true),
    )
  }
  return edits.map((edit) => edit.id)
}
