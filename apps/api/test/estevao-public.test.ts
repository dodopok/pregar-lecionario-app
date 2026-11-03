import { afterEach, describe, expect, it } from 'vitest'
import { createTestContext, json } from './helpers'
import type { TestContext } from './helpers'
import { loadConfig } from '../src/config'

let context: TestContext

afterEach(async () => {
  await context?.close()
})

/** Estêvão API falsa: devolve um dia ou uma lista e anota as URLs recebidas. */
function fakeEstevao(context: TestContext): URL[] {
  const received: URL[] = []
  context.fake.routes.push((url) => {
    if (url.host !== 'api.caminhoanglicano.com.br') return undefined
    received.push(url)
    const day = /^\/api\/v2\/days\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname)?.[1]
    if (day) return json({ data: { date: day, sunday_name: 'Domingo' } })
    return json({ data: [{ date: url.searchParams.get('from'), sunday_name: 'Domingo' }] })
  })
  return received
}

const get = (url: string, headers: Record<string, string> = {}) =>
  context.app.inject({ method: 'GET', url, headers })

const DAY = 24 * 60 * 60 * 1000

describe('degustação pública das leituras', () => {
  it('fica desligada por padrão', async () => {
    context = await createTestContext()
    const status = await get('/v1/public/preview')
    expect(status.statusCode).toBe(200)
    expect(status.json()).toEqual({ enabled: false, days: 0, from: null, to: null })
    const denied = await get('/v1/public/estevao/days/2026-11-08')
    expect(denied.statusCode).toBe(404)
    expect(denied.json().error).toEqual({
      code: 'preview_disabled',
      message: 'A degustação está desativada.',
    })
  })

  it('informa a janela e serve dias sem conta, filtrando parâmetros e guardando em cache', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true' })
    const received = fakeEstevao(context)
    // O relógio de teste marca 2026-11-01: 7 dias para trás e 35 para a frente.
    const status = await get('/v1/public/preview')
    expect(status.json()).toEqual({ enabled: true, days: 35, from: '2026-10-25', to: '2026-12-06' })

    const url = '/v1/public/estevao/days/2026-11-08?book=loc_2027&lang=pt-BR&bible=nvt&from=2020-01-01&evil=1'
    const first = await get(url)
    expect(first.statusCode).toBe(200)
    expect(first.json().data.date).toBe('2026-11-08')
    expect(first.headers['x-pregar-cache']).toBe('miss')
    expect(first.headers['cache-control']).toBe('public, max-age=3600')
    expect(received).toHaveLength(1)
    expect(received[0]?.pathname).toBe('/api/v2/days/2026-11-08')
    expect(received[0]?.searchParams.get('book')).toBe('loc_2027')
    expect(received[0]?.searchParams.get('bible')).toBe('nvt')
    expect(received[0]?.searchParams.has('evil')).toBe(false)
    expect(received[0]?.searchParams.has('from')).toBe(false)
    const upstreamHeaders = new Headers(context.fake.calls[0]?.init.headers)
    expect(upstreamHeaders.get('x-app-internal-id')).toBe('identificador-estevao-servidor')

    const second = await get(url)
    expect(second.statusCode).toBe(200)
    expect(second.headers['x-pregar-cache']).toBe('hit')
    expect(received).toHaveLength(1)
  })

  it('só aceita dias e intervalos do calendário', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true' })
    const received = fakeEstevao(context)
    const denied = [
      'bible-versions',
      'prayer-books',
      'passages?ref=Jo%203.16&bible=nvt',
      'admin/keys',
      '../v1/admin',
      'days/2026-11-08/texto',
      '',
    ]
    for (const path of denied) {
      const response = await get(`/v1/public/estevao/${path}`)
      expect(response.statusCode, path).toBe(404)
      expect(response.json().error.code, path).toBe('not_found')
    }
    expect(received).toHaveLength(0)
  })

  it('recusa dias fora da janela e datas inválidas', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true', ESTEVAO_PREVIEW_DAYS: '14' })
    fakeEstevao(context)
    expect((await get('/v1/public/preview')).json()).toMatchObject({
      days: 14,
      from: '2026-10-25',
      to: '2026-11-15',
    })
    expect((await get('/v1/public/estevao/days/2026-10-25')).statusCode).toBe(200)
    expect((await get('/v1/public/estevao/days/2026-11-15')).statusCode).toBe(200)

    const before = await get('/v1/public/estevao/days/2026-10-24')
    expect(before.statusCode).toBe(400)
    expect(before.json().error).toMatchObject({
      code: 'preview_window',
      details: { from: '2026-10-25', to: '2026-11-15' },
    })
    expect(before.json().error.message).toContain('25/10/2026')
    expect(before.json().error.message).toContain('15/11/2026')
    const after = await get('/v1/public/estevao/days/2026-11-16')
    expect(after.statusCode).toBe(400)
    expect(after.json().error.code).toBe('preview_window')

    const invalid = await get('/v1/public/estevao/days/2026-02-30')
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('bad_request')

    // A janela acompanha o relógio.
    context.clock.advance(2 * DAY)
    expect((await get('/v1/public/estevao/days/2026-11-17')).statusCode).toBe(200)
  })

  it('recorta intervalos para a janela e recusa os que ficam de fora', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true' })
    const received = fakeEstevao(context)

    const clamped = await get(
      '/v1/public/estevao/days?from=2026-01-01&to=2026-12-31&fields%5Bday%5D=date%2Csunday_name',
    )
    expect(clamped.statusCode).toBe(200)
    expect(clamped.headers['cache-control']).toBe('public, max-age=3600')
    expect(received[0]?.pathname).toBe('/api/v2/days')
    expect(received[0]?.searchParams.get('from')).toBe('2026-10-25')
    expect(received[0]?.searchParams.get('to')).toBe('2026-12-06')
    expect(received[0]?.searchParams.get('fields[day]')).toBe('date,sunday_name')

    // Sem from e to, vale a janela inteira.
    const bare = await get('/v1/public/estevao/days')
    expect(bare.statusCode).toBe(200)
    expect(received[1]?.searchParams.get('from')).toBe('2026-10-25')
    expect(received[1]?.searchParams.get('to')).toBe('2026-12-06')

    const inside = await get('/v1/public/estevao/days?from=2026-11-01&to=2026-11-30')
    expect(inside.statusCode).toBe(200)
    expect(received[2]?.searchParams.get('from')).toBe('2026-11-01')
    expect(received[2]?.searchParams.get('to')).toBe('2026-11-30')

    const outside = await get('/v1/public/estevao/days?from=2027-01-01&to=2027-01-31')
    expect(outside.statusCode).toBe(400)
    expect(outside.json().error.code).toBe('preview_window')
    const reversed = await get('/v1/public/estevao/days?from=2026-11-20&to=2026-11-10')
    expect(reversed.statusCode).toBe(400)
    expect(reversed.json().error.code).toBe('bad_request')
    const garbled = await get('/v1/public/estevao/days?from=hoje&to=2026-11-10')
    expect(garbled.statusCode).toBe(400)
    expect(garbled.json().error.code).toBe('bad_request')
    expect(received).toHaveLength(3)
  })

  it('limita por endereço IP', async () => {
    context = await createTestContext({
      ESTEVAO_PUBLIC_PREVIEW: 'true',
      LIMIT_ESTEVAO_PREVIEW_PER_MINUTE: '2',
    })
    fakeEstevao(context)
    const url = '/v1/public/estevao/days/2026-11-08'
    expect((await get(url)).statusCode).toBe(200)
    expect((await get(url)).statusCode).toBe(200)
    const limited = await get(url)
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error).toMatchObject({ code: 'rate_limited' })

    // Outro endereço (TRUST_PROXY ligado: vale o X-Forwarded-For) tem a própria janela,
    // e as consultas recusadas também contam.
    const other = { 'x-forwarded-for': '203.0.113.9' }
    expect((await get(url, other)).statusCode).toBe(200)
    expect((await get('/v1/public/estevao/admin', other)).statusCode).toBe(404)
    expect((await get(url, other)).statusCode).toBe(429)

    context.clock.advance(60_000)
    expect((await get(url)).statusCode).toBe(200)
  })

  it('repassa erros da Estêvão API como o proxy dos assinantes', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true' })
    context.fake.routes.push((url) => {
      if (url.host !== 'api.caminhoanglicano.com.br') return undefined
      if (url.pathname.endsWith('2026-11-08')) return json({ detail: 'Sem dados para a data.' }, 404)
      return json({ detail: 'Erro interno.' }, 500)
    })
    const missing = await get('/v1/public/estevao/days/2026-11-08')
    expect(missing.statusCode).toBe(404)
    expect(missing.headers['cache-control']).toBe('no-store')
    expect(missing.json().detail).toBe('Sem dados para a data.')
    const broken = await get('/v1/public/estevao/days/2026-11-15')
    expect(broken.statusCode).toBe(502)
    expect(broken.json().error.code).toBe('upstream_error')
  })

  it('responde 503 quando o identificador do servidor não está configurado', async () => {
    context = await createTestContext({ ESTEVAO_PUBLIC_PREVIEW: 'true', ESTEVAO_APP_INTERNAL_ID: '' })
    const response = await get('/v1/public/estevao/days/2026-11-08')
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('unavailable')
  })

  it('não aceita janela maior que 120 dias na configuração', () => {
    const base = { DATABASE_URL: 'postgres://x', AUTH_SECRET: 'a'.repeat(32) }
    expect(() => loadConfig({ ...base, ESTEVAO_PREVIEW_DAYS: '121' })).toThrow(/ESTEVAO_PREVIEW_DAYS/)
    expect(loadConfig({ ...base, ESTEVAO_PREVIEW_DAYS: '120' }).ESTEVAO_PREVIEW_DAYS).toBe(120)
    expect(loadConfig(base)).toMatchObject({
      ESTEVAO_PUBLIC_PREVIEW: false,
      ESTEVAO_PREVIEW_DAYS: 35,
      LIMIT_ESTEVAO_PREVIEW_PER_MINUTE: 20,
    })
  })
})
