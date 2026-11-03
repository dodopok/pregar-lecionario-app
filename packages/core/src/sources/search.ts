import { z } from 'zod'
import { englishBookName, parseAllReferences, parseReference } from '../bible/reference'
import type { ScriptureReference } from '../bible/reference'
import { silentIntegrationLog } from '../log/integration'
import type { IntegrationName } from '../log/integration'
import { dateKey } from '../util/dates'
import { loggedRequest, safeHttpsURL } from '../util/http'
import type { HttpContext, LoggedResponse } from '../util/http'
import { normalizeForSearch } from '../util/text'
import { parseRSSAtomCandidates } from './feed'
import type { FeedArticleCandidate } from './feed'
import {
  DEFAULT_FAVORITE_SITES,
  favoriteLibraryFingerprint,
  favoriteSiteHasStructuredSearch,
  favoriteSiteSearchURL,
} from './favorites'
import type { FavoriteAuthor, FavoritePassageContext, FavoriteSite } from './favorites'
import { FavoriteSourceURLs, percentEncodeSearchQuery } from './urls'

/**
 * Busca de artigos nas fontes favoritas. Porte de `FavoriteSiteSearch.swift`: consulta as APIs
 * públicas (WordPress REST, WordPress.com, feed JSON do Blogger, RSS/Atom), aceita links só do
 * domínio do perfil e em HTTPS, e classifica cada artigo pela referência explícita. No Anglican
 * Compass, a busca também usa a celebração para localizar artigos editoriais sem referência no título.
 */

export const FAVORITE_SITES_INTEGRATION: IntegrationName = 'Fontes favoritas'
export const FAVORITE_SITE_REQUEST_TIMEOUT_MS = 15_000
export const FAVORITE_SITE_MAXIMUM_RESPONSE_BYTES = 2_000_000
export const FAVORITE_SITE_MAXIMUM_ARTICLES = 6
const FAVORITE_SITE_SEARCH_REVISION = 'occasion-context-v2'

export const FAVORITE_SITE_INVALID_REFERENCE_MESSAGE =
  'Escolha uma passagem com livro, capítulo e versículos.'
export const FAVORITE_SITE_UNAVAILABLE_MESSAGE = 'Busca temporariamente indisponível.'

export type FavoriteSiteMatch = 'same' | 'contains' | 'partial' | 'context'

const MATCH_LABELS: Record<FavoriteSiteMatch, string> = {
  same: 'mesma passagem',
  contains: 'seção maior · contém a passagem',
  partial: 'sobreposição parcial',
  context: 'menção no contexto · conferir',
}

const MATCH_PRIORITY: Record<FavoriteSiteMatch, number> = { same: 0, contains: 1, partial: 2, context: 3 }

export function favoriteSiteMatchLabel(match: FavoriteSiteMatch): string {
  return MATCH_LABELS[match]
}

/** Artigo encontrado. A identidade é a `url`. */
export interface FavoriteSiteArticle {
  site: FavoriteSite
  title: string
  url: string
  author: string | null
  publishedAt: Date | null
  match: FavoriteSiteMatch
  /** Intervalo citado no título do artigo ("Matthew 21:18-27"). */
  passageReference: string | null
  /** Intervalo comum com a passagem buscada ("Matthew 21:23-27"). */
  overlapReference: string | null
}

/** Resultado de um site. A identidade é `site.id`. */
export interface FavoriteSiteSearchGroup {
  site: FavoriteSite
  /** Endereço que o Leitor abre para o site (arquivo, Próprio ou template de busca). */
  searchURL: string
  articles: FavoriteSiteArticle[]
  searchedAt: Date
  errorMessage: string | null
}

/** Relatório de uma busca. A identidade é `cacheKey`. */
export interface FavoriteSiteSearchReport {
  cacheKey: string
  reference: string
  searchedAt: Date
  groups: FavoriteSiteSearchGroup[]
}

export interface FavoriteSiteSearchParams extends FavoritePassageContext {
  /** Perfis consultados; sem valor, os perfis iniciais. */
  sites?: readonly FavoriteSite[]
  /** Autores preferidos, que sobem na ordenação. */
  authors?: readonly FavoriteAuthor[]
}

/**
 * Chave do cache: passagem, ocasião, data litúrgica, domingo/outro dia e a identidade da
 * biblioteca de fontes e autores. Sem `sites`, usa os perfis iniciais, como a busca.
 */
export async function favoriteSiteSearchCacheKey(params: FavoriteSiteSearchParams): Promise<string> {
  const cleanReference = params.reference.trim()
  const cleanOccasion = params.occasion?.trim() ?? ''
  const revision = await favoriteLibraryFingerprint(
    params.sites ?? DEFAULT_FAVORITE_SITES,
    params.authors ?? [],
  )
  return [
    FAVORITE_SITE_SEARCH_REVISION,
    cleanReference,
    cleanOccasion,
    dateKey(params.date),
    params.isSunday ? 'sunday' : 'other',
    revision,
  ].join('|')
}

export type FavoriteSiteSearchErrorKind =
  'invalidReference' | 'invalidRequest' | 'invalidResponse' | 'httpStatus'

export class FavoriteSiteSearchError extends Error {
  readonly kind: FavoriteSiteSearchErrorKind
  readonly status: number | null

  constructor(kind: FavoriteSiteSearchErrorKind, options: { status?: number; cause?: unknown } = {}) {
    const status = options.status ?? null
    super(kind === 'httpStatus' ? `httpStatus(${status ?? '?'})` : kind, { cause: options.cause })
    this.name = 'FavoriteSiteSearchError'
    this.kind = kind
    this.status = status
  }
}

// Requisições ------------------------------------------------------------------------------

export interface FavoriteSiteRequest {
  url: string
  method: 'GET'
  headers: Record<string, string>
  timeoutMs: number
}

function parseURL(value: string, base?: string | URL): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

function jsonRequest(host: string, path: string, query: [string, string][]): FavoriteSiteRequest {
  const search = query.map(([name, value]) => `${name}=${percentEncodeSearchQuery(value)}`).join('&')
  return {
    url: `https://${host}${path}?${search}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: FAVORITE_SITE_REQUEST_TIMEOUT_MS,
  }
}

/**
 * Requisição estruturada: em geral envia só "Livro capítulo" em inglês; o Anglican Compass
 * também recebe a celebração quando há uma página editorial própria. Working Preacher não é buscado
 * por API porque o arquivo é aberto diretamente no site.
 */
export function favoriteSiteRequest(
  site: FavoriteSite,
  reference: string,
  occasion: string | null = null,
  date: Date | null = null,
  isSunday = false,
): FavoriteSiteRequest | null {
  const target = parseReference(reference)
  if (!favoriteSiteHasStructuredSearch(site) || !target) return null
  const term = `${englishBookName(target)} ${target.chapter}`
  const base = parseURL(site.baseURL)
  const host = base?.hostname

  switch (site.adapter) {
    case 'workingPreacherArchive':
    case 'websiteSearch':
      return null
    case 'rssAtom': {
      const url = site.feedURL !== null ? parseURL(site.feedURL) : base ? parseURL('feed', base) : null
      if (!url || url.protocol !== 'https:') return null
      return {
        url: url.href,
        method: 'GET',
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        timeoutMs: FAVORITE_SITE_REQUEST_TIMEOUT_MS,
      }
    }
    case 'anglicanCompass':
    case 'wordpress': {
      if (!base || !host) return null
      const basePath = base.pathname.replace(/^\/+|\/+$/g, '')
      const path = '/' + [basePath, 'wp-json/wp/v2/posts'].filter((part) => part !== '').join('/')
      const editorialTerm =
        site.adapter === 'anglicanCompass'
          ? FavoriteSourceURLs.anglicanCompassEditorialLabel(occasion, date, isSunday)
          : null
      return jsonRequest(host, path, [
        ['search', editorialTerm ?? term],
        ['per_page', '12'],
        ['_embed', 'author'],
        ['_fields', 'date,link,title,excerpt,_links,_embedded'],
      ])
    }
    case 'wordpressCom':
      if (!host) return null
      return jsonRequest('public-api.wordpress.com', `/rest/v1.1/sites/${host}/posts/`, [
        ['search', term],
        ['number', '12'],
        ['fields', 'title,URL,date,author,excerpt'],
      ])
    case 'blogger':
      if (!host) return null
      return jsonRequest(host, '/feeds/posts/default', [
        ['q', term],
        ['alt', 'json'],
        ['max-results', '12'],
      ])
  }
}

// Respostas --------------------------------------------------------------------------------

const renderedSchema = z.object({ rendered: z.string() })

const wordPressPostsSchema = z.array(
  z.object({
    date: z.string(),
    link: z.string(),
    title: renderedSchema,
    excerpt: renderedSchema,
    // O autor embutido pode vir como erro `rest_no_route`: sem `name`, o artigo continua.
    _embedded: z.object({ author: z.array(z.object({ name: z.string().nullish() })).nullish() }).nullish(),
  }),
)

const wordPressComSchema = z.object({
  posts: z.array(
    z.object({
      title: z.string(),
      URL: z.string(),
      date: z.string(),
      author: z.object({ name: z.string() }).nullish(),
      excerpt: z.string(),
    }),
  ),
})

const bloggerTextSchema = z.object({ $t: z.string() })

const bloggerFeedSchema = z.object({
  feed: z.object({
    // O Blogger omite `entry` quando a busca não acha nada.
    entry: z
      .array(
        z.object({
          title: bloggerTextSchema,
          published: bloggerTextSchema,
          link: z.array(z.object({ rel: z.string(), href: z.string() })),
          author: z.array(z.object({ name: bloggerTextSchema })),
          summary: bloggerTextSchema.nullish(),
        }),
      )
      .nullish(),
  }),
})

function decodeJSON<T>(body: string | Uint8Array, schema: z.ZodType<T>): T {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new FavoriteSiteSearchError('invalidResponse', { cause: error })
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new FavoriteSiteSearchError('invalidResponse', { cause: parsed.error })
  return parsed.data
}

function candidatesFor(body: string | Uint8Array, site: FavoriteSite): FeedArticleCandidate[] {
  switch (site.adapter) {
    case 'workingPreacherArchive':
    case 'websiteSearch':
      return []
    case 'anglicanCompass':
    case 'wordpress':
      return decodeJSON(body, wordPressPostsSchema).map((post) => ({
        title: post.title.rendered,
        url: post.link,
        author: post._embedded?.author?.[0]?.name ?? null,
        date: post.date,
        excerpt: post.excerpt.rendered,
      }))
    case 'wordpressCom':
      return decodeJSON(body, wordPressComSchema).posts.map((post) => ({
        title: post.title,
        url: post.URL,
        author: post.author?.name ?? null,
        date: post.date,
        excerpt: post.excerpt,
      }))
    case 'blogger':
      return (decodeJSON(body, bloggerFeedSchema).feed.entry ?? []).map((entry) => ({
        title: entry.title.$t,
        url: entry.link.find((link) => link.rel === 'alternate')?.href ?? '',
        author: entry.author[0]?.name.$t ?? null,
        date: entry.published.$t,
        excerpt: entry.summary?.$t ?? '',
      }))
    case 'rssAtom':
      try {
        return parseRSSAtomCandidates(body)
      } catch (error) {
        throw new FavoriteSiteSearchError('invalidResponse', { cause: error })
      }
  }
}

/**
 * Artigos relacionados à passagem, até seis: autores preferidos primeiro, depois o tipo de
 * correspondência e a data mais recente.
 */
export function favoriteSiteArticles(
  body: string | Uint8Array,
  site: FavoriteSite,
  targetReference: string,
  authors: readonly FavoriteAuthor[] = [],
  occasion: string | null = null,
  date: Date | null = null,
  isSunday = false,
): FavoriteSiteArticle[] {
  const target = parseReference(targetReference)
  if (!target) throw new FavoriteSiteSearchError('invalidReference')
  const candidates = candidatesFor(body, site)

  const seen = new Set<string>()
  const articles: FavoriteSiteArticle[] = []
  for (const candidate of candidates) {
    const url = safeArticleURL(candidate.url, site)
    if (!url) continue
    const title = decodedText(candidate.title)
    if (title === '') continue
    if (seen.has(url)) continue
    seen.add(url)
    const relation =
      relationFor(title, candidate.excerpt, target) ??
      editorialContextRelation(site, title, occasion, date, isSunday)
    if (!relation) continue
    const author = candidate.author !== null ? decodedText(candidate.author) : ''
    articles.push({
      site,
      title,
      url,
      author: author === '' ? null : author,
      publishedAt: parsePublishedDate(candidate.date),
      match: relation.match,
      passageReference: relation.passageReference,
      overlapReference: relation.overlapReference,
    })
  }

  return articles
    .sort((left, right) => {
      const leftPreferred = isPreferredAuthor(left.author, authors)
      const rightPreferred = isPreferredAuthor(right.author, authors)
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
      if (left.match !== right.match) return MATCH_PRIORITY[left.match] - MATCH_PRIORITY[right.match]
      const leftTime = left.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY
      const rightTime = right.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY
      if (leftTime === rightTime) return 0
      return leftTime > rightTime ? -1 : 1
    })
    .slice(0, FAVORITE_SITE_MAXIMUM_ARTICLES)
}

function editorialContextRelation(
  site: FavoriteSite,
  title: string,
  occasion: string | null,
  date: Date | null,
  isSunday: boolean,
): FavoriteSitePassageRelation | null {
  if (site.adapter !== 'anglicanCompass') return null
  const editorialLabel = FavoriteSourceURLs.anglicanCompassEditorialLabel(occasion, date, isSunday)
  if (!editorialLabel || !normalizeForSearch(title).includes(normalizeForSearch(editorialLabel))) return null
  return { match: 'context', passageReference: null, overlapReference: null }
}

function isPreferredAuthor(value: string | null, authors: readonly FavoriteAuthor[]): boolean {
  if (value === null) return false
  const normalized = normalizeForSearch(value)
  return authors.some((author) => normalized !== '' && normalized.includes(normalizeForSearch(author.name)))
}

// Relação entre referências -----------------------------------------------------------------

export interface FavoriteSitePassageRelation {
  match: FavoriteSiteMatch
  passageReference: string | null
  overlapReference: string | null
}

type VersePoint = readonly [chapter: number, verse: number]

function relationFor(
  title: string,
  excerpt: string,
  target: ScriptureReference,
): FavoriteSitePassageRelation | null {
  const fromTitle = bestRelation(parseAllReferences(title), target)
  if (fromTitle) return fromTitle
  const fromExcerpt = bestRelation(parseAllReferences(decodedText(excerpt)), target)
  if (!fromExcerpt) return null
  return { match: 'context', passageReference: null, overlapReference: null }
}

function bestRelation(
  candidates: ScriptureReference[],
  target: ScriptureReference,
): FavoriteSitePassageRelation | null {
  let best: FavoriteSitePassageRelation | null = null
  for (const candidate of candidates) {
    const relation = referenceRelation(candidate, target)
    if (relation && (best === null || MATCH_PRIORITY[relation.match] < MATCH_PRIORITY[best.match]))
      best = relation
  }
  return best
}

/**
 * Relação de uma referência citada com a passagem buscada. Diferente do `passageRelation`
 * genérico: capítulo inteiro vira contexto com a referência citada, e sobreposições informam
 * o intervalo comum exato.
 */
export function favoriteReferenceRelation(
  candidate: ScriptureReference,
  target: ScriptureReference,
): FavoriteSitePassageRelation | null {
  return referenceRelation(candidate, target)
}

function referenceRelation(
  candidate: ScriptureReference,
  target: ScriptureReference,
): FavoriteSitePassageRelation | null {
  if (candidate.book !== target.book) return null
  const book = englishBookName(candidate)
  const candidateEndChapter = candidate.endChapter ?? candidate.chapter
  const targetEndChapter = target.endChapter ?? target.chapter

  if (candidate.startVerse === null || target.startVerse === null) {
    if (!(candidate.chapter <= targetEndChapter && candidateEndChapter >= target.chapter)) return null
    return {
      match: 'context',
      passageReference: formatReference(book, candidate.chapter, null, candidate.endChapter, null),
      overlapReference: null,
    }
  }

  const candidateStart: VersePoint = [candidate.chapter, candidate.startVerse]
  const candidateEnd: VersePoint = [candidateEndChapter, candidate.endVerse ?? candidate.startVerse]
  const targetStart: VersePoint = [target.chapter, target.startVerse]
  const targetEnd: VersePoint = [targetEndChapter, target.endVerse ?? target.startVerse]
  if (!isBeforeOrEqual(candidateStart, targetEnd) || !isBeforeOrEqual(targetStart, candidateEnd)) return null

  const passageReference = formatReference(
    book,
    candidate.chapter,
    candidate.startVerse,
    candidate.endChapter,
    candidate.endVerse ?? candidate.startVerse,
  )
  const overlapStart = isBeforeOrEqual(candidateStart, targetStart) ? targetStart : candidateStart
  const overlapEnd = isBeforeOrEqual(candidateEnd, targetEnd) ? candidateEnd : targetEnd
  const overlapReference = formatReference(
    book,
    overlapStart[0],
    overlapStart[1],
    overlapEnd[0],
    overlapEnd[1],
  )

  if (isEqual(candidateStart, targetStart) && isEqual(candidateEnd, targetEnd)) {
    return { match: 'same', passageReference, overlapReference }
  }
  if (isBeforeOrEqual(candidateStart, targetStart) && isBeforeOrEqual(targetEnd, candidateEnd)) {
    return { match: 'contains', passageReference, overlapReference }
  }
  return { match: 'partial', passageReference, overlapReference }
}

function formatReference(
  book: string,
  startChapter: number,
  startVerse: number | null,
  endChapter: number | null,
  endVerse: number | null,
): string {
  const start = startVerse !== null ? `${startChapter}:${startVerse}` : `${startChapter}`
  if (endChapter === null || endChapter === startChapter) {
    if (endVerse === null || startVerse === null || endVerse === startVerse) return `${book} ${start}`
    return `${book} ${start}-${endVerse}`
  }
  if (endVerse === null) return `${book} ${startChapter}-${endChapter}`
  return `${book} ${start}-${endChapter}:${endVerse}`
}

function isBeforeOrEqual(left: VersePoint, right: VersePoint): boolean {
  return left[0] < right[0] || (left[0] === right[0] && left[1] <= right[1])
}

function isEqual(left: VersePoint, right: VersePoint): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

// Texto, links e datas ---------------------------------------------------------------------

function normalizedHost(host: string): string {
  const lower = host.toLowerCase()
  return lower.startsWith('www.') ? lower.slice(4) : lower
}

/** Link do artigo apenas no domínio do perfil (com ou sem www), sem credenciais, em HTTPS. */
function safeArticleURL(value: string, site: FavoriteSite): string | null {
  const safe = safeHttpsURL(value)
  if (!safe) return null
  const host = parseURL(safe)?.hostname ?? ''
  const siteHost = parseURL(site.baseURL)?.hostname ?? ''
  if (host === '' || normalizedHost(host) !== normalizedHost(siteHost)) return null
  return safe
}

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&apos;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&ndash;': '–',
  '&mdash;': '—',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&ldquo;': '“',
  '&rdquo;': '”',
}

function decodeEntity(entity: string): string | null {
  const named = NAMED_ENTITIES[entity.toLowerCase()]
  if (named !== undefined) return named
  if (!entity.startsWith('&#') || !entity.endsWith(';')) return null
  const digits = entity.slice(2, -1)
  const value = /^x/i.test(digits) ? Number.parseInt(digits.slice(1), 16) : Number.parseInt(digits, 10)
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
    return null
  return String.fromCodePoint(value)
}

/** HTML para texto simples: remove script/style e tags, decodifica entidades comuns. */
function decodedText(value: string): string {
  const withoutActiveContent = value.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
  const plain = withoutActiveContent.replace(/<[^>]*>/g, ' ')
  const decoded = plain.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (token) => decodeEntity(token) ?? token)
  return decoded.replace(/\u00a0/g, ' ').trim()
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

const ZONE_OFFSETS: Record<string, number> = {
  GMT: 0,
  UT: 0,
  UTC: 0,
  Z: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
}

function utcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  offsetMinutes: number,
): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null
  const time = Date.UTC(year, month, day, hour, minute, second, millisecond)
  const check = new Date(time)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day)
    return null
  return new Date(time - offsetMinutes * 60_000)
}

function offsetFrom(sign: string, hours: string, minutes: string): number {
  const value = Number(hours) * 60 + Number(minutes)
  return sign === '-' ? -value : value
}

/**
 * Datas dos contratos: ISO 8601 com fuso (com ou sem fração), ISO sem fuso em UTC (WordPress)
 * e RFC 822 dos feeds RSS (`pubDate`).
 */
function parsePublishedDate(value: string | null): Date | null {
  if (!value) return null
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))?$/.exec(
    text,
  )
  if (iso) {
    const [, y, mo, d, h, mi, s, fraction, zone, sign, zh, zm] = iso
    // Sem fuso, só o formato sem fração (como o `DateFormatter` local do Swift).
    if (!zone && fraction) return null
    const offset = zone && zone !== 'Z' ? offsetFrom(sign ?? '+', zh ?? '0', zm ?? '0') : 0
    const millisecond = fraction ? Math.round(Number(`0${fraction}`) * 1000) : 0
    return utcDate(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      millisecond,
      offset,
    )
  }
  const rfc822 =
    /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([+-])(\d{2})(\d{2})|([A-Za-z]{1,3}))?$/.exec(
      text,
    )
  if (rfc822) {
    const [, d, monthName, y, h, mi, s, sign, zh, zm, zoneName] = rfc822
    const month = MONTHS[(monthName ?? '').toLowerCase()]
    if (month === undefined) return null
    let offset = 0
    if (sign) offset = offsetFrom(sign, zh ?? '0', zm ?? '0')
    else if (zoneName) {
      const known = ZONE_OFFSETS[zoneName.toUpperCase()]
      if (known === undefined) return null
      offset = known
    }
    let year = Number(y)
    if ((y ?? '').length === 2) year += year < 50 ? 2000 : 1900
    return utcDate(year, month, Number(d), Number(h), Number(mi), Number(s ?? '0'), 0, offset)
  }
  return null
}

// Busca ------------------------------------------------------------------------------------

export interface FavoriteSiteSearchContext extends HttpContext {
  /** Relógio injetável para `searchedAt`. */
  now?: () => Date
}

async function searchSite(
  context: FavoriteSiteSearchContext,
  site: FavoriteSite,
  passageContext: FavoritePassageContext,
  searchURL: string,
  authors: readonly FavoriteAuthor[],
  now: () => Date,
): Promise<FavoriteSiteSearchGroup> {
  const searchedAt = now()
  const { reference, occasion, date, isSunday } = passageContext
  const request = favoriteSiteRequest(site, reference, occasion ?? null, date, isSunday)
  if (!request) return { site, searchURL, articles: [], searchedAt, errorMessage: null }
  const operation = `busca · ${site.title}`
  let alreadyLogged = false
  try {
    let response: LoggedResponse
    try {
      response = await loggedRequest(
        context,
        request.url,
        { method: request.method, headers: request.headers },
        { integration: FAVORITE_SITES_INTEGRATION, operation, timeoutMs: request.timeoutMs },
      )
    } catch (error) {
      alreadyLogged = true // falha de rede ou tempo esgotado: já registrada
      throw error
    }
    if (!response.ok) {
      alreadyLogged = true // HTTP não 2xx: já registrado com o corpo
      throw new FavoriteSiteSearchError('httpStatus', { status: response.status })
    }
    if (response.body.byteLength > FAVORITE_SITE_MAXIMUM_RESPONSE_BYTES) {
      throw new FavoriteSiteSearchError('invalidResponse')
    }
    const articles = favoriteSiteArticles(response.body, site, reference, authors, occasion ?? null, date, isSunday)
    return { site, searchURL, articles, searchedAt, errorMessage: null }
  } catch (error) {
    if (!alreadyLogged) {
      ;(context.log ?? silentIntegrationLog).record({
        level: 'ERRO',
        integration: FAVORITE_SITES_INTEGRATION,
        operation,
        method: request.method,
        url: request.url,
        error,
      })
    }
    return { site, searchURL, articles: [], searchedAt, errorMessage: FAVORITE_SITE_UNAVAILABLE_MESSAGE }
  }
}

/**
 * Consulta todos os perfis em paralelo e devolve um grupo por site, na ordem recebida. Falhas
 * ficam no grupo do site (`errorMessage`); a função não lança.
 */
export async function searchFavoriteSites(
  context: FavoriteSiteSearchContext,
  params: FavoriteSiteSearchParams,
): Promise<FavoriteSiteSearchReport> {
  const now = context.now ?? (() => new Date())
  const sites = params.sites ?? DEFAULT_FAVORITE_SITES
  const authors = params.authors ?? []
  const reference = params.reference.trim()
  const passageContext: FavoritePassageContext = {
    reference,
    occasion: params.occasion ?? null,
    date: params.date,
    isSunday: params.isSunday,
  }
  const cacheKey = await favoriteSiteSearchCacheKey({ ...passageContext, sites, authors })
  const searchURLs = sites.map((site) => favoriteSiteSearchURL(site, passageContext))

  if (!parseReference(reference)) {
    const groups = sites.map((site, index) => ({
      site,
      searchURL: searchURLs[index] ?? site.baseURL,
      articles: [],
      searchedAt: now(),
      errorMessage: FAVORITE_SITE_INVALID_REFERENCE_MESSAGE,
    }))
    return { cacheKey, reference, searchedAt: now(), groups }
  }

  const groups = await Promise.all(
    sites.map((site, index) =>
      searchSite(context, site, passageContext, searchURLs[index] ?? site.baseURL, authors, now),
    ),
  )
  return { cacheKey, reference, searchedAt: now(), groups }
}
