import type { FastifyBaseLogger } from 'fastify'

/** Cliente mínimo da API v3 do Asaas (https://docs.asaas.com). Valores em reais decimais. */

export interface AsaasCustomer {
  id: string
  name: string
  email?: string | null
  externalReference?: string | null
}

export interface AsaasPixAutomaticAuthorization {
  id: string
  status: 'CREATED' | 'ACTIVE' | 'CANCELLED' | 'REFUSED' | 'EXPIRED'
  customerId?: string
  contractId?: string
  frequency?: string
  value?: number | null
  startDate?: string
  finishDate?: string | null
  subscriptionId?: string | null
  payload?: string | null
  encodedImage?: string | null
  immediateQrCode?: { conciliationIdentifier?: string | null; expirationDate?: string | null } | null
  cancellationDate?: string | null
  cancellationReason?: string | null
}

export interface AsaasPayment {
  id: string
  customer: string
  subscription?: string | null
  value: number
  status: string
  billingType?: string
  dueDate?: string | null
  paymentDate?: string | null
  clientPaymentDate?: string | null
  confirmedDate?: string | null
  invoiceUrl?: string | null
  externalReference?: string | null
  pixAutomaticAuthorizationId?: string | null
}

export interface AsaasSubscription {
  id: string
  customer: string
  status?: string
  value: number
  nextDueDate?: string
  cycle?: string
  externalReference?: string | null
}

export interface AsaasPixQrCode {
  encodedImage: string
  payload: string
  expirationDate?: string | null
}

export class AsaasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: string[] = [],
  ) {
    super(message)
    this.name = 'AsaasError'
  }
}

export interface AsaasClientOptions {
  baseURL: string
  apiKey: string
  fetch: typeof fetch
  log?: FastifyBaseLogger
  userAgent?: string
}

export class AsaasClient {
  constructor(private readonly options: AsaasClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now()
    const url = `${this.options.baseURL}${path}`
    let response: Response
    try {
      response = await this.options.fetch(url, {
        method,
        headers: {
          access_token: this.options.apiKey,
          'User-Agent': this.options.userAgent ?? 'pregar-api',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (error) {
      this.options.log?.error({ err: error, method, path, ms: Date.now() - started }, 'Asaas: falha de rede')
      throw new AsaasError('O provedor de pagamento não respondeu. Tente novamente em instantes.', 0)
    }
    const text = await response.text()
    const json = text ? (JSON.parse(text) as unknown) : null
    this.options.log?.info({ method, path, status: response.status, ms: Date.now() - started }, 'Asaas')
    if (!response.ok) {
      const errorsList = ((json as { errors?: { code?: string; description?: string }[] } | null)?.errors ?? []).filter(
        Boolean,
      )
      const description = errorsList.map((item) => item.description).filter(Boolean).join(' ')
      throw new AsaasError(
        description || `O provedor de pagamento recusou a operação (HTTP ${response.status}).`,
        response.status,
        errorsList.map((item) => item.code ?? '').filter(Boolean),
      )
    }
    return json as T
  }

  createCustomer(input: { name: string; cpfCnpj: string; email: string; externalReference: string }): Promise<AsaasCustomer> {
    return this.request('POST', '/customers', { ...input, notificationDisabled: false })
  }

  updateCustomer(id: string, input: { name?: string; cpfCnpj?: string; email?: string }): Promise<AsaasCustomer> {
    return this.request('PUT', `/customers/${encodeURIComponent(id)}`, input)
  }

  createPixAutomaticAuthorization(input: {
    customerId: string
    contractId: string
    frequency: 'MONTHLY' | 'ANNUALLY'
    startDate: string
    value: number
    description: string
    immediateQrCode: { expirationSeconds: number; originalValue: number; description: string }
  }): Promise<AsaasPixAutomaticAuthorization> {
    return this.request('POST', '/pix/automatic/authorizations', {
      ...input,
      paymentCreationMode: 'SUBSCRIPTION',
      retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS',
    })
  }

  getPixAutomaticAuthorization(id: string): Promise<AsaasPixAutomaticAuthorization> {
    return this.request('GET', `/pix/automatic/authorizations/${encodeURIComponent(id)}`)
  }

  cancelPixAutomaticAuthorization(id: string): Promise<unknown> {
    return this.request('DELETE', `/pix/automatic/authorizations/${encodeURIComponent(id)}`)
  }

  createSubscription(input: {
    customer: string
    value: number
    nextDueDate: string
    cycle: 'MONTHLY' | 'YEARLY'
    description: string
    externalReference: string
  }): Promise<AsaasSubscription> {
    return this.request('POST', '/subscriptions', { ...input, billingType: 'PIX' })
  }

  deleteSubscription(id: string): Promise<unknown> {
    return this.request('DELETE', `/subscriptions/${encodeURIComponent(id)}`)
  }

  listSubscriptionPayments(id: string): Promise<{ data: AsaasPayment[] }> {
    return this.request('GET', `/subscriptions/${encodeURIComponent(id)}/payments?limit=20`)
  }

  getPayment(id: string): Promise<AsaasPayment> {
    return this.request('GET', `/payments/${encodeURIComponent(id)}`)
  }

  getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
    return this.request('GET', `/payments/${encodeURIComponent(paymentId)}/pixQrCode`)
  }
}

export function reaisToCents(value: number): number {
  return Math.round(value * 100)
}

export function centsToReais(value: number): number {
  return Math.round(value) / 100
}
