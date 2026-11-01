/** Utilitários só de teste: escritor mínimo de bplist00 e montagem de pacotes em memória. */
import { sha256Hex } from '../../src/util/hash'
import type { MemoryBackupFileSystem } from '../../src/backup'

export class Real {
  constructor(readonly value: number) {}
}

export type PlistInput =
  string | number | boolean | Real | Uint8Array | PlistInput[] | { [key: string]: PlistInput }

/** Gera bplist00 com deslocamentos de 4 bytes e referências de 2 bytes, sem compartilhar objetos. */
export function encodeBinaryPlist(root: PlistInput): Uint8Array {
  const objects: number[][] = []
  const add = (value: PlistInput): number => {
    const index = objects.length
    objects.push([])
    objects[index] = encodeObject(value, add)
    return index
  }
  add(root)
  const out: number[] = [...new TextEncoder().encode('bplist00')]
  const offsets: number[] = []
  for (const object of objects) {
    offsets.push(out.length)
    out.push(...object)
  }
  const tableOffset = out.length
  for (const offset of offsets) out.push(...uint(offset, 4))
  out.push(0, 0, 0, 0, 0, 0, 4, 2, ...uint(objects.length, 8), ...uint(0, 8), ...uint(tableOffset, 8))
  return Uint8Array.from(out)
}

function encodeObject(value: PlistInput, add: (value: PlistInput) => number): number[] {
  if (typeof value === 'boolean') return [value ? 0x09 : 0x08]
  if (value instanceof Real) {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value.value)
    return [0x23, ...bytes]
  }
  if (typeof value === 'number') return [0x13, ...uint(value, 8)]
  if (typeof value === 'string') {
    const ascii = [...value].every((char) => char.charCodeAt(0) < 0x80)
    if (ascii) return [...header(0x5, value.length), ...[...value].map((char) => char.charCodeAt(0))]
    const units: number[] = []
    for (let index = 0; index < value.length; index += 1) units.push(...uint(value.charCodeAt(index), 2))
    return [...header(0x6, value.length), ...units]
  }
  if (value instanceof Uint8Array) return [...header(0x4, value.length), ...value]
  if (Array.isArray(value)) {
    const refs = value.map(add)
    return [...header(0xa, refs.length), ...refs.flatMap((ref) => uint(ref, 2))]
  }
  const entries = Object.entries(value)
  const keys = entries.map(([key]) => add(key))
  const values = entries.map(([, item]) => add(item))
  return [...header(0xd, entries.length), ...[...keys, ...values].flatMap((ref) => uint(ref, 2))]
}

function header(type: number, length: number): number[] {
  return length < 15 ? [(type << 4) | length] : [(type << 4) | 0x0f, 0x12, ...uint(length, 4)]
}

function uint(value: number, size: number): number[] {
  const bytes: number[] = []
  let remaining = BigInt.asUintN(size * 8, BigInt(value))
  for (let index = 0; index < size; index += 1) {
    bytes.unshift(Number(remaining & 0xffn))
    remaining >>= 8n
  }
  return bytes
}

export const text = (value: string) => new TextEncoder().encode(value)
export const json = (value: unknown, pretty = true) => text(JSON.stringify(value, null, pretty ? 2 : 0))

/** Grava arquivos numa pasta do FS em memória e devolve o mapa de SHA-256. */
export async function writeFiles(
  fs: MemoryBackupFileSystem,
  directory: string,
  files: Record<string, Uint8Array>,
): Promise<Record<string, string>> {
  const digests: Record<string, string> = {}
  for (const [path, data] of Object.entries(files)) {
    const full = `${directory}/${path}`
    await fs.mkdir(full.slice(0, full.lastIndexOf('/')))
    await fs.writeFile(full, data)
    digests[path] = await sha256Hex(data)
  }
  return digests
}

export function base64(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? text(value) : value
  return btoa(String.fromCharCode(...bytes))
}
