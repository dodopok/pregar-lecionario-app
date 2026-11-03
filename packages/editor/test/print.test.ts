import { describe, expect, it } from 'vitest'
import type { RichDocument } from '@pregar/core/document/model'
import { htmlForPrint, toRichDocument } from '../src'

const document: RichDocument = toRichDocument({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Parte <1>' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'O texto diz algo importante' },
        { type: 'footnote', attrs: { note: 'Nota de rodapé que fica no fim.' } },
        { type: 'text', text: ' e ' },
        { type: 'text', text: 'itálico', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' maior', marks: [{ type: 'textStyle', attrs: { fontSize: '22pt' } }] },
        { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'O amor de Deus' }] },
        {
          type: 'paragraph',
          attrs: { attribution: true },
          content: [{ type: 'text', text: '— Romanos 5:5' }],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Uma promessa para hoje' }] }],
        },
      ],
    },
    { type: 'paragraph' },
  ],
})

describe('htmlForPrint (PDF do tablet)', () => {
  it('monta cabeçalho com título e ocasião, família e tamanho escolhidos', () => {
    const html = htmlForPrint(document, {
      title: 'Mensagem & graça',
      occasion: 'LOC 2027 · Domingo',
      fontFamily: 'Georgia',
      fontSizePt: 14,
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Mensagem &amp; graça</title>')
    expect(html).toContain('<h1 class="print-title">Mensagem &amp; graça</h1>')
    expect(html).toContain('<p class="print-occasion">LOC 2027 · Domingo</p>')
    expect(html).toContain('font-family: "Georgia", Georgia, "Times New Roman", serif; font-size: 14pt')
    expect(html).toContain('h1.print-title { font-size: 18pt')
    expect(html).toContain('@page { size: A4; margin: 48pt; }')
  })

  it('escala tamanhos relativos ao corpo, recua citações e mostra marcadores de lista', () => {
    const page = new DOMParser().parseFromString(htmlForPrint(document, { fontSizePt: 14 }), 'text/html')
    const heading = page.querySelector('h1:not(.print-title)') as HTMLElement
    expect(heading.textContent).toBe('Parte <1>')
    // Título 1 (20 pt) com corpo de 14 pt: 20 × 14 / 11.
    expect(heading.getAttribute('style')).toContain('font-size:25.4545pt')
    const bigger = [...page.querySelectorAll('span')].find((node) => node.textContent === ' maior')
    expect(bigger?.getAttribute('style')).toContain('font-size:28pt')
    expect(page.querySelector('em, span[style*="italic"]')?.textContent).toBe('itálico')
    const quote = page.querySelector('p.quote') as HTMLElement
    expect(quote.getAttribute('style')).toContain('margin-left:34pt')
    expect(quote.getAttribute('style')).toContain('margin-top:11pt')
    expect(page.querySelector('p.attribution')?.textContent).toBe('— Romanos 5:5')
    expect(
      [...page.querySelectorAll('p')].some((node) => node.textContent === '• Uma promessa para hoje'),
    ).toBe(true)
    expect(page.querySelector('a')?.getAttribute('href')).toBe('https://example.org')
  })

  it('inclui as notas no fim com as chamadas no texto', () => {
    const html = htmlForPrint(document, { includeFootnotes: true })
    expect(html).toContain('<sup class="note-ref">1</sup>')
    expect(html).toContain('<p class="print-notes-title">Notas</p>')
    expect(html).toContain('<p class="print-note"><sup>1</sup> Nota de rodapé que fica no fim.</p>')
  })

  it('omitir as notas tira também as chamadas, sem mudar o documento', () => {
    const html = htmlForPrint(document, { includeFootnotes: false })
    expect(html).not.toContain('Nota de rodapé')
    expect(html).not.toContain('note-ref')
    expect(html).toContain('O texto diz algo importante e ')
    expect(document.footnotes.length).toBe(1)
  })

  it('usa o título do documento e escapa a família da fonte', () => {
    const html = htmlForPrint({ ...document, title: 'Do documento' }, { fontFamily: 'Evil"; } body { x: y' })
    expect(html).toContain('<h1 class="print-title">Do documento</h1>')
    expect(html).not.toContain('Evil"')
  })
})
