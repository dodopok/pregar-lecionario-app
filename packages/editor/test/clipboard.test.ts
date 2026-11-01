import { afterEach, describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { clipboardHTML, decodeClipboardPayload, footnotesOf, manuscriptPlainText, parseManuscriptJSON } from '../src'
import { createEditor, selectText } from './helpers'

const size = (value: string, marks: NonNullable<JSONContent['marks']> = []): JSONContent => ({
  type: 'text',
  text: value,
  marks: [...marks, { type: 'textStyle', attrs: { fontSize: '12.5pt' } }],
})

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('clipboardHTML (porta de DocumentClipboardHTML)', () => {
  it('cola num editor web com formatação, blocos explícitos e quebras (porta do teste do WebKit)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '😀 Título & <teste>', marks: [{ type: 'textStyle', attrs: { fontSize: '20pt' } }] }] },
        { type: 'paragraph' },
        {
          type: 'paragraph',
          attrs: { textAlign: 'justify', lineHeight: 1.5, spaceBefore: 6, spaceAfter: 8, indentStart: 20, indentFirstLine: 30 },
          content: [
            size('Um trecho '),
            {
              type: 'text',
              text: 'forte',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
                { type: 'strike' },
                { type: 'highlight', attrs: { color: '#ffff00' } },
                { type: 'textStyle', attrs: { fontSize: '12.5pt', color: 'rgb(18, 52, 86)' } },
              ],
            },
            size(' e uma '),
            size('referência', [{ type: 'link', attrs: { href: 'https://example.org/?a=1&b=2' } }]),
            size('.'),
            { type: 'hardBreak' },
            size('Outra linha com  dois espaços.'),
          ],
        },
        { type: 'paragraph', content: [size('Último', [{ type: 'superscript' }]), size(' parágrafo.')] },
        { type: 'paragraph' },
      ],
    }
    const html = clipboardHTML(doc)
    expect(html.startsWith('<html><head><meta charset="utf-8"></head><body><!--StartFragment--><div>')).toBe(true)
    expect(html.endsWith('</div><!--EndFragment--></body></html>')).toBe(true)
    const page = parse(html)
    const blocks = [...page.querySelectorAll('p,h1,h2,h3,h4,h5,h6')] as HTMLElement[]
    expect(blocks.map((node) => node.textContent)).toEqual(['😀 Título & <teste>', '', 'Um trecho forte e uma referência.Outra linha com  dois espaços.', 'Último parágrafo.', ''])
    expect(blocks.map((node) => node.tagName)).toEqual(['H2', 'P', 'P', 'P', 'P'])
    expect(blocks.map((node) => node.querySelectorAll('br').length)).toEqual([0, 1, 1, 0, 1])
    const strong = [...page.querySelectorAll('span')].find((node) => node.textContent === 'forte') as HTMLElement
    expect(strong.style.getPropertyValue('font-size')).toBe('12.5pt')
    expect(strong.style.getPropertyValue('font-weight')).toBe('700')
    expect(strong.style.getPropertyValue('font-style')).toBe('italic')
    expect(strong.style.getPropertyValue('text-decoration')).toContain('underline')
    expect(strong.style.getPropertyValue('text-decoration')).toContain('line-through')
    expect(strong.getAttribute('style')).toContain('color:rgba(18,52,86,1)')
    expect(strong.getAttribute('style')).toContain('background-color:rgba(255,255,0,1)')
    expect(strong.getAttribute('style')).toContain('white-space:pre-wrap')
    const paragraph = blocks[2] as HTMLElement
    const style = paragraph.getAttribute('style') ?? ''
    for (const declaration of ['text-align:justify', 'line-height:1.5', 'margin-top:6pt', 'margin-bottom:8pt', 'margin-left:20pt', 'text-indent:10pt', 'white-space:pre-wrap', 'font-size:12.5pt']) {
      expect(style).toContain(declaration)
    }
    expect(page.querySelector('a')?.getAttribute('href')).toBe('https://example.org/?a=1&b=2')
    expect(page.querySelectorAll('sup').length).toBe(1)
    expect(page.querySelectorAll('teste').length).toBe(0)
    expect(blocks[0]?.getAttribute('style')).toContain('font-size:20pt')
    expect(blocks[3]?.getAttribute('style')).toContain('text-align:start')
  })

  it('inclui só a seleção, escapa a marcação e não cria links executáveis', () => {
    const source = 'Privado antes. <script>window.injected=true</script> & café. Privado depois.'
    const middle = '<script>window.injected=true</script> & café.'
    const start = source.indexOf(middle)
    const doc = parseManuscriptJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: source.slice(0, start) },
            { type: 'text', text: middle, marks: [{ type: 'link', attrs: { href: 'javascript:window.injected=true' } }] },
            { type: 'text', text: source.slice(start + middle.length) },
          ],
        },
      ],
    })
    const slice = doc.slice(1 + start, 1 + start + middle.length)
    const html = clipboardHTML(slice)
    expect(html).not.toContain('Privado')
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.textContent).toBe(middle)
    expect(container.querySelectorAll('script').length).toBe(0)
    expect(container.querySelectorAll('a').length).toBe(0)
    expect((window as unknown as { injected?: boolean }).injected).toBeUndefined()
  })

  it('listas viram ul/ol aninhadas; verificação e citação usam blocos com estilo inline', () => {
    const html = clipboardHTML({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Três' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Quatro' }] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sub' }] }] }] },
              ],
            },
          ],
        },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feito' }] }] }] },
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Citação' }] },
            { type: 'paragraph', attrs: { attribution: true }, content: [{ type: 'text', text: '— Autor' }] },
          ],
        },
      ],
    })
    const page = parse(html)
    const ordered = page.querySelector('ol')
    expect(ordered?.getAttribute('start')).toBe('3')
    expect(ordered?.querySelectorAll(':scope > li').length).toBe(2)
    expect(ordered?.querySelector('li ul li')?.textContent).toBe('Sub')
    const paragraphs = [...page.querySelectorAll('p')] as HTMLElement[]
    expect(paragraphs.map((node) => node.textContent)).toEqual(['Três', 'Quatro', 'Sub', '☑ Feito', 'Citação', '— Autor'])
    const [quote, attribution] = paragraphs.slice(4).map((node) => node.getAttribute('style') ?? '')
    expect(quote).toContain('margin-left:34pt')
    expect(quote).toContain('margin-right:12pt')
    expect(quote).toContain('margin-top:11pt')
    expect(quote).toContain('margin-bottom:0pt')
    expect(attribution).toContain('margin-bottom:12pt')
    expect(paragraphs[4]?.querySelector('span')?.getAttribute('style')).toContain('color:rgba(43,82,61,1)')
  })

  it('chamadas de nota viram sobrescrito e as notas da seleção vão para o fim', () => {
    const html = clipboardHTML({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texto' }, { type: 'footnote', attrs: { note: 'Romanos 5:5.' } }] }],
    })
    const paragraphs = [...parse(html).querySelectorAll('p')].map((node) => node.textContent)
    expect(paragraphs).toEqual(['Texto1', '', '1 Romanos 5:5.'])
    expect(clipboardHTML({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'footnote', attrs: { note: 'x' } }] }] }, { includeFootnotes: false })).not.toContain('<sup')
  })
})

describe('copiar, recortar e colar no editor', () => {
  function clipboardEvent(store: Record<string, string>): ClipboardEvent {
    const data = {
      clearData: () => {
        for (const key of Object.keys(store)) delete store[key]
      },
      setData: (type: string, value: string) => {
        store[type] = value
      },
      getData: (type: string) => store[type] ?? '',
    }
    return { clipboardData: data, preventDefault: () => undefined } as unknown as ClipboardEvent
  }

  it('copiar publica HTML com estilos e texto simples; colar de volta conserva notas e citação', () => {
    editor = createEditor('<blockquote><p>Citado<sup data-footnote data-note="Fonte"></sup></p></blockquote><p>Fim</p>')
    editor.commands.setTextSelection({ from: 2, to: editor.state.doc.child(0).nodeSize - 2 })
    const store: Record<string, string> = {}
    const view = editor.view
    const copied = view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, clipboardEvent(store)))
    expect(copied).toBe(true)
    expect(store['text/plain']).toBe('Citado1\n\nNotas\n1. Fonte')
    expect(store['text/html']).toContain('margin-left:34pt')
    expect(decodeClipboardPayload(store['text/html'] ?? '')).toHaveProperty('slice')

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const pasted = view.someProp('handlePaste', (handler) => handler(view, clipboardEvent(store) as ClipboardEvent, Slice.empty))
    expect(pasted).toBe(true)
    const notes = footnotesOf(editor.getJSON())
    expect(notes.map((note) => note.note)).toEqual(['Fonte', 'Fonte'])
    expect(new Set(notes.map((note) => note.id)).size).toBe(2)
  })

  it('recortar copia e apaga a seleção', () => {
    editor = createEditor('<p>Um dois três</p>')
    selectText(editor, 'dois ')
    const store: Record<string, string> = {}
    const view = editor.view
    expect(view.someProp('handleDOMEvents', (handlers) => handlers.cut?.(view, clipboardEvent(store)))).toBe(true)
    expect(store['text/plain']).toBe('dois ')
    expect(manuscriptPlainText(editor.getJSON())).toBe('Um três')
  })

  it('HTML de outro aplicativo segue o caminho normal de colagem', () => {
    editor = createEditor('<p>Texto</p>')
    const view = editor.view
    const handled = view.someProp('handlePaste', (handler) => handler(view, clipboardEvent({ 'text/html': '<p>Externo</p>' }), Slice.empty))
    expect(handled).toBeFalsy()
  })
})
