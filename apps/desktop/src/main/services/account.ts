import { hostname } from 'node:os'
import type { AccountView, PaymentView, PlansView, SessionView, SubscriptionView, BillingCycle } from '@pregar/core/plans/contract'
import type { AccountState } from '@shared/ipc'
import type { KeyValueStore } from '../storage/db'
import type { SecretStore } from '../secrets'
import type { PregarAPIClient } from './pregar-api'
import { PregarAPIError } from './pregar-api'

const ACCOUNT_CACHE_KEY = 'account'
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

/** Conta do Proper: login por código, estado da assinatura e uso. Guarda a última resposta para uso offline. */
export class AccountService {
  private state: AccountState
  private lastRefresh = 0

  constructor(
    private readonly api: PregarAPIClient,
    private readonly secrets: SecretStore,
    private readonly cache: KeyValueStore,
    private readonly baseURL: () => string,
    private readonly emit: (state: AccountState) => void,
  ) {
    const cached = this.cache.get<{ account: AccountView; email: string }>(ACCOUNT_CACHE_KEY)
    const loggedIn = Boolean(this.secrets.get('pregarSession'))
    this.state = {
      loggedIn,
      account: loggedIn ? (cached?.account ?? null) : null,
      email: loggedIn ? (cached?.email ?? null) : null,
      offline: false,
      apiBaseURL: this.safeBaseURL(),
    }
  }

  private safeBaseURL(): string {
    try {
      return this.baseURL()
    } catch {
      return ''
    }
  }

  current(): AccountState {
    return this.state
  }

  /** Assinante com proxy de IA ativo (a conta em cache vale até o servidor dizer o contrário). */
  isPro(): boolean {
    return this.state.loggedIn && this.state.account?.plan === 'pro'
  }

  private update(next: Partial<AccountState>): AccountState {
    this.state = { ...this.state, ...next, apiBaseURL: this.safeBaseURL() }
    if (this.state.account && this.state.email) {
      this.cache.set(ACCOUNT_CACHE_KEY, { account: this.state.account, email: this.state.email })
    }
    this.emit(this.state)
    return this.state
  }

  async refresh(force = false): Promise<AccountState> {
    if (!this.secrets.get('pregarSession')) return this.update({ loggedIn: false, account: null, email: null, offline: false })
    if (!force && Date.now() - this.lastRefresh < REFRESH_INTERVAL_MS && this.state.account) return this.state
    try {
      const account = await this.api.request<AccountView>('GET', '/v1/account', { operation: 'conta' })
      this.lastRefresh = Date.now()
      return this.update({ loggedIn: true, account, email: account.user.email, offline: false })
    } catch (error) {
      if (error instanceof PregarAPIError && error.status === 401) {
        this.secrets.delete('pregarSession')
        this.cache.delete(ACCOUNT_CACHE_KEY)
        return this.update({ loggedIn: false, account: null, email: null, offline: false })
      }
      if (error instanceof PregarAPIError && error.code === 'offline') return this.update({ offline: true })
      throw error
    }
  }

  async startLogin(email: string): Promise<{ expiresInMinutes: number }> {
    const result = await this.api.request<{ expiresInMinutes: number }>('POST', '/v1/auth/start', {
      body: { email },
      auth: false,
      operation: 'login · código',
    })
    return { expiresInMinutes: result?.expiresInMinutes ?? 10 }
  }

  async verifyLogin(email: string, code: string): Promise<AccountState> {
    const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
    const result = await this.api.request<{ token: string }>('POST', '/v1/auth/verify', {
      body: { email, code, deviceName: `Proper · ${hostname().slice(0, 60)}`, platform },
      auth: false,
      operation: 'login · confirmação',
    })
    this.secrets.set('pregarSession', result.token)
    this.update({ loggedIn: true, email })
    return this.refresh(true)
  }

  async logout(): Promise<AccountState> {
    try {
      if (this.secrets.get('pregarSession')) await this.api.request('POST', '/v1/auth/logout', { operation: 'logout' })
    } catch {
      // Mesmo sem rede, a sessão local é apagada.
    }
    this.secrets.delete('pregarSession')
    this.cache.delete(ACCOUNT_CACHE_KEY)
    return this.update({ loggedIn: false, account: null, email: null, offline: false })
  }

  async rename(name: string): Promise<AccountState> {
    const account = await this.api.request<AccountView>('PATCH', '/v1/account', { body: { name } })
    return this.update({ account })
  }

  sessions(): Promise<SessionView[]> {
    return this.api.request<{ sessions: SessionView[] }>('GET', '/v1/account/sessions').then((result) => result.sessions)
  }

  async revokeSession(id: string): Promise<SessionView[]> {
    await this.api.request('DELETE', `/v1/account/sessions/${encodeURIComponent(id)}`)
    return this.sessions()
  }

  exportData(): Promise<unknown> {
    return this.api.request('GET', '/v1/account/export', { operation: 'exportar conta' })
  }

  async deleteAccount(confirm: string): Promise<AccountState> {
    await this.api.request('DELETE', '/v1/account', { body: { confirm }, operation: 'apagar conta' })
    this.secrets.delete('pregarSession')
    this.cache.delete(ACCOUNT_CACHE_KEY)
    return this.update({ loggedIn: false, account: null, email: null })
  }

  plans(): Promise<PlansView> {
    return this.api.request<PlansView>('GET', '/v1/billing/plans', { auth: false })
  }

  async checkout(input: { cycle: BillingCycle; name: string; cpfCnpj: string }): Promise<SubscriptionView> {
    const result = await this.api.request<{ subscription: SubscriptionView }>('POST', '/v1/billing/checkout', {
      body: input,
      operation: 'assinatura · checkout',
    })
    void this.refresh(true).catch(() => undefined)
    return result.subscription
  }

  async subscription(): Promise<SubscriptionView | null> {
    const result = await this.api.request<{ subscription: SubscriptionView | null }>('GET', '/v1/billing/subscription', {
      operation: 'assinatura',
    })
    const plan = this.state.account?.plan
    const active = result.subscription?.status === 'active'
    if ((active && plan !== 'pro') || (!active && plan === 'pro' && result.subscription?.status !== 'past_due')) {
      void this.refresh(true).catch(() => undefined)
    }
    return result.subscription
  }

  async cancel(): Promise<SubscriptionView | null> {
    const result = await this.api.request<{ subscription: SubscriptionView | null }>('POST', '/v1/billing/cancel', {
      operation: 'assinatura · cancelar',
    })
    void this.refresh(true).catch(() => undefined)
    return result.subscription
  }

  payments(): Promise<PaymentView[]> {
    return this.api.request<{ payments: PaymentView[] }>('GET', '/v1/billing/payments').then((result) => result.payments)
  }
}
