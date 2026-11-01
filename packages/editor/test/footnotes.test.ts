import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { footnotesOf, manuscriptPlainText, toRichDocument } from '../src'
import { createEditor, findText, positionAfter, press, selectText } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function textAround(current: Editor): { before: string; after: string } {
  const { $from } = current.state.selection
  return {
    before: $from.parent.textBetween(0, $from.parentOffset, undefined, '¹'),
    after: $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, '¹'),
  }
}

describe('nota de rodapé', () => {
  it('insere a chamada no cursor e deixa o cursor logo depois dela', () => {
    editor = createEditor('<p>Texto com nota e mais.</p>')
    editor.commands.setTextSelection(positionAfter(editor, 'nota'))
    expect(editor.commands.insertFootnote({ note: 'Referência: Romanos 5:5.' })).toBe(true)
    expect(textAround(editor)).toEqual({ before: 'Texto com nota¹', after: ' e mais.' })
    const document = toRichDocument(editor.getJSON())
    expect(document.footnotes).toEqual([{ number: 1, runs: [{ text: 'Referência: Romanos 5:5.' }] }])
    expect(document.paragraphs[0]?.runs.find((run) => run.footnote)).toMatchObject({ text: '1', footnote: 1, superscript: true })
  })

  it('com o cursor depois do espaço, a chamada fica colada à palavra e o cursor continua após o espaço', () => {
    editor = createEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto com nota ' }] }] })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertFootnote()
    expect(textAround(editor)).toEqual({ before: 'Texto com nota¹ ', after: '' })
    editor.commands.insertContent('continua')
    expect(manuscriptPlainText(editor.getJSON())).toBe('Texto com nota1 continua')
  })

  it('com seleção, insere no fim dela sem apagar o texto (o Swift substituía a seleção)', () => {
    editor = createEditor('<p>Texto com nota.</p>')
    selectText(editor, 'nota')
    editor.commands.insertFootnote()
    expect(manuscriptPlainText(editor.getJSON())).toBe('Texto com nota1.')
  })

  it('numera na ordem do texto e renumera ao inserir antes', () => {
    editor = createEditor('<p>Primeiro e segundo.</p>')
    editor.commands.setTextSelection(positionAfter(editor, 'segundo'))
    editor.commands.insertFootnote({ note: 'Nota do segundo' })
    editor.commands.setTextSelection(positionAfter(editor, 'Primeiro'))
    editor.commands.insertFootnote({ note: 'Nota do primeiro' })
    const numbers = [...editor.view.dom.querySelectorAll('sup[data-footnote]')].map((element) => [
      element.getAttribute('data-footnote-number'),
      element.getAttribute('data-note'),
    ])
    expect(numbers).toEqual([
      ['1', 'Nota do primeiro'],
      ['2', 'Nota do segundo'],
    ])
    expect(footnotesOf(editor.getJSON()).map((note) => [note.number, note.note])).toEqual([
      [1, 'Nota do primeiro'],
      [2, 'Nota do segundo'],
    ])
    expect(manuscriptPlainText(editor.getJSON(), { includeFootnotes: true })).toBe(
      'Primeiro1 e segundo2.\n\nNotas\n1. Nota do primeiro\n2. Nota do segundo',
    )
  })

  it('atualiza e remove a nota pelo id', () => {
    editor = createEditor('<p>Texto.</p>')
    editor.commands.setTextSelection(positionAfter(editor, 'Texto'))
    editor.commands.insertFootnote({ id: 'nota-a', note: 'Antiga' })
    expect(editor.commands.updateFootnote('nota-a', 'Nova')).toBe(true)
    expect(footnotesOf(editor.getJSON())[0]).toMatchObject({ id: 'nota-a', note: 'Nova' })
    expect(editor.commands.removeFootnote('nota-a')).toBe(true)
    expect(footnotesOf(editor.getJSON())).toEqual([])
    expect(editor.commands.updateFootnote('inexistente', 'x')).toBe(false)
  })

  it('⌥⌘F insere a nota e avisa o aplicativo com o id para abrir o editor da nota', () => {
    const onShortcut = vi.fn()
    editor = createEditor('<p>Texto</p>', { onShortcut })
    editor.commands.setTextSelection(positionAfter(editor, 'Texto'))
    expect(press(editor, 'Mod-Alt-f')).toBe(true)
    const [entry] = footnotesOf(editor.getJSON())
    expect(onShortcut).toHaveBeenCalledWith('footnoteInserted', { footnoteId: entry?.id })
  })

  it('o JSON e o HTML do editor guardam a nota', () => {
    editor = createEditor('<p>Texto<sup data-footnote data-note="Nota &amp; fonte"></sup> final.</p>')
    expect(footnotesOf(editor.getJSON())[0]?.note).toBe('Nota & fonte')
    expect(editor.getHTML()).toContain('data-note="Nota &amp; fonte"')
    expect(findText(editor, ' final.').from).toBeGreaterThan(0)
  })
})
