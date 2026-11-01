/** JSON determinístico dos arquivos do pacote: chaves ordenadas e recuo de 2 espaços. */
import type { z } from 'zod'
import { BackupError } from './errors'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      Object.defineProperty(sorted, key, {
        value: sortKeys(item),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return sorted
  }
  return value
}

/** Igual ao `JSONEncoder` com `.prettyPrinted` e `.sortedKeys` usado no Swift. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2)
}

const encoder = new TextEncoder()

export function encodeJSON(value: unknown): Uint8Array {
  return encoder.encode(stableStringify(value))
}

export function decodeUTF8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Decodifica e valida; qualquer falha vira "pacote inválido". */
export function decodeJSON<Schema extends z.ZodType>(bytes: Uint8Array, schema: Schema): z.output<Schema> {
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeUTF8(bytes))
  } catch (error) {
    throw BackupError.invalidPackage(error)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw BackupError.invalidPackage(result.error)
  return result.data
}
