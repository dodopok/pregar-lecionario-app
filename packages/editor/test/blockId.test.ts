import { afterEach, describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Slice } from '@tiptap/pm/model'
import { blockAnchors, footnotesOf } from '../src'
import { createEditor, findText, press } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function ids(json: JSONContent): string[] {
  const result: string[] = []
  const visit = (node: JSONContent) => {
    if (typeof node.attrs?.id === 'string') result.push(node.attrs.id)
    node.content?.forEach(visit)
  }
  visit(json)
  return result
}

function paragraphIds(current: Editor): string[] {
  return blockAnchors(current.getJSON()).map((anchor) => anchor.id)
}

describe('ids de bloco', () => {
  it('todo bloco de nível superior e todo parágrafo recebe um id único', () => {
    editor = createEditor('<p>Um</p><blockquote><p>Dois</p></blockquote><ul><li><p>Três</p></li></ul><h2>Quatro</h2>')
    const json = editor.getJSON()
    for (const node of json.content ?? []) expect(typeof node.attrs?.id).toBe('string')
    const all = ids(json)
    // 4 blocos de nível superior + 2 parágrafos internos.
    expect(all.length).toBe(6)
    expect(new Set(all).size).toBe(all.length)
  })

  it('dividir um parágrafo conserva o id da primeira parte e cria outro para a segunda', () => {
    editor = createEditor('<p>Primeira parte. Segunda parte.</p>')
    const [original] = paragraphIds(editor)
    editor.commands.setTextSelection(findText(editor, 'Segunda').from)
    press(editor, 'Enter')
    const [first, second] = paragraphIds(editor)
    expect(first).toBe(original)
    expect(second).toBeTruthy()
    expect(second).not.toBe(original)
  })

  it('ids sobrevivem a formatação e digitação', () => {
    editor = createEditor('<p>Um</p><p>Dois</p>')
    const before = paragraphIds(editor)
    editor.commands.selectAll()
    editor.commands.setParagraphStyle('heading2')
    editor.commands.toggleQuote()
    editor.commands.setTextSelection(3)
    editor.commands.insertContent(' mais')
    expect(paragraphIds(editor)).toEqual(before)
  })

  it('colar uma cópia gera novo id para a cópia e conserva o do original', () => {
    editor = createEditor('<p>Original</p><p>Fim</p>')
    const [original] = paragraphIds(editor)
    const copied = editor.state.doc.slice(0, editor.state.doc.child(0).nodeSize)
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.view.dispatch(editor.state.tr.replaceSelection(copied))
    const anchors = blockAnchors(editor.getJSON())
    expect(anchors.map((anchor) => anchor.text)).toEqual(['Original', 'Fim', 'Original'])
    expect(anchors[0]?.id).toBe(original)
    expect(anchors[2]?.id).not.toBe(original)
    expect(new Set(anchors.map((anchor) => anchor.id)).size).toBe(3)
  })

  it('recortar e colar (mover) conserva o id', () => {
    editor = createEditor('<p>Movido</p><p>Fica</p>')
    const [moved] = paragraphIds(editor)
    const size = editor.state.doc.child(0).nodeSize
    const slice: Slice = editor.state.doc.slice(0, size)
    editor.view.dispatch(editor.state.tr.delete(0, size))
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.view.dispatch(editor.state.tr.replaceSelection(slice))
    const anchors = blockAnchors(editor.getJSON())
    expect(anchors.map((anchor) => anchor.text)).toEqual(['Fica', 'Movido'])
    expect(anchors[1]?.id).toBe(moved)
  })

  it('notas copiadas recebem novo id', () => {
    editor = createEditor('<p>Texto<sup data-footnote data-note="A"></sup></p>')
    const content = editor.state.doc.slice(0, editor.state.doc.content.size)
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.view.dispatch(editor.state.tr.replaceSelection(content))
    const notes = footnotesOf(editor.getJSON())
    expect(notes.length).toBe(2)
    expect(notes[0]?.id).toBeTruthy()
    expect(notes[0]?.id).not.toBe(notes[1]?.id)
  })

  it('desfazer a primeira transação não remove os ids do documento carregado', () => {
    editor = createEditor('<p>Um</p>')
    const [id] = paragraphIds(editor)
    editor.commands.insertContent('x')
    editor.commands.undo()
    expect(paragraphIds(editor)).toEqual([id])
  })
})
