import { LiturgicalClient, LiturgicalAPIError } from '@pregar/core/liturgy/client'
import type { LiturgicalTransport } from '@pregar/core/liturgy/client'
import type { BiblePassageText, BibleVersion, LiturgicalDay, PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'
import type { HttpContext } from '@pregar/core/util/http'
import type { LiturgyAccess } from '@shared/ipc'
import type { AppSettings } from '@shared/settings'
import type { KeyValueStore } from '../storage/db'
import type { SecretStore } from '../secrets'
import type { AccountService } from './account'

const HOUR = 60 * 60 * 1000

/**
 * Leituras e calendário. Assinantes usam o proxy do servidor (sem chave); no plano gratuito, a chave
 * própria da Estêvão API. Respostas ficam em cache local e servem de reserva quando não há rede.
 */
export class LiturgyService {
  constructor(
    private readonly deps: {
      http: () => HttpContext
      settings: () => AppSettings
      secrets: SecretStore
      account: AccountService
      cache: KeyValueStore
      apiBaseURL: () => string
    },
  ) {}

  access(): LiturgyAccess {
    const { account, secrets, settings } = this.deps
    const state = account.current()
    if (state.loggedIn && state.account?.features.estevaoProxy && !settings().ai.preferOwnKeys) {
      return { mode: 'proxy', message: 'Leituras pela sua assinatura do Pregar.' }
    }
    if (secrets.get('estevao')) return { mode: 'direct', message: 'Leituras com a sua chave da Estêvão API.' }
    return {
      mode: 'none',
      message: 'Para carregar o calendário e as leituras, assine o Pregar ou salve a sua chave da Estêvão API nas Preferências.',
    }
  }

  private client(): LiturgicalClient {
    const access = this.access()
    const settings = this.deps.settings().liturgy
    let transport: LiturgicalTransport
    if (access.mode === 'proxy') {
      transport = {
        kind: 'proxy',
        baseURL: this.deps.apiBaseURL(),
        sessionToken: this.deps.secrets.get('pregarSession') ?? '',
      }
    } else if (access.mode === 'direct') {
      transport = { kind: 'direct', apiKey: this.deps.secrets.get('estevao') ?? '' }
    } else {
      throw new LiturgicalAPIError(access.message)
    }
    return new LiturgicalClient({ http: this.deps.http(), transport, settings })
  }

  private settingsKey(): string {
    const { prayerBook, language, bible, readingType } = this.deps.settings().liturgy
    return `${prayerBook}|${language}|${bible}|${readingType}`
  }

  /** Busca com cache: devolve o cache válido; sem rede, devolve o cache vencido. */
  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const fresh = this.deps.cache.get<{ value: T; at: number }>(key)
    if (fresh && Date.now() - fresh.at < ttlMs) return fresh.value
    try {
      const value = await load()
      this.deps.cache.set(key, { value, at: Date.now() })
      return value
    } catch (error) {
      if (fresh && !(error instanceof LiturgicalAPIError && error.status !== undefined && error.status < 500)) {
        return fresh.value
      }
      throw error
    }
  }

  day(dateKey: string): Promise<LiturgicalDay> {
    return this.cached(`day:v2:${this.settingsKey()}:${dateKey}`, 12 * HOUR, () => this.client().fetchDay(dateKey))
  }

  calendar(from: string, to: string): Promise<LiturgicalDay[]> {
    return this.cached(`calendar:v2:${this.settingsKey()}:${from}:${to}`, 24 * HOUR, () => this.client().fetchCalendarDays(from, to))
  }

  passage(reference: string, bible: string): Promise<BiblePassageText> {
    return this.cached(`passage:v2:${bible}:${reference}`, 7 * 24 * HOUR, () => this.client().fetchPassage(reference, bible))
  }

  bibleVersions(): Promise<BibleVersion[]> {
    return this.cached('bible-versions:v1', 24 * HOUR, () => this.client().fetchBibleVersions())
  }

  prayerBooks(): Promise<PrayerBookCatalogEntry[]> {
    return this.cached('prayer-books:v1', 24 * HOUR, () => this.client().fetchPrayerBooks())
  }
}
