/**
 * Leitor mínimo de property list binária (`bplist00`), suficiente para o `Preferences.plist`
 * gravado pelo app Swift com `PropertyListSerialization` no formato `.binary`. Sem dependências.
 *
 * Estrutura: cabeçalho "bplist00", objetos, tabela de deslocamentos e trailer de 32 bytes
 * (tamanho dos deslocamentos, tamanho das referências, número de objetos, objeto raiz e
 * início da tabela).
 */

export class PlistUID {
  constructor(readonly value: number) {}
}

export type PlistValue =
  string | number | bigint | boolean | Date | Uint8Array | null | PlistUID | PlistValue[] | PlistDictionary

export interface PlistDictionary {
  [key: string]: PlistValue
}

export class BinaryPlistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BinaryPlistError'
  }
}

/** Datas de plist contam segundos desde 2001-01-01T00:00:00Z. */
export const APPLE_REFERENCE_DATE_MS = Date.UTC(2001, 0, 1)

const MAGIC = 'bplist00'
const TRAILER_SIZE = 32
const MAX_DEPTH = 512

export function isBinaryPlist(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC.charCodeAt(index)) return false
  }
  return true
}

export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  if (!isBinaryPlist(bytes)) throw new BinaryPlistError('Cabeçalho bplist00 ausente.')
  if (bytes.length < MAGIC.length + TRAILER_SIZE + 1) throw new BinaryPlistError('Property list truncada.')
  return new BinaryPlistReader(bytes).parse()
}

class BinaryPlistReader {
  private readonly view: DataView
  private readonly objectsEnd: number
  private readonly offsetSize: number
  private readonly refSize: number
  private readonly objectCount: number
  private readonly topObject: number
  private readonly tableOffset: number
  private readonly cache = new Map<number, PlistValue>()
  private readonly inProgress = new Set<number>()

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const trailer = bytes.length - TRAILER_SIZE
    this.offsetSize = this.byteAt(trailer + 6)
    this.refSize = this.byteAt(trailer + 7)
    this.objectCount = this.readUInt(trailer + 8, 8)
    this.topObject = this.readUInt(trailer + 16, 8)
    this.tableOffset = this.readUInt(trailer + 24, 8)
    this.objectsEnd = this.tableOffset

    if (this.offsetSize < 1 || this.offsetSize > 8 || this.refSize < 1 || this.refSize > 8) {
      throw new BinaryPlistError('Tamanhos inválidos no trailer da property list.')
    }
    if (this.objectCount < 1 || this.topObject >= this.objectCount) {
      throw new BinaryPlistError('Objeto raiz fora da tabela.')
    }
    if (this.tableOffset < MAGIC.length || this.tableOffset + this.objectCount * this.offsetSize > trailer) {
      throw new BinaryPlistError('Tabela de deslocamentos fora do arquivo.')
    }
  }

  parse(): PlistValue {
    return this.object(this.topObject, 0)
  }

  private object(ref: number, depth: number): PlistValue {
    if (ref >= this.objectCount) throw new BinaryPlistError('Referência de objeto inválida.')
    const cached = this.cache.get(ref)
    if (cached !== undefined) return cached
    if (this.inProgress.has(ref)) throw new BinaryPlistError('Referência circular na property list.')
    if (depth > MAX_DEPTH) throw new BinaryPlistError('Property list aninhada demais.')
    this.inProgress.add(ref)
    const value = this.decode(this.offsetOf(ref), depth)
    this.inProgress.delete(ref)
    this.cache.set(ref, value)
    return value
  }

  private offsetOf(ref: number): number {
    const offset = this.readUInt(this.tableOffset + ref * this.offsetSize, this.offsetSize)
    if (offset < MAGIC.length || offset >= this.objectsEnd) {
      throw new BinaryPlistError('Deslocamento de objeto inválido.')
    }
    return offset
  }

  private decode(offset: number, depth: number): PlistValue {
    const marker = this.byteAt(offset)
    const type = marker >> 4
    const info = marker & 0x0f
    switch (type) {
      case 0x0:
        if (info === 0x0) return null
        if (info === 0x8) return false
        if (info === 0x9) return true
        break
      case 0x1:
        return this.integer(offset + 1, info)
      case 0x2: {
        if (info === 2) {
          this.ensure(offset + 1, 4)
          return this.view.getFloat32(offset + 1)
        }
        if (info === 3) {
          this.ensure(offset + 1, 8)
          return this.view.getFloat64(offset + 1)
        }
        break
      }
      case 0x3: {
        if (info !== 3) break
        this.ensure(offset + 1, 8)
        const date = new Date(APPLE_REFERENCE_DATE_MS + this.view.getFloat64(offset + 1) * 1000)
        if (Number.isNaN(date.getTime())) throw new BinaryPlistError('Data inválida na property list.')
        return date
      }
      case 0x4: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length)
        return this.bytes.slice(start, start + length)
      }
      case 0x5: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length)
        let text = ''
        for (let index = 0; index < length; index += 1)
          text += String.fromCharCode(this.bytes[start + index]!)
        return text
      }
      case 0x6: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length * 2)
        const units: number[] = []
        for (let index = 0; index < length; index += 1) units.push(this.view.getUint16(start + index * 2))
        let text = ''
        for (let index = 0; index < units.length; index += 4096) {
          text += String.fromCharCode(...units.slice(index, index + 4096))
        }
        return text
      }
      case 0x7: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length)
        return new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(start, start + length))
      }
      case 0x8:
        this.ensure(offset + 1, info + 1)
        return new PlistUID(this.readUInt(offset + 1, info + 1))
      case 0xa:
      case 0xc: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length * this.refSize)
        const items: PlistValue[] = []
        for (let index = 0; index < length; index += 1) {
          items.push(this.object(this.readUInt(start + index * this.refSize, this.refSize), depth + 1))
        }
        return items
      }
      case 0xd: {
        const { length, start } = this.length(offset, info)
        this.ensure(start, length * this.refSize * 2)
        const result: PlistDictionary = {}
        for (let index = 0; index < length; index += 1) {
          const key = this.object(this.readUInt(start + index * this.refSize, this.refSize), depth + 1)
          if (typeof key !== 'string') throw new BinaryPlistError('Chave de dicionário que não é texto.')
          const valueRef = this.readUInt(start + (length + index) * this.refSize, this.refSize)
          // defineProperty evita que "__proto__" altere o protótipo do resultado.
          Object.defineProperty(result, key, {
            value: this.object(valueRef, depth + 1),
            enumerable: true,
            writable: true,
            configurable: true,
          })
        }
        return result
      }
    }
    throw new BinaryPlistError(`Tipo de objeto não suportado: 0x${marker.toString(16).padStart(2, '0')}.`)
  }

  /** Inteiros de 1, 2 e 4 bytes são sem sinal; os de 8 e 16 bytes, com sinal. */
  private integer(start: number, info: number): number | bigint {
    if (info > 4) throw new BinaryPlistError('Inteiro com tamanho inválido.')
    const size = 1 << info
    this.ensure(start, size)
    if (size <= 4) return this.readUInt(start, size)
    let value = 0n
    for (let index = 0; index < size; index += 1) value = (value << 8n) | BigInt(this.bytes[start + index]!)
    value = BigInt.asIntN(size * 8, value)
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value
  }

  private length(offset: number, info: number): { length: number; start: number } {
    if (info !== 0x0f) return { length: info, start: offset + 1 }
    const marker = this.byteAt(offset + 1)
    if (marker >> 4 !== 0x1) throw new BinaryPlistError('Tamanho estendido inválido.')
    const size = 1 << (marker & 0x0f)
    if (size > 8) throw new BinaryPlistError('Tamanho estendido inválido.')
    this.ensure(offset + 2, size)
    return { length: this.readUInt(offset + 2, size), start: offset + 2 + size }
  }

  private readUInt(start: number, size: number): number {
    this.ensureInFile(start, size)
    let value = 0
    for (let index = 0; index < size; index += 1) value = value * 256 + this.bytes[start + index]!
    if (!Number.isSafeInteger(value)) throw new BinaryPlistError('Inteiro grande demais na estrutura.')
    return value
  }

  private byteAt(index: number): number {
    this.ensureInFile(index, 1)
    return this.bytes[index]!
  }

  /** Conteúdo de objetos deve ficar antes da tabela de deslocamentos. */
  private ensure(start: number, length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || start + length > this.objectsEnd) {
      throw new BinaryPlistError('Objeto ultrapassa o fim da property list.')
    }
  }

  private ensureInFile(start: number, length: number): void {
    if (start < 0 || start + length > this.bytes.length) {
      throw new BinaryPlistError('Leitura além do fim da property list.')
    }
  }
}
