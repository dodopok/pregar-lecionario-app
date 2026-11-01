import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { getFindState, toRichDocument } from '../src'
import { createEditor, press } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function selected(current: Editor): string {
  const { from, to } = current.state.selection
  return current.state.doc.textBetween(from, to)
}

describe('localizar e substituir', () => {
  it('encontra ocorrências sem diferenciar maiúsculas, destaca e navega', () => {
    editor = createEditor('<p>Graça e paz. A <strong>graça</strong> basta.</p><p>GRAÇA final</p>')
    editor.commands.setFindQuery('graça')
    let find = getFindState(editor.state)
    expect(find.matches.length).toBe(3)
    expect(find.current).toBe(0)
    expect(selected(editor)).toBe('Graça')
    expect(editor.view.dom.querySelectorAll('.manuscript-find-match').length).toBe(3)
    expect(editor.view.dom.querySelectorAll('.manuscript-find-current').length).toBe(1)
    editor.commands.findNext()
    expect(selected(editor)).toBe('graça')
    editor.commands.findNext()
    editor.commands.findNext()
    expect(getFindState(editor.state).current).toBe(0)
    editor.commands.findPrevious()
    find = getFindState(editor.state)
    expect(find.current).toBe(2)
    expect(selected(editor)).toBe('GRAÇA')
  })

  it('diferencia maiúsculas quando pedido', () => {
    editor = createEditor('<p>Graça e graça</p>')
    editor.commands.setFindQuery('graça', { matchCase: true })
    expect(getFindState(editor.state).matches.length).toBe(1)
  })

  it('substitui a atual preservando as marcas e avança', () => {
    editor = createEditor('<p>A <strong>graça</strong> e a graça.</p>')
    editor.commands.setFindQuery('graça')
    editor.commands.replaceMatch('misericórdia')
    const runs = toRichDocument(editor.getJSON()).paragraphs[0]?.runs ?? []
    expect(runs.find((run) => run.bold)?.text).toBe('misericórdia')
    expect(getFindState(editor.state).matches.length).toBe(1)
    expect(selected(editor)).toBe('graça')
  })

  it('substitui todas numa só transação, com um único desfazer', () => {
    editor = createEditor('<p>paz, paz</p><p>e paz</p>')
    editor.commands.setFindQuery('paz')
    expect(editor.commands.replaceAllMatches('shalom')).toBe(true)
    expect(editor.getText({ blockSeparator: '\n' })).toBe('shalom, shalom\ne shalom')
    expect(getFindState(editor.state).matches.length).toBe(0)
    editor.commands.undo()
    expect(editor.getText({ blockSeparator: '\n' })).toBe('paz, paz\ne paz')
  })

  it('as ocorrências acompanham a edição e o termo vazio limpa a busca', () => {
    editor = createEditor('<p>luz</p>')
    editor.commands.setFindQuery('luz')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent(' e luz')
    expect(getFindState(editor.state).matches.length).toBe(2)
    editor.commands.clearFind()
    expect(getFindState(editor.state).matches.length).toBe(0)
    expect(editor.view.dom.querySelectorAll('.manuscript-find-match').length).toBe(0)
  })

  it('⌘F e ⇧⌘H chamam a interface do aplicativo', () => {
    const actions: string[] = []
    editor = createEditor('<p>Texto</p>', {
      onShortcut: (action) => {
        actions.push(action)
      },
    })
    expect(press(editor, 'Mod-f')).toBe(true)
    expect(press(editor, 'Mod-Shift-h')).toBe(true)
    expect(press(editor, 'Mod-k')).toBe(true)
    expect(actions).toEqual(['find', 'replace', 'link'])
    expect(toRichDocument(editor.getJSON()).paragraphs[0]?.runs[0]?.highlight).toBeUndefined()
  })
})
