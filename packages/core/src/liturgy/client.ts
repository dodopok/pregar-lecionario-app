import { loggedRequest, tryParseJSON } from '../util/http'
import type { HttpContext } from '../util/http'
import { dateKey } from '../util/dates'
import type {
  BiblePassage,
  BiblePassageText,
  BibleVersion,
  LiturgicalDay,
  LiturgicalSettings,
  PrayerBookCatalogEntry,
} from './types'
import { ESTEVAO_API_BASE_URL } from './types'

export class LiturgicalAPIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'LiturgicalAPIError'
  }
}

/**
 * Como a requisição chega à Estêvão API: direto com a chave do usuário (plano gratuito)
 * ou pelo proxy da API do Pregar, que acrescenta a chave do servidor (assinantes).
 */
export type LiturgicalTransport =
  | { kind: 'direct'; apiKey: string; baseURL?: string }
  | { kind: 'proxy'; baseURL: string; sessionToken: string }

export interface LiturgicalClientOptions {
  http: HttpContext
  transport: LiturgicalTransport
  settings: LiturgicalSettings
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())
}

/** Converte chaves snake_case em camelCase recursivamente (equivalente ao `.convertFromSnakeCase`). */
export function camelizeKeys<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelizeKeys(item)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[snakeToCamel(key)] = camelizeKeys(item)
    }
    return result as T
  }
  return value as T
}

/** Caminhos v2 aceitos; o proxy do servidor usa a mesma lista. */
export const ESTEVAO_ALLOWED_PATHS = [
  /^\/api\/v2\/days\/\d{4}-\d{2}-\d{2}$/,
  /^\/api\/v2\/days$/,
  /^\/api\/v2\/passages$/,
  /^\/api\/v2\/bible-versions$/,
  /^\/api\/v2\/prayer-books$/,
]

export const ESTEVAO_ALLOWED_QUERY = new Set([
  'book',
  'lang',
  'bible',
  'include',
  'reading_type',
  'from',
  'to',
  'fields[day]',
  'fields[prayer_book]',
  'ref',
  'text_format',
])

export class LiturgicalClient {
  constructor(private readonly options: LiturgicalClientOptions) {}

  private buildURL(path: string, query: Record<string, string | undefined>): URL {
    const transport = this.options.transport
    let url: URL
    if (transport.kind === 'direct') {
      url = new URL(path, transport.baseURL ?? ESTEVAO_API_BASE_URL)
    } else {
      // O proxy espelha os caminhos v2 sob /v1/estevao.
      const base = transport.baseURL.replace(/\/+$/, '')
      url = new URL(`${base}/v1/estevao${path.replace(/^\/api\/v2/, '')}`)
    }
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value)
    }
    return url
  }

  private async get<T>(path: string, query: Record<string, string | undefined>): Promise<T> {
    const transport = this.options.transport
    const url = this.buildURL(path, query)
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json' }
    if (transport.kind === 'direct') {
      if (!transport.apiKey) {
        throw new LiturgicalAPIError('Salve a chave da Estêvão API nas Preferências para carregar o calendário.')
      }
      headers['X-API-Key'] = transport.apiKey
    } else {
      headers.Authorization = `Bearer ${transport.sessionToken}`
    }
    const response = await loggedRequest(
      this.options.http,
      url,
      { method: 'GET', headers },
      { integration: transport.kind === 'direct' ? 'Estêvão API' : 'Pregar API', operation: 'consulta', timeoutMs: 30_000 },
    )
    if (!response.ok) {
      const problem = tryParseJSON<{ detail?: string; code?: string; error?: { message?: string; code?: string } }>(
        response.text(),
      )
      let detail = problem?.detail ?? problem?.error?.message
      if (!detail) {
        if (response.status === 404) {
          detail = 'A rota da API v2 não foi encontrada neste endereço. Confira se a v2 está publicada no servidor.'
        } else if (response.status === 401) {
          detail = 'A chave da Estêvão API foi recusada.'
        } else if (response.status === 429) {
          detail = 'Muitas consultas em pouco tempo. Aguarde alguns segundos.'
        } else {
          detail = response.response.statusText || 'Falha na consulta'
        }
      }
      const code = problem?.code ?? problem?.error?.code
      throw new LiturgicalAPIError(`${detail} (HTTP ${response.status}${code ? `, ${code}` : ''}).`, response.status, code)
    }
    const json = tryParseJSON<{ data?: unknown }>(response.text())
    if (!json || json.data === undefined) {
      throw new LiturgicalAPIError('A resposta da Estêvão API não corresponde ao formato esperado da v2.')
    }
    return camelizeKeys<T>(json.data)
  }

  fetchDay(date: Date | string): Promise<LiturgicalDay> {
    const key = typeof date === 'string' ? date : dateKey(date)
    const { settings } = this.options
    return this.get<LiturgicalDay>(`/api/v2/days/${key}`, {
      book: settings.prayerBook,
      lang: settings.language,
      bible: settings.bible,
      include: 'readings.text,collect.text,celebrations',
      reading_type: settings.readingType || undefined,
    })
  }

  /** Nomes dos domingos do intervalo, sem leituras nem coletas (consulta leve do calendário). */
  fetchCalendarDays(from: Date | string, to: Date | string): Promise<LiturgicalDay[]> {
    const { settings } = this.options
    return this.get<LiturgicalDay[]>('/api/v2/days', {
      from: typeof from === 'string' ? from : dateKey(from),
      to: typeof to === 'string' ? to : dateKey(to),
      book: settings.prayerBook,
      lang: settings.language,
      'fields[day]': 'date,sunday_name,is_sunday',
    })
  }

  async fetchPassage(reference: string, bible: string): Promise<BiblePassageText> {
    const passage = await this.get<BiblePassage>('/api/v2/passages', {
      ref: reference,
      bible,
      text_format: 'verses',
    })
    if (!passage.text) {
      throw new LiturgicalAPIError(`A passagem ${reference} não está disponível em ${bible.toUpperCase()}.`)
    }
    return passage.text
  }

  fetchBibleVersions(): Promise<BibleVersion[]> {
    return this.get<BibleVersion[]>('/api/v2/bible-versions', {})
  }

  fetchPrayerBooks(): Promise<PrayerBookCatalogEntry[]> {
    return this.get<PrayerBookCatalogEntry[]>('/api/v2/prayer-books', {
      'fields[prayer_book]':
        'code,name,description,language,jurisdiction,year,is_recommended,image_url,thumbnail_url',
    })
  }
}
