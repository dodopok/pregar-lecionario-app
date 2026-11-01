import { loggedRequest, tryParseJSON } from '@pregar/core/util/http'
import type { HttpContext } from '@pregar/core/util/http'
import { PREGAR_API_DEFAULT_URL } from '@pregar/core/plans/contract'
import type { APIErrorBody } from '@pregar/core/plans/contract'

/** Erro vindo da API do Pregar, com mensagem pronta para a interface. */
export class PregarAPIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'PregarAPIError'
  }
}

export function resolveAPIBaseURL(configured: string): string {
  const candidate = configured.trim() || import.meta.env.MAIN_VITE_PREGAR_API_URL || PREGAR_API_DEFAULT_URL
  const url = new URL(candidate)
  // Só https, exceto servidor local de desenvolvimento.
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('O endereço da API do Pregar precisa usar https.')
  }
  return url.toString().replace(/\/+$/, '')
}

export class PregarAPIClient {
  constructor(
    private readonly http: () => HttpContext,
    private readonly baseURL: () => string,
    private readonly token: () => string | null,
  ) {}

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { body?: unknown; auth?: boolean; timeoutMs?: number; signal?: AbortSignal; operation?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Pregar-Desktop' }
    const token = this.token()
    if (options.auth !== false) {
      if (!token) throw new PregarAPIError('Entre na sua conta para continuar.', 401, 'unauthorized')
      headers.Authorization = `Bearer ${token}`
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    const context = this.http()
    let response
    try {
      response = await loggedRequest(
        { ...context, signal: options.signal ?? context.signal },
        `${this.baseURL()}${path}`,
        { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) },
        { integration: 'Pregar API', operation: options.operation ?? `${method} ${path.split('?')[0]}`, timeoutMs: options.timeoutMs ?? 30_000 },
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new PregarAPIError('Sem conexão com o servidor do Pregar. Confira a internet e tente de novo.', 0, 'offline')
    }
    if (response.status === 204) return undefined as T
    const body = tryParseJSON<unknown>(response.text())
    if (!response.ok) {
      const error = (body as APIErrorBody | undefined)?.error
      throw new PregarAPIError(
        error?.message ?? `O servidor do Pregar respondeu com erro (HTTP ${response.status}).`,
        response.status,
        error?.code ?? 'http_error',
        error?.details,
      )
    }
    return body as T
  }
}
