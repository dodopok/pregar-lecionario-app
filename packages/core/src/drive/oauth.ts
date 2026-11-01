/**
 * OAuth do Google para app instalado: navegador padrão, retorno por loopback (127.0.0.1) e PKCE
 * S256, apenas com o escopo `drive.file`. O servidor HTTP local fica no app desktop, que implementa
 * `LoopbackReceiver`; aqui ficam as partes puras (URL, validação do retorno, página exibida) e a troca
 * do código pelos tokens.
 */

import { z } from 'zod'
import { base64UrlEncode, randomBytes, timingSafeEqualString } from '../util/hash'
import { loggedRequest, tryParseJSON } from '../util/http'
import type { HttpContext } from '../util/http'
import { GoogleDriveError } from './errors'

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** Tempo máximo de espera pelo retorno do navegador, como no app Swift (240 s). */
export const GOOGLE_OAUTH_TIMEOUT_MS = 240_000
const TOKEN_TIMEOUT_MS = 30_000

/** Cliente OAuth do produto (tipo "Desktop app"). O segredo de cliente desktop não é confidencial. */
export interface GoogleOAuthClientConfig {
  clientId: string
  clientSecret?: string
}

export interface GoogleOAuthTokens {
  accessToken: string
  refreshToken?: string
  /** Validade do access token em segundos. */
  expiresIn: number
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
})

export function randomPKCEVerifier(): string {
  return base64UrlEncode(randomBytes(64))
}

export function randomOAuthState(): string {
  return base64UrlEncode(randomBytes(32))
}

/** `code_challenge` S256: SHA-256 do verificador em base64url sem preenchimento. */
export async function pkceCodeChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

/** URI de retorno por loopback, sem barra final (deve ser idêntica na autorização e na troca do código). */
export function loopbackRedirectURI(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function isGoogleDesktopClientId(clientId: string): boolean {
  return clientId.endsWith('.apps.googleusercontent.com')
}

export async function googleAuthorizationURL(options: {
  clientId: string
  redirectUri: string
  state: string
  verifier: string
}): Promise<string> {
  if (!isGoogleDesktopClientId(options.clientId)) throw new GoogleDriveError('invalidClientID')
  const challenge = await pkceCodeChallenge(options.verifier)
  const query = new URLSearchParams([
    ['client_id', options.clientId],
    ['redirect_uri', options.redirectUri],
    ['response_type', 'code'],
    ['scope', GOOGLE_DRIVE_SCOPE],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['state', options.state],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
  ])
  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${query.toString()}`
}

export async function exchangeGoogleAuthorizationCode(
  http: HttpContext,
  options: { code: string; client: GoogleOAuthClientConfig; redirectUri: string; verifier: string },
): Promise<GoogleOAuthTokens> {
  const values: [string, string][] = [
    ['code', options.code],
    ['client_id', options.client.clientId],
    ['redirect_uri', options.redirectUri],
    ['grant_type', 'authorization_code'],
    ['code_verifier', options.verifier],
  ]
  if (options.client.clientSecret) values.push(['client_secret', options.client.clientSecret])
  return tokenRequest(http, values, [options.code, options.verifier, options.client.clientSecret])
}

export async function refreshGoogleAccessToken(
  http: HttpContext,
  options: { refreshToken: string; client: GoogleOAuthClientConfig },
): Promise<GoogleOAuthTokens> {
  const values: [string, string][] = [
    ['client_id', options.client.clientId],
    ['refresh_token', options.refreshToken],
    ['grant_type', 'refresh_token'],
  ]
  if (options.client.clientSecret) values.push(['client_secret', options.client.clientSecret])
  return tokenRequest(http, values, [options.refreshToken, options.client.clientSecret])
}

async function tokenRequest(
  http: HttpContext,
  values: [string, string][],
  secrets: (string | undefined)[],
): Promise<GoogleOAuthTokens> {
  const response = await loggedRequest(
    http,
    GOOGLE_TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(values).toString(),
    },
    {
      integration: 'Google Drive',
      operation: 'OAuth · token',
      timeoutMs: TOKEN_TIMEOUT_MS,
      secrets: secrets.filter((value): value is string => Boolean(value)),
    },
  )
  if (!response.ok) {
    const payload = tryParseJSON<Record<string, unknown>>(response.text())
    const description = typeof payload?.error_description === 'string' ? payload.error_description : undefined
    const code = typeof payload?.error === 'string' ? payload.error : undefined
    const message = description ?? code ?? 'Confira o OAuth Client ID e as APIs ativadas no Google Cloud.'
    throw GoogleDriveError.api(response.status, message, code)
  }
  const parsed = tokenResponseSchema.safeParse(tryParseJSON(response.text()))
  if (!parsed.success) throw new GoogleDriveError('invalidOAuthResponse')
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
  }
}

/** O refresh token foi revogado ou expirou: o app deve apagá-lo e pedir nova conexão. */
export function isRejectedRefreshToken(error: unknown): boolean {
  if (!(error instanceof GoogleDriveError) || error.code !== 'api' || error.status !== 400) return false
  if (error.oauthError === 'invalid_grant') return true
  return (error.detail ?? '').toLowerCase().includes('invalid_grant')
}

// MARK: - Retorno por loopback

export const GOOGLE_LOOPBACK_SUCCESS_TEXT =
  'Authorization received. You may close this page and return to Pregar.'
export const GOOGLE_LOOPBACK_NOT_FOUND_TEXT = 'Return to Pregar.'

export interface LoopbackResponse {
  status: 200 | 404
  /** Cabeçalhos a enviar com a página; a conexão deve ser fechada depois da resposta. */
  headers: Record<string, string>
  /** Página HTML exibida no navegador. */
  body: string
  /** Parâmetros do retorno do Google, quando a requisição é o retorno esperado. */
  callback?: Record<string, string>
}

export function loopbackPage(body: string): string {
  return `<!doctype html><html><meta charset="utf-8"><title>Pregar</title><body style="font:16px -apple-system,sans-serif;padding:3rem">${body}</body></html>`
}

function decodeQueryComponent(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '))
}

/**
 * Lê os parâmetros do alvo da requisição (`/?state=...&code=...`). O primeiro valor de cada nome
 * prevalece e itens sem `=` são ignorados, como no `URLComponents`. Devolve `null` para alvos inválidos.
 */
export function parseLoopbackQuery(target: string): Record<string, string> | null {
  if (!target.startsWith('/')) return null
  const queryStart = target.indexOf('?')
  if (queryStart < 0) return {}
  const hashStart = target.indexOf('#', queryStart)
  const query = target.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
  const values: Record<string, string> = {}
  for (const part of query.split('&')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    let name: string
    let value: string
    try {
      name = decodeQueryComponent(part.slice(0, separator))
      value = decodeQueryComponent(part.slice(separator + 1))
    } catch {
      return null
    }
    if (!Object.hasOwn(values, name)) values[name] = value
  }
  return values
}

/**
 * Resposta para cada requisição que chega ao servidor de loopback. Só o retorno com `state` e
 * `code` ou `error` conclui a espera; o resto (favicon, por exemplo) recebe 404.
 */
export function handleLoopbackRequest(target: string): LoopbackResponse {
  const values = parseLoopbackQuery(target)
  const isCallback =
    values !== null && values.state !== undefined && (values.code !== undefined || values.error !== undefined)
  const status = isCallback ? 200 : 404
  const body = loopbackPage(isCallback ? GOOGLE_LOOPBACK_SUCCESS_TEXT : GOOGLE_LOOPBACK_NOT_FOUND_TEXT)
  const response: LoopbackResponse = {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' },
    body,
  }
  if (isCallback && values) response.callback = values
  return response
}

/** Confere o `state` e devolve o código de autorização. */
export function authorizationCodeFromCallback(
  callback: Record<string, string>,
  expectedState: string,
): string {
  const state = callback.state
  if (state === undefined || !timingSafeEqualString(state, expectedState)) {
    throw new GoogleDriveError('invalidOAuthResponse')
  }
  if (callback.error !== undefined) throw GoogleDriveError.authorizationDenied(callback.error)
  if (callback.code === undefined) throw new GoogleDriveError('invalidOAuthResponse')
  return callback.code
}

/**
 * Servidor HTTP local implementado pelo app (no Electron, `node:http` no processo principal).
 * Deve escutar somente em 127.0.0.1, numa porta livre, e responder cada requisição com
 * `onRequest(alvo)`, onde o alvo é a linha da requisição sem método e versão (`/?code=...`).
 */
export interface LoopbackReceiver {
  /** Começa a escutar e devolve a porta escolhida. */
  start(onRequest: (target: string) => LoopbackResponse): Promise<number>
  /** Encerra o servidor; chamado sempre ao fim do fluxo, com sucesso ou não. */
  stop(): void | Promise<void>
}

export interface GoogleOAuthFlowOptions {
  http: HttpContext
  client: GoogleOAuthClientConfig
  receiver: LoopbackReceiver
  /** Abre a URL no navegador padrão; `false` ou exceção interrompe o fluxo. */
  openBrowser: (url: string) => Promise<boolean | void> | boolean | void
  timeoutMs?: number
  signal?: AbortSignal
}

/** Fluxo completo: loopback, navegador, conferência do `state` e troca do código por tokens. */
export async function authorizeGoogleDrive(options: GoogleOAuthFlowOptions): Promise<GoogleOAuthTokens> {
  const client = options.client
  if (!isGoogleDesktopClientId(client.clientId)) throw new GoogleDriveError('invalidClientID')
  options.signal?.throwIfAborted()

  let resolveCallback: (values: Record<string, string>) => void = () => {}
  const callback = new Promise<Record<string, string>>((resolve) => {
    resolveCallback = resolve
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener = () => {}
  try {
    const port = await options.receiver.start((target) => {
      const response = handleLoopbackRequest(target)
      if (response.callback) resolveCallback(response.callback)
      return response
    })
    const redirectUri = loopbackRedirectURI(port)
    const state = randomOAuthState()
    const verifier = randomPKCEVerifier()
    const url = await googleAuthorizationURL({ clientId: client.clientId, redirectUri, state, verifier })

    const failure = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new GoogleDriveError('authorizationTimedOut')),
        options.timeoutMs ?? GOOGLE_OAUTH_TIMEOUT_MS,
      )
      const signal = options.signal
      if (signal) {
        const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => signal.removeEventListener('abort', onAbort)
      }
    })
    failure.catch(() => {})

    let opened: boolean | void
    try {
      opened = await options.openBrowser(url)
    } catch {
      opened = false
    }
    if (opened === false) throw new GoogleDriveError('invalidOAuthResponse')

    const values = await Promise.race([callback, failure])
    const code = authorizationCodeFromCallback(values, state)
    return await exchangeGoogleAuthorizationCode(options.http, { code, client, redirectUri, verifier })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    removeAbortListener()
    try {
      await options.receiver.stop()
    } catch {
      // Encerrar o servidor local não pode mascarar o resultado da autorização.
    }
  }
}
