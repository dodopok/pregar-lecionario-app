import { describe, expect, it } from 'vitest'
import {
  REVIEW_MAX_BYTES_PER_SOURCE,
  SermonReviewMaterialError,
  extractPdfReviewSources,
  indexPdf,
  makeSectionLocation,
  makeWebReviewSource,
  webReviewCitation,
  type PdfLibraryRecord,
  type ReviewTabInput,
} from '../../src/library'
import { FEASTING_PAGES, FakePdfTextSource, bookmark, filler } from './fixtures'

const TAB_ID = '6F1C2A4E-9B0D-4C55-8E1F-0A2B3C4D5E6F'

function tab(overrides: Partial<ReviewTabInput> = {}): ReviewTabInput {
  return {
    id: TAB_ID,
    title: 'Aba do comentário',
    location: '/books/romans.pdf',
    physicalPage: 2,
    reference: null,
    ...overrides,
  }
}

function record(
  sections: PdfLibraryRecord['sections'],
  overrides: Partial<PdfLibraryRecord> = {},
): PdfLibraryRecord {
  return {
    id: '/books/romans.pdf',
    title: 'Paul for Everyone: Romans Part 2',
    path: '/books/romans.pdf',
    pageCount: 6,
    bookmarkCount: 0,
    author: 'N. T. Wright',
    sections,
    indexVersion: 4,
    ...overrides,
  }
}

describe('extração de seções para a revisão', () => {
  const pages = [
    'Front matter.',
    'end of Romans 13.1-7 commentary.\nRomans 13.8-14 Love, the Law and the Coming Day\n8 Owe no one anything.',
    'The commentary on love.\nRomans 14.1-6 Welcoming the Weak\n1 Welcome those who are weak.',
    'More on welcoming.',
    'Other.',
    'Other.',
  ]
  const sections = [
    makeSectionLocation({
      title: 'Romans 13.8-14 Love, the Law and the Coming Day',
      startPage: 2,
      endPage: 3,
      findingMethod: 'textHeading',
    }),
    makeSectionLocation({
      title: 'Romans 14.1-6 Welcoming the Weak',
      startPage: 3,
      endPage: 4,
      findingMethod: 'textHeading',
    }),
  ]

  it('respeita o início e o fim da seção dentro de páginas compartilhadas', async () => {
    const sources = await extractPdfReviewSources({
      tab: tab(),
      targetReference: 'Romanos 13:8-14',
      source: new FakePdfTextSource({ pages }),
      libraryRecords: [record(sections)],
    })

    expect(sources).toEqual([
      {
        id: `pdf:${TAB_ID}:section`,
        title: 'Paul for Everyone: Romans Part 2 · N. T. Wright',
        citation: 'Romans 13.8-14 Love, the Law and the Coming Day · páginas físicas 2–3',
        text: '8 Owe no one anything.\n\nThe commentary on love.',
      },
    ])
  })

  it('prefere a seção exata, depois a parcial e por fim a página da aba', async () => {
    const source = new FakePdfTextSource({ pages })
    const libraryRecords = [record(sections)]
    const byPartial = await extractPdfReviewSources({
      tab: tab({ physicalPage: 1 }),
      targetReference: 'Romans 14:5-12',
      source,
      libraryRecords,
    })
    expect(byPartial[0]!.citation.startsWith('Romans 14.1-6')).toBe(true)

    const byTabReference = await extractPdfReviewSources({
      tab: tab({ physicalPage: 1, reference: 'Romans 14:1-6' }),
      targetReference: '',
      source,
      libraryRecords,
    })
    expect(byTabReference[0]!.text).toBe('1 Welcome those who are weak.\n\nMore on welcoming.')

    const byPage = await extractPdfReviewSources({ tab: tab({ physicalPage: 4 }), source, libraryRecords })
    expect(byPage[0]!.citation.startsWith('Romans 14.1-6')).toBe(true)
  })

  it('usa o título da aba e indexa o documento quando o PDF não está no acervo', async () => {
    const sources = await extractPdfReviewSources({
      tab: tab({ physicalPage: 2 }),
      source: new FakePdfTextSource({ pages }),
      libraryRecords: [],
    })
    expect(sources[0]!.title).toBe('Aba do comentário')
    expect(sources[0]!.citation).toBe('Romans 13.8-14 Love, the Law and the Coming Day · páginas física 2')
    expect(sources[0]!.text).toBe('8 Owe no one anything.')
  })

  it('cria uma fonte por perspectiva do Feasting, com autor e página', async () => {
    const feastingPages = filler(14)
    for (const [page, text] of Object.entries(FEASTING_PAGES)) feastingPages[Number(page) - 1] = text
    const source = new FakePdfTextSource({
      pages: feastingPages,
      metadata: { title: 'Feasting on the Word: Year A, Volume 4' },
      outline: [bookmark('Romans 13:8-14', 10), bookmark('Matthew 18:15-20', 13)],
    })
    const indexed = (await indexPdf(source, { path: '/books/feasting.pdf' }))!

    const sources = await extractPdfReviewSources({
      tab: tab({ location: '/books/feasting.pdf', physicalPage: 10, title: 'Feasting' }),
      targetReference: 'Romans 13:8-14',
      source,
      libraryRecords: [indexed],
    })

    expect(sources.map((item) => [item.id, item.title, item.citation])).toEqual([
      [
        `pdf:${TAB_ID}:0`,
        'Feasting on the Word: Year A, Volume 4 — Theological Perspective · ELEAZAR S. FERNANDEZ',
        'Romans 13:8-14 · página física 10',
      ],
      [
        `pdf:${TAB_ID}:1`,
        'Feasting on the Word: Year A, Volume 4 — Pastoral Perspective · ROCHELLE A. STACKHOUSE',
        'Romans 13:8-14 · página física 11',
      ],
      [
        `pdf:${TAB_ID}:2`,
        'Feasting on the Word: Year A, Volume 4 — Exegetical Perspective · CHRISTOPHER R. HUTSON',
        'Romans 13:8-14 · página física 12',
      ],
      [
        `pdf:${TAB_ID}:3`,
        'Feasting on the Word: Year A, Volume 4 — Homiletical Perspective · DAVID L. BARTLETT',
        'Romans 13:8-14 · página física 13',
      ],
    ])
    expect(sources[0]!.text).toBe('Theological body begins.\nTheological body continues.')
    expect(sources[3]!.text).toBe('Homiletical body ends here.')
  })

  it('bloqueia o envio em vez de mandar trechos parciais', async () => {
    const longPages = ['Romans 13.8-14 Love\n' + 'a'.repeat(REVIEW_MAX_BYTES_PER_SOURCE + 1)]
    await expect(
      extractPdfReviewSources({
        tab: tab({ physicalPage: 1 }),
        source: new FakePdfTextSource({ pages: longPages }),
        libraryRecords: [
          record([makeSectionLocation({ title: 'Romans 13.8-14 Love', startPage: 1, endPage: 1 })], {
            pageCount: 1,
          }),
        ],
      }),
    ).rejects.toThrow(
      'A extração de “Aba do comentário” excede os limites e não será enviada parcialmente. Desmarque esta aba para continuar.',
    )

    const manyPages = filler(40)
    await expect(
      extractPdfReviewSources({
        tab: tab({ physicalPage: 1 }),
        source: new FakePdfTextSource({ pages: manyPages }),
        libraryRecords: [
          record([makeSectionLocation({ title: 'Romans 13', startPage: 1, endPage: 37 })], { pageCount: 40 }),
        ],
      }),
    ).rejects.toMatchObject({ code: 'sourceTooLarge', materialTitle: 'Aba do comentário' })

    const thirtySix = await extractPdfReviewSources({
      tab: tab({ physicalPage: 1 }),
      source: new FakePdfTextSource({ pages: manyPages }),
      libraryRecords: [
        record([makeSectionLocation({ title: 'Romans 13', startPage: 1, endPage: 36 })], { pageCount: 40 }),
      ],
    })
    expect(thirtySix[0]!.citation).toBe('Romans 13 · páginas físicas 1–36')

    const accented = ['Romans 13.8-14 Love\n' + 'é'.repeat(REVIEW_MAX_BYTES_PER_SOURCE / 2)]
    await expect(
      extractPdfReviewSources({
        tab: tab({ physicalPage: 1 }),
        source: new FakePdfTextSource({ pages: accented }),
        libraryRecords: [
          record([makeSectionLocation({ title: 'Romans 13.8-14 Love', startPage: 1, endPage: 1 })], {
            pageCount: 1,
          }),
        ],
      }),
    ).resolves.toHaveLength(1)
  })

  it('bloqueia perspectivas do Feasting grandes demais com o nome do componente', async () => {
    const big = {
      ...FEASTING_PAGES,
      11:
        'x'.repeat(REVIEW_MAX_BYTES_PER_SOURCE) +
        '\nELEAZAR S. FERNANDEZ\nPastoral Perspective\nPastoral body begins.',
    }
    const pagesWithBig = filler(14)
    for (const [page, text] of Object.entries(big)) pagesWithBig[Number(page) - 1] = text
    const source = new FakePdfTextSource({
      pages: pagesWithBig,
      metadata: { title: 'Feasting on the Word: Year A, Volume 4' },
      outline: [bookmark('Romans 13:8-14', 10), bookmark('Matthew 18:15-20', 13)],
    })
    const indexed = (await indexPdf(source, { path: '/books/feasting.pdf' }))!
    await expect(
      extractPdfReviewSources({
        tab: tab({ location: '/books/feasting.pdf', physicalPage: 10 }),
        targetReference: 'Romans 13:8-14',
        source,
        libraryRecords: [indexed],
      }),
    ).rejects.toThrow('“Feasting on the Word: Year A, Volume 4 — Theological Perspective”')
  })

  it('informa material indisponível e seção não encontrada', async () => {
    await expect(extractPdfReviewSources({ tab: tab(), source: null })).rejects.toThrow(
      'Não foi possível abrir o material “Aba do comentário” marcado para revisão.',
    )
    await expect(
      extractPdfReviewSources({
        tab: tab(),
        source: new FakePdfTextSource({ pages: ['Only prose.', 'More prose.'] }),
      }),
    ).rejects.toThrow(
      'Não encontrei uma seção legível em “Aba do comentário”. Desmarque-a ou escolha a seção no Leitor.',
    )
  })

  it('bloqueia página sem texto nem OCR', async () => {
    await expect(
      extractPdfReviewSources({
        tab: tab({ physicalPage: 1 }),
        source: new FakePdfTextSource({ pages: ['Romans 13.8-14 Love\nText.', ''] }),
        libraryRecords: [
          record([makeSectionLocation({ title: 'Romans 13.8-14 Love', startPage: 1, endPage: 2 })], {
            pageCount: 2,
          }),
        ],
      }),
    ).rejects.toMatchObject({
      code: 'pageUnavailable',
      message: 'Não foi possível extrair o texto da página marcada para revisão.',
    })
  })
})

describe('fontes web para a revisão', () => {
  it('cita o endereço sem consulta nem fragmento e usa o título da página', () => {
    const source = makeWebReviewSource(
      { id: TAB_ID, title: 'Aba' },
      { title: 'Artigo B', text: 'Texto do artigo.', url: 'https://example.org/artigo?utm=1#nota' },
    )
    expect(source).toEqual({
      id: `web:${TAB_ID}`,
      title: 'Artigo B',
      citation: 'https://example.org/artigo',
      text: 'Texto do artigo.',
    })
    expect(
      makeWebReviewSource({ id: TAB_ID, title: 'Aba' }, { title: '', text: 'x', url: 'not a url' }).title,
    ).toBe('Aba')
    expect(webReviewCitation('not a url')).toBe('not a url')
  })

  it('bloqueia página carregando, vazia ou grande demais', () => {
    const page = { title: 'A', text: 'Texto.', url: 'https://example.org/a' }
    expect(() => makeWebReviewSource({ id: TAB_ID, title: 'Aba' }, page, { isLoading: true })).toThrow(
      'Uma página marcada para revisão ainda está carregando. Aguarde e tente novamente.',
    )
    expect(() => makeWebReviewSource({ id: TAB_ID, title: 'Aba' }, { ...page, text: '  \n' })).toThrow(
      SermonReviewMaterialError,
    )
    expect(() =>
      makeWebReviewSource(
        { id: TAB_ID, title: 'Aba' },
        { ...page, text: 'a'.repeat(REVIEW_MAX_BYTES_PER_SOURCE + 1) },
      ),
    ).toThrow('A extração de “Aba” excede os limites')
  })
})
