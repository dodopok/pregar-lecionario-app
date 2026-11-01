import { z } from 'zod'
import { decodeFavoriteSite, encodeFavoriteSite } from './favorites'
import type { FavoriteSite } from './favorites'
import type {
  FavoriteSiteArticle,
  FavoriteSiteMatch,
  FavoriteSiteSearchGroup,
  FavoriteSiteSearchReport,
} from './search'

/**
 * Cache local dos relatórios de busca nas fontes favoritas: vale 24 horas, é indexado pela
 * chave de passagem/ocasião/data/biblioteca e guarda os 100 relatórios mais recentes. A
 * persistência e o relógio são injetados pelo processo que usa o core.
 */

export const FAVORITE_SITE_REPORTS_STORAGE_KEY = 'pregar.favorite-site-search.reports.v3'
export const FAVORITE_SITE_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const FAVORITE_SITE_SEARCH_CACHE_LIMIT = 100

type MaybePromise<T> = T | Promise<T>

/** Armazenamento chave-valor de texto (preferências do app, arquivo, `localStorage`…). */
export interface FavoriteSiteSearchStorage {
  get(key: string): MaybePromise<string | null | undefined>
  set(key: string, value: string): MaybePromise<void>
}

const MATCHES = ['same', 'contains', 'partial', 'context'] as const satisfies readonly FavoriteSiteMatch[]

const dateSchema = z.string().transform((value, context) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: 'custom', message: 'data inválida' })
    return z.NEVER
  }
  return date
})

const siteSchema = z.unknown().transform((value, context) => {
  const site = decodeFavoriteSite(value)
  if (!site || typeof value === 'string') {
    context.addIssue({ code: 'custom', message: 'perfil inválido' })
    return z.NEVER
  }
  return site
})

const articleSchema = z.object({
  site: siteSchema,
  title: z.string(),
  url: z.string(),
  author: z.string().nullish(),
  publishedAt: dateSchema.nullish(),
  match: z.enum(MATCHES),
  passageReference: z.string().nullish(),
  overlapReference: z.string().nullish(),
})

const groupSchema = z.object({
  site: siteSchema,
  searchURL: z.string(),
  articles: z.array(articleSchema),
  searchedAt: dateSchema,
  errorMessage: z.string().nullish(),
})

const reportSchema = z.object({
  cacheKey: z.string(),
  reference: z.string(),
  searchedAt: dateSchema,
  groups: z.array(groupSchema),
})

function encodeArticle(article: FavoriteSiteArticle): Record<string, unknown> {
  return {
    site: encodeFavoriteSite(article.site),
    title: article.title,
    url: article.url,
    author: article.author,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    match: article.match,
    passageReference: article.passageReference,
    overlapReference: article.overlapReference,
  }
}

function encodeGroup(group: FavoriteSiteSearchGroup): Record<string, unknown> {
  return {
    site: encodeFavoriteSite(group.site),
    searchURL: group.searchURL,
    articles: group.articles.map(encodeArticle),
    searchedAt: group.searchedAt.toISOString(),
    errorMessage: group.errorMessage,
  }
}

export function serializeFavoriteSiteReports(reports: readonly FavoriteSiteSearchReport[]): string {
  return JSON.stringify(
    reports.map((report) => ({
      cacheKey: report.cacheKey,
      reference: report.reference,
      searchedAt: report.searchedAt.toISOString(),
      groups: report.groups.map(encodeGroup),
    })),
  )
}

/** Lê relatórios salvos; itens ilegíveis são descartados e texto inválido vira lista vazia. */
export function deserializeFavoriteSiteReports(text: string | null | undefined): FavoriteSiteSearchReport[] {
  if (!text) return []
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const reports: FavoriteSiteSearchReport[] = []
  for (const item of value) {
    const parsed = reportSchema.safeParse(item)
    if (!parsed.success) continue
    const data = parsed.data
    reports.push({
      cacheKey: data.cacheKey,
      reference: data.reference,
      searchedAt: data.searchedAt,
      groups: data.groups.map((group) => ({
        site: group.site as FavoriteSite,
        searchURL: group.searchURL,
        articles: group.articles.map((article) => ({
          site: article.site as FavoriteSite,
          title: article.title,
          url: article.url,
          author: article.author ?? null,
          publishedAt: article.publishedAt ?? null,
          match: article.match,
          passageReference: article.passageReference ?? null,
          overlapReference: article.overlapReference ?? null,
        })),
        searchedAt: group.searchedAt,
        errorMessage: group.errorMessage ?? null,
      })),
    })
  }
  return reports
}

export interface FavoriteSiteSearchCacheOptions {
  /** Sem armazenamento, o cache vive só na memória do processo. */
  storage?: FavoriteSiteSearchStorage
  now?: () => Date
  storageKey?: string
  maxAgeMs?: number
  limit?: number
}

export class FavoriteSiteSearchCache {
  private readonly storage: FavoriteSiteSearchStorage | undefined
  private readonly now: () => Date
  private readonly storageKey: string
  private readonly maxAgeMs: number
  private readonly limit: number
  private reports: Map<string, FavoriteSiteSearchReport> | null = null
  private loading: Promise<Map<string, FavoriteSiteSearchReport>> | null = null

  constructor(options: FavoriteSiteSearchCacheOptions = {}) {
    this.storage = options.storage
    this.now = options.now ?? (() => new Date())
    this.storageKey = options.storageKey ?? FAVORITE_SITE_REPORTS_STORAGE_KEY
    this.maxAgeMs = options.maxAgeMs ?? FAVORITE_SITE_SEARCH_CACHE_TTL_MS
    this.limit = options.limit ?? FAVORITE_SITE_SEARCH_CACHE_LIMIT
  }

  /** Relatório salvo para a chave, de qualquer idade. */
  async get(cacheKey: string): Promise<FavoriteSiteSearchReport | null> {
    return (await this.load()).get(cacheKey) ?? null
  }

  /** Relatório salvo há menos de 24 horas. */
  async getFresh(cacheKey: string): Promise<FavoriteSiteSearchReport | null> {
    const report = await this.get(cacheKey)
    return report && this.isFresh(report) ? report : null
  }

  isFresh(report: FavoriteSiteSearchReport): boolean {
    return this.now().getTime() - report.searchedAt.getTime() < this.maxAgeMs
  }

  async put(report: FavoriteSiteSearchReport): Promise<void> {
    const reports = await this.load()
    reports.set(report.cacheKey, report)
    const kept = this.newestFirst(reports)
    this.reports = new Map(kept.map((item) => [item.cacheKey, item]))
    await this.storage?.set(this.storageKey, serializeFavoriteSiteReports(kept))
  }

  /** Relê o armazenamento (por exemplo, depois de restaurar um backup). */
  async reload(): Promise<void> {
    this.reports = null
    this.loading = null
    await this.load()
  }

  private newestFirst(reports: Map<string, FavoriteSiteSearchReport>): FavoriteSiteSearchReport[] {
    return [...reports.values()]
      .sort((left, right) => right.searchedAt.getTime() - left.searchedAt.getTime())
      .slice(0, this.limit)
  }

  private async load(): Promise<Map<string, FavoriteSiteSearchReport>> {
    if (this.reports) return this.reports
    this.loading ??= this.read()
    const loaded = await this.loading
    this.reports ??= loaded
    return this.reports
  }

  private async read(): Promise<Map<string, FavoriteSiteSearchReport>> {
    let text: string | null | undefined
    try {
      text = await this.storage?.get(this.storageKey)
    } catch {
      text = null
    }
    const reports = new Map<string, FavoriteSiteSearchReport>()
    for (const report of deserializeFavoriteSiteReports(text)) {
      const existing = reports.get(report.cacheKey)
      // Chave repetida: fica o relatório mais recente.
      if (!existing || report.searchedAt.getTime() > existing.searchedAt.getTime()) {
        reports.set(report.cacheKey, report)
      }
    }
    return reports
  }
}
