import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { manuscriptPlainText, toRichDocument } from '../src'
import { compact, createEditor, press, selectText, typeText } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function topTypes(current: Editor): Array<string | undefined> {
  return compact(current.getJSON()).content?.map((node) => node.type) ?? []
}

describe('atalhos no início da linha', () => {
  it.each([
    ['# ', 'heading', 1],
    ['## ', 'heading', 2],
  ])('"%s" vira título', (prefix, type, level) => {
    editor = createEditor('')
    typeText(editor, `${prefix}Título`)
    const node = compact(editor.getJSON()).content?.[0]
    expect(node?.type).toBe(type)
    expect(node?.attrs?.level).toBe(level)
    expect(manuscriptPlainText(editor.getJSON())).toBe('Título')
  })

  it('"> " vira citação', () => {
    editor = createEditor('')
    typeText(editor, '> Uma citação')
    expect(topTypes(editor)).toEqual(['blockquote'])
    expect(toRichDocument(editor.getJSON()).paragraphs[0]?.quote).toBe(true)
  })

  it.each(['- ', '* '])('"%s" vira lista com marcadores', (prefix) => {
    editor = createEditor('')
    typeText(editor, `${prefix}Item`)
    expect(topTypes(editor)).toEqual(['bulletList'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('• Item')
  })

  it('"1. " vira lista numerada', () => {
    editor = createEditor('')
    typeText(editor, '1. Primeiro')
    expect(topTypes(editor)).toEqual(['orderedList'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('1. Primeiro')
  })

  it('no meio do texto, os caracteres ficam como foram digitados', () => {
    editor = createEditor('')
    typeText(editor, 'Texto # com - sinais > soltos')
    expect(topTypes(editor)).toEqual(['paragraph'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('Texto # com - sinais > soltos')
  })
})

describe('listas', () => {
  it('lista em vários parágrafos, troca de tipo e continuação com Return (porta de DocumentEditorTests)', () => {
    editor = createEditor('<p>Primeiro</p><p>Segundo</p><p>Terceiro</p>')
    editor.commands.selectAll()
    editor.commands.toggleBulletList()
    expect(manuscriptPlainText(editor.getJSON())).toBe('• Primeiro\n• Segundo\n• Terceiro')
    editor.commands.toggleOrderedList()
    expect(manuscriptPlainText(editor.getJSON())).toBe('1. Primeiro\n2. Segundo\n3. Terceiro')
    editor.commands.setTextSelection(editor.state.doc.content.size - 3)
    press(editor, 'Enter')
    expect(manuscriptPlainText(editor.getJSON())).toBe('1. Primeiro\n2. Segundo\n3. Terceiro\n4. ')
    press(editor, 'Enter')
    expect(manuscriptPlainText(editor.getJSON())).toBe('1. Primeiro\n2. Segundo\n3. Terceiro\n')
    expect(topTypes(editor)).toEqual(['orderedList', 'paragraph'])
  })

  it('Return num item vazio encerra a lista', () => {
    editor = createEditor('')
    typeText(editor, '- Um')
    press(editor, 'Enter')
    typeText(editor, 'Dois')
    press(editor, 'Enter')
    press(editor, 'Enter')
    typeText(editor, 'Corpo')
    expect(manuscriptPlainText(editor.getJSON())).toBe('• Um\n• Dois\nCorpo')
  })

  it('Backspace logo após o marcador remove o marcador, não o texto', () => {
    editor = createEditor('')
    typeText(editor, '- Item')
    editor.commands.setTextSelection(3)
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(press(editor, 'Backspace')).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('Item')
  })

  it('Backspace logo após digitar "- " também remove o marcador inteiro', () => {
    editor = createEditor('')
    typeText(editor, '- ')
    expect(press(editor, 'Backspace')).toBe(true)
    expect(manuscriptPlainText(editor.getJSON())).toBe('')
    expect(topTypes(editor)).toEqual(['paragraph'])
  })

  it('⇧⌘7, ⇧⌘8 e ⇧⌘9 alternam lista numerada, com marcadores e de verificação', () => {
    editor = createEditor('<p>Item</p>')
    expect(press(editor, 'Mod-Shift-7')).toBe(true)
    expect(manuscriptPlainText(editor.getJSON())).toBe('1. Item')
    press(editor, 'Mod-Shift-8')
    expect(manuscriptPlainText(editor.getJSON())).toBe('• Item')
    press(editor, 'Mod-Shift-9')
    expect(manuscriptPlainText(editor.getJSON())).toBe('☐ Item')
    press(editor, 'Mod-Shift-9')
    expect(manuscriptPlainText(editor.getJSON())).toBe('Item')
  })

  it('Tab fora de lista insere tabulação; dentro de lista aprofunda o item', () => {
    editor = createEditor('<p>A</p>')
    editor.commands.setTextSelection(2)
    press(editor, 'Tab')
    expect(manuscriptPlainText(editor.getJSON())).toBe('A\t')
  })
})

describe('títulos e citações ao digitar', () => {
  it('Return no fim de um título começa um parágrafo de corpo, sem herdar alinhamento', () => {
    editor = createEditor('<h2 style="text-align: center">Título</h2>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(press(editor, 'Enter')).toBe(true)
    typeText(editor, 'Corpo')
    const [heading, body] = toRichDocument(editor.getJSON()).paragraphs
    expect(heading?.headingLevel).toBe(2)
    expect(body).toMatchObject({ headingLevel: 0, runs: [{ text: 'Corpo' }] })
    expect(body?.alignment).toBeUndefined()
  })

  it('Return no meio de um título divide o título normalmente', () => {
    editor = createEditor('<h1>Título longo</h1>')
    selectText(editor, 'longo')
    editor.commands.setTextSelection(editor.state.selection.from)
    press(editor, 'Enter')
    expect(toRichDocument(editor.getJSON()).paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([1, 1])
  })

  it('Return numa linha vazia de citação sai da citação', () => {
    editor = createEditor('')
    typeText(editor, '> Verso um')
    press(editor, 'Enter')
    typeText(editor, 'Verso dois')
    press(editor, 'Enter')
    press(editor, 'Enter')
    typeText(editor, 'Corpo')
    const paragraphs = toRichDocument(editor.getJSON()).paragraphs
    expect(paragraphs.map((paragraph) => [paragraph.quote === true, paragraph.runs.map((run) => run.text).join('')])).toEqual([
      [true, 'Verso um'],
      [true, 'Verso dois'],
      [false, 'Corpo'],
    ])
  })

  it('linha vazia no meio da citação sai dela e divide o bloco', () => {
    editor = createEditor('<blockquote><p>Um</p><p></p><p>Dois</p></blockquote>')
    editor.commands.setTextSelection(6)
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    press(editor, 'Enter')
    expect(topTypes(editor)).toEqual(['blockquote', 'paragraph', 'blockquote'])
  })

  it('Shift-Return insere quebra de linha dentro do parágrafo (verso de poema)', () => {
    editor = createEditor('')
    typeText(editor, 'Na noite, uma janela;')
    press(editor, 'Shift-Enter')
    typeText(editor, 'o silêncio aprende a escutar.')
    const paragraph = toRichDocument(editor.getJSON()).paragraphs[0]
    expect(paragraph?.runs.some((run) => run.hardBreak)).toBe(true)
    expect(manuscriptPlainText(editor.getJSON())).toBe('Na noite, uma janela;\no silêncio aprende a escutar.')
  })
})
