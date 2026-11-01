import { sql } from 'kysely'
import type { Kysely } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import type { AppServices } from '../src/app'
import { loadConfig } from '../src/config'
import type { AppConfig } from '../src/config'
import { createDatabase, migrateToLatest } from '../src/db'
import type { Database } from '../src/db/schema'
import type { AppDeps, Clock } from '../src/lib/context'
import { LogEmailSender } from '../src/lib/email'
import type { AIRunner } from '../src/modules/ai/runner'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pregar:pregar@127.0.0.1:5432/pregar_test'

export class TestClock implements Clock {
  constructor(public current = new Date('2026-11-01T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined

/** fetch falso: cada rota devolve uma Response ou undefined para passar adiante. */
export class FakeFetch {
  routes: Route[] = []
  calls: { url: URL; init: RequestInit }[] = []

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    this.calls.push({ url, init })
    for (const route of this.routes) {
      const response = await route(url, init)
      if (response) return response
    }
    throw new Error(`Sem rota falsa para ${init.method ?? 'GET'} ${url.toString()}`)
  }

  on(method: string, pathPattern: RegExp, handler: (url: URL, body: unknown, init: RequestInit) => unknown, status = 200): void {
    this.routes.push((url, init) => {
      if ((init.method ?? 'GET').toUpperCase() !== method || !pathPattern.test(url.pathname)) return undefined
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      return json(handler(url, body, init), status)
    })
  }
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

export const stubRunner: AIRunner = {
  async review() {
    return { result: { findings: [], rejectedFindingCount: 0 }, usage: usage() }
  },
  async questions() {
    return { result: { questions: [] }, usage: usage() }
  },
  async research() {
    return { result: { sources: [] }, usage: usage() }
  },
}

export function usage(costUSD = 0.05) {
  return { provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 500, costUSD }
}

export interface TestContext {
  app: FastifyInstance
  db: Kysely<Database>
  config: AppConfig
  clock: TestClock
  email: LogEmailSender
  fake: FakeFetch
  deps: AppDeps
  services: AppServices
  close(): Promise<void>
}

export async function resetDatabase(db: Kysely<Database>): Promise<void> {
  await migrateToLatest(db)
  await sql`truncate table estevao_cache, ai_inflight, usage_events, webhook_events, payments, subscriptions, sessions, login_codes, users restart identity cascade`.execute(
    db,
  )
}

export async function createTestContext(
  overrides: Record<string, string> = {},
  runner: AIRunner = stubRunner,
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
    ASAAS_API_KEY: '$aact_teste_chave_do_asaas_sandbox',
    ASAAS_WEBHOOK_TOKEN: 'token-do-webhook-de-teste-com-32-caracteres',
    ESTEVAO_API_KEY: 'chave-estevao-servidor',
    ADMIN_TOKEN: 'token-administrativo-de-teste-com-32-caracteres',
    LOG_LEVEL: 'silent',
    RECONCILE_INTERVAL_MINUTES: '0',
    ...overrides,
  })
  const { db } = createDatabase({ connectionString: config.DATABASE_URL, max: 4 })
  await resetDatabase(db)
  const clock = new TestClock()
  const email = new LogEmailSender()
  const fake = new FakeFetch()
  const deps: AppDeps = { config, db, clock, email, fetch: fake.fetch as typeof fetch }
  const { app, services } = await buildApp(deps, runner, { logger: false })
  await app.ready()
  return {
    app,
    db,
    config,
    clock,
    email,
    fake,
    deps,
    services,
    async close() {
      await app.close()
      await db.destroy()
    },
  }
}

export function lastCode(email: LogEmailSender): string {
  const message = email.sent.at(-1)
  const match = message ? /(\d{6})/.exec(message.subject) : null
  if (!match?.[1]) throw new Error('Nenhum código enviado')
  return match[1]
}

export async function login(context: TestContext, address = 'pastor@example.com'): Promise<string> {
  const start = await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: address } })
  if (start.statusCode !== 202) throw new Error(`start falhou: ${start.body}`)
  const verify = await context.app.inject({
    method: 'POST',
    url: '/v1/auth/verify',
    payload: { email: address, code: lastCode(context.email), deviceName: 'Teste', platform: 'linux' },
  })
  if (verify.statusCode !== 200) throw new Error(`verify falhou: ${verify.body}`)
  // Próximo código do mesmo email precisa respeitar o intervalo de reenvio.
  context.clock.advance(60_000)
  return verify.json().token as string
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}
