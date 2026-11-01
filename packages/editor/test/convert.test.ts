import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { documentPlainText } from '@pregar/core/document/model'
import { blockAnchors, findTextRange, manuscriptPlainText, normalizeQuoteText, parseManuscriptJSON, toRichDocument } from '../src'

const text = (value: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const paragraph = (content: JSONContent[], attrs: Record<string, unknown> = {}): JSONContent => ({ type: 'paragraph', attrs, content })

const sample: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { id: 'h', level: 2, textAlign: 'center' }, content: [text('Mensagem')] },
    paragraph(
      [
        text('Cito '),
        text('forte', [{ type: 'bold' }, { type: 'italic' }]),
        text(' e '),
        text('ligado', [{ type: 'link', attrs: { href: 'https://example.org' } }]),
        text(' mau', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        { type: 'footnote', attrs: { id: 'n1', note: 'Romanos 5:5' } },
        text('.'),
      ],
      { id: 'p1', indentStart: 10, indentFirstLine: 30, spaceBefore: 6, spaceAfter: 8, lineHeight: 1.5 },
    ),
    {
      type: 'blockquote',
      attrs: { id: 'q' },
      content: [
        paragraph([text('Na noite,'), { type: 'hardBreak' }, text('uma janela.')], { id: 'q1' }),
        paragraph([text('— Autor')], { id: 'q2', attribution: true }),
      ],
    },
    {
      type: 'orderedList',
      attrs: { id: 'ol', start: 3 },
      content: [
        { type: 'listItem', content: [paragraph([text('Três')], { id: 'l1' })] },
        {
          type: 'listItem',
          content: [
            paragraph([text('Quatro')], { id: 'l2' }),
            { type: 'bulletList', attrs: { id: 'ul' }, content: [{ type: 'listItem', content: [paragraph([text('Sub')], { id: 'l3' })] }] },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      attrs: { id: 'tl' },
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [paragraph([text('Feito')], { id: 't1' })] },
        { type: 'taskItem', attrs: { checked: false }, content: [paragraph([text('A fazer')], { id: 't2' })] },
      ],
    },
    paragraph(
      [
        text('Cor', [{ type: 'textStyle', attrs: { color: 'rgb(18, 52, 86)', fontFamily: '"Times New Roman", serif', fontSize: '16px' } }]),
        text('realce', [{ type: 'highlight', attrs: { color: '#FFFF00' } }]),
        text('2', [{ type: 'superscript' }]),
        text('2', [{ type: 'subscript' }]),
      ],
      { id: 'p2' },
    ),
    { type: 'paragraph', attrs: { id: 'empty' } },
    paragraph([text('Segunda'), { type: 'footnote', attrs: { id: 'n2', note: '' } }], { id: 'p3' }),
  ],
}

describe('toRichDocument', () => {
  const document = toRichDocument(sample, { title: 'Sermão' })

  it('é um JSON válido no esquema do manuscrito', () => {
    expect(() => parseManuscriptJSON(sample)).not.toThrow()
  })

  it('converte títulos, alinhamento, recuos, espaçamento e entrelinha', () => {
    expect(document.title).toBe('Sermão')
    expect(document.paragraphs[0]).toMatchObject({ id: 'h', headingLevel: 2, alignment: 'center', runs: [{ text: 'Mensagem' }] })
    expect(document.paragraphs[1]).toMatchObject({ id: 'p1', headingLevel: 0, indentStartPt: 10, indentFirstLinePt: 30, spaceBeforePt: 6, spaceAfterPt: 8, lineHeight: 1.5 })
  })

  it('converte marcas e só aceita links seguros; numera notas na ordem', () => {
    const runs = document.paragraphs[1]?.runs
    expect(runs).toEqual([
      { text: 'Cito ' },
      { text: 'forte', bold: true, italic: true },
      { text: ' e ' },
      { text: 'ligado', link: 'https://example.org' },
      { text: ' mau' },
      { text: '1', superscript: true, footnote: 1 },
      { text: '.' },
    ])
    expect(document.footnotes).toEqual([
      { number: 1, runs: [{ text: 'Romanos 5:5' }] },
      { number: 2, runs: [] },
    ])
    expect(document.paragraphs.at(-1)?.runs.at(-1)).toMatchObject({ footnote: 2 })
  })

  it('converte cores, família, tamanho em pt, realce, sobrescrito e subscrito', () => {
    expect(document.paragraphs.find((candidate) => candidate.id === 'p2')?.runs).toEqual([
      { text: 'Cor', color: '#123456', fontFamily: 'Times New Roman', fontSizePt: 12 },
      { text: 'realce', highlight: '#ffff00' },
      { text: '2', superscript: true },
      { text: '2', subscript: true },
    ])
  })

  it('marca citação, atribuição e quebras de linha', () => {
    const [verse, attribution] = document.paragraphs.filter((candidate) => candidate.quote)
    expect(verse?.runs).toEqual([{ text: 'Na noite,' }, { text: '\n', hardBreak: true }, { text: 'uma janela.' }])
    expect(verse?.attribution).toBeUndefined()
    expect(attribution).toMatchObject({ id: 'q2', quote: true, attribution: true })
  })

  it('dá ordinal, nível e marcação às listas', () => {
    const lists = document.paragraphs.filter((candidate) => candidate.list).map((candidate) => [candidate.id, candidate.list])
    expect(lists).toEqual([
      ['l1', { kind: 'ordered', level: 0, ordinal: 3 }],
      ['l2', { kind: 'ordered', level: 0, ordinal: 4 }],
      ['l3', { kind: 'bullet', level: 1 }],
      ['t1', { kind: 'check', level: 0, checked: true }],
      ['t2', { kind: 'check', level: 0, checked: false }],
    ])
  })
})

describe('texto corrido e âncoras', () => {
  const expected = [
    'Mensagem',
    'Cito forte e ligado mau1.',
    'Na noite,\numa janela.',
    '— Autor',
    '3. Três',
    '4. Quatro',
    '• Sub',
    '☑ Feito',
    '☐ A fazer',
    'Cor realce22'.replace(' ', ''),
    '',
    'Segunda2',
  ].join('\n')

  it('manuscriptPlainText é o documentPlainText do modelo neutro', () => {
    expect(manuscriptPlainText(sample)).toBe(expected)
    expect(manuscriptPlainText(sample)).toBe(documentPlainText(toRichDocument(sample)))
    expect(manuscriptPlainText(sample, { includeFootnotes: true })).toBe(`${expected}\n\nNotas\n1. Romanos 5:5\n2. `)
  })

  it('cada âncora aponta para o texto do parágrafo dentro do texto corrido', () => {
    const plain = manuscriptPlainText(sample)
    const anchors = blockAnchors(sample)
    expect(anchors.map((anchor) => anchor.id)).toEqual(['h', 'p1', 'q1', 'q2', 'l1', 'l2', 'l3', 't1', 't2', 'p2', 'empty', 'p3'])
    for (const anchor of anchors) expect(plain.slice(anchor.start, anchor.end)).toBe(anchor.text)
    expect(anchors.find((anchor) => anchor.id === 'l1')?.text).toBe('Três')
  })
})

describe('findTextRange', () => {
  const doc = parseManuscriptJSON(sample)
  const between = (range: { from: number; to: number } | null) =>
    range ? doc.textBetween(range.from, range.to, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : '¹')) : null

  it('acha o trecho literal e devolve posições do ProseMirror', () => {
    expect(between(findTextRange(doc, 'forte e ligado'))).toBe('forte e ligado')
    expect(between(findTextRange(sample, 'Mensagem'))).toBe('Mensagem')
  })

  it('tolera espaços em sequência, quebras de linha e quebras entre parágrafos', () => {
    expect(between(findTextRange(doc, 'Na noite,   uma janela.'))).toBe('Na noite,\numa janela.')
    expect(between(findTextRange(doc, 'uma janela. — Autor'))).toBe('uma janela.\n— Autor')
  })

  it('tolera aspas tipográficas, maiúsculas e NFD', () => {
    const quoted = parseManuscriptJSON({ type: 'doc', content: [paragraph([text('Ele disse: “A esperança não decepciona.”')])] })
    expect(normalizeQuoteText('“A  esperança”')).toBe('"A esperança"')
    expect(quoted.textBetween(findTextRange(quoted, '"A esperança não decepciona."')?.from ?? 0, findTextRange(quoted, '"A esperança não decepciona."')?.to ?? 0)).toBe(
      '“A esperança não decepciona.”',
    )
    expect(findTextRange(quoted, 'ele DISSE')).not.toBeNull()
    expect(findTextRange(quoted, 'esperança')).not.toBeNull()
  })

  it('aceita marcadores de lista e números de nota citados, mas seleciona só o texto', () => {
    expect(between(findTextRange(doc, '3. Três'))).toBe('Três')
    expect(between(findTextRange(doc, 'mau1.'))).toBe('mau¹.')
  })

  it('devolve null para trecho ausente ou vazio', () => {
    expect(findTextRange(doc, 'inexistente')).toBeNull()
    expect(findTextRange(doc, '   ')).toBeNull()
  })
})
