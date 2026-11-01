import { describe, expect, it } from 'vitest'
import { LiturgyService } from '../../src/main/services/liturgy'

function setup() {
  const secrets = new Map<string, string>()
  const cache = new Map<string, unknown>()
  const requests: string[] = []
  let status = 200
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    requests.push(headers.get('X-API-Key') ?? '')
    const body = status === 200 ? { data: [{ code: 'loc_2027', name: 'REB - 2027' }] } : { error: 'Chave inválida' }
    void input
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const service = new LiturgyService({
    http: () => ({ fetch }),
    settings: () =>
      ({
        liturgy: { prayerBook: 'loc_2027', language: 'pt-BR', bible: 'nvt', readingType: 'main' },
        ai: { preferOwnKeys: false },
      }) as never,
    secrets: {
      get: (name: string) => secrets.get(name) ?? null,
    } as never,
    account: { current: () => ({ loggedIn: false }) } as never,
    cache: {
      get: (key: string) => cache.get(key),
      set: (key: string, value: unknown) => void cache.set(key, value),
    } as never,
    apiBaseURL: () => 'https://api.exemplo.test',
  })
  return {
    service,
    secrets,
    requests,
    failWith: (code: number) => {
      status = code
    },
  }
}

describe('cache das leituras', () => {
  it('reaproveita a resposta enquanto a chave é a mesma', async () => {
    const { service, secrets, requests } = setup()
    secrets.set('estevao', 'chave-boa')
    await service.prayerBooks()
    await service.prayerBooks()
    expect(requests).toEqual(['chave-boa'])
  })

  it('consulta de novo quando a chave muda, e uma chave recusada não passa pelo cache', async () => {
    const { service, secrets, requests, failWith } = setup()
    secrets.set('estevao', 'chave-boa')
    await service.prayerBooks()
    secrets.set('estevao', 'chave-errada')
    failWith(401)
    await expect(service.prayerBooks()).rejects.toThrow()
    expect(requests).toEqual(['chave-boa', 'chave-errada'])
  })
})
