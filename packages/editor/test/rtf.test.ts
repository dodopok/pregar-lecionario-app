import { afterEach, describe, expect, it } from 'vitest'
import type { Editor, JSONContent } from '@tiptap/core'
import { fontInfo, manuscriptPlainText, parseManuscriptJSON, parseRtf, rtfToTiptap, toRichDocument } from '../src'
import { compact, createEditor, sequentialIds } from './helpers'
import { body, cocoaRtf, type FixtureDocument } from './rtfFixtures'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const QUOTE_INK: [number, number, number] = [44, 82, 62]
const QUOTE_PAPER: [number, number, number] = [232, 240, 232]

function convert(document: FixtureDocument | string): JSONContent {
  const rtf = typeof document === 'string' ? document : cocoaRtf(document)
  const json = rtfToTiptap(rtf, { generateId: sequentialIds() })
  // Todo resultado precisa ser válido no esquema e carregável no editor.
  expect(() => parseManuscriptJSON(json)).not.toThrow()
  return json
}

describe('parseRtf', () => {
  it('lê fontes, cores, parágrafos e o comprimento UTF-16 como o NSAttributedString', () => {
    const parsed = parseRtf(cocoaRtf({ fonts: ['ArialMT', 'Arial-BoldMT'], colors: [[18, 52, 86]], paragraphs: [body('😀 Um'), body('Dois', { font: 1, bold: true, color: 3 })] }))
    expect(parsed.fonts.get(1)).toBe('Arial-BoldMT')
    expect(parsed.colors).toEqual([null, '#ffffff', '#000000', '#123456'])
    expect(parsed.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))).toEqual(['😀 Um', 'Dois'])
    expect(parsed.paragraphs.map((paragraph) => paragraph.start)).toEqual([0, 6])
    expect(parsed.length).toBe('😀 Um\nDois'.length)
    expect(parsed.paragraphs[1]?.runs[0]?.format).toMatchObject({ bold: true, font: 1, color: 3, fontSize: 22 })
  })

  it('converte nomes PostScript em família e traços', () => {
    expect(fontInfo('ArialMT')).toEqual({ family: 'Arial', bold: false, italic: false })
    expect(fontInfo('Arial-BoldItalicMT')).toEqual({ family: 'Arial', bold: true, italic: true })
    expect(fontInfo('TimesNewRomanPS-ItalicMT')).toEqual({ family: 'Times New Roman', bold: false, italic: true })
    expect(fontInfo('Helvetica-Oblique')).toEqual({ family: 'Helvetica', bold: false, italic: true })
    expect(fontInfo('PalatinoLinotype-Bold')).toEqual({ family: 'Palatino Linotype', bold: true, italic: false })
    expect(fontInfo('AvenirNext-Regular').family).toBe('Avenir Next')
    expect(fontInfo('.SFNS-Regular').family).toBeNull()
    expect(fontInfo('Times New Roman').family).toBe('Times New Roman')
  })
})

describe('rtfToTiptap: estilos semânticos de DocumentRTF', () => {
  it('títulos guardados nas palavras-chave conservam alinhamento independente e Unicode; negrito no corpo não é título', () => {
    const json = convert({
      fonts: ['ArialMT', '.SFNS-Bold'],
      paragraphs: [
        body('😀 Primeiro', { size: 20 }, { align: 'qc', sb: 16, sa: 6 }),
        body('Segundo', { size: 20 }, { align: 'ql', sb: 16, sa: 6 }),
        body('Corpo em negrito.', { font: 1, bold: true, size: 16 }),
      ],
      styles: [
        { paragraphs: [0, 1], style: 'heading1' },
        { paragraphs: [2, 2], style: 'normal' },
      ],
      extraKeywords: 'Sermão, ',
    })
    expect(compact(json)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: '😀 Primeiro' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Segundo' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Corpo em negrito.', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '16pt' } }] }],
        },
      ],
    })
  })

  it('título, subtítulo e títulos 2 a 6 com tamanhos e espaçamentos do Swift', () => {
    const json = convert({
      colors: [[102, 102, 102]],
      paragraphs: [
        body('Título do sermão', { size: 26 }, { sa: 6 }),
        body('Subtítulo', { size: 15, color: 3 }, { sa: 6 }),
        body('Seção', { size: 14 }, { sb: 16, sa: 6 }),
        body('Texto', {}, {}),
      ],
      styles: [
        { paragraphs: [0, 0], style: 'title' },
        { paragraphs: [1, 1], style: 'subtitle' },
        { paragraphs: [2, 2], style: 'heading3' },
      ],
    })
    const document = toRichDocument(json)
    expect(document.paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([1, 0, 3, 0])
    expect(document.paragraphs[0]?.runs[0]?.fontSizePt).toBe(26)
    expect(document.paragraphs[1]?.runs[0]).toMatchObject({ fontSizePt: 15, color: '#666666' })
    expect(document.paragraphs[2]?.runs[0]?.fontSizePt).toBeUndefined()
    expect(document.paragraphs[2]?.spaceBeforePt).toBeUndefined()
    expect(document.paragraphs[3]?.headingLevel).toBe(0)
  })

  it('ignora metadados inválidos, fora do intervalo ou de estilo desconhecido', () => {
    const invalid = btoa(JSON.stringify([{ length: 500, location: 0, style: 'heading1' }, { length: 3, location: 0, style: 'sidebar' }]))
    const json = convert({ paragraphs: [body('Texto', { size: 16, bold: true })], rawKeywords: `PregarDocumentStyles.v1:${invalid}` })
    expect(toRichDocument(json).paragraphs[0]?.headingLevel).toBe(2)
    const garbage = convert({ paragraphs: [body('Texto')], rawKeywords: 'PregarDocumentStyles.v1:@@@' })
    expect(toRichDocument(garbage).paragraphs[0]?.headingLevel).toBe(0)
  })
})

describe('rtfToTiptap: representações antigas (porta do teste de poema, citação, lista e nota)', () => {
  const legacy: FixtureDocument = {
    fonts: ['ArialMT', 'Arial-BoldMT', 'Arial-ItalicMT', '.SFNS-Regular'],
    colors: [QUOTE_INK, QUOTE_PAPER],
    paragraphs: [
      body('Mensagem', { font: 1, bold: true, size: 14 }, { sb: 14, sa: 4 }),
      body('', { size: 10 }),
      body('Poema:', { size: 10 }),
      body('Na noite, uma janela;', { size: 10 }),
      body('o silêncio aprende a escutar.', { size: 10 }),
      body('', { size: 10 }),
      body('A manhã responde.', { size: 10 }),
      body('', { size: 10 }),
      { runs: [{ text: 'Cito ', size: 10 }, { text: '“A esperança não decepciona.”', size: 10, font: 2, italic: true }] },
      body('', { size: 10 }),
      body('O amor de Deus foi derramado em nossos corações.', { size: 10, color: 3, background: 4 }, { li: 34, ri: 12, sb: 11, sa: 12 }),
      body('— Romanos 5:5', { size: 10, color: 3, background: 4 }, { li: 34, ri: 12, sb: 11, sa: 12 }),
      body('', { size: 10 }),
      body('Lista', { size: 10 }),
      body('• Uma promessa para hoje', { size: 10 }),
      body('', { size: 10 }),
      { runs: [{ text: 'Texto com nota', size: 10 }, { text: '¹', font: 3, size: 8, up: 4 }, { text: '.', size: 10 }] },
      body('', { font: 3, size: 10 }),
      body('¹ Referência: Romanos 5:5.', { font: 3, size: 10 }),
    ],
  }

  it('título = negrito ≥ 13 pt, citação = recuo de 34 pt, lista = "• ", nota = sobrescrito + área de notas', () => {
    const json = convert(legacy)
    const types = json.content?.map((node) => node.type)
    expect(types).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'blockquote',
      'paragraph',
      'paragraph',
      'bulletList',
      'paragraph',
      'paragraph',
    ])
    expect(manuscriptPlainText(json)).toBe(
      [
        'Mensagem',
        '',
        'Poema:',
        'Na noite, uma janela;',
        'o silêncio aprende a escutar.',
        '',
        'A manhã responde.',
        '',
        'Cito “A esperança não decepciona.”',
        '',
        'O amor de Deus foi derramado em nossos corações.',
        '— Romanos 5:5',
        '',
        'Lista',
        '• Uma promessa para hoje',
        '',
        'Texto com nota1.',
      ].join('\n'),
    )
    const document = toRichDocument(json)
    expect(document.paragraphs[0]).toMatchObject({ headingLevel: 2, runs: [{ text: 'Mensagem', bold: true, fontSizePt: 14 }] })
    expect(document.paragraphs[0]?.spaceBeforePt).toBeUndefined()
    expect(document.paragraphs[2]?.runs[0]).toEqual({ text: 'Poema:', fontSizePt: 10 })
    expect(document.paragraphs[8]?.runs[1]).toMatchObject({ text: '“A esperança não decepciona.”', italic: true })
    const quoted = document.paragraphs.filter((paragraph) => paragraph.quote)
    expect(quoted.map((paragraph) => [paragraph.attribution === true, paragraph.indentStartPt, paragraph.spaceBeforePt])).toEqual([
      [false, undefined, undefined],
      [true, undefined, undefined],
    ])
    expect(quoted.flatMap((paragraph) => paragraph.runs).every((run) => !run.color && !run.highlight)).toBe(true)
    expect(document.paragraphs.find((paragraph) => paragraph.list)?.runs[0]?.text).toBe('Uma promessa para hoje')
    expect(document.footnotes).toEqual([{ number: 1, runs: [{ text: 'Referência: Romanos 5:5.' }] }])
  })

  it('o resultado abre no editor e segue editável', () => {
    editor = createEditor(convert(legacy))
    expect(manuscriptPlainText(editor.getJSON()).startsWith('Mensagem\n')).toBe(true)
    expect(editor.view.dom.querySelector('sup[data-footnote]')?.getAttribute('data-footnote-number')).toBe('1')
  })

  it('notas com dois dígitos e números antigos com \\super também viram notas', () => {
    const json = convert({
      fonts: ['ArialMT'],
      paragraphs: [
        { runs: [{ text: 'O texto diz algo' }, { text: '¹⁰', up: 4 }, { text: '. E m² fica.' }] },
        { runs: [{ text: 'Antigo' }, { text: '2', up: 4 }, { text: '.' }] },
        body(''),
        body('¹⁰ Nota de rodapé dez.'),
        body(''),
        body('2 Nota antiga.'),
      ],
    })
    expect(manuscriptPlainText(json)).toBe('O texto diz algo1. E m² fica.\nAntigo2.')
    expect(toRichDocument(json).footnotes.map((note) => note.runs[0]?.text)).toEqual(['Nota de rodapé dez.', 'Nota antiga.'])
  })

  it('número no início de parágrafo sem chamada anterior continua texto', () => {
    const json = convert({ paragraphs: [body('3 pontos para lembrar'), body('¹ sem chamada')] })
    expect(manuscriptPlainText(json)).toBe('3 pontos para lembrar\n¹ sem chamada')
    expect(toRichDocument(json).footnotes).toEqual([])
  })
})

describe('rtfToTiptap: caracteres, parágrafos e listas', () => {
  it('links, sublinhado, tachado, sobrescrito, cores, realce e tamanho fracionário', () => {
    const json = convert({
      fonts: ['ArialMT', 'TimesNewRomanPSMT'],
      colors: [[18, 52, 86], [255, 255, 0]],
      paragraphs: [
        {
          runs: [
            { text: 'Veja ' },
            { text: 'a fonte', link: 'https://example.org/?a=1&b=2', underline: true, strike: true },
            { text: ' e ' },
            { text: 'não isto', link: 'javascript:alert(1)' },
            { text: ' com ' },
            { text: 'cor', color: 3, background: 4, font: 1, size: 12.5 },
            { text: ' e ' },
            { text: 'H' },
            { text: '2', up: -3 },
            { text: 'O' },
            { text: ' branco', background: 1 },
          ],
        },
      ],
    })
    const runs = toRichDocument(json).paragraphs[0]?.runs
    expect(runs).toEqual([
      { text: 'Veja ' },
      { text: 'a fonte', underline: true, strike: true, link: 'https://example.org/?a=1&b=2' },
      { text: ' e não isto com ' },
      { text: 'cor', color: '#123456', highlight: '#ffff00', fontFamily: 'Times New Roman', fontSizePt: 12.5 },
      { text: ' e H' },
      { text: '2', subscript: true },
      { text: 'O branco' },
    ])
  })

  it('recuos, espaçamento, entrelinha e alinhamento', () => {
    const json = convert({ paragraphs: [body('Texto', {}, { li: 36, fi: 18, sb: 6, sa: 12, lineHeight: 1.3, align: 'qj' }), body('Padrão')] })
    const [first, second] = toRichDocument(json).paragraphs
    expect(first).toMatchObject({ alignment: 'justify', indentStartPt: 36, indentFirstLinePt: 54, spaceBeforePt: 6, spaceAfterPt: 12, lineHeight: 1.3 })
    expect(second).toEqual({ id: second?.id, headingLevel: 0, runs: [{ text: 'Padrão' }] })
  })

  it('listas numeradas, de verificação e listas nativas do Cocoa', () => {
    const json = convert({
      paragraphs: [
        body('3. Três'),
        body('4. Quatro'),
        body('☐ Pendente'),
        body('☑ Feito'),
        { runs: [{ text: 'Nativo' }], raw: '{\\listtext\t\\uc0\\u8226 \t}' },
      ],
    })
    expect(compact(json).content?.map((node) => [node.type, node.attrs?.start])).toEqual([
      ['orderedList', 3],
      ['taskList', undefined],
      ['bulletList', undefined],
    ])
    expect(manuscriptPlainText(json)).toBe('3. Três\n4. Quatro\n☐ Pendente\n☑ Feito\n• Nativo')
  })

  it('escapes, Unicode, cp1252, quebras de linha e tabulação', () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fswiss ArialMT;}\\f0\\fs22 B\\\'eanç\\\'e3o, a\\\'e7\\\'e3o \\{chaves\\} \\\\ barra\\tab tab\\emdash fim' +
      '\\line verso\\uc0\\u8232 outro \\uc0\\u55357 \\u56832  \\u-3851 ?\\\n' +
      '{\\*\\unknowndest ignorado}{\\uc1 Caf\\u233\\\'e9 com leite}\\par}'
    const json = convert(rtf)
    expect(manuscriptPlainText(json)).toBe('Bênção, ação {chaves} \\ barra\ttab—fim\nverso\noutro 😀 \uf0f5?\nCafé com leite')
    expect(json.content?.[0]?.content?.filter((node) => node.type === 'hardBreak').length).toBe(2)
  })

  it('nota nativa do RTF (\\footnote) vira nota do editor', () => {
    const json = convert('{\\rtf1\\ansi Texto{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} Nota do Word.}\\par}')
    expect(toRichDocument(json).footnotes).toEqual([{ number: 1, runs: [{ text: 'Nota do Word.' }] }])
    expect(manuscriptPlainText(json)).toBe('Texto1')
  })

  it('documento vazio vira um parágrafo vazio', () => {
    expect(compact(convert('{\\rtf1\\ansi }'))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('aceita bytes e um parágrafo final terminado em \\par', () => {
    const rtf = cocoaRtf({ paragraphs: [body('Um'), body('Dois')], trailingNewline: true })
    const json = rtfToTiptap(new TextEncoder().encode(rtf))
    expect(manuscriptPlainText(json)).toBe('Um\nDois')
    expect(json.content?.every((node) => typeof node.attrs?.id === 'string')).toBe(true)
  })
})
