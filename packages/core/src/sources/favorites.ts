import { z } from 'zod'
import { englishReference, englishBookName, parseReference } from '../bible/reference'
import { dateKey } from '../util/dates'
import { sha256Hex } from '../util/hash'
import { FavoriteSourceURLs, percentEncodeSearchQuery } from './urls'

/**
 * Biblioteca configurável de sites e autores favoritos. Porte de `FavoriteReferences.swift`:
 * perfis editáveis (descrição, idioma, tradição), adaptadores de busca e a identidade estável
 * da biblioteca usada no cache das buscas.
 */

export const FAVORITE_SITE_ADAPTERS = [
  'workingPreacherArchive',
  'anglicanCompass',
  'wordpress',
  'wordpressCom',
  'blogger',
  'rssAtom',
  'websiteSearch',
] as const

export type FavoriteSiteAdapter = (typeof FAVORITE_SITE_ADAPTERS)[number]

const ADAPTER_TITLES: Record<FavoriteSiteAdapter, string> = {
  workingPreacherArchive: 'Arquivo do Working Preacher',
  anglicanCompass: 'Anglican Compass',
  wordpress: 'WordPress',
  wordpressCom: 'WordPress.com',
  blogger: 'Blogger',
  rssAtom: 'RSS / Atom',
  websiteSearch: 'Busca do site',
}

export function favoriteSiteAdapterTitle(adapter: FavoriteSiteAdapter): string {
  return ADAPTER_TITLES[adapter]
}

export interface FavoriteSite {
  id: string
  title: string
  /** Endereço base como foi cadastrado, sem normalização (o `absoluteString` do Swift). */
  baseURL: string
  /** Descrição editorial. */
  detail: string
  language: string
  /** Tradição/jurisdição; exibida apenas quando cadastrada. */
  tradition: string
  adapter: FavoriteSiteAdapter
  /** Aceita {query}, {reference}, {book}, {chapter}, {occasion} e {date}. */
  searchURLTemplate: string
  feedURL: string | null
}

export interface FavoriteSiteInit {
  id: string
  title: string
  baseURL: string
  detail: string
  language: string
  adapter: FavoriteSiteAdapter
  searchURLTemplate: string
  feedURL?: string | null
  tradition?: string
}

export function createFavoriteSite(init: FavoriteSiteInit): FavoriteSite {
  return {
    id: init.id,
    title: init.title,
    baseURL: init.baseURL,
    detail: init.detail,
    language: init.language,
    tradition: init.tradition ?? '',
    adapter: init.adapter,
    searchURLTemplate: init.searchURLTemplate,
    feedURL: init.feedURL ?? null,
  }
}

/** Contexto da passagem usado para montar o endereço de busca de cada site. */
export interface FavoritePassageContext {
  reference: string
  occasion?: string | null
  date: Date
  isSunday: boolean
}

const workingPreacher = Object.freeze(
  createFavoriteSite({
    id: 'workingPreacher',
    title: 'Working Preacher',
    baseURL: 'https://www.workingpreacher.org',
    detail: 'Comentários · Lecionário Comum Revisado',
    language: 'inglês',
    adapter: 'workingPreacherArchive',
    searchURLTemplate: 'https://www.workingpreacher.org/?s={query}',
  }),
)
const anglicanCompass = Object.freeze(
  createFavoriteSite({
    id: 'anglicanCompass',
    title: 'Anglican Compass',
    baseURL: 'https://anglicancompass.com',
    detail: 'Recursos anglicanos · ACNA',
    language: 'inglês',
    adapter: 'anglicanCompass',
    searchURLTemplate: 'https://anglicancompass.com/?s={query}',
  }),
)
const myPastoralPonderings = Object.freeze(
  createFavoriteSite({
    id: 'myPastoralPonderings',
    title: 'My Pastoral Ponderings',
    baseURL: 'https://mypastoralponderings.com',
    detail: 'Sermões e reflexões',
    language: 'inglês',
    adapter: 'wordpressCom',
    searchURLTemplate: 'https://mypastoralponderings.com/?s={query}',
  }),
)
const bobCornwall = Object.freeze(
  createFavoriteSite({
    id: 'bobCornwall',
    title: 'Ponderings on a Faith Journey',
    baseURL: 'https://www.bobcornwall.com',
    detail: 'Bob Cornwall · reflexão pastoral',
    language: 'inglês',
    adapter: 'blogger',
    searchURLTemplate: 'https://www.bobcornwall.com/search?q={query}',
  }),
)

/** Perfis embutidos (imutáveis; copie com spread para editar). */
export const BUILT_IN_FAVORITE_SITES = Object.freeze({
  workingPreacher,
  anglicanCompass,
  myPastoralPonderings,
  bobCornwall,
})

/** Perfis iniciais da biblioteca, na ordem exibida. */
export const DEFAULT_FAVORITE_SITES: readonly FavoriteSite[] = Object.freeze([
  workingPreacher,
  anglicanCompass,
  myPastoralPonderings,
  bobCornwall,
])

function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

/** Perfil vazio para o formulário de inclusão. */
export function newFavoriteSite(): FavoriteSite {
  return createFavoriteSite({
    id: randomUUID(),
    title: '',
    baseURL: 'https://example.org',
    detail: '',
    language: '',
    adapter: 'websiteSearch',
    searchURLTemplate: 'https://example.org/?s={query}',
  })
}

function legacyCustomSite(id: string): FavoriteSite {
  return createFavoriteSite({
    id,
    title: id,
    baseURL: 'https://example.org',
    detail: '',
    language: '',
    adapter: 'websiteSearch',
    searchURLTemplate: 'https://example.org/?s={query}',
  })
}

function parseURL(value: string, base?: string | URL): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

function hostOf(value: string): string | null {
  const host = parseURL(value)?.hostname.toLowerCase()
  return host ? host : null
}

function withoutWWW(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

export function favoriteSiteHasStructuredSearch(site: FavoriteSite): boolean {
  return site.adapter !== 'websiteSearch' && site.adapter !== 'workingPreacherArchive'
}

/** "Comentários · Tradição/jurisdição: Anglicana (ACNA) · Idioma: português" */
export function favoriteSiteEditorialContext(site: FavoriteSite): string {
  const detail = site.detail.trim()
  const tradition = site.tradition.trim()
  const language = site.language.trim()
  return [
    detail === '' ? null : detail,
    tradition === '' ? null : `Tradição/jurisdição: ${tradition}`,
    language === '' ? null : `Idioma: ${language}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** O perfil ainda aponta para o domínio embutido (raiz, com ou sem www)? */
function usesBuiltInDestination(site: FavoriteSite, defaultSite: FavoriteSite): boolean {
  const siteURL = parseURL(site.baseURL)
  const siteHost = siteURL?.hostname.toLowerCase()
  const defaultHost = hostOf(defaultSite.baseURL)
  if (!siteURL || !siteHost || !defaultHost) return false
  return withoutWWW(siteHost) === withoutWWW(defaultHost) && trimSlashes(siteURL.pathname) === ''
}

export function favoriteSiteUsesAnglicanCompassDestination(site: FavoriteSite): boolean {
  return site.adapter === 'anglicanCompass' && usesBuiltInDestination(site, anglicanCompass)
}

/** Quando o template é o embutido, troca o domínio padrão pelo endereço base editado. */
function searchTemplate(site: FavoriteSite, defaultSite: FavoriteSite): string {
  if (site.searchURLTemplate !== defaultSite.searchURLTemplate) return site.searchURLTemplate
  return site.searchURLTemplate.replaceAll(defaultSite.baseURL, site.baseURL)
}

/** Preenche o template de busca com a passagem, a ocasião e a data. */
export function resolveFavoriteSiteSearchURL(
  site: FavoriteSite,
  reference: string,
  occasion: string | null = null,
  date: Date = new Date(),
  template: string | null = null,
): string {
  const passage = parseReference(reference)
  const values: Record<string, string> = {
    query: passage ? `${englishBookName(passage)} ${passage.chapter}` : reference,
    reference: passage ? englishReference(passage) : reference,
    book: passage ? englishBookName(passage) : reference,
    chapter: passage ? String(passage.chapter) : '',
    occasion: occasion ?? '',
    date: dateKey(date),
  }
  let result = template ?? site.searchURLTemplate
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, percentEncodeSearchQuery(value))
  }
  return result
}

function urlOrBase(value: string, site: FavoriteSite): string {
  return parseURL(value) ? value : site.baseURL
}

/** Endereço que o Leitor abre para o site: destino embutido ou template configurado. */
export function favoriteSiteSearchURL(site: FavoriteSite, context: FavoritePassageContext): string {
  const { reference, date, isSunday } = context
  const occasion = context.occasion ?? null
  switch (site.adapter) {
    case 'workingPreacherArchive':
      if (usesBuiltInDestination(site, workingPreacher)) return FavoriteSourceURLs.workingPreacher(reference)
      return urlOrBase(
        resolveFavoriteSiteSearchURL(site, reference, occasion, date, searchTemplate(site, workingPreacher)),
        site,
      )
    case 'anglicanCompass':
      if (usesBuiltInDestination(site, anglicanCompass)) {
        return FavoriteSourceURLs.anglicanCompass(reference, occasion, date, isSunday)
      }
      return urlOrBase(
        resolveFavoriteSiteSearchURL(site, reference, occasion, date, searchTemplate(site, anglicanCompass)),
        site,
      )
    case 'wordpress':
    case 'wordpressCom':
    case 'blogger':
    case 'rssAtom':
    case 'websiteSearch':
      return urlOrBase(resolveFavoriteSiteSearchURL(site, reference, occasion, date), site)
  }
}

export interface FavoriteAuthor {
  id: string
  name: string
  referenceURL: string | null
}

function defaultAuthor(name: string): FavoriteAuthor {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return Object.freeze({ id: `default-${slug}`, name, referenceURL: null })
}

/** Autores iniciais. Os IDs são fixos para a chave de cache sobreviver a reinícios. */
export const DEFAULT_FAVORITE_AUTHORS: readonly FavoriteAuthor[] = Object.freeze(
  [
    'N. T. Wright',
    'Michael Bird',
    'Scot McKnight',
    'Fleming Rutledge',
    'Andrew McGowan',
    'Richard Bauckham',
  ].map(defaultAuthor),
)

export function newFavoriteAuthor(): FavoriteAuthor {
  return { id: randomUUID(), name: '', referenceURL: null }
}

// Persistência ----------------------------------------------------------------------------

export const FAVORITE_SITES_STORAGE_KEY = 'pregar.favorite-sites.v1'
export const FAVORITE_AUTHORS_STORAGE_KEY = 'pregar.favorite-authors.v1'

const urlStringSchema = z.string().min(1)

const favoriteSiteObjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  baseURL: urlStringSchema,
  detail: z.string().nullish(),
  language: z.string().nullish(),
  tradition: z.string().nullish(),
  adapter: z.enum(FAVORITE_SITE_ADAPTERS).nullish(),
  searchURLTemplate: z.string().nullish(),
  feedURL: urlStringSchema.nullish(),
})

const favoriteAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  referenceURL: urlStringSchema.nullish(),
})

function cloneSite(site: FavoriteSite): FavoriteSite {
  return { ...site }
}

/**
 * Decodifica um perfil salvo. Aceita o formato antigo (apenas o ID de um site embutido) e
 * perfis gravados antes dos campos de tradição/adaptador.
 */
export function decodeFavoriteSite(value: unknown): FavoriteSite | null {
  if (typeof value === 'string') {
    const builtIn = DEFAULT_FAVORITE_SITES.find((site) => site.id === value)
    return builtIn ? cloneSite(builtIn) : legacyCustomSite(value)
  }
  const parsed = favoriteSiteObjectSchema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data
  return {
    id: data.id,
    title: data.title,
    baseURL: data.baseURL,
    detail: data.detail ?? '',
    language: data.language ?? '',
    tradition: data.tradition ?? '',
    adapter: data.adapter ?? 'websiteSearch',
    searchURLTemplate: data.searchURLTemplate ?? `${data.baseURL}?s={query}`,
    feedURL: data.feedURL ?? null,
  }
}

/** Como o `JSONDecoder` do Swift: um item inválido invalida a lista inteira. */
export function decodeFavoriteSites(value: unknown): FavoriteSite[] | null {
  if (!Array.isArray(value)) return null
  const sites: FavoriteSite[] = []
  for (const item of value) {
    const site = decodeFavoriteSite(item)
    if (!site) return null
    sites.push(site)
  }
  return sites
}

export function decodeFavoriteAuthors(value: unknown): FavoriteAuthor[] | null {
  const parsed = z.array(favoriteAuthorSchema).safeParse(value)
  if (!parsed.success) return null
  return parsed.data.map((author) => ({
    id: author.id,
    name: author.name,
    referenceURL: author.referenceURL ?? null,
  }))
}

/** Objeto JSON do perfil, com os campos na ordem do Swift e `feedURL` só quando existe. */
export function encodeFavoriteSite(site: FavoriteSite): Record<string, string> {
  const encoded: Record<string, string> = {
    id: site.id,
    title: site.title,
    baseURL: site.baseURL,
    detail: site.detail,
    language: site.language,
    tradition: site.tradition,
    adapter: site.adapter,
    searchURLTemplate: site.searchURLTemplate,
  }
  if (site.feedURL !== null) encoded.feedURL = site.feedURL
  return encoded
}

export function encodeFavoriteAuthor(author: FavoriteAuthor): Record<string, string> {
  const encoded: Record<string, string> = { id: author.id, name: author.name }
  if (author.referenceURL !== null) encoded.referenceURL = author.referenceURL
  return encoded
}

export function encodeFavoriteSites(sites: readonly FavoriteSite[]): string {
  return JSON.stringify(sites.map(encodeFavoriteSite))
}

export function encodeFavoriteAuthors(authors: readonly FavoriteAuthor[]): string {
  return JSON.stringify(authors.map(encodeFavoriteAuthor))
}

/** Valor salvo nas preferências: texto JSON, bytes UTF-8 ou o valor já desserializado. */
export type FavoriteLibraryData = string | Uint8Array | readonly unknown[] | null | undefined

function storedValue(data: FavoriteLibraryData): { empty: boolean; value: unknown } {
  if (data === null || data === undefined) return { empty: true, value: undefined }
  if (typeof data === 'string' || data instanceof Uint8Array) {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    if (text.length === 0) return { empty: true, value: undefined }
    try {
      return { empty: false, value: JSON.parse(text) as unknown }
    } catch {
      return { empty: false, value: undefined }
    }
  }
  return { empty: false, value: data }
}

/** Sites salvos; sem dados ou com dados ilegíveis, os perfis iniciais. Lista vazia é respeitada. */
export function favoriteSitesFromData(data: FavoriteLibraryData): FavoriteSite[] {
  const stored = storedValue(data)
  const decoded = stored.empty ? null : decodeFavoriteSites(stored.value)
  return decoded ?? DEFAULT_FAVORITE_SITES.map(cloneSite)
}

export function favoriteAuthorsFromData(data: FavoriteLibraryData): FavoriteAuthor[] {
  const stored = storedValue(data)
  const decoded = stored.empty ? null : decodeFavoriteAuthors(stored.value)
  return decoded ?? DEFAULT_FAVORITE_AUTHORS.map((author) => ({ ...author }))
}

/** JSON com chaves ordenadas: a ordem das chaves não pode mudar a identidade da biblioteca. */
function sortedKeysJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedKeysJSON).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedKeysJSON(record[key])}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Identidade da biblioteca de fontes/autores (16 hex do SHA-256 do JSON com chaves ordenadas).
 * Muda quando qualquer perfil muda, e não muda entre renderizações da mesma biblioteca.
 */
export async function favoriteLibraryFingerprint(
  sites: readonly FavoriteSite[],
  authors: readonly FavoriteAuthor[] = [],
): Promise<string> {
  const json = sortedKeysJSON([sites.map(encodeFavoriteSite), authors.map(encodeFavoriteAuthor)])
  return (await sha256Hex(json)).slice(0, 16)
}
