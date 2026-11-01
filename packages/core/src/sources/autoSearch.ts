import { parseReference } from '../bible/reference'
import type { HttpContext } from '../util/http'
import { FavoriteSiteSearchCache } from './cache'
import { favoriteSiteSearchCacheKey, searchFavoriteSites } from './search'
import type { FavoriteSiteSearchParams, FavoriteSiteSearchReport } from './search'

/**
 * Busca automática nas fontes favoritas. Porte do `FavoriteSiteSearchAutoGate` e da orquestração
 * do painel de Materiais do Swift: espera 650 ms a passagem estabilizar, deduplica por contexto
 * durante a sessão, respeita o cache de 24 horas e libera nova tentativa depois de cancelamento.
 * Só `refresh` (o comando Atualizar) força uma nova busca.
 */

export const FAVORITE_SITE_SEARCH_STABILIZATION_MS = 650
export const FAVORITE_SITE_SEARCH_LOADING_HOLD_MS = 500
export const FAVORITE_SITE_SEARCH_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Deduplicação das buscas automáticas: uma tentativa por chave a cada 24 horas por sessão. */
export class FavoriteSiteSearchAutoGate {
  private readonly lastAttemptAt = new Map<string, number>()
  private readonly activeKeys = new Set<string>()

  constructor(private readonly clock: () => Date = () => new Date()) {}

  begin(cacheKey: string, now: Date = this.clock()): boolean {
    if (this.activeKeys.has(cacheKey)) return false
    const lastAttempt = this.lastAttemptAt.get(cacheKey)
    if (lastAttempt !== undefined && now.getTime() - lastAttempt < FAVORITE_SITE_SEARCH_RETRY_INTERVAL_MS)
      return false
    this.activeKeys.add(cacheKey)
    this.lastAttemptAt.set(cacheKey, now.getTime())
    return true
  }

  finish(cacheKey: string, wasCancelled: boolean): void {
    this.activeKeys.delete(cacheKey)
    if (wasCancelled) this.lastAttemptAt.delete(cacheKey)
  }
}

/** Temporizadores injetáveis (testes usam um relógio manual). */
export interface FavoriteSiteSearchTimers {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemFavoriteSiteSearchTimers: FavoriteSiteSearchTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
}

export interface FavoriteSiteSearchCoordinatorOptions {
  http: HttpContext
  cache?: FavoriteSiteSearchCache
  gate?: FavoriteSiteSearchAutoGate
  timers?: FavoriteSiteSearchTimers
  now?: () => Date
  stabilizationMs?: number
  loadingHoldMs?: number
  /**
   * Chave cuja busca está em andamento para o indicador de carregamento, ou `null`. O indicador
   * fica visível meio segundo depois da resposta/cancelamento para não piscar.
   */
  onLoadingChange?: (cacheKey: string | null) => void
}

interface PendingAutomaticSearch {
  controller: AbortController
  handle: unknown
  fired: boolean
  settle: (report: FavoriteSiteSearchReport | null) => void
}

export class FavoriteSiteSearchCoordinator {
  readonly cache: FavoriteSiteSearchCache
  readonly gate: FavoriteSiteSearchAutoGate
  private readonly http: HttpContext
  private readonly timers: FavoriteSiteSearchTimers
  private readonly now: () => Date
  private readonly stabilizationMs: number
  private readonly loadingHoldMs: number
  private readonly onLoadingChange: ((cacheKey: string | null) => void) | undefined
  private readonly activeKeys = new Set<string>()
  private pending: PendingAutomaticSearch | null = null
  private currentLoadingKey: string | null = null
  private loadingClear: { handle: unknown } | null = null

  constructor(options: FavoriteSiteSearchCoordinatorOptions) {
    this.http = options.http
    this.now = options.now ?? (() => new Date())
    this.cache = options.cache ?? new FavoriteSiteSearchCache({ now: this.now })
    this.gate = options.gate ?? new FavoriteSiteSearchAutoGate(this.now)
    this.timers = options.timers ?? systemFavoriteSiteSearchTimers
    this.stabilizationMs = options.stabilizationMs ?? FAVORITE_SITE_SEARCH_STABILIZATION_MS
    this.loadingHoldMs = options.loadingHoldMs ?? FAVORITE_SITE_SEARCH_LOADING_HOLD_MS
    this.onLoadingChange = options.onLoadingChange
  }

  /** Chave exibida como "buscando", ou `null`. */
  get loadingKey(): string | null {
    return this.currentLoadingKey
  }

  /** Alguma busca em andamento (o Swift desabilita o botão Atualizar enquanto isso). */
  get isSearching(): boolean {
    return this.activeKeys.size > 0
  }

  /**
   * Agenda a busca automática para o contexto exibido. Uma nova chamada substitui a anterior e
   * cancela a busca dela, como o `.task(id:)` do SwiftUI. Resolve com o relatório disponível
   * (do cache, se ainda vale, ou recém-buscado) ou `null` se nada foi buscado.
   */
  scheduleAutomatic(params: FavoriteSiteSearchParams): Promise<FavoriteSiteSearchReport | null> {
    this.cancelAutomatic()
    if (!parseReference(params.reference)) return Promise.resolve(null)
    const controller = new AbortController()
    return new Promise((resolve) => {
      const pending: PendingAutomaticSearch = { controller, handle: undefined, fired: false, settle: resolve }
      pending.handle = this.timers.setTimeout(() => {
        pending.fired = true
        if (controller.signal.aborted) {
          resolve(null)
          return
        }
        this.searchIfStale(params, controller.signal)
          .then(resolve, () => resolve(null))
          .finally(() => {
            if (this.pending === pending) this.pending = null
          })
      }, this.stabilizationMs)
      this.pending = pending
    })
  }

  /** Cancela a busca automática agendada ou em andamento (painel fechado, contexto trocado). */
  cancelAutomatic(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    if (!pending.fired) {
      this.timers.clearTimeout(pending.handle)
      pending.settle(null)
    }
    pending.controller.abort()
  }

  /**
   * Busca se não houver relatório com menos de 24 horas e a deduplicação permitir. Resolve com o
   * relatório disponível ou `null` (referência inválida, busca já em andamento, tentativa
   * recente na sessão ou cancelamento).
   */
  async searchIfStale(
    params: FavoriteSiteSearchParams,
    signal?: AbortSignal,
  ): Promise<FavoriteSiteSearchReport | null> {
    const cacheKey = await favoriteSiteSearchCacheKey(params)
    const cached = await this.cache.get(cacheKey)
    if (cached && this.cache.isFresh(cached)) return cached
    if (signal?.aborted) return null
    if (
      !parseReference(params.reference) ||
      this.activeKeys.has(cacheKey) ||
      !this.gate.begin(cacheKey, this.now())
    ) {
      return null
    }
    try {
      return await this.perform(params, cacheKey, { signal, showsLoading: cached === null })
    } finally {
      this.gate.finish(cacheKey, signal?.aborted ?? false)
    }
  }

  /** Comando Atualizar: ignora cache e deduplicação, mas não repete uma busca em andamento. */
  async refresh(
    params: FavoriteSiteSearchParams,
    options: { signal?: AbortSignal; showsLoading?: boolean } = {},
  ): Promise<FavoriteSiteSearchReport | null> {
    const cacheKey = await favoriteSiteSearchCacheKey(params)
    return this.perform(params, cacheKey, {
      signal: options.signal,
      showsLoading: options.showsLoading ?? true,
    })
  }

  /** Libera temporizadores e cancela a busca automática. */
  dispose(): void {
    this.cancelAutomatic()
    if (this.loadingClear) {
      this.timers.clearTimeout(this.loadingClear.handle)
      this.loadingClear = null
    }
  }

  private async perform(
    params: FavoriteSiteSearchParams,
    cacheKey: string,
    options: { signal: AbortSignal | undefined; showsLoading: boolean },
  ): Promise<FavoriteSiteSearchReport | null> {
    if (this.activeKeys.has(cacheKey) || params.reference === '' || !parseReference(params.reference))
      return null
    this.activeKeys.add(cacheKey)
    if (options.showsLoading) {
      this.cancelLoadingClear()
      this.setLoadingKey(cacheKey)
    }
    try {
      const signal = this.combinedSignal(options.signal)
      const report = await searchFavoriteSites({ ...this.http, signal, now: this.now }, params)
      if (signal?.aborted) return null
      await this.cache.put(report)
      return report
    } finally {
      this.activeKeys.delete(cacheKey)
      this.scheduleLoadingClear()
    }
  }

  private combinedSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
    const signals = [this.http.signal, signal].filter((item): item is AbortSignal => item !== undefined)
    if (signals.length <= 1) return signals[0]
    return AbortSignal.any(signals)
  }

  private setLoadingKey(cacheKey: string | null): void {
    if (this.currentLoadingKey === cacheKey) return
    this.currentLoadingKey = cacheKey
    this.onLoadingChange?.(cacheKey)
  }

  private cancelLoadingClear(): void {
    if (!this.loadingClear) return
    this.timers.clearTimeout(this.loadingClear.handle)
    this.loadingClear = null
  }

  private scheduleLoadingClear(): void {
    if (this.activeKeys.size > 0 || this.currentLoadingKey === null) return
    const visibleKey = this.currentLoadingKey
    this.cancelLoadingClear()
    const entry: { handle: unknown } = { handle: undefined }
    entry.handle = this.timers.setTimeout(() => {
      if (this.loadingClear === entry) this.loadingClear = null
      if (this.activeKeys.size > 0 || this.currentLoadingKey !== visibleKey) return
      this.setLoadingKey(null)
    }, this.loadingHoldMs)
    this.loadingClear = entry
  }
}
