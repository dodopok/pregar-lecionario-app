import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  applyLanguageEdits,
  languageEdits,
  proofreadingKey,
  setLanguageCorrections,
  createManuscriptExtensions,
} from '../src'
import { createEditor } from './helpers'
let editor: Editor | undefined
afterEach(() => editor?.destroy())

describe('correções linguísticas', () => {
  it('corrige grafia e uma frase gramatical em lote e desfaz numa etapa, preservando negrito', () => {
    editor = createEditor('<p>A <strong>excessão</strong> é rara. As pessoa chegou atrasado.</p>')
    const items = [
      { id: '1', quote: 'excessão', correction: 'exceção' },
      { id: '2', quote: 'As pessoa chegou atrasado.', correction: 'As pessoas chegaram atrasadas.' },
    ]
    expect(applyLanguageEdits(editor, items)).toEqual(['2', '1'])
    expect(editor.getText()).toBe('A exceção é rara. As pessoas chegaram atrasadas.')
    expect(editor.getHTML()).toContain('<strong>exceção</strong>')
    editor.commands.undo()
    expect(editor.getText()).toBe('A excessão é rara. As pessoa chegou atrasado.')
  })
  it('preserva formatação no meio de uma frase com várias correções', () => {
    editor = createEditor('<p>As pessoa <em>sempre</em> chegou atrasado.</p>')
    applyLanguageEdits(editor, [
      {
        id: '1',
        quote: 'As pessoa sempre chegou atrasado.',
        correction: 'As pessoas sempre chegaram atrasadas.',
      },
    ])
    expect(editor.getHTML()).toContain('<em>sempre</em>')
    expect(editor.getText()).toBe('As pessoas sempre chegaram atrasadas.')
  })
  it('não aplica trechos alterados, repetidos ou conflitantes', () => {
    editor = createEditor('<p>erro erro. As pessoa chegou.</p>')
    expect(
      languageEdits(editor.state.doc, [
        { id: '1', quote: 'erro', correction: 'erros' },
        { id: '2', quote: 'inexistente', correction: 'existente' },
        { id: '3', quote: 'As pessoa', correction: 'As pessoas' },
        { id: '4', quote: 'pessoa chegou', correction: 'pessoas chegaram' },
      ]),
    ).toEqual([])
  })
  it('não dispara salvamento quando a marcação normaliza IDs de um editor recém-criado', () => {
    let updates = 0
    editor = new Editor({
      extensions: createManuscriptExtensions(),
      content: '<p>O texto salvo continua aqui.</p>',
      onUpdate: () => {
        updates++
      },
    })
    setLanguageCorrections(editor, [])
    expect(updates).toBe(0)
    expect(editor.getText()).toBe('O texto salvo continua aqui.')
  })

  it('realces não alteram o documento e desaparecem quando o trecho é editado', () => {
    editor = createEditor('<p>A excessão.</p>')
    const before = editor.getJSON()
    editor.view.dispatch(
      editor.state.tr.setMeta(proofreadingKey, [{ id: '1', quote: 'excessão', correction: 'exceção' }]),
    )
    expect(editor.view.dom.querySelectorAll('.manuscript-proofreading')).toHaveLength(1)
    expect(editor.getJSON()).toEqual(before)
    applyLanguageEdits(editor, [{ id: '1', quote: 'excessão', correction: 'exceção' }])
    expect(editor.view.dom.querySelectorAll('.manuscript-proofreading')).toHaveLength(0)
  })
})
