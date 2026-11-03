import { createHash } from 'node:crypto'
import { LiturgicalClient, LiturgicalAPIError, fetchPreviewStatus } from '@pregar/core/liturgy/client'
import type { LiturgicalTransport, PreviewStatus } from '@pregar/core/liturgy/client'
import type { BiblePassageText, BibleVersion, LiturgicalDay, PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'
import type { HttpContext } from '@pregar/core/util/http'
import type { LiturgyAccess } from '@shared/ipc'
import type { AppSettings } from '@shared/settings'
import type { KeyValueStore } from '../storage/db'
import type { SecretStore } from '../secrets'
import type { AccountService } from './account'

const HOUR = 60 * 60 * 1000
const PREVIEW_STATUS_KEY = 'preview-status:v1'
const PREVIEW_STATUS_TTL = 6 * HOUR

/**
 * Leituras e calendário. Assinantes usam o proxy do servidor (sem chave); no plano gratuito, a chave
 * própria da Estêvão API; sem nenhum dos dois, a degustação pública da API do Proper (janela de
 * datas limitada). Respostas ficam em cache local e servem de reserva quando não há rede.
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
      return { mode: 'proxy', message: 'Leituras pela sua assinatura do Proper.' }
    }
    if (secrets.get('estevao')) return { mode: 'direct', message: 'Leituras com a sua chave da Estêvão API.' }
    const preview = this.previewStatus()
    if (preview?.enabled && preview.from && preview.to) {
      return {
        mode: 'preview',
        message: 'Degustação: as leituras das próximas semanas, sem conta. Conecte para ver qualquer data e revisar.',
        preview: { from: preview.from, to: preview.to },
      }
    }
    return {
      mode: 'none',
      message: 'Para carregar o calendário e as leituras, assine o Proper ou salve a sua chave da Estêvão API nas Preferências.',
    }
  }

  /** Último estado conhecido da degustação pública (cache local; nulo antes da primeira consulta). */
  private previewStatus(): PreviewStatus | null {
    const cached = this.deps.cache.get<{ value: PreviewStatus; at: number }>(PREVIEW_STATUS_KEY)
    return cached?.value ?? null
  }

  /**
   * Consulta a API do Proper sobre a degustação (no início e a cada 6 h). Devolve verdadeiro quando
   * o modo de acesso mudou, para as janelas atualizarem o estado.
   */
  async refreshPreviewStatus(force = false): Promise<boolean> {
    const cached = this.deps.cache.get<{ value: PreviewStatus; at: number }>(PREVIEW_STATUS_KEY)
    if (!force && cached && Date.now() - cached.at < PREVIEW_STATUS_TTL) return false
    const before = this.access().mode
    try {
      const status = await fetchPreviewStatus(this.deps.http(), this.deps.apiBaseURL())
      this.deps.cache.set(PREVIEW_STATUS_KEY, { value: status, at: Date.now() })
    } catch {
      // Sem rede ou sem API: a degustação fica como estava (ou indisponível).
      if (!cached) this.deps.cache.set(PREVIEW_STATUS_KEY, { value: { enabled: false, days: 0, from: null, to: null }, at: Date.now() - PREVIEW_STATUS_TTL + 10 * 60 * 1000 })
      return false
    }
    return this.access().mode !== before
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
    } else if (access.mode === 'preview') {
      transport = { kind: 'preview', baseURL: this.deps.apiBaseURL() }
    } else {
      throw new LiturgicalAPIError(access.message)
    }
    return new LiturgicalClient({ http: this.deps.http(), transport, settings })
  }

  private settingsKey(): string {
    const { prayerBook, language, bible, readingType } = this.deps.settings().liturgy
    return `${prayerBook}|${language}|${bible}|${readingType}`
  }

  /**
   * Credencial que produziu a resposta (modo e impressão curta da chave). Trocar a chave ou entrar
   * na assinatura invalida o cache, para que "Salvar e testar" sempre consulte a API de verdade.
   */
  private credentialStamp(): string {
    const access = this.access()
    if (access.mode === 'direct') {
      const key = this.deps.secrets.get('estevao') ?? ''
      return `direct:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
    }
    return access.mode
  }

  /** Busca com cache: devolve o cache válido; sem rede, devolve o cache vencido. */
  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const fresh = this.deps.cache.get<{ value: T; at: number; via?: string }>(key)
    const via = this.credentialStamp()
    if (fresh && fresh.via === via && Date.now() - fresh.at < ttlMs) return fresh.value
    try {
      const value = await load()
      this.deps.cache.set(key, { value, at: Date.now(), via })
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
    return this.cached(`calendar:v3:${this.settingsKey()}:${from}:${to}`, 24 * HOUR, () => this.client().fetchCalendarDays(from, to))
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
