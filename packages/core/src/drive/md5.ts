/**
 * MD5 (RFC 1321). A Web Crypto não oferece MD5, mas a Drive API informa o `md5Checksum` dos
 * arquivos; ele serve só para conferir a integridade do download, nunca como proteção criptográfica.
 */

import { bytesToHex } from '../util/hash'

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21, 6, 10, 15, 21,
]

// K[i] = floor(|sin(i + 1)| · 2^32)
const CONSTANTS = new Int32Array(64)
for (let index = 0; index < 64; index += 1) {
  CONSTANTS[index] = Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0
}

const SHIFT_TABLE = Int32Array.from(SHIFTS)

class MD5State {
  a = 0x67452301
  b = 0xefcdab89 | 0
  c = 0x98badcfe | 0
  d = 0x10325476
  private readonly words = new Int32Array(16)

  /** Processa um bloco de 64 bytes a partir de `offset`. */
  block(bytes: Uint8Array, offset: number): void {
    const words = this.words
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4
      words[index] =
        (bytes[base] as number) |
        ((bytes[base + 1] as number) << 8) |
        ((bytes[base + 2] as number) << 16) |
        ((bytes[base + 3] as number) << 24)
    }
    let a = this.a
    let b = this.b
    let c = this.c
    let d = this.d
    for (let index = 0; index < 64; index += 1) {
      let f: number
      let g: number
      if (index < 16) {
        f = (b & c) | (~b & d)
        g = index
      } else if (index < 32) {
        f = (d & b) | (~d & c)
        g = (5 * index + 1) & 15
      } else if (index < 48) {
        f = b ^ c ^ d
        g = (3 * index + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * index) & 15
      }
      const sum = (a + f + (CONSTANTS[index] as number) + (words[g] as number)) | 0
      const shift = SHIFT_TABLE[index] as number
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
    }
    this.a = (this.a + a) | 0
    this.b = (this.b + b) | 0
    this.c = (this.c + c) | 0
    this.d = (this.d + d) | 0
  }
}

/** Resumo MD5 em 16 bytes. */
export function md5(data: Uint8Array | ArrayBuffer | string): Uint8Array {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
  const state = new MD5State()
  const fullBlocks = Math.floor(bytes.length / 64)
  for (let block = 0; block < fullBlocks; block += 1) state.block(bytes, block * 64)

  // Cauda: bytes restantes, 0x80, zeros e o comprimento em bits (64 bits little-endian).
  const remaining = bytes.length - fullBlocks * 64
  const tailLength = remaining < 56 ? 64 : 128
  const tail = new Uint8Array(tailLength)
  tail.set(bytes.subarray(fullBlocks * 64))
  tail[remaining] = 0x80
  const bitLengthLow = (bytes.length * 8) >>> 0
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000) >>> 0
  const lengthOffset = tailLength - 8
  for (let index = 0; index < 4; index += 1) {
    tail[lengthOffset + index] = (bitLengthLow >>> (8 * index)) & 0xff
    tail[lengthOffset + 4 + index] = (bitLengthHigh >>> (8 * index)) & 0xff
  }
  for (let offset = 0; offset < tailLength; offset += 64) state.block(tail, offset)

  const digest = new Uint8Array(16)
  const view = new DataView(digest.buffer)
  view.setInt32(0, state.a, true)
  view.setInt32(4, state.b, true)
  view.setInt32(8, state.c, true)
  view.setInt32(12, state.d, true)
  return digest
}

/** Resumo MD5 em hexadecimal minúsculo, no formato do `md5Checksum` da Drive API. */
export function md5Hex(data: Uint8Array | ArrayBuffer | string): string {
  return bytesToHex(md5(data))
}
