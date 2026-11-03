import { describe, expect, it } from 'vitest'
import { createFavoriteSite } from '@pregar/core/sources'
import type { FavoriteSiteArticle, FavoriteSiteMatch, FavoriteSiteSearchGroup } from '@pregar/core/sources'
import type { ReaderTab } from '@pregar/core/reader'
import type { LibrarySectionMatch } from '../../src/shared/ipc-library'
import {
  articleGroup,
  articleLines,
  findReaderTab,
  groupMaterials,
  materialsEmptyMessage,
  materialSearchOccasion,
  normalizedArticleURL,
  openModeFromEvent,
  pageRangeLabel,
  pdfLines,
  researchDomain,
  researchLines,
  shortDate,
  sitesToConsult,
  sortedPdfMatches,
  totalItems,
  uniqueArticles,
  uniqueResearchSources,
} from '../../src/renderer/src/views/mesa/panels/materials'

const site = createFavoriteSite({
  id: 'compass',
  title: 'Anglican Compass',
  baseURL: 'https://anglicancompass.com',
  detail: 'Recursos anglicanos',
  language: 'inglês',
  tradition: 'ACNA',
  adapter: 'anglicanCompass',
  searchURLTemplate: 'https://anglicancompass.com/?s={query}',
})
const otherSite = createFavoriteSite({
  id: 'ponderings',
  title: 'My Pastoral Ponderings',
  baseURL: 'https://mypastoralponderings.com',
  detail: '',
  language: '',
  adapter: 'wordpressCom',
  searchURLTemplate: 'https://mypastoralponderings.com/?s={query}',
})

function article(
  title: string,
  url: string,
  match: FavoriteSiteMatch,
  extra: Partial<FavoriteSiteArticle> = {},
): FavoriteSiteArticle {
  return {
    site,
    title,
    url,
    author: null,
    publishedAt: null,
    match,
    passageReference: null,
    overlapReference: null,
    ...extra,
  }
}

function pdf(
  workTitle: string,
  startPage: number,
  kind: LibrarySectionMatch['kind'],
  extra: Partial<LibrarySectionMatch> = {},
): LibrarySectionMatch {
  return {
    recordId: workTitle,
    path: `/pdfs/${workTitle}.pdf`,
    workTitle,
    author: null,
    section: { title: `Seção ${startPage}`, startPage, endPage: startPage + 2 },
    kind,
    ...extra,
  }
}

describe('grupos de materiais', () => {
  it('inclui a festa da coleta junto com o domingo ao montar o contexto da busca', () => {
    const occasion = materialSearchOccasion('23º Domingo após Pentecostes', {
      date: '2026-11-01',
      sundayName: '23º Domingo após Pentecostes',
      collect: [
        { title: 'Todos os Santos e Santas', subtitle: 'Primeiro de novembro', text: 'Coleta da festa.' },
        { title: '23º Domingo após Pentecostes', text: 'Coleta do domingo.' },
      ],
    })

    expect(occasion).toBe('Todos os Santos e Santas · 23º Domingo após Pentecostes')
  })

  it('leva "mesma passagem" e "seção maior" para "Sobre esta passagem"', () => {
    expect(articleGroup('same')).toBe('exact')
    expect(articleGroup('contains')).toBe('exact')
    expect(articleGroup('partial')).toBe('partial')
    expect(articleGroup('context')).toBe('context')
  })

  it('mistura PDFs e artigos por correspondência, PDFs primeiro, sem grupos vazios', () => {
    const groups = groupMaterials(
      [pdf('Wright', 102, 'exact'), pdf('Feasting', 96, 'context')],
      [article('Proper 22', 'https://a.com/1', 'same'), article('Sermão', 'https://a.com/2', 'context')],
      'all',
    )
    expect(groups.map((group) => [group.id, group.title, group.items.map((item) => item.kind)])).toEqual([
      ['exact', 'Sobre esta passagem', ['pdf', 'article']],
      ['context', 'A confirmar', ['pdf', 'article']],
    ])
    expect(totalItems(groups)).toBe(4)
  })

  it('o filtro esconde PDFs ou sites', () => {
    const pdfs = [pdf('Wright', 102, 'partial')]
    const articles = [article('Proper 22', 'https://a.com/1', 'partial')]
    expect(groupMaterials(pdfs, articles, 'library')[0]!.items.map((item) => item.kind)).toEqual(['pdf'])
    expect(groupMaterials(pdfs, articles, 'sites')[0]!.items.map((item) => item.kind)).toEqual(['article'])
    expect(groupMaterials(pdfs, [], 'sites')).toEqual([])
  })

  it('ordena obras em ordem natural e remove seções repetidas', () => {
    const sorted = sortedPdfMatches([
      pdf('Volume 10', 5, 'exact'),
      pdf('Volume 2', 30, 'exact'),
      pdf('Volume 2', 4, 'exact'),
      pdf('Volume 2', 4, 'exact'),
    ])
    expect(sorted.map((match) => `${match.workTitle}:${match.section.startPage}`)).toEqual([
      'Volume 2:4',
      'Volume 2:30',
      'Volume 10:5',
    ])
  })

  it('o mesmo artigo vindo de dois sites aparece uma vez, com a correspondência mais forte', () => {
    const unique = uniqueArticles([
      article('A', 'https://a.com/x/', 'context'),
      article('B', 'https://b.com/y', 'same'),
      { ...article('A', 'https://a.com/x#topo', 'same'), site: otherSite },
    ])
    expect(unique.map((item) => [item.url, item.match])).toEqual([
      ['https://a.com/x#topo', 'same'],
      ['https://b.com/y', 'same'],
    ])
    expect(normalizedArticleURL('https://a.com/x/#c')).toBe('https://a.com/x')
  })

  it('sites sem artigos viram "Fontes para consultar"', () => {
    const groups: FavoriteSiteSearchGroup[] = [
      {
        site,
        searchURL: 'https://a.com',
        articles: [article('A', 'https://a.com/1', 'same')],
        searchedAt: new Date(),
        errorMessage: null,
      },
      {
        site: otherSite,
        searchURL: 'https://b.com',
        articles: [],
        searchedAt: new Date(),
        errorMessage: null,
      },
    ]
    expect(sitesToConsult(groups).map((group) => group.site.id)).toEqual(['ponderings'])
    expect(sitesToConsult(null)).toEqual([])
  })
})

describe('textos da aba Materiais', () => {
  it('explica o vazio pelo motivo', () => {
    expect(materialsEmptyMessage({ filter: 'all', libraryWorks: 0, favoriteSites: 0 })).toBe(
      'Nenhum PDF importado ainda. Nenhuma fonte favorita cadastrada.',
    )
    expect(materialsEmptyMessage({ filter: 'library', libraryWorks: 3, favoriteSites: 0 })).toBe(
      'Nenhum PDF indexado trata desta passagem.',
    )
    expect(materialsEmptyMessage({ filter: 'sites', libraryWorks: 0, favoriteSites: 4 })).toBe(
      'Nenhum artigo das fontes favoritas corresponde a esta passagem.',
    )
  })

  it('descreve páginas físicas e metadados do PDF', () => {
    expect(pageRangeLabel({ startPage: 102, endPage: 102 })).toBe('física 102')
    expect(pageRangeLabel({ startPage: 96, endPage: 101 })).toBe('físicas 96–101')
    expect(pdfLines(pdf('Matthew for Everyone', 102, 'exact', { author: 'N. T. Wright' }))).toEqual([
      'N. T. Wright · Matthew for Everyone',
      'PDF · físicas 102–104',
    ])
  })

  it('mostra o trecho comum só na sobreposição parcial', () => {
    const partial = article('Sermão', 'https://a.com/1', 'partial', {
      author: 'Fulano',
      publishedAt: new Date(2026, 8, 27),
      passageReference: 'Matthew 21:18-27',
      overlapReference: 'Matthew 21:23-27',
    })
    expect(articleLines(partial)).toEqual([
      'Fulano · Anglican Compass',
      'Recursos anglicanos · Tradição/jurisdição: ACNA · Idioma: inglês · 27/09/2026 · Trecho comum: Matthew 21:23-27 · material: Matthew 21:18-27',
    ])
    const same = { ...partial, match: 'same' as const, site: otherSite, author: null, publishedAt: null }
    expect(articleLines(same)).toEqual(['My Pastoral Ponderings', 'Matthew 21:18-27'])
  })

  it('a pesquisa mostra só metadados presentes', () => {
    expect(
      researchLines({
        title: 'A',
        url: 'https://www.exemplo.org/a',
        author: 'Rutledge',
        language: 'inglês',
        publishedDate: '2024',
      }),
    ).toEqual(['Autor: Rutledge · Idioma: inglês', 'exemplo.org · 2024'])
    expect(researchLines({ title: 'B', url: 'https://site.com/b' })).toEqual(['site.com'])
    expect(researchDomain('não é url')).toBe('não é url')
    expect(
      uniqueResearchSources([
        { title: 'A', url: 'https://x.com/a/' },
        { title: 'A2', url: 'https://x.com/a' },
      ]),
    ).toHaveLength(1)
  })

  it('aceita datas como texto (cache) ou Date', () => {
    expect(shortDate('2026-11-01T12:00:00')).toBe('01/11/2026')
    expect(shortDate(new Date(2026, 0, 5))).toBe('05/01/2026')
    expect(shortDate(null)).toBeNull()
  })
})

describe('abertura no Leitor', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false }

  it('clique comum abre e mostra; botão do meio abre ao fundo', () => {
    expect(openModeFromEvent(click, true)).toEqual({ background: false, select: false })
    expect(openModeFromEvent({ ...click, button: 1 }, false)).toEqual({ background: true, select: false })
  })

  it('⌘clique no Mac e Ctrl+clique nos outros sistemas abrem ao fundo; ⇧ seleciona', () => {
    expect(openModeFromEvent({ ...click, metaKey: true }, true)).toEqual({ background: true, select: false })
    expect(openModeFromEvent({ ...click, ctrlKey: true }, true)).toEqual({ background: false, select: false })
    expect(openModeFromEvent({ ...click, ctrlKey: true, shiftKey: true }, false)).toEqual({
      background: true,
      select: true,
    })
    expect(openModeFromEvent({ ...click, shiftKey: true }, false)).toEqual({
      background: false,
      select: false,
    })
  })

  it('reconhece a aba já aberta da mesma preparação', () => {
    const tabs: ReaderTab[] = [
      {
        id: '1',
        title: 'W',
        kind: 'pdf',
        location: 'C:\\pdfs\\Wright.pdf',
        physicalPage: 10,
        sermonDateKey: '2026-11-01',
        includedInReview: false,
      },
      {
        id: '2',
        title: 'A',
        kind: 'web',
        location: 'https://a.com/1/',
        physicalPage: 1,
        sermonDateKey: '2026-11-01',
        includedInReview: true,
      },
      {
        id: '3',
        title: 'B',
        kind: 'web',
        location: 'https://b.com',
        physicalPage: 1,
        sermonDateKey: '2026-10-25',
        includedInReview: false,
      },
    ]
    expect(findReaderTab(tabs, 'pdf', 'C:/pdfs/Wright.pdf', '2026-11-01')?.id).toBe('1')
    expect(findReaderTab(tabs, 'web', 'https://a.com/1', '2026-11-01')?.id).toBe('2')
    expect(findReaderTab(tabs, 'web', 'https://b.com', '2026-11-01')).toBeUndefined()
  })
})
