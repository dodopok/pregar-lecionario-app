import { Editor, type JSONContent } from '@tiptap/core'
import { createManuscriptExtensions, type ManuscriptExtensionOptions } from '../src'

/** Ids previsíveis: b1, b2… para blocos e n1, n2… para notas. */
export function sequentialIds(): (kind: 'block' | 'footnote') => string {
  let block = 0
  let footnote = 0
  return (kind) => (kind === 'footnote' ? `n${++footnote}` : `b${++block}`)
}

export function createEditor(content: string | JSONContent = '', options: ManuscriptExtensionOptions = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createManuscriptExtensions({ generateId: sequentialIds(), ...options }),
    content,
  })
  // A primeira transação normaliza os ids do documento inicial.
  editor.view.dispatch(editor.state.tr)
  return editor
}

/** Digita caractere a caractere passando pelas regras de entrada, como o teclado. */
export function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const view = editor.view
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
    )
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

export const isMac = /Mac|iP(hone|[oa]d)/.test(typeof navigator !== 'undefined' ? navigator.platform : '')

/** Envia uma tecla ao editor ("Mod-Shift-x", "Enter", "Mod-Alt-1"). Devolve true se tratada. */
export function press(editor: Editor, combo: string): boolean {
  const parts = combo.split('-')
  let key = parts.pop() ?? ''
  if (key === '' && combo.endsWith('-')) key = '-'
  const modifiers = new Set(parts)
  const mod = modifiers.has('Mod')
  const shift = modifiers.has('Shift')
  const codes: Record<string, number> = {
    Enter: 13,
    Backspace: 8,
    Tab: 9,
    '.': 190,
    ',': 188,
    '[': 219,
    ']': 221,
    '\\': 220,
    '/': 191,
    '=': 187,
    '-': 189,
  }
  const keyCode = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
  const event = new KeyboardEvent('keydown', {
    key: key.length === 1 && shift ? key.toUpperCase() : key,
    keyCode,
    metaKey: (mod && isMac) || modifiers.has('Meta'),
    ctrlKey: (mod && !isMac) || modifiers.has('Ctrl'),
    altKey: modifiers.has('Alt'),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit)
  const view = editor.view
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) === true
}

/** Posição logo depois da primeira ocorrência do texto. */
export function positionAfter(editor: Editor, text: string): number {
  const range = findText(editor, text)
  return range.to
}

export function findText(editor: Editor, text: string): { from: number; to: number } {
  let result: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (result || !node.isText) return !result
    const index = node.text?.indexOf(text) ?? -1
    if (index >= 0) result = { from: pos + index, to: pos + index + text.length }
    return false
  })
  if (!result) throw new Error(`Texto não encontrado: ${text}`)
  return result
}

export function selectText(editor: Editor, text: string): void {
  const { from, to } = findText(editor, text)
  editor.commands.setTextSelection({ from, to })
}

/** Remove atributos nulos/padrão para comparar a estrutura do JSON com folga. */
export function compact(json: JSONContent): JSONContent {
  const result: JSONContent = { type: json.type }
  if (json.attrs) {
    const attrs = Object.fromEntries(Object.entries(json.attrs).filter(([name, value]) => value !== null && value !== false && name !== 'id'))
    if (Object.keys(attrs).length) result.attrs = attrs
  }
  if (json.text !== undefined) result.text = json.text
  if (json.marks?.length) result.marks = json.marks.map((mark) => (mark.attrs ? { type: mark.type, attrs: Object.fromEntries(Object.entries(mark.attrs).filter(([, value]) => value !== null)) } : { type: mark.type }))
  if (json.content?.length) result.content = json.content.map(compact)
  return result
}
