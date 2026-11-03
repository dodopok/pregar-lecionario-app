import { afterEach, describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import {
  blockAnchors,
  clipboardHTML,
  findTextRange,
  flattenDocument,
  footnotesOf,
  htmlForPrint,
  manuscriptPlainText,
  manuscriptWordCount,
  parseManuscriptJSON,
  toRichDocument,
} from '../src'
import { compact, createEditor, findText, positionAfter, press, selectText, typeText } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const topTypes = (current: Editor): Array<string | undefined> =>
  compact(current.getJSON()).content?.map((node) => node.type) ?? []

const ANNOTATION_TAG = '<aside data-annotation="" class="manuscript-annotation">'

describe('anotação: comandos', () => {
  it('setAnnotation envolve o parágrafo do cursor; unsetAnnotation devolve-o ao corpo', () => {
    editor = createEditor('<p>Antes</p><p>Lembrar de olhar para a Ana</p><p>Depois</p>')
    editor.commands.setTextSelection(positionAfter(editor, 'Ana'))
    expect(editor.commands.setAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph', 'annotation', 'paragraph'])
    expect(editor.getHTML()).toContain(`${ANNOTATION_TAG}<p`)
    expect(editor.isActive('annotation')).toBe(true)
    // Já anotado: nada a envolver.
    expect(editor.commands.setAnnotation()).toBe(false)
    expect(editor.commands.unsetAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(editor.commands.unsetAnnotation()).toBe(false)
  })

  it('toggleAnnotation anota a seleção, funde a anotação vizinha selecionada e desfaz tudo de novo', () => {
    editor = createEditor('<p>Um</p><aside data-annotation><p>Nota</p></aside><p>Dois</p>')
    editor.commands.setTextSelection({ from: findText(editor, 'Um').from, to: findText(editor, 'Dois').to })
    expect(editor.commands.toggleAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['annotation'])
    expect(manuscriptPlainText(editor.getJSON(), { includeAnnotations: true })).toBe('Um\nNota\nDois')
    expect(manuscriptPlainText(editor.getJSON())).toBe('')
    editor.commands.selectAll()
    expect(editor.commands.toggleAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })

  it('título selecionado vira parágrafo dentro da anotação; dentro de lista o comando falha', () => {
    editor = createEditor('<h2>Título</h2><p>Texto</p>')
    editor.commands.selectAll()
    expect(editor.commands.setAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['annotation'])
    expect(compact(editor.getJSON()).content?.[0]?.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
    ])
    editor.destroy()
    editor = createEditor('<ul><li><p>Item</p></li></ul>')
    selectText(editor, 'Item')
    expect(editor.commands.setAnnotation()).toBe(false)
    expect(topTypes(editor)).toEqual(['bulletList'])
  })

  it('tirar um parágrafo do meio divide a anotação', () => {
    editor = createEditor('<aside data-annotation><p>Um</p><p>Dois</p><p>Três</p></aside>')
    selectText(editor, 'Dois')
    expect(editor.commands.unsetAnnotation()).toBe(true)
    expect(topTypes(editor)).toEqual(['annotation', 'paragraph', 'annotation'])
  })

  it('⇧⌘A alterna a anotação', () => {
    editor = createEditor('<p>Pausa aqui</p>')
    expect(press(editor, 'Mod-Shift-a')).toBe(true)
    expect(topTypes(editor)).toEqual(['annotation'])
    expect(press(editor, 'Mod-Shift-a')).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph'])
  })
})

describe('anotação: teclado', () => {
  it('Return numa linha vazia no fim sai da anotação', () => {
    editor = createEditor('<aside data-annotation><p>Nota</p></aside><p>Depois</p>')
    editor.commands.setTextSelection(positionAfter(editor, 'Nota'))
    press(editor, 'Enter')
    expect(topTypes(editor)).toEqual(['annotation', 'paragraph'])
    expect(press(editor, 'Enter')).toBe(true)
    typeText(editor, 'Corpo')
    expect(topTypes(editor)).toEqual(['annotation', 'paragraph', 'paragraph'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('Corpo\nDepois')
    expect(manuscriptPlainText(editor.getJSON(), { includeAnnotations: true })).toBe('Nota\nCorpo\nDepois')
  })

  it('Return numa linha vazia no meio tira a linha e divide a anotação, como na citação', () => {
    editor = createEditor('<aside data-annotation><p>Um</p><p></p><p>Dois</p></aside>')
    editor.commands.setTextSelection(6)
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    press(editor, 'Enter')
    expect(topTypes(editor)).toEqual(['annotation', 'paragraph', 'annotation'])
  })

  it('Backspace no início do primeiro parágrafo devolve-o ao corpo; no segundo, junta ao anterior', () => {
    editor = createEditor('<p>Antes</p><aside data-annotation><p>Nota</p><p>Outra</p></aside>')
    editor.commands.setTextSelection(findText(editor, 'Outra').from)
    press(editor, 'Backspace')
    expect(topTypes(editor)).toEqual(['paragraph', 'annotation'])
    expect(manuscriptPlainText(editor.getJSON(), { includeAnnotations: true })).toBe('Antes\nNotaOutra')
    editor.commands.setTextSelection(findText(editor, 'Nota').from)
    expect(press(editor, 'Backspace')).toBe(true)
    expect(topTypes(editor)).toEqual(['paragraph', 'paragraph'])
    expect(manuscriptPlainText(editor.getJSON())).toBe('Antes\nNotaOutra')
  })
})

describe('anotação: fora do texto falado', () => {
  const annotation: JSONContent = {
    type: 'annotation',
    content: [
      {
        type: 'paragraph',
        attrs: { id: 'a1' },
        content: [
          { type: 'text', text: 'Lembrar de olhar para a Ana' },
          { type: 'footnote', attrs: { id: 'n2', note: 'Só para mim' } },
        ],
      },
      { type: 'paragraph', attrs: { id: 'a2' }, content: [{ type: 'text', text: 'Pausa aqui.' }] },
    ],
  }
  const json: JSONContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 'h', level: 1 }, content: [{ type: 'text', text: 'Título um' }] },
      {
        type: 'paragraph',
        attrs: { id: 'p1' },
        content: [
          { type: 'text', text: 'Texto com nota' },
          { type: 'footnote', attrs: { id: 'n1', note: 'Fonte A' } },
          { type: 'text', text: ' final.' },
        ],
      },
      annotation,
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', attrs: { id: 'l1' }, content: [{ type: 'text', text: 'Item' }] }],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            attrs: { id: 'q1' },
            content: [
              { type: 'text', text: 'Citado' },
              { type: 'footnote', attrs: { id: 'n3', note: 'Fonte C' } },
            ],
          },
        ],
      },
    ],
  }

  it('é válida no esquema e sobrevive ao JSON e ao HTML do editor', () => {
    expect(() => parseManuscriptJSON(json)).not.toThrow()
    editor = createEditor(json)
    expect(compact(editor.getJSON()).content?.[2]).toEqual(compact(annotation))
    const html = editor.getHTML()
    expect(html).toContain(ANNOTATION_TAG)
    expect(html).toContain('Lembrar de olhar para a Ana')
    const reloaded = createEditor(html)
    expect(topTypes(reloaded)).toEqual(['heading', 'paragraph', 'annotation', 'orderedList', 'blockquote'])
    expect(manuscriptPlainText(reloaded.getJSON(), { includeAnnotations: true })).toBe(
      manuscriptPlainText(json, { includeAnnotations: true }),
    )
    reloaded.destroy()
    // Um aside comum não é anotação.
    const plain = createEditor('<aside><p>Só um aparte</p></aside>')
    expect(topTypes(plain)).toEqual(['paragraph'])
    plain.destroy()
  })

  it('texto da revisão, âncoras e busca de citação ignoram a anotação', () => {
    expect(manuscriptPlainText(json)).toBe('Título um\nTexto com nota1 final.\n1. Item\nCitado2')
    expect(blockAnchors(json).map((anchor) => anchor.id)).toEqual(['h', 'p1', 'l1', 'q1'])
    expect(findTextRange(json, 'olhar para a Ana')).toBeNull()
    expect(findTextRange(json, 'Citado')).not.toBeNull()
    expect(manuscriptPlainText(json, { includeAnnotations: true })).toBe(
      'Título um\nTexto com nota1 final.\nLembrar de olhar para a Ana2\nPausa aqui.\n1. Item\nCitado3',
    )
  })

  it('o modelo neutro, a impressão e a área de transferência não levam a anotação nem as notas dela', () => {
    const document = toRichDocument(json)
    expect(document.paragraphs.map((paragraph) => paragraph.id)).toEqual(['h', 'p1', 'l1', 'q1'])
    expect(document.footnotes).toEqual([
      { number: 1, runs: [{ text: 'Fonte A' }] },
      { number: 2, runs: [{ text: 'Fonte C' }] },
    ])
    const printed = htmlForPrint(document, { includeFootnotes: true })
    expect(printed).not.toContain('Ana')
    expect(printed).not.toContain('Só para mim')
    expect(clipboardHTML(json)).not.toContain('Ana')
    expect(
      toRichDocument(json, { includeAnnotations: true }).paragraphs.map((paragraph) => paragraph.id),
    ).toEqual(['h', 'p1', 'a1', 'a2', 'l1', 'q1'])
  })

  it('a lista de notas do editor numera também as notas dentro da anotação', () => {
    expect(footnotesOf(json).map((entry) => [entry.number, entry.note])).toEqual([
      [1, 'Fonte A'],
      [2, 'Só para mim'],
      [3, 'Fonte C'],
    ])
    const flagged = flattenDocument(json, { includeAnnotations: true }).filter(
      (paragraph) => paragraph.annotation,
    )
    expect(flagged.map((paragraph) => paragraph.id)).toEqual(['a1', 'a2'])
    expect(flattenDocument(json).some((paragraph) => paragraph.annotation)).toBe(false)
  })

  it('manuscriptWordCount conta o texto falado: sem anotação, marcadores de lista nem números de nota', () => {
    expect(manuscriptWordCount(json)).toBe(8)
    editor = createEditor(json)
    expect(manuscriptWordCount(editor.state.doc)).toBe(8)
    // A contagem da extensão CharacterCount inclui a anotação; por isso o aplicativo usa esta.
    const storage = editor.storage as unknown as { characterCount: { words(): number } }
    expect(storage.characterCount.words()).toBe(16)
    const split: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'pa' },
            { type: 'text', text: 'la', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'vra' },
          ],
        },
      ],
    }
    expect(manuscriptWordCount(split)).toBe(1)
    expect(manuscriptWordCount({ type: 'doc' })).toBe(0)
  })
})
