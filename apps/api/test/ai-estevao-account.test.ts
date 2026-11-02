import { afterEach, describe, expect, it } from 'vitest'
import { bearer, createTestContext, json, login, stubRunner, usage } from './helpers'
import type { TestContext } from './helpers'
import { grantDays } from '../src/modules/admin/plugin'
import type { AIRunner } from '../src/modules/ai/runner'
import { AIRunError } from '../src/modules/ai/runner'

let context: TestContext

afterEach(async () => {
  await context?.close()
})

const review = { mainReference: 'Romanos 13:8-14', manuscript: 'O amor cumpre a lei.', criteria: ['spelling', 'clarity'] }

describe('IA pelo servidor', () => {
  it('exige assinatura, registra uso e aplica o limite mensal', async () => {
    context = await createTestContext({ LIMIT_REVIEWS_PER_MONTH: '2' })
    const token = await login(context)
    const free = await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    expect(free.statusCode).toBe(402)
    expect(free.json().error.code).toBe('subscription_required')

    await grantDays(context.deps, 'pastor@example.com', 30)
    const first = await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ model: 'claude-sonnet-5-5', usage: { used: { review: 1 } } })
    await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    const third = await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('monthly_limit')

    // Checagem de estrutura conta separado.
    const structure = await context.app.inject({
      method: 'POST',
      url: '/v1/ai/review',
      headers: bearer(token),
      payload: { ...review, criteria: ['structure'] },
    })
    expect(structure.statusCode).toBe(200)
    expect(structure.json().usage.used).toMatchObject({ review: 2, structure: 1 })
  })

  it('valida entrada e limite dos materiais', async () => {
    context = await createTestContext()
    const token = await login(context)
    await grantDays(context.deps, 'pastor@example.com', 30)
    const empty = await context.app.inject({
      method: 'POST',
      url: '/v1/ai/review',
      headers: bearer(token),
      payload: { ...review, manuscript: '   ' },
    })
    expect(empty.statusCode).toBe(400)
    const big = 'x'.repeat(23_000)
    const sources = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, title: 'T', citation: 'p. 1', text: big }))
    const tooMuch = await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: { ...review, sources } })
    expect(tooMuch.statusCode).toBe(400)
    expect(tooMuch.json().error.message).toContain('120 KB')
    const badCriteria = await context.app.inject({
      method: 'POST',
      url: '/v1/ai/review',
      headers: bearer(token),
      payload: { ...review, criteria: ['reescrever'] },
    })
    expect(badCriteria.statusCode).toBe(400)
  })

  it('bloqueia chamadas simultâneas e aplica o teto de custo', async () => {
    let release: () => void = () => {}
    const slow: AIRunner = {
      ...stubRunner,
      async review() {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { result: {}, usage: usage(5) }
      },
    }
    context = await createTestContext({ LIMIT_MONTHLY_COST_USD: '4' }, slow)
    const token = await login(context)
    await grantDays(context.deps, 'pastor@example.com', 30)
    const pending = context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const concurrent = await context.app.inject({ method: 'POST', url: '/v1/ai/questions', headers: bearer(token), payload: review })
    expect(concurrent.statusCode).toBe(409)
    release()
    expect((await pending).statusCode).toBe(200)
    const capped = await context.app.inject({ method: 'POST', url: '/v1/ai/questions', headers: bearer(token), payload: review })
    expect(capped.statusCode).toBe(429)
    expect(capped.json().error.code).toBe('cost_cap')
  })

  it('registra falha do provedor sem consumir a cota', async () => {
    const failing: AIRunner = {
      ...stubRunner,
      async review() {
        throw new AIRunError('A resposta veio incompleta.', 'incomplete', 502, usage(0.02))
      },
    }
    context = await createTestContext({}, failing)
    const token = await login(context)
    await grantDays(context.deps, 'pastor@example.com', 30)
    const response = await context.app.inject({ method: 'POST', url: '/v1/ai/review', headers: bearer(token), payload: review })
    expect(response.statusCode).toBe(502)
    expect(response.json().error).toMatchObject({ code: 'incomplete', message: 'A resposta veio incompleta.' })
    const view = (await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(token) })).json()
    expect(view.usage.used.review).toBe(0)
    const rows = await context.db.selectFrom('usage_events').selectAll().execute()
    expect(rows[0]).toMatchObject({ status: 'error', error_code: 'incomplete' })
  })
})

describe('proxy da Estêvão API', () => {
  it('usa o identificador interno do servidor, filtra parâmetros e guarda em cache', async () => {
    context = await createTestContext()
    let upstream = 0
    context.fake.routes.push((url, init) => {
      if (url.host !== 'api.caminhoanglicano.com.br') return undefined
      upstream += 1
      expect(new Headers(init.headers).get('x-app-internal-id')).toBe('identificador-estevao-servidor')
      expect(url.searchParams.has('evil')).toBe(false)
      return json({ data: { date: '2026-11-01', sunday_name: 'Todos os Santos' } })
    })
    const token = await login(context)
    const free = await context.app.inject({ method: 'GET', url: '/v1/estevao/days/2026-11-01', headers: bearer(token) })
    expect(free.statusCode).toBe(402)

    await grantDays(context.deps, 'pastor@example.com', 30)
    const url = '/v1/estevao/days/2026-11-01?book=loc_2027&lang=pt-BR&bible=nvt&evil=1'
    const first = await context.app.inject({ method: 'GET', url, headers: bearer(token) })
    expect(first.statusCode).toBe(200)
    expect(first.headers['x-pregar-cache']).toBe('miss')
    expect(first.json().data.sunday_name).toBe('Todos os Santos')
    const second = await context.app.inject({ method: 'GET', url, headers: bearer(token) })
    expect(second.headers['x-pregar-cache']).toBe('hit')
    expect(upstream).toBe(1)

    const blocked = await context.app.inject({ method: 'GET', url: '/v1/estevao/admin/keys', headers: bearer(token) })
    expect(blocked.statusCode).toBe(404)
    const traversal = await context.app.inject({ method: 'GET', url: '/v1/estevao/../v1/admin', headers: bearer(token) })
    expect(traversal.statusCode).toBe(404)
  })

  it('pode ser liberado para contas gratuitas por configuração', async () => {
    context = await createTestContext({ ESTEVAO_PROXY_FOR_FREE: 'true' })
    context.fake.routes.push((url) => (url.host === 'api.caminhoanglicano.com.br' ? json({ data: [] }) : undefined))
    const token = await login(context)
    const response = await context.app.inject({ method: 'GET', url: '/v1/estevao/bible-versions', headers: bearer(token) })
    expect(response.statusCode).toBe(200)
  })
})

describe('conta e LGPD', () => {
  it('exporta e apaga a conta', async () => {
    context = await createTestContext()
    const token = await login(context)
    const exported = await context.app.inject({ method: 'GET', url: '/v1/account/export', headers: bearer(token) })
    expect(exported.statusCode).toBe(200)
    expect(exported.json().user.email).toBe('pastor@example.com')
    const refused = await context.app.inject({ method: 'DELETE', url: '/v1/account', headers: bearer(token), payload: { confirm: 'sim' } })
    expect(refused.statusCode).toBe(400)
    const deleted = await context.app.inject({ method: 'DELETE', url: '/v1/account', headers: bearer(token), payload: { confirm: 'APAGAR' } })
    expect(deleted.statusCode).toBe(204)
    const after = await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(token) })
    expect(after.statusCode).toBe(401)
    const users = await context.db.selectFrom('users').selectAll().execute()
    expect(users[0]?.email).toMatch(/^apagado\+/)
    // O mesmo email pode criar uma conta nova.
    const again = await login(context)
    expect(again).toMatch(/^prg_/)
  })

  it('serve páginas legais, saúde e cabeçalhos de segurança', async () => {
    context = await createTestContext()
    const privacy = await context.app.inject({ method: 'GET', url: '/legal/privacidade' })
    expect(privacy.statusCode).toBe(200)
    expect(privacy.body).toContain('LGPD')
    expect(privacy.headers['x-content-type-options']).toBe('nosniff')
    expect(privacy.headers['content-security-policy']).toContain("default-src 'none'")
    const health = await context.app.inject({ method: 'GET', url: '/health' })
    expect(health.json()).toEqual({ ok: true })
    const missing = await context.app.inject({ method: 'GET', url: '/nao-existe' })
    expect(missing.statusCode).toBe(404)
  })

  it('protege as rotas administrativas', async () => {
    context = await createTestContext()
    const denied = await context.app.inject({ method: 'POST', url: '/v1/admin/grant', payload: { email: 'x@example.com', days: 30 } })
    expect(denied.statusCode).toBe(401)
    const granted = await context.app.inject({
      method: 'POST',
      url: '/v1/admin/grant',
      headers: bearer(context.config.ADMIN_TOKEN!),
      payload: { email: 'x@example.com', days: 30 },
    })
    expect(granted.statusCode).toBe(200)
  })
})
