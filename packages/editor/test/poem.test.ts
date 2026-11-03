import { afterEach, describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { htmlForPrint, MANUSCRIPT_EDITOR_CSS, parseManuscriptJSON, toRichDocument } from '../src'
import { createEditor, selectText } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

/** Tipos de bloco de nível superior; a citação aparece pelo seu `kind`. */
const kinds = (current: Editor): Array<string | undefined> =>
  current
    .getJSON()
    .content?.map((node) => (node.type === 'blockquote' ? String(node.attrs?.kind) : node.type)) ?? []

describe('citação: prosa e poema', () => {
  it('documentos antigos, sem o atributo, são citações de prosa', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { id: 'q' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Citado' }] }],
        },
      ],
    }
    expect(parseManuscriptJSON(json).firstChild?.attrs.kind).toBe('quote')
    editor = createEditor(json)
    expect(kinds(editor)).toEqual(['quote'])
    expect(editor.getHTML()).toMatch(/<blockquote [^>]*data-kind="quote"/)
  })

  it('setBlockquoteKind troca o tipo da citação do cursor e volta', () => {
    editor = createEditor('<blockquote><p>Na noite,</p><p>uma janela.</p></blockquote>')
    selectText(editor, 'janela')
    expect(editor.commands.setBlockquoteKind('poem')).toBe(true)
    expect(kinds(editor)).toEqual(['poem'])
    expect(editor.getHTML()).toMatch(/<blockquote [^>]*data-kind="poem"/)
    expect(editor.isActive('blockquote', { kind: 'poem' })).toBe(true)
    expect(editor.commands.setBlockquoteKind('quote')).toBe(true)
    expect(kinds(editor)).toEqual(['quote'])
    expect(editor.isActive('blockquote', { kind: 'poem' })).toBe(false)
  })

  it('fora de citação, setBlockquoteKind cria uma citação já do tipo pedido; toggleBlockquote e toggleQuote continuam a funcionar', () => {
    editor = createEditor('<p>Verso solto</p>')
    expect(editor.commands.setBlockquoteKind('poem')).toBe(true)
    expect(kinds(editor)).toEqual(['poem'])
    expect(editor.commands.toggleBlockquote()).toBe(true)
    expect(kinds(editor)).toEqual(['paragraph'])
    expect(editor.commands.toggleBlockquote()).toBe(true)
    expect(kinds(editor)).toEqual(['quote'])
    expect(editor.commands.toggleQuote()).toBe(true)
    expect(kinds(editor)).toEqual(['paragraph'])
  })

  it('lê e grava data-kind no HTML do editor', () => {
    editor = createEditor(
      '<blockquote data-kind="poem"><p>Verso</p></blockquote><blockquote><p>Prosa</p></blockquote>',
    )
    expect(kinds(editor)).toEqual(['poem', 'quote'])
    const reloaded = createEditor(editor.getHTML())
    expect(kinds(reloaded)).toEqual(['poem', 'quote'])
    reloaded.destroy()
  })

  it('toggleQuote só une citações vizinhas do mesmo tipo', () => {
    editor = createEditor('<blockquote data-kind="poem"><p>Verso</p></blockquote><p>Solto</p>')
    selectText(editor, 'Solto')
    editor.commands.toggleQuote()
    expect(kinds(editor)).toEqual(['poem', 'quote'])
    editor.destroy()
    editor = createEditor('<blockquote><p>Prosa</p></blockquote><p>Solto</p>')
    selectText(editor, 'Solto')
    editor.commands.toggleQuote()
    expect(kinds(editor)).toEqual(['quote'])
  })

  it('o poema mantém os versos na impressão, em parágrafos separados ou com Shift-Return', () => {
    const document = toRichDocument({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          attrs: { kind: 'poem' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Na noite, uma janela;' },
                { type: 'hardBreak' },
                { type: 'text', text: 'o silêncio escuta.' },
              ],
            },
            { type: 'paragraph', content: [{ type: 'text', text: 'Segundo verso.' }] },
          ],
        },
      ],
    })
    expect(document.paragraphs.map((paragraph) => paragraph.quote)).toEqual([true, true])
    const page = new DOMParser().parseFromString(htmlForPrint(document), 'text/html')
    const verses = [...page.querySelectorAll('p.quote')]
    expect(verses.map((node) => node.textContent)).toEqual([
      'Na noite, uma janela;o silêncio escuta.',
      'Segundo verso.',
    ])
    expect(verses[0]?.querySelector('br')).not.toBeNull()
  })

  it('o CSS do editor distingue poema, prosa citada e anotação', () => {
    expect(MANUSCRIPT_EDITOR_CSS).toContain(
      '.manuscript-editor blockquote[data-kind="poem"] p { padding-left: 1.5em; text-indent: -1.5em; }',
    )
    expect(MANUSCRIPT_EDITOR_CSS).toContain('border-left: 2px solid var(--accent, #2e7a51)')
    expect(MANUSCRIPT_EDITOR_CSS).toContain("content: 'Anotação'")
    expect(MANUSCRIPT_EDITOR_CSS).toContain('aside.manuscript-annotation')
  })
})
