/**
 * Registro das integrações externas. Cada chamada vira uma linha com data e hora, nível,
 * integração, operação, método e caminho, código HTTP e duração. O corpo da requisição nunca
 * é registrado (leva manuscrito e credenciais); o corpo da resposta só entra em falhas,
 * truncado e com segredos removidos. O destino das linhas é injetado por quem usa o core.
 */

export type IntegrationName = 'Estêvão API' | 'IA' | 'Fontes favoritas' | 'Google Drive' | 'Proper API' | 'Asaas'

export type IntegrationLevel = 'OK' | 'AVISO' | 'ERRO'

export interface IntegrationLogEntry {
  level: IntegrationLevel
  integration: IntegrationName
  operation: string
  method?: string
  url?: string
  status?: number
  durationMs?: number
  body?: Uint8Array | string
  error?: unknown
  note?: string
  /** Valores de cabeçalhos e parâmetros que precisam sair da linha registrada. */
  secrets?: string[]
  at?: Date
}

export interface IntegrationLogSink {
  write(line: string, entry: IntegrationLogEntry): void
}

export const MAXIMUM_BODY_EXCERPT = 4000

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /ya29\.[0-9A-Za-z_.-]{8,}/g,
  /1\/\/[0-9A-Za-z_-]{8,}/g,
  /pplx-[A-Za-z0-9_-]{8,}/g,
  /\$aact_[A-Za-z0-9_$-]{8,}/g,
  /prg_[A-Za-z0-9_-]{16,}/g,
]
const JSON_SECRET_PATTERN =
  /"(access_token|refresh_token|id_token|client_secret|api_key|apiKey|authToken|token|code)"\s*:\s*"[^"]*"/g

export const REDACTED = '[segredo removido]'

export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = text
  for (const secret of secrets) {
    if (secret && secret.length >= 6) result = result.split(secret).join(REDACTED)
  }
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, REDACTED)
  result = result.replace(JSON_SECRET_PATTERN, (_match, key: string) => `"${key}":"${REDACTED}"`)
  return result
}

/** Coleta os segredos de uma requisição: cabeçalhos de autenticação e parâmetros de chave. */
export function secretsFromRequest(url: string | URL | undefined, headers?: HeadersInit): string[] {
  const values: string[] = []
  const normalized = new Headers(headers ?? {})
  for (const name of ['authorization', 'x-api-key', 'x-goog-api-key', 'access_token', 'asaas-access-token']) {
    const value = normalized.get(name)
    if (value) values.push(value.replace(/^Bearer\s+/i, ''))
  }
  if (url) {
    try {
      const parsed = new URL(url.toString())
      for (const [name, value] of parsed.searchParams) {
        if (['key', 'access_token', 'token'].includes(name.toLowerCase()) && value) values.push(value)
      }
    } catch {
      // URL relativa ou inválida: nada a extrair.
    }
  }
  return values.filter((value) => value.length >= 6)
}

function bodyExcerpt(body: Uint8Array | string): string {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const sample = bytes.subarray(0, MAXIMUM_BODY_EXCERPT)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(sample)
  let printable = 0
  let total = 0
  for (const char of text) {
    total += 1
    const code = char.codePointAt(0) ?? 0
    if (char === '\n' || char === '\t' || code >= 0x20) printable += 1
  }
  if (total > 0 && printable * 10 < total * 9) return `<${bytes.length} bytes não textuais>`
  const trimmed = text.trim()
  return bytes.length > MAXIMUM_BODY_EXCERPT ? `${trimmed}… [${bytes.length} bytes no total]` : trimmed
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return `${error.name}: ${error.message}`
    const cause = (error as { cause?: unknown }).cause
    const causeText = cause instanceof Error ? ` (${cause.message})` : ''
    return `${error.name}: ${error.message}${causeText}`
  }
  return String(error)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localTimestamp(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export function formatIntegrationLine(entry: IntegrationLogEntry): string {
  const parts = [localTimestamp(entry.at ?? new Date()), entry.level, entry.integration, entry.operation]
  if (entry.url) {
    try {
      const parsed = new URL(entry.url)
      parts.push(`${entry.method ?? 'GET'} ${parsed.host}${parsed.pathname}`)
    } catch {
      parts.push(`${entry.method ?? 'GET'} ${entry.url.split('?')[0]}`)
    }
  }
  if (entry.status !== undefined) parts.push(`HTTP ${entry.status}`)
  if (entry.durationMs !== undefined) parts.push(`${(entry.durationMs / 1000).toFixed(1)} s`)
  if (entry.note) parts.push(entry.note)
  if (entry.error !== undefined) parts.push(describeError(entry.error))
  let line = parts.join(' · ')
  if (entry.body !== undefined && (typeof entry.body === 'string' ? entry.body.length : entry.body.byteLength) > 0) {
    line += '\n    ' + bodyExcerpt(entry.body).replace(/\n/g, '\n    ')
  }
  return redactSecrets(line, entry.secrets)
}

export class IntegrationLog {
  constructor(private readonly sink?: IntegrationLogSink) {}

  record(entry: IntegrationLogEntry): void {
    if (!this.sink) return
    try {
      this.sink.write(formatIntegrationLine(entry), entry)
    } catch {
      // O registro nunca pode derrubar a operação que está sendo registrada.
    }
  }
}

/** Registro que não grava nada; usado em testes e quando o chamador não quer registro. */
export const silentIntegrationLog = new IntegrationLog()

/** Registro em memória, útil para testes. */
export class MemoryIntegrationLog extends IntegrationLog {
  readonly lines: string[]
  readonly entries: IntegrationLogEntry[]

  constructor() {
    const lines: string[] = []
    const entries: IntegrationLogEntry[] = []
    super({
      write(line, entry) {
        lines.push(line)
        entries.push(entry)
      },
    })
    this.lines = lines
    this.entries = entries
  }
}
