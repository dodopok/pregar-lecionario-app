import { describe, expect, it } from 'vitest'
import { GoogleDriveAPI } from '../../src/drive/api'
import {
  DOCS_QUOTE_BACKGROUND_COLOR,
  DOCS_QUOTE_FOREGROUND_COLOR,
  googleDocsBatchUpdateBody,
  googleDocsContentFromDocument,
  googleDocsContentHash,
  googleDocsParagraphRun,
  googleDocsStyleRun,
  plainTextFromDocsContent,
  docsRGBColorFromHex,
  sanitizeDocsText,
} from '../../src/drive/docs-content'
import type { GoogleDocsContent, GoogleDocsRequest, GoogleDocsStyleRun } from '../../src/drive/docs-content'
import type { RichDocument, RichParagraph } from '../../src/document/model'

type Json = Record<string, unknown>

function requestsOf(body: { requests: GoogleDocsRequest[] }, kind: string): Json[] {
  return body.requests.filter((request) => kind in request).map((request) => request[kind] as Json)
}

function doc(paragraphs: RichParagraph[], footnotes: RichDocument['footnotes'] = []): RichDocument {
  return { paragraphs, footnotes }
}

function paragraph(text: string, extra: Partial<RichParagraph> = {}): RichParagraph {
  return { headingLevel: 0, runs: [{ text }], ...extra }
}

function styleAt(content: GoogleDocsContent, location: number): GoogleDocsStyleRun | undefined {
  return content.styles.find(
    (style) => style.range.location <= location && location < style.range.location + style.range.length,
  )
}

describe('conversão do manuscrito para o Google Docs', () => {
  it('preserva texto, título, negrito e o bloco de citação com cores e espaçamento', () => {
    const content = googleDocsContentFromDocument(
      doc([
        { headingLevel: 2, runs: [{ text: 'Sermão', bold: true }, { text: ' fiel' }] },
        paragraph('Uma citação', { quote: true }),
      ]),
    )

    expect(content.text).toBe('Sermão fiel\nUma citação')
    expect(
      content.styles.some((style) => style.range.location === 0 && style.bold && style.fontSize >= 13),
    ).toBe(true)
    expect(content.paragraphs.some((run) => run.headingType === 'HEADING_2')).toBe(true)
    const quote = content.paragraphs.find((run) => run.range.location === 12)!
    expect(quote).toMatchObject({
      indentStart: 34,
      indentFirstLine: 34,
      indentEnd: 12,
      spacingBefore: 11,
      spacingAfter: 12,
    })
    const quoteStyle = styleAt(content, 12)!
    expect(quoteStyle.foregroundColor).toEqual(DOCS_QUOTE_FOREGROUND_COLOR)
    expect(quoteStyle.backgroundColor).toEqual(DOCS_QUOTE_BACKGROUND_COLOR)
    expect(styleAt(content, 0)?.foregroundColor).toBeUndefined()

    const custom = googleDocsContentFromDocument(
      doc([paragraph('Citação', { quote: true, spaceBeforePt: 7, spaceAfterPt: 9 })]),
    )
    expect(custom.paragraphs[0]).toMatchObject({ spacingBefore: 7, spacingAfter: 9, indentStart: 34 })
  })

  it('mantém marcadores de lista literais e chamadas de nota sobrescritas com as notas no fim', () => {
    const content = googleDocsContentFromDocument(
      doc(
        [
          paragraph('Um item', { list: { kind: 'bullet', level: 0 } }),
          { headingLevel: 0, runs: [{ text: 'Texto' }, { text: '¹', footnote: 1 }] },
        ],
        [{ number: 1, runs: [{ text: 'Nota de rodapé' }] }],
      ),
    )

    expect(content.text).toBe('• Um item\nTexto1\n\n1 Nota de rodapé')
    expect(content.text.startsWith('• Um item\n')).toBe(true)
    const marker = content.styles.find((style) => style.range.location === 15)!
    expect(marker).toMatchObject({ range: { location: 15, length: 1 }, superscript: true })
    const noteMarker = content.styles.find((style) => style.range.location === 18)!
    expect(noteMarker).toMatchObject({ range: { location: 18, length: 1 }, superscript: true })
    expect(styleAt(content, 20)?.fontSize).toBe(10)
    expect(styleAt(content, 20)?.superscript).toBe(false)
  })

  it('numera listas ordenadas, marca listas de verificação e recua listas aninhadas', () => {
    const content = googleDocsContentFromDocument(
      doc([
        paragraph('Primeiro', { list: { kind: 'ordered', level: 0, ordinal: 1 } }),
        paragraph('Segundo', { list: { kind: 'ordered', level: 1, ordinal: 2 } }),
        paragraph('Feito', { list: { kind: 'check', level: 0, checked: true } }),
        paragraph('Pendente', { list: { kind: 'check', level: 0 } }),
      ]),
    )
    expect(content.text).toBe('1. Primeiro\n2. Segundo\n☑ Feito\n☐ Pendente')
    expect(content.paragraphs).toHaveLength(1)
    expect(content.paragraphs[0]).toMatchObject({
      range: { location: 12, length: 11 },
      indentStart: 36,
      indentFirstLine: 36,
    })
  })

  it('leva título, alinhamento, entrelinha e espaçamento ao corpo do batchUpdate', () => {
    const content = googleDocsContentFromDocument(
      doc([
        paragraph('Um título', {
          headingLevel: 2,
          alignment: 'center',
          lineHeight: 1.5,
          spaceBeforePt: 6,
          spaceAfterPt: 8,
        }),
        paragraph('Texto do documento.'),
      ]),
    )
    const first = content.paragraphs[0]!
    expect(first.headingType).toBe('HEADING_2')
    expect(first.alignment).toBe('CENTER')
    expect(first.lineSpacing).toBeCloseTo(150, 0)
    expect(first.spacingBefore).toBe(6)
    expect(first.spacingAfter).toBe(8)
    expect(styleAt(content, 0)?.fontSize).toBe(16)

    const body = googleDocsBatchUpdateBody(content, 2, 'test')
    const styles = requestsOf(body, 'updateParagraphStyle').map((update) => update.paragraphStyle as Json)
    expect(styles.some((style) => style.alignment === 'CENTER' && (style.lineSpacing as number) > 149)).toBe(
      true,
    )
    expect(styles.some((style) => style.namedStyleType === 'HEADING_2')).toBe(true)
    const alignments = googleDocsContentFromDocument(
      doc([
        paragraph('a', { alignment: 'left' }),
        paragraph('b', { alignment: 'right' }),
        paragraph('c', { alignment: 'justify' }),
      ]),
    ).paragraphs.map((run) => run.alignment)
    expect(alignments).toEqual(['START', 'END', 'JUSTIFIED'])
  })

  it('converte sublinhado, tachado, link, cores, fonte, tamanho e deslocamento de linha', () => {
    const content = googleDocsContentFromDocument(
      doc([
        {
          headingLevel: 0,
          runs: [
            {
              text: 'forte',
              bold: true,
              italic: true,
              underline: true,
              strike: true,
              color: '#123456',
              highlight: '#ff0',
            },
            { text: ' ' },
            { text: 'referência', link: 'https://example.org/reference' },
            { text: ' H' },
            { text: '2', subscript: true },
            { text: 'O ' },
            { text: 'x', superscript: true },
            { text: ' Georgia', fontFamily: 'Georgia', fontSizePt: 12.5 },
          ],
        },
      ]),
    )
    const body = googleDocsBatchUpdateBody(content, 2, 'rev')
    const updates = requestsOf(body, 'updateTextStyle')
    const forte = updates.find(
      (update) => (update.range as Json).startIndex === 1 && (update.range as Json).endIndex === 6,
    )!
    const forteStyle = forte.textStyle as Json
    expect(forteStyle).toMatchObject({ bold: true, italic: true, underline: true, strikethrough: true })
    expect(forteStyle.foregroundColor).toEqual({
      color: { rgbColor: { red: 18 / 255, green: 52 / 255, blue: 86 / 255 } },
    })
    expect(forteStyle.backgroundColor).toEqual({ color: { rgbColor: { red: 1, green: 1, blue: 0 } } })
    expect(updates.some((update) => (update.textStyle as Json).link !== undefined)).toBe(true)
    expect(content.styles.some((style) => style.linkURL === 'https://example.org/reference')).toBe(true)
    const offsets = updates.map((update) => (update.textStyle as Json).baselineOffset)
    expect(offsets).toContain('SUBSCRIPT')
    expect(offsets).toContain('SUPERSCRIPT')
    // Texto comum leva NONE: a API do Docs rejeita qualquer outro nome para a linha de base.
    expect(offsets).toContain('NONE')
    expect(offsets.every((offset) => ['NONE', 'SUPERSCRIPT', 'SUBSCRIPT'].includes(offset as string))).toBe(
      true,
    )
    const georgia = updates.find(
      (update) => ((update.textStyle as Json).weightedFontFamily as Json).fontFamily === 'Georgia',
    )!
    expect((georgia.textStyle as Json).fontSize).toEqual({ magnitude: 12.5, unit: 'PT' })
    expect(forte.fields).toBe(
      'bold,italic,underline,strikethrough,baselineOffset,weightedFontFamily,fontSize,foregroundColor,backgroundColor,link',
    )
  })

  it('exige a revisão remota e usa intervalos UTF-16', () => {
    const content: GoogleDocsContent = {
      text: 'A 😀 B\n',
      styles: [
        googleDocsStyleRun({
          range: { location: 2, length: 2 },
          fontName: 'Arial',
          fontSize: 14,
          bold: true,
          italic: false,
          superscript: false,
          backgroundColor: { red: 0.89, green: 0.93, blue: 0.89 },
        }),
      ],
      paragraphs: [
        googleDocsParagraphRun({
          range: { location: 0, length: 7 },
          indentStart: 22,
          indentFirstLine: 22,
          indentEnd: 12,
          headingType: 'HEADING_2',
          spacingBefore: 7,
          spacingAfter: 9,
        }),
      ],
    }

    const body = GoogleDriveAPI.batchUpdateBody(content, 15, 'revision-8')
    const deletion = body.requests[0]!.deleteContentRange as Json
    const insertion = body.requests[1]!.insertText as Json
    const updates = requestsOf(body, 'updateTextStyle')
    const styled = updates[updates.length - 1]!
    const paragraphUpdate = requestsOf(body, 'updateParagraphStyle').find(
      (update) => (update.paragraphStyle as Json).namedStyleType === 'HEADING_2',
    )!
    const rgb = (((styled.textStyle as Json).backgroundColor as Json).color as Json).rgbColor as Json

    expect(deletion.range).toEqual({ startIndex: 1, endIndex: 14 })
    expect(insertion).toEqual({ location: { index: 1 }, text: content.text })
    expect(styled.range).toEqual({ startIndex: 3, endIndex: 5 })
    expect(body.writeControl).toEqual({ requiredRevisionId: 'revision-8' })
    expect(paragraphUpdate.range).toEqual({ startIndex: 1, endIndex: 8 })
    const fields = paragraphUpdate.fields as string
    expect(fields).toContain('namedStyleType')
    expect(fields).toContain('spaceAbove')
    expect(fields).toContain('spaceBelow')
    expect(rgb.green as number).toBeCloseTo(0.93, 1)
  })

  it('calcula intervalos UTF-16 a partir do modelo com emoji', () => {
    const content = googleDocsContentFromDocument(
      doc([
        { headingLevel: 1, runs: [{ text: '😀 Primeiro' }] },
        { headingLevel: 1, alignment: 'left', runs: [{ text: 'Segundo' }] },
        { headingLevel: 0, runs: [{ text: 'Corpo em ' }, { text: 'negrito', bold: true }] },
      ]),
    )
    expect(content.text).toBe('😀 Primeiro\nSegundo\nCorpo em negrito')
    expect(content.paragraphs.filter((run) => run.headingType === 'HEADING_1')).toHaveLength(2)
    expect(content.paragraphs[1]!.range).toEqual({ location: 12, length: 8 })
    expect(content.paragraphs.some((run) => run.range.location === 20)).toBe(false)
    const bold = content.styles.find((style) => style.bold)!
    expect(bold.range).toEqual({ location: 29, length: 7 })
    expect(content.text.slice(bold.range.location, bold.range.location + bold.range.length)).toBe('negrito')
  })

  it('começa do texto normal: limpa o documento, reaplica a base e funde trechos iguais', () => {
    const content = googleDocsContentFromDocument(
      doc([paragraph('Primeiro'), paragraph('Segundo'), paragraph('')]),
    )
    expect(content.text).toBe('Primeiro\nSegundo')
    expect(content.styles).toHaveLength(1)
    expect(content.styles[0]).toMatchObject({
      range: { location: 0, length: 16 },
      fontName: 'Source Serif 4',
      fontSize: 11,
    })

    const fresh = googleDocsBatchUpdateBody(content, 2, 'rev-1')
    expect(fresh.requests.some((request) => 'deleteContentRange' in request)).toBe(false)
    expect(fresh.requests[0]).toHaveProperty('insertText')
    const reset = fresh.requests[1]!.updateParagraphStyle as Json
    expect(reset.range).toEqual({ startIndex: 1, endIndex: 17 })
    expect(reset.paragraphStyle).toEqual({ namedStyleType: 'NORMAL_TEXT' })
    const base = fresh.requests[2]!.updateTextStyle as Json
    expect(base.textStyle).toMatchObject({
      weightedFontFamily: { fontFamily: 'Arial' },
      fontSize: { magnitude: 10, unit: 'PT' },
    })

    const empty = googleDocsBatchUpdateBody({ text: '', styles: [], paragraphs: [] }, 20, 'rev-2')
    expect(empty.requests).toEqual([{ deleteContentRange: { range: { startIndex: 1, endIndex: 19 } } }])
  })

  it('aplica a citação à linha de atribuição e quebra versos dentro do parágrafo', () => {
    const content = googleDocsContentFromDocument(
      doc([
        {
          headingLevel: 0,
          quote: true,
          runs: [
            { text: 'Na noite, uma janela;' },
            { text: '', hardBreak: true },
            { text: 'A manhã responde.' },
          ],
        },
        paragraph('— Romanos 5:5', { attribution: true }),
      ]),
    )
    expect(content.text).toBe('Na noite, uma janela;\u000bA manhã responde.\n— Romanos 5:5')
    expect(content.paragraphs).toHaveLength(2)
    expect(content.paragraphs.every((run) => run.indentStart === 34)).toBe(true)
    expect(content.styles.every((style) => style.backgroundColor !== undefined)).toBe(true)
  })

  it('remove do texto o que a API descartaria, sem deslocar os índices', () => {
    expect(sanitizeDocsText('a\r\nb\nc d')).toBe('a\u000bb\u000bc\u000bd')
    expect(sanitizeDocsText('x\u0000y\u000czw\tq')).toBe('xyzw\tq')
    expect(sanitizeDocsText('ok 😀 \ud800!')).toBe('ok 😀 �!')
    const content = googleDocsContentFromDocument(
      doc([{ headingLevel: 0, runs: [{ text: 'a\u0001b' }, { text: 'c', bold: true }] }]),
    )
    expect(content.text).toBe('abc')
    expect(content.styles.find((style) => style.bold)?.range).toEqual({ location: 2, length: 1 })
  })

  it('lê cores hexadecimais', () => {
    expect(docsRGBColorFromHex('#ffffff')).toEqual({ red: 1, green: 1, blue: 1 })
    expect(docsRGBColorFromHex('000')).toEqual({ red: 0, green: 0, blue: 0 })
    expect(docsRGBColorFromHex('rgb(1,2,3)')).toBeUndefined()
    expect(docsRGBColorFromHex(undefined)).toBeUndefined()
  })

  it('gera hash estável que muda com o conteúdo', async () => {
    const first = googleDocsContentFromDocument(doc([paragraph('Texto', { id: 'a' })]))
    const sameText = googleDocsContentFromDocument(doc([paragraph('Texto', { id: 'b' })]))
    const changed = googleDocsContentFromDocument(doc([paragraph('Texto!')]))
    expect(await googleDocsContentHash(first)).toBe(await googleDocsContentHash(sameText))
    expect(await googleDocsContentHash(first)).not.toBe(await googleDocsContentHash(changed))
    expect(await googleDocsContentHash(first)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cobre o manuscrito sintético: versos, citação com atribuição, lista e nota', () => {
    const content = googleDocsContentFromDocument(
      doc(
        [
          {
            headingLevel: 0,
            runs: [
              { text: 'Na noite, uma janela;' },
              { text: '', hardBreak: true },
              { text: 'A manhã responde.' },
            ],
          },
          {
            headingLevel: 0,
            runs: [{ text: 'Cito ' }, { text: '“o amor não falha”', italic: true }, { text: '.' }],
          },
          paragraph('O amor de Deus é derramado.', { quote: true }),
          paragraph('— Romanos 5:5', { quote: true, attribution: true }),
          paragraph('Item da lista', { list: { kind: 'bullet', level: 0 } }),
          { headingLevel: 0, runs: [{ text: 'Fim' }, { text: '', footnote: 1 }] },
        ],
        [{ number: 1, runs: [{ text: 'Referência: Romanos 5:5.' }] }],
      ),
    )
    const body = googleDocsBatchUpdateBody(content, content.text.length + 1, 'synthetic-revision')
    expect(requestsOf(body, 'insertText')[0]!.text).toBe(content.text)
    expect(content.text).toContain('• Item da lista')
    expect(content.text.endsWith('\n\n1 Referência: Romanos 5:5.')).toBe(true)
    expect(content.styles.some((style) => style.superscript)).toBe(true)
    expect(content.styles.some((style) => style.italic)).toBe(true)
    expect(content.styles.some((style) => style.backgroundColor !== undefined)).toBe(true)
    expect(
      content.paragraphs.some(
        (run) => run.indentStart === 34 && run.spacingBefore === 11 && run.spacingAfter === 12,
      ),
    ).toBe(true)
    expect(requestsOf(body, 'updateTextStyle').length).toBeGreaterThan(1)
    expect(requestsOf(body, 'updateParagraphStyle').length).toBeGreaterThan(1)
  })
})

describe('texto de documentos do Docs', () => {
  it('extrai parágrafos, tabelas e sumário', () => {
    const text = plainTextFromDocsContent([
      { startIndex: 0, endIndex: 1, sectionBreak: {} },
      { paragraph: { elements: [{ textRun: { content: 'Ideias\n' } }, { inlineObjectElement: {} }] } },
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] }] },
            { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] }] },
          ],
        },
      },
      {
        tableOfContents: { content: [{ paragraph: { elements: [{ textRun: { content: 'Sumário\n' } }] } }] },
      },
    ])
    expect(text).toBe('Ideias\nA\nB\nSumário\n')
    expect(plainTextFromDocsContent(null)).toBe('')
  })
})
