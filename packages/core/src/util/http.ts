import { secretsFromRequest, silentIntegrationLog } from '../log/integration'
import type { IntegrationName, IntegrationLog } from '../log/integration'

/** Assinatura mínima de `fetch`, injetada para permitir testes e o `net.fetch` do Electron. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HttpContext {
  fetch: FetchLike
  log?: IntegrationLog
  signal?: AbortSignal
}

export interface LoggedRequestOptions {
  integration: IntegrationName
  operation: string
  timeoutMs?: number
  /** Segredos extras a remover do registro (por exemplo, o token da sessão do usuário). */
  secrets?: string[]
}

export interface LoggedResponse {
  response: Response
  status: number
  ok: boolean
  headers: Headers
  body: Uint8Array
  text(): string
  json<T = unknown>(): T
}

export class HttpTimeoutError extends Error {
  constructor(message = 'O serviço demorou demais para responder.') {
    super(message)
    this.name = 'TimeoutError'
  }
}

function combineSignals(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return AbortSignal.any(present)
}

/**
 * Executa a requisição, lê o corpo inteiro e registra o resultado. Respostas não 2xx não lançam
 * erro: quem chama decide. Falhas de rede e tempo esgotado são registradas e repassadas.
 */
export async function loggedRequest(
  context: HttpContext,
  url: string | URL,
  init: RequestInit,
  options: LoggedRequestOptions,
): Promise<LoggedResponse> {
  const log = context.log ?? silentIntegrationLog
  const started = Date.now()
  const timeoutSignal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined
  const signal = combineSignals([context.signal, init.signal ?? undefined, timeoutSignal])
  const secrets = [...secretsFromRequest(url, init.headers), ...(options.secrets ?? [])]
  const method = (init.method ?? 'GET').toUpperCase()
  const base = {
    integration: options.integration,
    operation: options.operation,
    method,
    url: url.toString(),
    secrets,
  }
  let response: Response
  try {
    response = await context.fetch(url, { ...init, signal })
  } catch (error) {
    const durationMs = Date.now() - started
    const timedOut = timeoutSignal?.aborted && !context.signal?.aborted
    const finalError = timedOut ? new HttpTimeoutError() : error
    log.record({ ...base, level: 'ERRO', durationMs, error: finalError })
    throw finalError
  }
  let body: Uint8Array
  try {
    body = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    const durationMs = Date.now() - started
    log.record({ ...base, level: 'ERRO', status: response.status, durationMs, error })
    throw error
  }
  const durationMs = Date.now() - started
  if (response.ok) {
    log.record({ ...base, level: 'OK', status: response.status, durationMs })
  } else {
    log.record({ ...base, level: 'ERRO', status: response.status, durationMs, body })
  }
  let cachedText: string | undefined
  return {
    response,
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body,
    text() {
      cachedText ??= new TextDecoder().decode(body)
      return cachedText
    },
    json<T>() {
      cachedText ??= new TextDecoder().decode(body)
      return JSON.parse(cachedText) as T
    },
  }
}

export function tryParseJSON<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** Aceita apenas URLs https com host, como o app Swift fazia com links externos. */
export function safeHttpsURL(value: string | undefined | null, allowedHosts?: string[]): string | null {
  if (!value) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'https:'
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null
  if (parsed.username || parsed.password) return null
  if (allowedHosts && allowedHosts.length > 0) {
    const host = parsed.hostname.toLowerCase()
    const allowed = allowedHosts.some((candidate) => {
      const normalized = candidate.toLowerCase().replace(/^www\./, '')
      return host === normalized || host === `www.${normalized}` || host.endsWith(`.${normalized}`)
    })
    if (!allowed) return null
  }
  return parsed.toString()
}
