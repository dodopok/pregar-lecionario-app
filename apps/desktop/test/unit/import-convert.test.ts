// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { parseManuscriptJSON } from '@pregar/editor/extensions'
import type { LiturgicalDay } from '@pregar/core/liturgy/types'
import {
  convertDocument,
  decodeEntities,
  decodeText,
  describeConversionError,
  expandPaths,
  formatForFile,
  htmlToDocument,
  liturgicalFieldsFor,
  mapLimit,
  markdownToDocument,
  prepareCandidate,
  sermonPatchFor,
  textToDocument,
} from '../../src/main/modules/content/import-convert'

function sequentialIds(): (kind: 'block' | 'footnote') => string {
  let block = 0
  let footnote = 0
  return (kind) => (kind === 'footnote' ? `n${++footnote}` : `b${++block}`)
}

/** Esqueleto do documento sem ids nem atributos nulos, para comparar a estrutura. */
function skeleton(node: JSONContent): unknown {
  const result: Record<string, unknown> = { type: node.type }
  if (node.text !== undefined) result.text = node.text
  if (node.marks?.length)
    result.marks = node.marks.map((mark) => (mark.attrs ? { type: mark.type, attrs: mark.attrs } : mark.type))
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([key, value]) => key !== 'id' && value !== null && value !== false,
    ),
  )
  if (Object.keys(attrs).length) result.attrs = attrs
  if (node.content?.length) result.content = node.content.map(skeleton)
  return result
}

function paragraphs(doc: JSONContent): string[] {
  return (doc.content ?? []).map((node) =>
    (node.content ?? []).map((inline) => (inline.type === 'hardBreak' ? '\n' : (inline.text ?? ''))).join(''),
  )
}

const encoder = new TextEncoder()

/** .docx mínimo (só document.xml e os relacionamentos) com parágrafos, títulos, ênfases, lista e imagem. */
async function tinyDocx(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Citacao"><w:name w:val="Citação"/></w:style>
  <w:style w:type="paragraph" w:styleId="Balao"><w:name w:val="Texto de balão"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>`,
  )
  zip.file('word/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  const run = (text: string, props = '') =>
    `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
  const paragraph = (inner: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`
  const listItem = (text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(text)}</w:p>`
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${paragraph(run('As dez virgens'), 'Heading1')}
${paragraph(run('Domingo, 12 de novembro de 2023'))}
${paragraph(run('Texto: Mateus 25:1-13'))}
${paragraph(run('O reino dos céus ') + run('será semelhante', '<w:b/>') + run(' a dez ') + run('virgens', '<w:i/><w:u w:val="single"/>') + run(' &amp; suas lâmpadas.'))}
${paragraph(run('Vigiai, pois.'), 'Citacao')}
${paragraph(run('Nota em balão'), 'Balao')}
${listItem('Cinco prudentes')}
${listItem('Cinco insensatas')}
<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Figura"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
</w:body>
</w:document>`,
  )
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

describe('texto puro', () => {
  it('separa parágrafos por linha em branco e guarda as quebras internas', () => {
    const doc = textToDocument(
      'Primeiro parágrafo.\n\nVerso um\nVerso dois\n\n\n  Terceiro.  ',
      sequentialIds(),
    )
    expect(() => parseManuscriptJSON(doc)).not.toThrow()
    expect(paragraphs(doc)).toEqual(['Primeiro parágrafo.', 'Verso um\nVerso dois', 'Terceiro.'])
    expect(doc.content?.[0]?.attrs).toEqual({ id: 'b1' })
  })

  it('sem linhas em branco (exportação do Word), cada linha é um parágrafo', () => {
    const doc = textToDocument('Um\r\nDois\r\nTrês\r\n', sequentialIds())
    expect(paragraphs(doc)).toEqual(['Um', 'Dois', 'Três'])
  })

  it('texto vazio vira um documento com um parágrafo vazio', () => {
    const doc = textToDocument('   \n\n ', sequentialIds())
    expect(skeleton(doc)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(() => parseManuscriptJSON(doc)).not.toThrow()
  })

  it('decodifica UTF-8 com BOM, UTF-16 e Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x4f, 0x6c, 0xc3, 0xa1]))).toBe('Olá')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x4f, 0x00, 0x6c, 0x00, 0xe1, 0x00]))).toBe('Olá')
    expect(decodeText(new Uint8Array([0x4f, 0x6c, 0xe1]))).toBe('Olá')
  })
})

describe('markdown', () => {
  it('mapeia títulos, citações, listas, ênfases e links', () => {
    const source = [
      '# As dez virgens',
      '',
      'Texto com **negrito**, *itálico*, ~~tachado~~ e `código`.',
      'Mesma frase continua.',
      '',
      '> Vigiai, pois.',
      '> — Mateus',
      '',
      '- Cinco prudentes',
      '- Cinco insensatas',
      '  - Sem azeite',
      '',
      '1. Primeiro',
      '2. Segundo',
      '',
      'Veja [o site](https://exemplo.org/x) e [perigo](javascript:alert(1)).',
      '',
      '![figura](imagem.png)',
      '',
      '---',
      'Fim.',
    ].join('\n')
    const { doc, warnings } = markdownToDocument(source, sequentialIds())
    expect(() => parseManuscriptJSON(doc)).not.toThrow()
    expect(skeleton(doc)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'As dez virgens' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Texto com ' },
            { type: 'text', text: 'negrito', marks: ['bold'] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'itálico', marks: ['italic'] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'tachado', marks: ['strike'] },
            { type: 'text', text: ' e código. Mesma frase continua.' },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vigiai, pois. — Mateus' }] }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cinco prudentes' }] }],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Cinco insensatas' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sem azeite' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primeiro' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Segundo' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Veja ' },
            {
              type: 'text',
              text: 'o site',
              marks: [{ type: 'link', attrs: { href: 'https://exemplo.org/x' } }],
            },
            { type: 'text', text: ' e perigo.' },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Fim.' }] },
      ],
    })
    expect(warnings).toEqual(['1 imagem ficou de fora (o editor não guarda imagens).'])
  })

  it('reconhece títulos sublinhados, linhas de atribuição e deixa asteriscos soltos em paz', () => {
    const { doc } = markdownToDocument(
      'Título\n=====\n\n> Citação\n>\n> — Autor\n\n5 * 3 = 15 e a_b_c',
      sequentialIds(),
    )
    expect(() => parseManuscriptJSON(doc)).not.toThrow()
    const [heading, quote, paragraph] = doc.content ?? []
    expect(heading?.type).toBe('heading')
    expect(heading?.attrs?.level).toBe(1)
    expect(quote?.content?.map((node) => node.attrs?.attribution === true)).toEqual([false, true])
    expect(paragraph?.content?.[0]?.text).toBe('5 * 3 = 15 e a_b_c')
  })
})

describe('HTML do Word', () => {
  it('converte o HTML do mammoth sem DOM, com marcas, listas aninhadas, citações e quebras', () => {
    const html =
      '<h1>Título</h1><p>Um <strong>forte</strong>, <em>leve</em>, <u>sub</u>, <s>fora</s>, x<sup>2</sup> &amp; &quot;aspas&quot;.<br />Linha dois</p>' +
      '<ul><li>Um<ul><li>Dentro</li></ul></li><li>Dois</li></ul><ol start="3"><li>Três</li></ol>' +
      '<blockquote><p>Citação</p><p>— Autor</p></blockquote>' +
      '<table><tr><td><p>Célula A</p></td><td><p>Célula B</p></td></tr></table>' +
      '<p><a href="https://exemplo.org/">link</a> e <a href="#footnote-1">[1]</a><img src="" /></p>' +
      '<ol><li id="footnote-1"><p>Nota <a href="#footnote-ref-1">↑</a></p></li></ol>'
    const { doc, warnings } = htmlToDocument(html, sequentialIds())
    expect(() => parseManuscriptJSON(doc)).not.toThrow()
    expect(skeleton(doc)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Um ' },
            { type: 'text', text: 'forte', marks: ['bold'] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'leve', marks: ['italic'] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'sub', marks: ['underline'] },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'fora', marks: ['strike'] },
            { type: 'text', text: ', x' },
            { type: 'text', text: '2', marks: ['superscript'] },
            { type: 'text', text: ' & "aspas".' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Linha dois' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Um' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dentro' }] }],
                    },
                  ],
                },
              ],
            },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dois' }] }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Três' }] }] },
          ],
        },
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Citação' }] },
            { type: 'paragraph', attrs: { attribution: true }, content: [{ type: 'text', text: '— Autor' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Célula A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Célula B' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://exemplo.org/' } }],
            },
            { type: 'text', text: ' e [1]' },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nota ↑' }] }],
            },
          ],
        },
      ],
    })
    expect(warnings).toEqual([
      '1 imagem ficou de fora (o editor não guarda imagens).',
      '1 tabela virou parágrafos.',
      'As notas de rodapé viraram uma lista numerada no fim do texto.',
    ])
  })

  it('decodifica entidades e ignora marcação sem texto', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&#39;&#x41;&#66;&nbsp;&bogus;')).toBe('&<>"\'AB &bogus;')
    const { doc } = htmlToDocument('<p>  </p><div></div>', sequentialIds())
    expect(skeleton(doc)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })
})

describe('.docx com mammoth', () => {
  it('lê títulos, ênfases, citações por estilo, listas e avisa sobre imagens e estilos desconhecidos', async () => {
    const result = await convertDocument('docx', await tinyDocx(), { generateId: sequentialIds() })
    expect(() => parseManuscriptJSON(result.doc)).not.toThrow()
    expect(result.plainText.split('\n')).toEqual([
      'As dez virgens',
      'Domingo, 12 de novembro de 2023',
      'Texto: Mateus 25:1-13',
      'O reino dos céus será semelhante a dez virgens & suas lâmpadas.',
      'Vigiai, pois.',
      'Nota em balão',
      '• Cinco prudentes',
      '• Cinco insensatas',
    ])
    const content = result.doc.content ?? []
    expect(content[0]?.type).toBe('heading')
    expect(content[3]?.content?.map((node) => node.marks?.map((mark) => mark.type) ?? [])).toEqual([
      [],
      ['bold'],
      [],
      ['italic', 'underline'],
      [],
    ])
    expect(content[4]?.type).toBe('blockquote')
    expect(content[6]?.type).toBe('bulletList')
    expect(result.wordCount).toBe(33)
    expect(result.warnings).toEqual([
      '1 imagem ficou de fora (o editor não guarda imagens).',
      'Estilos do Word não reconhecidos viraram texto comum: Texto de balão.',
    ])
  })

  it('explica um .docx inválido em português', async () => {
    await expect(convertDocument('docx', encoder.encode('isto não é um zip'))).rejects.toThrow()
    expect(describeConversionError(new Error("Can't find end of central directory"), 'docx')).toMatch(
      /não é um \.docx válido/,
    )
    expect(describeConversionError(new Error('x'), 'rtf')).toBe(
      'Não foi possível converter este arquivo .rtf.',
    )
  })
})

describe('.rtf pelo conversor do editor', () => {
  it('converte parágrafos e negrito', async () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard Primeiro par\\'e1grafo.\\par\\pard {\\b Negrito} depois.\\par}"
    const result = await convertDocument('rtf', encoder.encode(rtf), { generateId: sequentialIds() })
    expect(() => parseManuscriptJSON(result.doc)).not.toThrow()
    expect(result.plainText).toBe('Primeiro parágrafo.\nNegrito depois.')
    expect(result.wordCount).toBe(4)
  })
})

describe('arquivos e pastas', () => {
  it('reconhece os formatos pela extensão, sem diferenciar maiúsculas', () => {
    expect(formatForFile('Sermão.DOCX')).toBe('docx')
    expect(formatForFile('a.rtf')).toBe('rtf')
    expect(formatForFile('a.txt')).toBe('txt')
    expect(formatForFile('a.md')).toBe('md')
    expect(formatForFile('a.doc')).toBeNull()
    expect(formatForFile('semextensao')).toBeNull()
  })

  it('percorre pastas até três níveis, ignora ocultos e respeita o limite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pregar-import-'))
    mkdirSync(join(root, 'a', 'b', 'c', 'd'), { recursive: true })
    mkdirSync(join(root, '.oculta'))
    writeFileSync(join(root, 'raiz.docx'), '')
    writeFileSync(join(root, 'ignorado.pdf'), '')
    writeFileSync(join(root, '.oculto.txt'), '')
    writeFileSync(join(root, '.oculta', 'x.txt'), '')
    writeFileSync(join(root, 'a', 'n1.txt'), '')
    writeFileSync(join(root, 'a', 'b', 'n2.md'), '')
    writeFileSync(join(root, 'a', 'b', 'c', 'n3.rtf'), '')
    writeFileSync(join(root, 'a', 'b', 'c', 'd', 'n4.txt'), '')
    const expanded = await expandPaths([root, join(root, 'ignorado.pdf')])
    expect(expanded.files.map((file) => file.slice(root.length + 1))).toEqual([
      'raiz.docx',
      'a/n1.txt',
      'a/b/n2.md',
      'a/b/c/n3.rtf',
      'ignorado.pdf',
    ])
    expect(expanded.truncated).toBe(false)
    const limited = await expandPaths([root], { limit: 2 })
    expect(limited.files).toHaveLength(2)
    expect(limited.truncated).toBe(true)
    const missing = await expandPaths([join(root, 'nao-existe.txt')])
    expect(missing).toEqual({ files: [], truncated: false })
  })

  it('prepara candidatos com metadados e transforma falhas em candidatos com erro', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pregar-import-'))
    const good = join(root, '2023-11-12 As dez virgens.txt')
    writeFileSync(good, 'Texto: Mateus 25:1-13\n\nO reino dos céus será semelhante a dez virgens.\n', 'utf8')
    const now = new Date(2026, 10, 3)
    const prepared = await prepareCandidate(good, 'id-1', { now, generateId: sequentialIds() })
    expect(prepared.candidate).toMatchObject({
      id: 'id-1',
      fileName: '2023-11-12 As dez virgens.txt',
      format: 'txt',
      detected: {
        dateKey: '2023-11-12',
        reference: 'Mateus 25:1-13',
        title: 'As dez virgens',
        confidence: { date: 'filename', reference: 'text' },
      },
      wordCount: 13,
      warnings: [],
      error: null,
    })
    expect(prepared.plainText).toContain('dez virgens')

    const undated = join(root, 'sem-data.txt')
    writeFileSync(undated, 'Só texto.', 'utf8')
    const withoutDate = await prepareCandidate(undated, 'id-2', { now })
    expect(withoutDate.candidate.warnings).toEqual([
      'Sem data no nome do arquivo nem nas primeiras linhas: informe a data.',
    ])
    expect(withoutDate.candidate.detected.title).toBe('sem data')

    const empty = join(root, 'vazio 12-11-2023.md')
    writeFileSync(empty, '\n\n', 'utf8')
    const emptyCandidate = await prepareCandidate(empty, 'id-3', { now })
    expect(emptyCandidate.candidate.error).toBe('O arquivo não tem texto legível.')
    expect(emptyCandidate.candidate.detected.dateKey).toBe('2023-11-12')
    expect(emptyCandidate.doc).toBeNull()

    const big = join(root, 'grande.txt')
    writeFileSync(big, 'x'.repeat(64), 'utf8')
    expect((await prepareCandidate(big, 'id-4', { now, maxBytes: 32 })).candidate.error).toMatch(
      /maior que 5 MB/,
    )

    const wrong = join(root, 'antigo.doc')
    writeFileSync(wrong, 'x', 'utf8')
    expect((await prepareCandidate(wrong, 'id-5', { now })).candidate.error).toBe(
      'Formato não aceito: use .docx, .rtf, .txt ou .md.',
    )
    expect((await prepareCandidate(join(root, 'nada.txt'), 'id-6', { now })).candidate.error).toBe(
      'O arquivo não pôde ser lido.',
    )
  })
})

describe('gravação', () => {
  const day: LiturgicalDay = {
    date: '2023-11-12',
    sundayName: 'Próprio 27',
    season: { name: 'Tempo Comum' },
    celebration: { name: 'Vigésimo Quarto Domingo depois de Pentecostes' },
    readings: [
      { slot: 'first_reading', reference: 'Amós 5:18-24' },
      { slot: 'gospel', reference: 'Mateus 25:1-13' },
    ],
  }

  it('preenche os campos litúrgicos e adota a leitura do dia quando a passagem coincide', () => {
    expect(liturgicalFieldsFor(day, 'Mt 25.1-13', 'loc_2027')).toEqual({
      liturgicalOccasion: 'Próprio 27',
      liturgicalCelebration: 'Vigésimo Quarto Domingo depois de Pentecostes',
      liturgicalSeason: 'Tempo Comum',
      prayerBookId: 'loc_2027',
      mainReadingReference: 'Mateus 25:1-13',
      mainReadingSlot: 'gospel',
    })
    expect(liturgicalFieldsFor(day, 'Mateus 25:1-5', 'loc_2027')).toMatchObject({
      mainReadingReference: 'Mateus 25:1-5',
      mainReadingSlot: null,
    })
    expect(liturgicalFieldsFor(null, 'Mateus 25:1-13', 'loc_2027')).toEqual({
      liturgicalOccasion: null,
      liturgicalCelebration: null,
      liturgicalSeason: null,
      prayerBookId: null,
      mainReadingReference: 'Mateus 25:1-13',
      mainReadingSlot: null,
    })
  })

  it('monta o patch completo da preparação', () => {
    const doc = textToDocument('Olá mundo', sequentialIds())
    const patch = sermonPatchFor(
      { candidate: {} as never, doc, plainText: 'Olá mundo', wordCount: 2 },
      'Título',
      liturgicalFieldsFor(null, null, null),
    )
    expect(patch).toEqual({
      title: 'Título',
      doc: JSON.stringify(doc),
      plainText: 'Olá mundo',
      wordCount: 2,
      liturgicalOccasion: null,
      liturgicalCelebration: null,
      liturgicalSeason: null,
      prayerBookId: null,
      mainReadingReference: null,
      mainReadingSlot: null,
      tabletPdfPath: null,
      tabletPdfUpdatedAt: null,
    })
  })

  it('mapLimit preserva a ordem e limita o paralelismo', async () => {
    let active = 0
    let peak = 0
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return value * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})
