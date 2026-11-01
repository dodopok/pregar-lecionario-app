import { describe, expect, it, vi } from 'vitest'
import { englishReference, parseReference } from '../../src/bible/reference'
import {
  liturgicalProperDay,
  liturgicalYearLetter,
  properDesignation,
  properShortDesignation,
} from '../../src/liturgy/calendar'
import { MemoryIntegrationLog } from '../../src/log/integration'
import type { FetchLike } from '../../src/util/http'
import {
  BUILT_IN_FAVORITE_SITES,
  DEFAULT_FAVORITE_AUTHORS,
  DEFAULT_FAVORITE_SITES,
  FAVORITE_SITE_INVALID_REFERENCE_MESSAGE,
  FavoriteSiteSearchAutoGate,
  FavoriteSourceURLs,
  createFavoriteSite,
  decodeFavoriteSite,
  decodeFavoriteSites,
  deserializeFavoriteSiteReports,
  encodeFavoriteAuthors,
  encodeFavoriteSite,
  encodeFavoriteSites,
  favoriteAuthorsFromData,
  favoriteSiteArticles,
  favoriteSiteEditorialContext,
  favoriteSiteRequest,
  favoriteSiteSearchCacheKey,
  favoriteSiteSearchURL,
  favoriteSiteUsesAnglicanCompassDestination,
  favoriteSitesFromData,
  newFavoriteSite,
  searchFavoriteSites,
  serializeFavoriteSiteReports,
} from '../../src/sources'
import type { FavoriteSite } from '../../src/sources'

/**
 * Porte de PregarTests/FavoriteSiteSearchTests.swift. Fora do porte:
 * - testAppHostIsIsolatedFromThePersonalInstallation (específico do host de testes do macOS);
 * - testLiveFavoriteSiteAdaptersWhenExplicitlyEnabled (rede real, PREGAR_LIVE_SITE_TESTS=1).
 */

const { workingPreacher, anglicanCompass, myPastoralPonderings, bobCornwall } = BUILT_IN_FAVORITE_SITES

function json(value: unknown): string {
  return JSON.stringify(value)
}

function fakeFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn<FetchLike>(async (input, init) =>
    handler(new URL(input instanceof Request ? input.url : input), init),
  )
}

function post(title: string, url: string, date: string) {
  return {
    title,
    URL: url,
    date,
    author: { name: 'Rev. James E. Laurence' },
    excerpt: '<p>Romans 13:8-14</p>',
  }
}

function bloggerEntry(title: string, url: string) {
  return {
    title: { $t: title },
    published: { $t: '2026-03-30T11:42:00.001-04:00' },
    link: [{ rel: 'alternate', href: url }],
    author: [{ name: { $t: 'Bob Cornwall' } }],
    summary: { $t: 'A lectionary reflection.' },
  }
}

function anglicanCompassResponse(): string {
  return json([
    {
      date: '2026-09-20T12:00:00',
      link: 'https://anglicancompass.com/today-in-the-spirit-proper-21a/',
      title: { rendered: 'Today in the Spirit: Proper 21A' },
      excerpt: { rendered: '<p>The Gospel reading is Matthew 21:28-32.</p>' },
    },
  ])
}

function bobCornwallResponse(): string {
  return json({
    feed: {
      entry: [
        bloggerEntry(
          'Question of Authority — Matthew 21:18-27',
          'https://www.bobcornwall.com/2026/03/question.html',
        ),
      ],
    },
  })
}

describe('busca nas fontes favoritas (porte do Swift)', () => {
  it('deduplica a busca automática e respeita o intervalo de um dia', () => {
    const gate = new FavoriteSiteSearchAutoGate()
    const start = new Date(1_800_000_000_000)
    const key = 'Matthew 21|2026-09-27'

    expect(gate.begin(key, start)).toBe(true)
    expect(gate.begin(key, new Date(start.getTime() + 1_000))).toBe(false)
    gate.finish(key, false)
    expect(gate.begin(key, new Date(start.getTime() + 60_000))).toBe(false)
    expect(gate.begin(key, new Date(start.getTime() + 86_401_000))).toBe(true)
  })

  it('permite nova tentativa depois de uma busca automática cancelada', () => {
    const gate = new FavoriteSiteSearchAutoGate()
    const start = new Date(1_800_000_000_000)
    const key = 'Matthew 21|2026-09-27'

    expect(gate.begin(key, start)).toBe(true)
    gate.finish(key, true)
    expect(gate.begin(key, new Date(start.getTime() + 1_000))).toBe(true)
  })

  it('inclui o contexto litúrgico na chave de cache', async () => {
    const date = new Date('2026-09-27T12:00:00Z')
    const nextSunday = new Date('2026-10-04T12:00:00Z')
    const proper21 = await favoriteSiteSearchCacheKey({
      reference: ' Matthew 21:23-32 ',
      occasion: 'Proper 21 A',
      date,
      isSunday: true,
    })

    expect(
      await favoriteSiteSearchCacheKey({
        reference: 'Matthew 21:23-32',
        occasion: 'Proper 21 A',
        date,
        isSunday: true,
      }),
    ).toBe(proper21)
    expect(
      await favoriteSiteSearchCacheKey({
        reference: 'Matthew 21:23-32',
        occasion: 'Proper 22 A',
        date,
        isSunday: true,
      }),
    ).not.toBe(proper21)
    expect(
      await favoriteSiteSearchCacheKey({
        reference: 'Matthew 21:23-32',
        occasion: 'Proper 21 A',
        date: nextSunday,
        isSunday: true,
      }),
    ).not.toBe(proper21)
  })

  it('casa o Próprio e o ciclo do ano na virada do Advento', () => {
    const proper22 = new Date(2026, 9, 4)
    const dayBeforeAdvent = new Date(2026, 10, 28)
    const firstAdvent = new Date(2026, 10, 29)

    const context = liturgicalProperDay('19º Domingo depois de Pentecostes', proper22, true)
    expect(context && properDesignation(context)).toBe('Próprio 22')
    expect(context && properShortDesignation(context)).toBe('Próprio 22 A')
    expect(liturgicalYearLetter(dayBeforeAdvent)).toBe('A')
    expect(liturgicalYearLetter(firstAdvent)).toBe('B')
    expect(liturgicalProperDay('19º Domingo depois de Pentecostes', proper22, false)).toBeNull()
  })

  it('inclui fontes e autores editáveis na chave de cache', async () => {
    const date = new Date('2026-09-27T12:00:00Z')
    const params = { reference: 'Matthew 21:23-32', occasion: null, date, isSunday: true }
    const baseline = await favoriteSiteSearchCacheKey(params)
    const source = { ...newFavoriteSite(), title: 'Meu comentário' }
    const withSource = await favoriteSiteSearchCacheKey({ ...params, sites: [source] })
    const withAuthor = await favoriteSiteSearchCacheKey({
      ...params,
      authors: [{ id: 'bird', name: 'Michael Bird', referenceURL: null }],
    })

    expect(withSource).not.toBe(baseline)
    expect(withAuthor).not.toBe(baseline)
  })

  it('mantém uma chave de cache e uma busca automática para perfis inalterados', async () => {
    const sitesData = encodeFavoriteSites(DEFAULT_FAVORITE_SITES)
    const authorsData = encodeFavoriteAuthors(DEFAULT_FAVORITE_AUTHORS)
    const date = new Date('2026-11-01T12:00:00Z')
    const gate = new FavoriteSiteSearchAutoGate()
    const cacheKeys = new Set<string>()
    let searchesStarted = 0

    for (let index = 0; index < 100; index += 1) {
      const key = await favoriteSiteSearchCacheKey({
        reference: 'Salmo 34:1-10, 22',
        occasion: 'Todos os Santos',
        date,
        isSunday: true,
        sites: favoriteSitesFromData(sitesData),
        authors: favoriteAuthorsFromData(authorsData),
      })
      cacheKeys.add(key)
      if (gate.begin(key, date)) {
        searchesStarted += 1
        gate.finish(key, false)
      }
    }

    expect(cacheKeys.size).toBe(1)
    expect(searchesStarted).toBe(1)
  })

  it('decodifica IDs legados e preserva perfis editáveis na ida e volta', () => {
    const legacy = decodeFavoriteSites(JSON.parse('["workingPreacher","anglicanCompass"]'))
    expect(legacy).toEqual([workingPreacher, anglicanCompass])

    const custom = createFavoriteSite({
      id: 'my-wp-site',
      title: 'Meu WordPress',
      baseURL: 'https://example.org',
      detail: 'Comentários',
      language: 'português',
      adapter: 'wordpress',
      searchURLTemplate: 'https://example.org/?s={query}',
      tradition: 'Anglicana (ACNA)',
    })
    expect(favoriteSiteEditorialContext(custom)).toBe(
      'Comentários · Tradição/jurisdição: Anglicana (ACNA) · Idioma: português',
    )
    const restored = decodeFavoriteSite(JSON.parse(JSON.stringify(encodeFavoriteSite(custom))))
    expect(restored).toEqual(custom)

    expect(favoriteSiteEditorialContext(anglicanCompass)).toContain('Recursos anglicanos · ACNA')
    expect(favoriteSiteEditorialContext(anglicanCompass)).toContain('Idioma: inglês')

    const olderProfile =
      '{"id":"older","title":"Site antigo","baseURL":"https://example.org","detail":"Comentários","language":"inglês","adapter":"wordpress","searchURLTemplate":"https://example.org/?s={query}"}'
    const migrated = decodeFavoriteSite(JSON.parse(olderProfile))
    expect(migrated?.tradition).toBe('')
  })

  it('usa o destino editado quando o endereço base de um site embutido muda', () => {
    const preacher: FavoriteSite = { ...workingPreacher, baseURL: 'https://commentary.example.org' }
    const preacherURL = new URL(
      favoriteSiteSearchURL(preacher, {
        reference: 'Matthew 21:33-46',
        occasion: null,
        date: new Date(),
        isSunday: false,
      }),
    )
    expect(preacherURL.hostname).toBe('commentary.example.org')
    expect(preacherURL.searchParams.get('s')).toBe('Matthew 21')

    const compass: FavoriteSite = { ...anglicanCompass, baseURL: 'https://anglican.example.org/resources' }
    expect(favoriteSiteUsesAnglicanCompassDestination(compass)).toBe(false)
    const compassURL = new URL(
      favoriteSiteSearchURL(compass, {
        reference: 'Matthew 21:33-46',
        occasion: 'Proper 22 A',
        date: new Date(),
        isSunday: true,
      }),
    )
    expect(compassURL.hostname).toBe('anglican.example.org')
    expect(compassURL.pathname.startsWith('/resources')).toBe(true)
    expect(favoriteSiteUsesAnglicanCompassDestination(anglicanCompass)).toBe(true)
  })

  it('preserva intervalos entre capítulos nas buscas das fontes', () => {
    const reference = 'Mateus 21.33-22.4'

    const preacher = new URL(FavoriteSourceURLs.workingPreacher(reference))
    expect(preacher.pathname).toBe('/')
    expect(preacher.searchParams.get('s')).toBe('Matthew 21:33-22:4')

    const compass = new URL(FavoriteSourceURLs.anglicanCompass(reference, null, null, false))
    expect(compass.searchParams.get('s')).toBe('Today in the Spirit Matthew 21:33-22:4')

    const customSite = createFavoriteSite({
      id: 'cross-chapter-search',
      title: 'Busca configurada',
      baseURL: 'https://example.org',
      detail: '',
      language: 'inglês',
      adapter: 'websiteSearch',
      searchURLTemplate: 'https://example.org/?passage={reference}',
    })
    expect(
      favoriteSiteSearchURL(customSite, { reference, occasion: null, date: new Date(), isSunday: false }),
    ).toContain('passage=Matthew%2021:33-22:4')

    expect(englishReference(parseReference(reference)!)).toBe('Matthew 21:33-22:4')
    const pastoral = new URL(FavoriteSourceURLs.myPastoralPonderings(reference))
    expect(pastoral.searchParams.get('s')).toBe('Matthew 21:33-22:4')
  })

  it('monta requisições próprias de cada site só com a passagem', () => {
    for (const site of [anglicanCompass, myPastoralPonderings, bobCornwall]) {
      const request = favoriteSiteRequest(site, 'Romanos 13.8-14')
      expect(request).not.toBeNull()
      const url = new URL(request!.url)
      expect(request!.method).toBe('GET')
      expect(request!.headers.Accept).toBe('application/json')
      expect(url.searchParams.get('search') ?? url.searchParams.get('q')).toBe('Romans 13')
      expect(request!.url).not.toContain('sermão')
      expect(request!.url).not.toContain('serm%C3%A3o')
      if (site === anglicanCompass) {
        expect(url.searchParams.get('_embed')).toBe('author')
        expect(url.searchParams.get('_fields')).toContain('_embedded')
      }
    }

    expect(favoriteSiteRequest(workingPreacher, 'Romanos 13.8-14')).toBeNull()
  })

  it('WordPress: usa o resumo como contexto e rejeita links externos', () => {
    const data = json([
      {
        date: '2026-09-20T12:00:00',
        link: 'https://anglicancompass.com/today-in-the-spirit-proper-21a/',
        title: { rendered: 'Today in the Spirit: Proper 21A' },
        excerpt: { rendered: '<p>The Gospel reading is Matthew 21:28-32.</p>' },
        _embedded: { author: [{ name: 'Rev. Anna Smith' }] },
      },
      {
        date: '2026-09-20T12:00:00',
        link: 'https://example.org/not-our-source/',
        title: { rendered: 'Matthew 21:23-32' },
        excerpt: { rendered: '<p>External source.</p>' },
      },
    ])

    const results = favoriteSiteArticles(data, anglicanCompass, 'Matthew 21:23-32')

    expect(results).toHaveLength(1)
    expect(results[0]?.match).toBe('context')
    expect(results[0]?.author).toBe('Rev. Anna Smith')
    expect(new URL(results[0]!.url).hostname).toBe('anglicancompass.com')
    expect(results[0]?.publishedAt?.toISOString()).toBe('2026-09-20T12:00:00.000Z')
  })

  it('WordPress: erro no autor embutido não descarta o artigo', () => {
    const data = json([
      {
        date: '2026-09-20T12:00:00',
        link: 'https://anglicancompass.com/matthew-21-commentary/',
        title: { rendered: 'Matthew 21:28-32' },
        excerpt: { rendered: 'A reflection on Matthew 21:28-32.' },
        _embedded: {
          author: [
            {
              code: 'rest_no_route',
              message: 'No route was found matching the URL and request method.',
              data: { status: 404 },
            },
          ],
        },
      },
    ])

    const article = favoriteSiteArticles(data, anglicanCompass, 'Matthew 21:28-32')[0]

    expect(article).toBeDefined()
    expect(article?.author).toBeNull()
    expect(article?.title).toBe('Matthew 21:28-32')
    expect(article?.match).toBe('same')
    expect(new URL(article!.url).hostname).toBe('anglicancompass.com')
  })

  it('WordPress.com: classifica intervalos e trata menções no resumo como contexto', () => {
    const data = json({
      posts: [
        post('Romans 13:8-14', 'http://mypastoralponderings.com/same', '2026-09-20T12:00:00-04:00'),
        post('Romans 13:1-14', 'https://mypastoralponderings.com/contains', '2026-09-19T12:00:00-04:00'),
        post('Romans 13:11-14', 'https://mypastoralponderings.com/partial', '2026-09-18T12:00:00-04:00'),
        post('Isaiah 55:1-5', 'https://mypastoralponderings.com/unrelated', '2026-09-17T12:00:00-04:00'),
      ],
    })

    const results = favoriteSiteArticles(data, myPastoralPonderings, 'Romans 13:8-14')

    expect(results.map((article) => article.match)).toEqual(['same', 'contains', 'partial', 'context'])
    expect(results[0]?.passageReference).toBe('Romans 13:8-14')
    expect(results[1]?.overlapReference).toBe('Romans 13:8-14')
    expect(results[2]?.overlapReference).toBe('Romans 13:11-14')
    expect(results[3]?.passageReference).toBeNull()
    expect(new URL(results[0]!.url).protocol).toBe('https:')
    expect(results[0]?.author).toBe('Rev. James E. Laurence')
  })

  it('Blogger: encontra referências parciais e confere o domínio', () => {
    const data = json({
      feed: {
        entry: [
          bloggerEntry(
            'Question of Authority — Matthew 21:18-27',
            'https://www.bobcornwall.com/2026/03/question.html',
          ),
          bloggerEntry('Matthew 21:23-32', 'https://elsewhere.example.org/not-bob.html'),
        ],
      },
    })

    const results = favoriteSiteArticles(data, bobCornwall, 'Matthew 21:23-32')

    expect(results).toHaveLength(1)
    expect(results[0]?.match).toBe('partial')
    expect(results[0]?.overlapReference).toBe('Matthew 21:23-27')
    expect(results[0]?.passageReference).toBe('Matthew 21:18-27')
    expect(results[0]?.author).toBe('Bob Cornwall')
  })

  it('adaptadores genéricos de WordPress e RSS buscam e priorizam autores salvos', () => {
    const wordpress = createFavoriteSite({
      id: 'generic-wp',
      title: 'Meu blog',
      baseURL: 'https://example.org/teologia',
      detail: '',
      language: 'português',
      adapter: 'wordpress',
      searchURLTemplate: 'https://example.org/?s={query}',
    })
    const request = favoriteSiteRequest(wordpress, 'Mateus 21.33-46')
    expect(new URL(request!.url).pathname).toBe('/teologia/wp-json/wp/v2/posts')

    const response = json([
      {
        date: '2026-09-20T12:00:00Z',
        link: 'https://example.org/teologia/mateus-21/',
        title: { rendered: 'Matthew 21:33-46' },
        excerpt: { rendered: 'The vineyard parable.' },
        _embedded: { author: [{ name: 'Another Writer' }] },
      },
      {
        date: '2026-09-19T12:00:00Z',
        link: 'https://example.org/teologia/mateus-21-bird/',
        title: { rendered: 'Matthew 21:33-46' },
        excerpt: { rendered: 'The vineyard parable.' },
        _embedded: { author: [{ name: 'Michael Bird' }] },
      },
    ])
    const authors = [{ id: 'bird', name: 'Michael Bird', referenceURL: null }]
    const results = favoriteSiteArticles(response, wordpress, 'Matthew 21:33-46', authors)
    expect(results[0]?.author).toBe('Michael Bird')

    const rss = createFavoriteSite({
      id: 'rss',
      title: 'Feed de comentários',
      baseURL: 'https://feed.example.org',
      detail: '',
      language: 'inglês',
      adapter: 'rssAtom',
      searchURLTemplate: 'https://feed.example.org/?s={query}',
      feedURL: 'https://feed.example.org/comments.xml',
    })
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Matthew 21:33-46</title>
          <link rel="alternate" href="https://feed.example.org/vineyard" />
          <author><name>Andrew McGowan</name></author>
          <published>2026-09-20T12:00:00Z</published>
          <summary>A reflection on the passage.</summary>
        </entry>
      </feed>`
    const feedRequest = favoriteSiteRequest(rss, 'Matthew 21:33-46')
    expect(feedRequest?.url).toBe('https://feed.example.org/comments.xml')
    const feedResults = favoriteSiteArticles(new TextEncoder().encode(xml), rss, 'Matthew 21:33-46')
    expect(feedResults[0]?.author).toBe('Andrew McGowan')
    expect(feedResults[0]?.match).toBe('same')
  })

  it('sobreposição entre capítulos informa só os versículos comuns', () => {
    const data = json({
      feed: {
        entry: [bloggerEntry('Matthew 21:33-22:4', 'https://www.bobcornwall.com/2026/03/vineyard.html')],
      },
    })

    const results = favoriteSiteArticles(data, bobCornwall, 'Matthew 22:1-6')

    expect(results[0]?.match).toBe('partial')
    expect(results[0]?.overlapReference).toBe('Matthew 22:1-4')
    expect(results[0]?.passageReference).toBe('Matthew 21:33-22:4')

    const report = {
      cacheKey: 'k',
      reference: 'Matthew 22:1-6',
      searchedAt: new Date('2026-09-27T12:00:00Z'),
      groups: [
        {
          site: bobCornwall,
          searchURL: 'https://www.bobcornwall.com/',
          articles: results,
          searchedAt: new Date('2026-09-27T12:00:00Z'),
          errorMessage: null,
        },
      ],
    }
    const restored = deserializeFavoriteSiteReports(serializeFavoriteSiteReports([report]))
    expect(restored[0]?.groups[0]?.articles[0]?.overlapReference).toBe('Matthew 22:1-4')
    expect(restored).toEqual([report])
  })

  it('devolve falhas parciais e mantém o Working Preacher como abertura do arquivo', async () => {
    const fetch = fakeFetch((url) => {
      switch (url.hostname) {
        case 'anglicancompass.com':
          return new Response(anglicanCompassResponse(), { status: 200 })
        case 'public-api.wordpress.com':
          return new Response('', { status: 503 })
        case 'www.bobcornwall.com':
          return new Response(bobCornwallResponse(), { status: 200 })
        default:
          return new Response('', { status: 404 })
      }
    })

    const report = await searchFavoriteSites(
      { fetch },
      {
        reference: 'Matthew 21:23-32',
        occasion: 'Proper 21 A',
        date: new Date(1_790_000_000_000),
        isSunday: true,
      },
    )

    const group = (site: FavoriteSite) => report.groups.find((item) => item.site.id === site.id)
    expect(report.groups.map((item) => item.site)).toEqual(DEFAULT_FAVORITE_SITES)
    expect(group(workingPreacher)?.errorMessage).toBeNull()
    expect(group(workingPreacher)?.articles).toEqual([])
    expect(group(anglicanCompass)?.articles).toHaveLength(1)
    expect(group(myPastoralPonderings)?.errorMessage).not.toBeNull()
    expect(group(bobCornwall)?.articles).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('busca nas fontes favoritas (casos adicionais)', () => {
  it('referência inválida não consulta a rede e explica o motivo em cada grupo', async () => {
    const fetch = fakeFetch(() => new Response('[]'))
    const report = await searchFavoriteSites(
      { fetch },
      { reference: 'sermão sem passagem', occasion: null, date: new Date(2026, 8, 27), isSunday: true },
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(report.groups).toHaveLength(DEFAULT_FAVORITE_SITES.length)
    expect(
      report.groups.every((group) => group.errorMessage === FAVORITE_SITE_INVALID_REFERENCE_MESSAGE),
    ).toBe(true)
  })

  it('registra cada chamada como "Fontes favoritas" e anota falhas de leitura sem duplicar HTTP', async () => {
    const log = new MemoryIntegrationLog()
    const fetch = fakeFetch((url) => {
      if (url.hostname === 'anglicancompass.com') return new Response('{"not":"an array"}', { status: 200 })
      if (url.hostname === 'public-api.wordpress.com') return new Response('down', { status: 503 })
      return new Response(bobCornwallResponse(), { status: 200 })
    })

    const report = await searchFavoriteSites(
      { fetch, log },
      { reference: 'Matthew 21:23-32', occasion: null, date: new Date(2026, 8, 27), isSunday: true },
    )

    expect(log.entries.every((entry) => entry.integration === 'Fontes favoritas')).toBe(true)
    const operations = log.entries.map((entry) => `${entry.level} ${entry.operation}`)
    expect(operations.filter((item) => item === 'ERRO busca · Anglican Compass')).toHaveLength(1)
    expect(operations.filter((item) => item === 'OK busca · Anglican Compass')).toHaveLength(1)
    expect(operations.filter((item) => item.endsWith('busca · My Pastoral Ponderings'))).toEqual([
      'ERRO busca · My Pastoral Ponderings',
    ])
    expect(operations).toContain('OK busca · Ponderings on a Faith Journey')
    expect(report.groups.find((group) => group.site.id === 'anglicanCompass')?.errorMessage).toBe(
      'Busca temporariamente indisponível.',
    )
  })

  it('recusa respostas maiores que 2 MB', async () => {
    const fetch = fakeFetch(() => new Response(new Uint8Array(2_000_001), { status: 200 }))
    const report = await searchFavoriteSites(
      { fetch },
      {
        reference: 'Matthew 21:23-32',
        date: new Date(2026, 8, 27),
        isSunday: false,
        sites: [anglicanCompass],
      },
    )
    expect(report.groups[0]?.errorMessage).toBe('Busca temporariamente indisponível.')
  })

  it('falha de rede vira mensagem no grupo, sem lançar', async () => {
    const fetch = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const report = await searchFavoriteSites(
      { fetch },
      { reference: 'Romans 13:8-14', date: new Date(2026, 8, 27), isSunday: false, sites: [bobCornwall] },
    )
    expect(report.groups[0]?.errorMessage).toBe('Busca temporariamente indisponível.')
    expect(report.groups[0]?.articles).toEqual([])
  })

  it('aceita só links HTTPS do próprio domínio, sem credenciais', () => {
    const data = json(
      [
        ['https://user:secret@anglicancompass.com/a/', 'Matthew 21:23-32'],
        ['https://evil.anglicancompass.com/b/', 'Matthew 21:23-32'],
        ['javascript:alert(1)', 'Matthew 21:23-32'],
        ['/relative/', 'Matthew 21:23-32'],
        ['ftp://anglicancompass.com/c/', 'Matthew 21:23-32'],
        ['http://www.anglicancompass.com/ok/', 'Matthew 21:23-32'],
        ['https://anglicancompass.com/ok/', 'Matthew 21:23-32 (sem www)'],
      ].map(([link, title]) => ({
        date: '2026-09-20T12:00:00',
        link,
        title: { rendered: title },
        excerpt: { rendered: '' },
      })),
    )
    const results = favoriteSiteArticles(data, anglicanCompass, 'Matthew 21:23-32')
    expect(results.map((article) => article.url)).toEqual([
      'https://www.anglicancompass.com/ok/',
      'https://anglicancompass.com/ok/',
    ])
  })

  it('decodifica entidades e remove HTML do título e do autor', () => {
    const data = json([
      {
        date: '2026-09-20T12:00:00',
        link: 'https://anglicancompass.com/x/',
        title: {
          rendered:
            '<em>Matthew 21:23&#8211;32</em> &amp; the &ldquo;authority&rdquo;<script>alert(1)</script>',
        },
        excerpt: { rendered: '' },
        _embedded: { author: [{ name: '  <b>Fleming&nbsp;Rutledge</b> ' }] },
      },
    ])
    const article = favoriteSiteArticles(data, anglicanCompass, 'Matthew 21:23-32')[0]
    expect(article?.title).toBe('Matthew 21:23–32  & the “authority”')
    expect(article?.author).toBe('Fleming Rutledge')
    expect(article?.match).toBe('same')
  })

  it('limita a seis artigos e ordena por correspondência e data', () => {
    const titles = [
      'Romans 13:11-14',
      'Romans 13:8-14',
      'Romans 13:1-14',
      'Romans 13',
      'Romans 13:8-14',
      'Romans 13:9-10',
      'Romans 13:8-14',
    ]
    const data = json({
      posts: titles.map((title, index) => ({
        title,
        URL: `https://mypastoralponderings.com/${index}`,
        date: `2026-09-1${index}T12:00:00Z`,
        excerpt: '',
      })),
    })
    const results = favoriteSiteArticles(data, myPastoralPonderings, 'Romans 13:8-14')
    expect(results).toHaveLength(6)
    expect(results.map((article) => article.match)).toEqual([
      'same',
      'same',
      'same',
      'contains',
      'partial',
      'partial',
    ])
    expect(results.slice(0, 3).map((article) => article.url)).toEqual([
      'https://mypastoralponderings.com/6',
      'https://mypastoralponderings.com/4',
      'https://mypastoralponderings.com/1',
    ])
  })

  it('capítulo inteiro no título conta como contexto com a referência citada', () => {
    const data = json({
      posts: [
        { title: 'Sermon on Romans 13', URL: 'https://mypastoralponderings.com/r13', date: '', excerpt: '' },
      ],
    })
    const article = favoriteSiteArticles(data, myPastoralPonderings, 'Romans 13:8-14')[0]
    expect(article?.match).toBe('context')
    expect(article?.passageReference).toBe('Romans 13')
    expect(article?.overlapReference).toBeNull()
    expect(article?.publishedAt).toBeNull()
  })

  it('Blogger sem resultados (sem "entry") devolve lista vazia', () => {
    expect(
      favoriteSiteArticles(json({ feed: { title: { $t: 'Blog' } } }), bobCornwall, 'Matthew 21:23-32'),
    ).toEqual([])
  })

  it('JSON fora do contrato é resposta inválida', () => {
    expect(() => favoriteSiteArticles('<html>', anglicanCompass, 'Matthew 21:23-32')).toThrow(
      /invalidResponse/,
    )
    expect(() =>
      favoriteSiteArticles('{"posts":[{"title":1}]}', myPastoralPonderings, 'Matthew 21:23-32'),
    ).toThrow(/invalidResponse/)
    expect(() => favoriteSiteArticles('[]', anglicanCompass, 'sem passagem')).toThrow(/invalidReference/)
  })

  it('RSS exige feed HTTPS e usa /feed quando não há endereço próprio', () => {
    const rss = createFavoriteSite({
      id: 'rss',
      title: 'Blog',
      baseURL: 'https://blog.example.org/',
      detail: '',
      language: '',
      adapter: 'rssAtom',
      searchURLTemplate: 'https://blog.example.org/?s={query}',
    })
    expect(favoriteSiteRequest(rss, 'Romans 13:8-14')?.url).toBe('https://blog.example.org/feed')
    expect(favoriteSiteRequest(rss, 'Romans 13:8-14')?.headers.Accept).toBe(
      'application/rss+xml, application/atom+xml, application/xml, text/xml',
    )
    expect(
      favoriteSiteRequest({ ...rss, feedURL: 'http://blog.example.org/rss' }, 'Romans 13:8-14'),
    ).toBeNull()
    expect(favoriteSiteRequest(rss, 'sem passagem')).toBeNull()
  })

  it('WordPress.com e Blogger usam os endpoints públicos com HTTPS', () => {
    const wpcom = new URL(favoriteSiteRequest(myPastoralPonderings, 'Romans 13:8-14')!.url)
    expect(wpcom.origin).toBe('https://public-api.wordpress.com')
    expect(wpcom.pathname).toBe('/rest/v1.1/sites/mypastoralponderings.com/posts/')
    expect(wpcom.searchParams.get('number')).toBe('12')
    expect(wpcom.searchParams.get('fields')).toBe('title,URL,date,author,excerpt')

    const blogger = new URL(favoriteSiteRequest(bobCornwall, 'Romans 13:8-14')!.url)
    expect(blogger.origin).toBe('https://www.bobcornwall.com')
    expect(blogger.pathname).toBe('/feeds/posts/default')
    expect(blogger.searchParams.get('alt')).toBe('json')
    expect(blogger.searchParams.get('max-results')).toBe('12')
  })

  it('templates aceitam {query} {reference} {book} {chapter} {occasion} {date}', () => {
    const site = createFavoriteSite({
      id: 'tpl',
      title: 'Template',
      baseURL: 'https://example.org',
      detail: '',
      language: '',
      adapter: 'websiteSearch',
      searchURLTemplate:
        'https://example.org/find?q={query}&r={reference}&b={book}&c={chapter}&o={occasion}&d={date}',
    })
    const url = new URL(
      favoriteSiteSearchURL(site, {
        reference: '1 Coríntios 13:1-13',
        occasion: 'Proper 4 B & mais',
        date: new Date(2027, 4, 30),
        isSunday: true,
      }),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '1 Corinthians 13',
      r: '1 Corinthians 13:1-13',
      b: '1 Corinthians',
      c: '13',
      o: 'Proper 4 B & mais',
      d: '2027-05-30',
    })
  })

  it('Working Preacher abre o arquivo da perícope e o Anglican Compass o Próprio do dia', () => {
    expect(FavoriteSourceURLs.workingPreacher('Mateus 21.23-32')).toBe(
      'https://www.workingpreacher.org/posts-by-tag/matthew-21_23-32',
    )
    expect(FavoriteSourceURLs.workingPreacher('1 Coríntios 13.4')).toBe(
      'https://www.workingpreacher.org/posts-by-tag/1-corinthians-13_4-4',
    )
    const workingPreacherSearch = favoriteSiteSearchURL(workingPreacher, {
      reference: 'Mateus 21.23-32',
      date: new Date(),
      isSunday: true,
    })
    expect(workingPreacherSearch).toBe('https://www.workingpreacher.org/posts-by-tag/matthew-21_23-32')

    const sunday = new Date(2026, 8, 27)
    expect(
      favoriteSiteSearchURL(anglicanCompass, {
        reference: 'Mateus 21.23-32',
        occasion: '18º Domingo depois de Pentecostes',
        date: sunday,
        isSunday: true,
      }),
    ).toBe('https://anglicancompass.com/today-in-the-spirit-proper-21a/')
    expect(FavoriteSourceURLs.anglicanCompassDetail('18º Domingo depois de Pentecostes', sunday, true)).toBe(
      'Today in the Spirit · Proper 21A',
    )
    expect(FavoriteSourceURLs.anglicanCompassDetail('Todos os Santos', sunday, true)).toBe(
      'Today in the Spirit · Todos os Santos',
    )
    expect(FavoriteSourceURLs.anglicanCompassDetail(null, null, false)).toBe(
      'Today in the Spirit · lecionário',
    )
    expect(new URL(FavoriteSourceURLs.bobCornwall('Romanos 13.8-14')).searchParams.get('s')).toBe(
      'Romans 13:8-14',
    )
  })

  it('dados salvos ilegíveis voltam aos perfis iniciais; lista vazia é respeitada', () => {
    expect(favoriteSitesFromData(null)).toEqual(DEFAULT_FAVORITE_SITES)
    expect(favoriteSitesFromData('')).toEqual(DEFAULT_FAVORITE_SITES)
    expect(favoriteSitesFromData('{oops')).toEqual(DEFAULT_FAVORITE_SITES)
    expect(favoriteSitesFromData('[{"id":"x"}]')).toEqual(DEFAULT_FAVORITE_SITES)
    expect(
      favoriteSitesFromData('[{"id":"x","title":"X","baseURL":"https://x.org","adapter":"gopher"}]'),
    ).toEqual(DEFAULT_FAVORITE_SITES)
    expect(favoriteSitesFromData('[]')).toEqual([])
    expect(favoriteSitesFromData(new TextEncoder().encode('["bobCornwall"]'))).toEqual([bobCornwall])
    expect(decodeFavoriteSites(['custom-id'])?.[0]).toMatchObject({
      id: 'custom-id',
      title: 'custom-id',
      adapter: 'websiteSearch',
    })
    expect(favoriteAuthorsFromData(undefined).map((author) => author.name)).toEqual([
      'N. T. Wright',
      'Michael Bird',
      'Scot McKnight',
      'Fleming Rutledge',
      'Andrew McGowan',
      'Richard Bauckham',
    ])
    const sites = favoriteSitesFromData(null)
    sites[0]!.title = 'editado'
    expect(workingPreacher.title).toBe('Working Preacher')
  })

  it('perfil antigo sem template usa a raiz com ?s={query}', () => {
    const site = decodeFavoriteSite({ id: 'a', title: 'A', baseURL: 'https://a.example.org' })
    expect(site).toMatchObject({
      adapter: 'websiteSearch',
      searchURLTemplate: 'https://a.example.org?s={query}',
      feedURL: null,
    })
  })
})
