import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk'
import { secretsFromRequest, silentIntegrationLog } from '../log/integration'
import { HttpTimeoutError } from '../util/http'
import type { FetchLike, HttpContext } from '../util/http'

/**
 * Transporte do Claude pelo SDK oficial. O `fetch` injetado pelo chamador (Electron ou servidor)
 * passa por um envoltório que registra código HTTP e duração no registro de integrações sem
 * consumir o corpo das respostas bem-sucedidas (que podem ser um fluxo SSE longo); só os corpos de
 * erro são clonados para o registro.
 */

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

/** Beta da troca de modelo no servidor quando o modelo pedido recusa por política. */
export const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Modelos em que a troca de reserva do servidor é pedida por padrão. */
export const CLAUDE_FALLBACK_MODELS: readonly string[] = [
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
]

export interface ClaudeFallbackParams {
  betas?: string[]
  fallbacks?: 'default'
}

/** Parâmetros de reserva do servidor para o modelo; vazio quando o modelo não participa. */
export function claudeFallbackParams(model: string, enabled = true): ClaudeFallbackParams {
  if (!enabled || !CLAUDE_FALLBACK_MODELS.includes(model)) return {}
  return { betas: [CLAUDE_FALLBACK_BETA], fallbacks: 'default' }
}

export interface LoggingFetchOptions {
  operation: string
  /** Segredos extras a remover do registro (a chave do usuário). */
  secrets?: string[]
  /** Recebe o código HTTP de cada resposta, para diagnósticos posteriores. */
  onResponse?: (status: number) => void
}

function requestURL(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

/** `fetch` que registra cada chamada na integração "IA" sem ler o corpo das respostas 2xx. */
export function loggingFetch(context: HttpContext, options: LoggingFetchOptions): FetchLike {
  const log = context.log ?? silentIntegrationLog
  return async (input, init = {}) => {
    const url = requestURL(input)
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = init.headers ?? (input instanceof Request ? input.headers : undefined)
    const secrets = [...secretsFromRequest(url, headers), ...(options.secrets ?? [])]
    const base = { integration: 'IA' as const, operation: options.operation, method, url, secrets }
    const started = Date.now()
    let response: Response
    try {
      response = await context.fetch(input, init)
    } catch (error) {
      log.record({ ...base, level: 'ERRO', durationMs: Date.now() - started, error })
      throw error
    }
    const durationMs = Date.now() - started
    options.onResponse?.(response.status)
    if (response.ok) {
      log.record({ ...base, level: 'OK', status: response.status, durationMs })
    } else {
      let body: Uint8Array | undefined
      try {
        body = new Uint8Array(await response.clone().arrayBuffer())
      } catch {
        body = undefined
      }
      log.record({ ...base, level: 'ERRO', status: response.status, durationMs, ...(body ? { body } : {}) })
    }
    return response
  }
}

/** Cliente do SDK sem novas tentativas automáticas, sem telemetria e sem registro próprio. */
export function createAnthropicClient(
  apiKey: string,
  context: HttpContext,
  options: LoggingFetchOptions,
): Anthropic {
  return new Anthropic({
    apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    fetch: loggingFetch(context, { ...options, secrets: [apiKey, ...(options.secrets ?? [])] }),
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    // O registro de integrações é o único destino; o SDK não deve copiar corpos para o console.
    logLevel: 'off',
    openTelemetry: false,
  })
}

/** Erro HTTP do Claude já traduzido para código e corpo, para cada operação montar sua mensagem. */
export class AnthropicHTTPError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.name = 'AnthropicHTTPError'
    this.status = status
    this.body = body
  }
}

/** Códigos documentados para os tipos de erro que chegam dentro de um fluxo SSE já aberto. */
const STREAM_ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
}

export interface AnthropicCallOptions {
  signal: AbortSignal
  timeout: number
}

function abortError(signal: AbortSignal | undefined): unknown {
  const reason = signal?.reason
  if (reason instanceof Error) return reason
  return new DOMException('A operação foi cancelada.', 'AbortError')
}

/**
 * Executa uma chamada do SDK com cancelamento do chamador e prazo total (o prazo do SDK cobre só
 * a espera pelos cabeçalhos; aqui ele vale também para a leitura do fluxo). Traduz os erros do SDK
 * para os mesmos que `loggedRequest` produz: `HttpTimeoutError`, `AbortError`, falhas de rede e
 * `AnthropicHTTPError` para respostas não 2xx.
 */
export async function runAnthropicCall<T>(
  context: HttpContext,
  timeoutMs: number,
  run: (options: AnthropicCallOptions) => Promise<T>,
): Promise<T> {
  if (context.signal?.aborted) throw abortError(context.signal)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal
  try {
    return await run({ signal, timeout: timeoutMs })
  } catch (error) {
    if (context.signal?.aborted) throw abortError(context.signal)
    if (timeoutSignal.aborted || error instanceof APIConnectionTimeoutError) throw new HttpTimeoutError()
    if (error instanceof APIUserAbortError) throw abortError(context.signal)
    if (error instanceof APIConnectionError) throw error.cause instanceof Error ? error.cause : error
    if (error instanceof APIError) {
      const status = error.status ?? STREAM_ERROR_STATUS[error.type ?? ''] ?? 500
      throw new AnthropicHTTPError(status, error.error, error.message)
    }
    throw error
  }
}
