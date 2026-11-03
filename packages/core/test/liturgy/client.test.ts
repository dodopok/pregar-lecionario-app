import { describe, expect, it } from 'vitest'
import {
  LiturgicalAPIError,
  LiturgicalClient,
  PREVIEW_PAST_DAYS,
  fetchPreviewStatus,
  previewWindow,
} from '../../src/liturgy/client'
import type { LiturgicalTransport } from '../../src/liturgy/client'
import { DEFAULT_LITURGICAL_SETTINGS } from '../../src/liturgy/types'
import type { HttpContext } from '../../src/util/http'

interface Captured {
  url: URL
  headers: Headers
}

/** fetch falso que anota URL e cabeçalhos e responde sempre o mesmo corpo. */
function fakeHttp(body: unknown, status = 200): { http: HttpContext; calls: Captured[] } {
  const calls: Captured[] = []
  const http: HttpContext = {
    fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    },
  }
  return { http, calls }
}

function clientFor(
  transport: LiturgicalTransport,
  body: unknown = { data: { date: '2026-11-08' } },
  status = 200,
) {
  const { http, calls } = fakeHttp(body, status)
  const client = new LiturgicalClient({ http, transport, settings: DEFAULT_LITURGICAL_SETTINGS })
  return { client, calls }
}

function pathOf(call: Captured | undefined): string {
  if (!call) throw new Error('nenhuma chamada registrada')
  return `${call.url.origin}${call.url.pathname}`
}

describe('transporte do cliente litúrgico', () => {
  it('degustação: espelha os caminhos v2 em /v1/public/estevao, sem credencial', async () => {
    const { client, calls } = clientFor({ kind: 'preview', baseURL: 'https://api.pregar.app/' })
    const day = await client.fetchDay('2026-11-08')
    expect(day.date).toBe('2026-11-08')
    expect(pathOf(calls[0])).toBe('https://api.pregar.app/v1/public/estevao/days/2026-11-08')
    expect(calls[0]?.url.searchParams.get('book')).toBe('loc_2027')
    expect(calls[0]?.url.searchParams.get('include')).toBe('readings.text,collect.text,celebrations')
    expect(calls[0]?.headers.has('authorization')).toBe(false)
    expect(calls[0]?.headers.has('x-api-key')).toBe(false)
    expect(calls[0]?.headers.get('accept')).toContain('application/json')
  })

  it('degustação: o calendário leve vai para /v1/public/estevao/days com from e to', async () => {
    const { client, calls } = clientFor({ kind: 'preview', baseURL: 'https://api.pregar.app' }, { data: [] })
    await client.fetchCalendarDays('2026-10-25', '2026-12-06')
    expect(pathOf(calls[0])).toBe('https://api.pregar.app/v1/public/estevao/days')
    expect(calls[0]?.url.searchParams.get('from')).toBe('2026-10-25')
    expect(calls[0]?.url.searchParams.get('to')).toBe('2026-12-06')
    expect(calls[0]?.headers.has('authorization')).toBe(false)
  })

  it('assinantes: /v1/estevao com o token da sessão', async () => {
    const { client, calls } = clientFor({
      kind: 'proxy',
      baseURL: 'https://api.pregar.app',
      sessionToken: 'prg_token',
    })
    await client.fetchDay('2026-11-08')
    expect(pathOf(calls[0])).toBe('https://api.pregar.app/v1/estevao/days/2026-11-08')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer prg_token')
    expect(calls[0]?.headers.has('x-api-key')).toBe(false)
  })

  it('direto: a Estêvão API com a chave da pessoa', async () => {
    const { client, calls } = clientFor({ kind: 'direct', apiKey: 'chave-propria' })
    await client.fetchDay('2026-11-08')
    expect(pathOf(calls[0])).toBe('https://api.caminhoanglicano.com.br/api/v2/days/2026-11-08')
    expect(calls[0]?.headers.get('x-api-key')).toBe('chave-propria')
    expect(calls[0]?.headers.has('authorization')).toBe(false)
  })

  it('erros da API do Pregar chegam com código e mensagem', async () => {
    const { client } = clientFor(
      { kind: 'preview', baseURL: 'https://api.pregar.app' },
      { error: { code: 'preview_disabled', message: 'A degustação está desativada.' } },
      404,
    )
    const error = await client.fetchDay('2026-11-08').catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(LiturgicalAPIError)
    expect(error).toMatchObject({ status: 404, code: 'preview_disabled' })
    expect((error as Error).message).toContain('A degustação está desativada.')
  })
})

describe('janela da degustação', () => {
  it('vai de 7 dias atrás até N dias à frente, em dias UTC', () => {
    expect(PREVIEW_PAST_DAYS).toBe(7)
    expect(previewWindow(new Date('2026-11-01T12:00:00.000Z'), 35)).toEqual({
      from: '2026-10-25',
      to: '2026-12-06',
    })
    expect(previewWindow(new Date('2026-12-30T23:30:00.000Z'), 10)).toEqual({
      from: '2026-12-23',
      to: '2027-01-09',
    })
    expect(previewWindow(new Date('2026-11-01T00:30:00.000Z'), 0)).toEqual({
      from: '2026-10-25',
      to: '2026-11-01',
    })
    // Ano bissexto: 29 de fevereiro conta como um dia.
    expect(previewWindow(new Date('2028-02-27T12:00:00.000Z'), 3)).toEqual({
      from: '2028-02-20',
      to: '2028-03-01',
    })
  })
})

describe('fetchPreviewStatus', () => {
  it('lê a janela informada pela API do Pregar', async () => {
    const { http, calls } = fakeHttp({ enabled: true, days: 35, from: '2026-10-25', to: '2026-12-06' })
    const status = await fetchPreviewStatus(http, 'https://api.pregar.app/')
    expect(status).toEqual({ enabled: true, days: 35, from: '2026-10-25', to: '2026-12-06' })
    expect(pathOf(calls[0])).toBe('https://api.pregar.app/v1/public/preview')
    expect(calls[0]?.headers.has('authorization')).toBe(false)
  })

  it('degustação desligada vem sem janela', async () => {
    const { http } = fakeHttp({ enabled: false, days: 0, from: null, to: null })
    expect(await fetchPreviewStatus(http, 'https://api.pregar.app')).toEqual({
      enabled: false,
      days: 0,
      from: null,
      to: null,
    })
  })

  it('recusa respostas fora do formato ou com erro', async () => {
    const { http: broken } = fakeHttp({ ok: true })
    await expect(fetchPreviewStatus(broken, 'https://api.pregar.app')).rejects.toBeInstanceOf(
      LiturgicalAPIError,
    )
    const { http: failing } = fakeHttp({ error: { code: 'internal' } }, 500)
    await expect(fetchPreviewStatus(failing, 'https://api.pregar.app')).rejects.toMatchObject({ status: 500 })
  })
})
