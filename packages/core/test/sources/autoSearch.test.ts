import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../../src/util/http'
import {
  BUILT_IN_FAVORITE_SITES,
  FAVORITE_SITE_REPORTS_STORAGE_KEY,
  FavoriteSiteSearchAutoGate,
  FavoriteSiteSearchCache,
  FavoriteSiteSearchCoordinator,
  favoriteSiteSearchCacheKey,
  serializeFavoriteSiteReports,
} from '../../src/sources'
import type {
  FavoriteSiteSearchParams,
  FavoriteSiteSearchReport,
  FavoriteSiteSearchStorage,
  FavoriteSiteSearchTimers,
} from '../../src/sources'

/** Temporizadores manuais: nada dispara até `advance`. */
class ManualTimers implements FavoriteSiteSearchTimers {
  private current = 0
  private nextId = 1
  private readonly tasks = new Map<number, { at: number; callback: () => void }>()

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId
    this.nextId += 1
    this.tasks.set(id, { at: this.current + delayMs, callback })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number)
  }

  get pending(): number {
    return this.tasks.size
  }

  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | undefined
      for (const entry of this.tasks) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry
      }
      if (!next) break
      this.tasks.delete(next[0])
      this.current = next[1].at
      next[1].callback()
    }
    this.current = target
  }
}

class MemoryStorage implements FavoriteSiteSearchStorage {
  readonly values = new Map<string, string>()
  get(key: string): string | null {
    return this.values.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const { anglicanCompass } = BUILT_IN_FAVORITE_SITES

function wordPressResponse(title: string): Response {
  return new Response(
    JSON.stringify([
      {
        date: '2026-09-20T12:00:00',
        link: `https://anglicancompass.com/${encodeURIComponent(title)}/`,
        title: { rendered: title },
        excerpt: { rendered: '' },
      },
    ]),
    { status: 200 },
  )
}

function requestURL(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input)
}

function setup(options: { fetch?: FetchLike; cache?: FavoriteSiteSearchCache } = {}) {
  let nowMs = Date.parse('2026-09-27T12:00:00Z')
  const now = () => new Date(nowMs)
  const timers = new ManualTimers()
  const fetch =
    options.fetch ??
    vi.fn<FetchLike>(async (input) => wordPressResponse(requestURL(input).searchParams.get('search') ?? '?'))
  const loading: (string | null)[] = []
  const cache = options.cache ?? new FavoriteSiteSearchCache({ now })
  const coordinator = new FavoriteSiteSearchCoordinator({
    http: { fetch },
    cache,
    timers,
    now,
    onLoadingChange: (key) => loading.push(key),
  })
  return {
    coordinator,
    timers,
    fetch,
    loading,
    cache,
    advanceClock: (ms: number) => {
      nowMs += ms
    },
  }
}

function params(reference: string): FavoriteSiteSearchParams {
  return {
    reference,
    occasion: 'Proper 21 A',
    date: new Date(2026, 8, 27),
    isSunday: true,
    sites: [anglicanCompass],
  }
}

describe('busca automática nas fontes favoritas', () => {
  it('espera 650 ms de estabilização e busca só o contexto final', async () => {
    const { coordinator, timers, fetch } = setup()

    const first = coordinator.scheduleAutomatic(params('Matthew 21:23-32'))
    timers.advance(649)
    const second = coordinator.scheduleAutomatic(params('Romans 13:8-14'))
    expect(await first).toBeNull()
    timers.advance(649)
    expect(fetch).not.toHaveBeenCalled()
    timers.advance(1)

    const report = await second
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(requestURL(vi.mocked(fetch).mock.calls[0]![0]).searchParams.get('search')).toBe('Romans 13')
    expect(report?.reference).toBe('Romans 13:8-14')
    expect(report?.cacheKey).toBe(await favoriteSiteSearchCacheKey(params('Romans 13:8-14')))
  })

  it('serve o cache por 24 horas e busca de novo depois disso', async () => {
    const { coordinator, timers, fetch, advanceClock } = setup()
    const context = params('Romans 13:8-14')

    const first = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    const report = await first
    // O site responde com o título "Romans 13": capítulo inteiro, menção no contexto.
    expect(report?.groups[0]?.articles[0]?.match).toBe('context')

    advanceClock(60 * 60 * 1000)
    const cached = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    expect(await cached).toBe(report)
    expect(fetch).toHaveBeenCalledTimes(1)

    advanceClock(24 * 60 * 60 * 1000)
    const stale = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    const fresh = await stale
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fresh).not.toBe(report)
  })

  it('deduplica por contexto na sessão mesmo sem cache', async () => {
    const { coordinator, timers, fetch } = setup({ cache: new FavoriteSiteSearchCache({ limit: 0 }) })
    const context = params('Matthew 21:23-32')

    const first = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    expect(await first).not.toBeNull()

    const again = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    expect(await again).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)

    // O comando Atualizar ignora a deduplicação.
    expect(await coordinator.refresh(context)).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('cancelamento durante a busca não grava resultado e libera nova tentativa', async () => {
    let hang = true
    const fetch = vi.fn<FetchLike>((input, init) => {
      if (!hang) return Promise.resolve(wordPressResponse('Matthew 21:23-32'))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelada', 'AbortError')))
      })
    })
    const { coordinator, timers, cache } = setup({ fetch })
    const context = params('Matthew 21:23-32')
    const key = await favoriteSiteSearchCacheKey(context)

    const pending = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(coordinator.isSearching).toBe(true)
    coordinator.cancelAutomatic()
    expect(await pending).toBeNull()
    expect(await cache.get(key)).toBeNull()
    expect(coordinator.isSearching).toBe(false)

    hang = false
    const retry = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    const report = await retry
    expect(report?.groups[0]?.articles[0]?.match).toBe('same')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await cache.get(key)).toBe(report)
  })

  it('cancelar antes dos 650 ms não consulta a rede', async () => {
    const { coordinator, timers, fetch } = setup()
    const pending = coordinator.scheduleAutomatic(params('Matthew 21:23-32'))
    coordinator.cancelAutomatic()
    expect(await pending).toBeNull()
    expect(timers.pending).toBe(0)
    timers.advance(1000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('não agenda referência sem livro e capítulo', async () => {
    const { coordinator, timers } = setup()
    expect(await coordinator.scheduleAutomatic(params('Todos os Santos'))).toBeNull()
    expect(timers.pending).toBe(0)
  })

  it('o indicador de carregamento permanece meio segundo depois da resposta', async () => {
    const { coordinator, timers, loading } = setup()
    const context = params('Matthew 21:23-32')
    const key = await favoriteSiteSearchCacheKey(context)

    const pending = coordinator.scheduleAutomatic(context)
    timers.advance(650)
    await pending
    expect(loading).toEqual([key])
    expect(coordinator.loadingKey).toBe(key)
    timers.advance(499)
    expect(loading).toEqual([key])
    timers.advance(1)
    expect(loading).toEqual([key, null])
    expect(coordinator.loadingKey).toBeNull()
  })

  it('refresh concorrente da mesma chave não duplica a busca', async () => {
    const { coordinator, fetch } = setup()
    const context = params('Matthew 21:23-32')
    const [first, second] = await Promise.all([coordinator.refresh(context), coordinator.refresh(context)])
    expect([first, second].filter((report) => report !== null)).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('cache das buscas nas fontes favoritas', () => {
  function report(cacheKey: string, searchedAt: string): FavoriteSiteSearchReport {
    return {
      cacheKey,
      reference: 'Romans 13:8-14',
      searchedAt: new Date(searchedAt),
      groups: [
        {
          site: anglicanCompass,
          searchURL: 'https://anglicancompass.com/?s=Romans%2013:8-14',
          articles: [
            {
              site: anglicanCompass,
              title: 'Romans 13:8-14',
              url: 'https://anglicancompass.com/romans/',
              author: null,
              publishedAt: null,
              match: 'same',
              passageReference: 'Romans 13:8-14',
              overlapReference: 'Romans 13:8-14',
            },
          ],
          searchedAt: new Date(searchedAt),
          errorMessage: null,
        },
      ],
    }
  }

  it('persiste no armazenamento injetado e relê em outra instância', async () => {
    const storage = new MemoryStorage()
    const now = () => new Date('2026-09-27T13:00:00Z')
    const original = report('a', '2026-09-27T12:00:00Z')
    await new FavoriteSiteSearchCache({ storage, now }).put(original)
    expect(storage.values.has(FAVORITE_SITE_REPORTS_STORAGE_KEY)).toBe(true)

    const restored = new FavoriteSiteSearchCache({ storage, now })
    expect(await restored.get('a')).toEqual(original)
    expect(await restored.getFresh('a')).toEqual(original)
  })

  it('vale por menos de 24 horas pelo relógio injetado', async () => {
    let nowMs = Date.parse('2026-09-27T12:00:00Z')
    const cache = new FavoriteSiteSearchCache({ now: () => new Date(nowMs) })
    await cache.put(report('a', '2026-09-27T12:00:00Z'))
    nowMs += 24 * 60 * 60 * 1000 - 1
    expect(await cache.getFresh('a')).not.toBeNull()
    nowMs += 1
    expect(await cache.getFresh('a')).toBeNull()
    expect(await cache.get('a')).not.toBeNull()
  })

  it('guarda só os relatórios mais recentes e, em chave repetida, o mais novo', async () => {
    const storage = new MemoryStorage()
    const cache = new FavoriteSiteSearchCache({ storage, limit: 2 })
    await cache.put(report('old', '2026-09-01T12:00:00Z'))
    await cache.put(report('mid', '2026-09-02T12:00:00Z'))
    await cache.put(report('new', '2026-09-03T12:00:00Z'))
    expect(await cache.get('old')).toBeNull()
    expect(JSON.parse(storage.values.get(FAVORITE_SITE_REPORTS_STORAGE_KEY)!)).toHaveLength(2)

    const duplicated = new MemoryStorage()
    const older = report('dup', '2026-09-01T12:00:00Z')
    const newer = report('dup', '2026-09-05T12:00:00Z')
    const kept = JSON.parse(storage.values.get(FAVORITE_SITE_REPORTS_STORAGE_KEY)!) as unknown[]
    const extra = JSON.parse(serializeFavoriteSiteReports([older, newer])) as unknown[]
    duplicated.set(FAVORITE_SITE_REPORTS_STORAGE_KEY, JSON.stringify([...kept, ...extra]))
    const restored = new FavoriteSiteSearchCache({ storage: duplicated })
    expect((await restored.get('dup'))?.searchedAt.toISOString()).toBe('2026-09-05T12:00:00.000Z')
    expect(await restored.get('new')).not.toBeNull()
  })

  it('dados corrompidos ou armazenamento com falha viram cache vazio', async () => {
    const corrupted = new MemoryStorage()
    corrupted.set(FAVORITE_SITE_REPORTS_STORAGE_KEY, '{oops')
    const cache = new FavoriteSiteSearchCache({ storage: corrupted })
    expect(await cache.get('a')).toBeNull()
    await cache.put(report('a', '2026-09-27T12:00:00Z'))
    expect(await new FavoriteSiteSearchCache({ storage: corrupted }).get('a')).not.toBeNull()

    const failing: FavoriteSiteSearchStorage = {
      get: async () => {
        throw new Error('disco indisponível')
      },
      set: () => undefined,
    }
    expect(await new FavoriteSiteSearchCache({ storage: failing }).get('a')).toBeNull()

    const partlyValid = new MemoryStorage()
    const valid = JSON.parse(serializeFavoriteSiteReports([report('b', '2026-09-27T12:00:00Z')])) as unknown[]
    partlyValid.set(FAVORITE_SITE_REPORTS_STORAGE_KEY, JSON.stringify([{ cacheKey: 'x' }, ...valid]))
    const partial = new FavoriteSiteSearchCache({ storage: partlyValid })
    expect(await partial.get('x')).toBeNull()
    expect(await partial.get('b')).not.toBeNull()
  })

  it('o gate da sessão usa o relógio injetado', () => {
    let nowMs = 0
    const gate = new FavoriteSiteSearchAutoGate(() => new Date(nowMs))
    expect(gate.begin('k')).toBe(true)
    gate.finish('k', false)
    nowMs = 24 * 60 * 60 * 1000 - 1
    expect(gate.begin('k')).toBe(false)
    nowMs += 1
    expect(gate.begin('k')).toBe(true)
    expect(gate.begin('k')).toBe(false) // ainda ativa
  })
})
