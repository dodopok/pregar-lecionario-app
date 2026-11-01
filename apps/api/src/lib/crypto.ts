import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const SESSION_TOKEN_PREFIX = 'prg_'

export function newSessionToken(): string {
  return SESSION_TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Código numérico de 6 dígitos com distribuição uniforme. */
export function newLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashLoginCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}\n${code}`).digest('hex')
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) {
    // Compara mesmo assim para não vazar o tamanho pelo tempo.
    timingSafeEqual(a, a)
    return false
  }
  return timingSafeEqual(a, b)
}
