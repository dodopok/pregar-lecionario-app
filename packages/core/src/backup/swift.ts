/**
 * Decodificação dos valores gravados pelo `JSONEncoder` do app Swift.
 *
 * - Arquivos do backup (Manifest, Drafts, Library, Reader, SectionLinks) usam
 *   `dateEncodingStrategy = .iso8601`: "2026-10-04T03:00:00Z", sem frações de segundo.
 * - O histórico (`SermonRevisionStore`) usa o `JSONEncoder()` padrão: datas como número de
 *   segundos desde 2001-01-01T00:00:00Z (`.deferredToDate`).
 * - `Data` usa a estratégia padrão `.base64` nos dois casos.
 */
import { z } from 'zod'
import { APPLE_REFERENCE_DATE_MS, PlistUID } from './bplist'
import type { PlistValue } from './bplist'
import type { JsonValue } from './json'

/** Data do `JSONEncoder` padrão: segundos desde a data de referência da Apple. */
export function dateFromSwiftReferenceSeconds(seconds: number): Date {
  return new Date(APPLE_REFERENCE_DATE_MS + seconds * 1000)
}

const ISO8601 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/

/** Data de `.iso8601` (`ISO8601DateFormatter` com `.withInternetDateTime`). */
export function parseSwiftISO8601(value: string): Date | null {
  const match = ISO8601.exec(value)
  if (!match) return null
  const zone = match[2]!
  const normalizedZone = zone === 'Z' || zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`
  const date = new Date(`${match[1]}${normalizedZone}`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

/**
 * Texto do RTF guardado em `Data`. O Cocoa grava RTF em ASCII com escapes; se houver bytes
 * altos, tenta UTF-8 e, se não for UTF-8 válido, Windows-1252 (o `\ansicpg1252` do Cocoa).
 */
export function decodeRTFBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export const swiftISODateSchema = z.string().transform((value, context) => {
  const date = parseSwiftISO8601(value)
  if (date === null) {
    context.addIssue({ code: 'custom', message: 'Data ISO 8601 inválida.' })
    return z.NEVER
  }
  return date
})

export const swiftReferenceDateSchema = z
  .number()
  .refine(Number.isFinite)
  .transform(dateFromSwiftReferenceSeconds)

export const swiftDataSchema = z.string().transform((value, context) => {
  try {
    return decodeBase64(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'Base64 inválido.' })
    return z.NEVER
  }
})

/** Converte um valor de property list para JSON. `Data` com JSON dentro (AppStorage) vira o JSON. */
export function plistToJSON(value: PlistValue): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof PlistUID) return value.value
  if (value instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)) as JsonValue
    } catch {
      return encodeBase64(value)
    }
  }
  if (Array.isArray(value)) return value.map(plistToJSON)
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: plistToJSON(item),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return result
}
