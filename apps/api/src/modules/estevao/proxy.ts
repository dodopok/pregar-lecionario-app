import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { ESTEVAO_ALLOWED_PATHS, ESTEVAO_ALLOWED_QUERY } from '@pregar/core/liturgy/client'
import type { AppDeps } from '../../lib/context'
import { ApiError, errors } from '../../lib/errors'
import { WindowLimiter } from '../../lib/window-limiter'
import type { BillingService } from '../billing/service'

interface CacheEntry {
  status: number
  body: string
  expiresAt: number
}

const MEMORY_LIMIT = 2000
const HOUR = 60 * 60 * 1000

function ttlFor(path: string): number {
  if (/^\/api\/v2\/days\/\d/.test(path)) return 12 * HOUR
  if (path === '/api/v2/days') return 24 * HOUR
  if (path === '/api/v2/passages') return 7 * 24 * HOUR
  return 24 * HOUR
}

/** Proxy da Estêvão API v2 para assinantes: a chave fica no servidor e as respostas são guardadas em cache. */
export class EstevaoProxy {
  private readonly memory = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<CacheEntry>>()

  constructor(private readonly deps: AppDeps) {}

  normalize(path: string, query: Record<string, unknown>): { upstreamPath: string; search: URLSearchParams; key: string } {
    const upstreamPath = `/api/v2/${path.replace(/^\/+/, '')}`
    if (!ESTEVAO_ALLOWED_PATHS.some((pattern) => pattern.test(upstreamPath))) {
      throw errors.notFound('Rota')
    }
    const search = new URLSearchParams()
    for (const name of [...Object.keys(query)].sort()) {
      if (!ESTEVAO_ALLOWED_QUERY.has(name)) continue
      const raw = query[name]
      const value = Array.isArray(raw) ? raw[0] : raw
      if (typeof value !== 'string' || value.length === 0) continue
      if (value.length > 200) throw errors.badRequest('Parâmetro longo demais.')
      search.set(name, value)
    }
    return { upstreamPath, search, key: `${upstreamPath}?${search.toString()}` }
  }

  private remember(key: string, entry: CacheEntry): void {
    this.memory.delete(key)
    this.memory.set(key, entry)
    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest)
    }
  }

  async get(path: string, query: Record<string, unknown>): Promise<CacheEntry & { cache: 'hit' | 'miss' }> {
    const { upstreamPath, search, key } = this.normalize(path, query)
    const now = this.deps.clock.now().getTime()
    const memory = this.memory.get(key)
    if (memory && memory.expiresAt > now) return { ...memory, cache: 'hit' }
    const stored = await this.deps.db
      .selectFrom('estevao_cache')
      .selectAll()
      .where('key', '=', key)
      .where('expires_at', '>', new Date(now))
      .executeTakeFirst()
    if (stored) {
      const entry = { status: stored.status, body: stored.body, expiresAt: stored.expires_at.getTime() }
      this.remember(key, entry)
      return { ...entry, cache: 'hit' }
    }
    // Consultas iguais e simultâneas compartilham a mesma ida à Estêvão API.
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.fetchUpstream(upstreamPath, search, key).finally(() => this.inflight.delete(key))
      this.inflight.set(key, pending)
    }
    return { ...(await pending), cache: 'miss' }
  }

  private async fetchUpstream(upstreamPath: string, search: URLSearchParams, key: string): Promise<CacheEntry> {
    const { config } = this.deps
    if (!config.ESTEVAO_API_KEY) throw errors.unavailable('As leituras pelo servidor ainda não estão configuradas.')
    const url = new URL(upstreamPath, config.ESTEVAO_API_URL)
    url.search = search.toString()
    let response: Response
    try {
      response = await this.deps.fetch(url, {
        headers: { 'X-API-Key': config.ESTEVAO_API_KEY, Accept: 'application/json, application/problem+json' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      this.deps.log?.warn({ err: error, path: upstreamPath }, 'Estêvão API indisponível')
      throw errors.unavailable('A Estêvão API não respondeu. Tente novamente em instantes.')
    }
    const body = await response.text()
    const entry: CacheEntry = { status: response.status, body, expiresAt: 0 }
    if (response.ok) {
      entry.expiresAt = this.deps.clock.now().getTime() + ttlFor(upstreamPath)
      this.remember(key, entry)
      await this.deps.db
        .insertInto('estevao_cache')
        .values({ key, status: response.status, body, fetched_at: this.deps.clock.now(), expires_at: new Date(entry.expiresAt) })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({ status: response.status, body, expires_at: new Date(entry.expiresAt), fetched_at: this.deps.clock.now() }),
        )
        .execute()
    } else if (response.status === 401 || response.status === 403) {
      this.deps.log?.error({ status: response.status }, 'Chave do servidor recusada pela Estêvão API')
      throw errors.unavailable('As leituras pelo servidor estão temporariamente indisponíveis.')
    }
    return entry
  }

  async purgeExpired(): Promise<void> {
    await this.deps.db.deleteFrom('estevao_cache').where('expires_at', '<', this.deps.clock.now()).execute()
  }
}

export function estevaoRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  proxy: EstevaoProxy,
  billing: BillingService,
  requireAuth: preHandlerHookHandler,
): void {
  const limiter = new WindowLimiter(deps.config.LIMIT_ESTEVAO_PER_MINUTE, 60_000)
  app.get('/v1/estevao/*', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.auth!.user
    if (!deps.config.ESTEVAO_PROXY_FOR_FREE && (await billing.planFor(user.id)) !== 'pro') {
      throw errors.forbiddenPlan()
    }
    if (!limiter.take(user.id)) throw errors.rateLimited('Muitas consultas às leituras em pouco tempo. Aguarde um instante.')
    const path = (request.params as { '*': string })['*'] ?? ''
    const result = await proxy.get(path, request.query as Record<string, unknown>)
    if (result.status >= 500) throw new ApiError(502, 'upstream_error', 'A Estêvão API respondeu com erro. Tente de novo.')
    return reply
      .status(result.status)
      .header('content-type', 'application/json; charset=utf-8')
      .header('x-pregar-cache', result.cache)
      .header('cache-control', 'private, max-age=300')
      .send(result.body)
  })
}
