/** Utilitários compartilhados pelas extensões e conversores. */

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Identificador curto e aleatório; prefixo evita chaves numéricas em objetos. */
export function randomId(prefix = 'b'): string {
  const bytes = new Uint8Array(10)
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  let id = prefix
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length]
  return id
}

export type IdGenerator = (kind: 'block' | 'footnote') => string

export const defaultIdGenerator: IdGenerator = (kind) => randomId(kind === 'footnote' ? 'n' : 'b')

/** Número em CSS como o Swift: até quatro casas, sem zeros à direita. */
export function cssNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(4).replace(/\.?0+$/, '')
  return fixed === '-0' ? '0' : fixed
}

export function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/** Só links http, https, mailto e tel; nada executável (javascript:, data:, file:...). */
export function isSafeLinkHref(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  // Caracteres de controle podem esconder um esquema ("java\tscript:").
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (!match?.[1]) return false
  const scheme = match[1].toLowerCase()
  if (!SAFE_LINK_SCHEMES.has(scheme)) return false
  if (scheme === 'http' || scheme === 'https') {
    try {
      return new URL(trimmed).hostname.length > 0
    } catch {
      return false
    }
  }
  return trimmed.length > scheme.length + 1
}

/**
 * Normaliza o endereço digitado na folha de link, como `validLink` do Swift: sem esquema vira
 * https; aceita http, https e mailto (e tel). Devolve null quando inválido.
 */
export function normalizeLinkHref(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  return isSafeLinkHref(candidate) ? candidate : null
}

/** Converte cores CSS comuns (#rgb, #rrggbb, rgb(), rgba()) para #rrggbb. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  let match = /^#([0-9a-f]{3})$/.exec(text)
  if (match?.[1]) {
    const [r, g, b] = match[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text)
  if (match?.[1]) return `#${match[1]}`
  match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(text)
  if (match) {
    if (match[4] !== undefined && parseFloat(match[4]) === 0) return undefined
    const channels = [match[1], match[2], match[3]].map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))))
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    yellow: '#ffff00',
    blue: '#0000ff',
    green: '#008000',
    gray: '#808080',
    grey: '#808080',
  }
  return named[text]
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeColor(hex) ?? '#000000'
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]
}

export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2))
}

/** Tamanho CSS ("12.5pt", "16px", "12") em pontos. */
export function parseLengthPt(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const match = /^\s*(-?[\d.]+)\s*(pt|px|em|rem)?\s*$/i.exec(value)
  if (!match?.[1]) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return undefined
  const unit = (match[2] ?? 'pt').toLowerCase()
  if (unit === 'px') return amount * 0.75
  if (unit === 'em' || unit === 'rem') return amount * 11
  return amount
}

/** Primeira família de uma lista CSS, sem aspas. */
export function primaryFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim()
  return first ? first : undefined
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
