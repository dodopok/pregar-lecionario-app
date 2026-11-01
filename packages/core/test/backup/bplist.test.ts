import { describe, expect, it } from 'vitest'
import { BinaryPlistError, PlistUID, isBinaryPlist, parseBinaryPlist } from '../../src/backup/bplist'

/** Converte "62 70 6c" em bytes; espaços e quebras de linha são ignorados. */
function hex(...parts: string[]): Uint8Array {
  const clean = parts.join(' ').replace(/\s+/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

const HEADER = '62 70 6c 69 73 74 30 30' // "bplist00"

/** Preferências como o app Swift grava: texto, real, inteiro e booleano. Conferido com plistlib. */
const PREFERENCES = hex(
  HEADER,
  'd4 01 02 03 04 05 06 07 08', // 0 @08: dicionário com 4 pares (chaves 1-4, valores 5-8)
  '59 61 70 69 2e 62 69 62 6c 65', // 1 @11: "api.bible"
  '5e 64 72 69 76 65 2e 66 6f 6e 74 53 69 7a 65', // 2 @1b: "drive.fontSize"
  '55 63 6f 75 6e 74', // 3 @2a: "count"
  '57 65 6e 61 62 6c 65 64', // 4 @30: "enabled"
  '53 6e 61 61', // 5 @38: "naa"
  '23 40 2c 00 00 00 00 00 00', // 6 @3c: real 14.0
  '10 03', // 7 @45: inteiro 3
  '09', // 8 @47: true
  '08 11 1b 2a 30 38 3c 45 47', // tabela @48 (deslocamentos de 1 byte)
  '00 00 00 00 00 00 01 01', // trailer: deslocamentos e referências de 1 byte
  '00 00 00 00 00 00 00 09', // 9 objetos
  '00 00 00 00 00 00 00 00', // raiz: objeto 0
  '00 00 00 00 00 00 00 48', // tabela em 0x48
)

/** Escalares variados com deslocamentos de 2 bytes. Conferido com plistlib. */
const SCALARS = hex(
  HEADER,
  'ab 01 02 03 04 05 06 07 08 09 0a 0b', // 0 @0008: array com 11 itens
  '68 00 53 00 65 00 72 00 6d 00 e3 00 6f 00 20 27 1d', // 1 @0014: UTF-16 "Sermão ✝"
  '13 ff ff ff ff ff ff ff d6', // 2 @0025: inteiro de 8 bytes -42
  '33 41 c8 38 fc 58 00 00 00', // 3 @002e: data 812775600 s desde 2001 = 2026-10-04T03:00:00Z
  '44 25 50 44 46', // 4 @0037: data "%PDF"
  '00', // 5 @003c: null
  '08', // 6 @003d: false
  '22 3f c0 00 00', // 7 @003e: real de 4 bytes 1.5
  '80 07', // 8 @0043: UID 7
  '5f 10 1e 74 65 78 74 6f 20 61 73 63 69 69 20 63 6f 6d 20 6d 61 69 73 20 64 65 20 71 75 69 6e 7a 65', // 9 @0045: ASCII com tamanho estendido (30)
  '11 01 2c', // 10 @0066: inteiro de 2 bytes 300
  '12 00 01 11 70', // 11 @0069: inteiro de 4 bytes 70000
  '00 08 00 14 00 25 00 2e 00 37 00 3c 00 3d 00 3e 00 43 00 45 00 66 00 69', // tabela @006e
  '00 00 00 00 00 00 02 01',
  '00 00 00 00 00 00 00 0c',
  '00 00 00 00 00 00 00 00',
  '00 00 00 00 00 00 00 6e',
)

/** Dicionários aninhados, objeto compartilhado, chave "__proto__" e data longa. Conferido com plistlib. */
const NESTED = hex(
  HEADER,
  'd3 01 02 03 04 05 06', // 0 @08: {sites, __proto__, blob}
  '55 73 69 74 65 73', // 1 @0f: "sites"
  '59 5f 5f 70 72 6f 74 6f 5f 5f', // 2 @15: "__proto__"
  '54 62 6c 6f 62', // 3 @1f: "blob"
  'a2 07 07', // 4 @24: array com o objeto 7 duas vezes
  '51 78', // 5 @27: "x"
  '4f 10 14 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13', // 6 @29: data de 20 bytes
  'd1 08 09', // 7 @40: {name: ...}
  '54 6e 61 6d 65', // 8 @43: "name"
  '5f 10 10 57 6f 72 6b 69 6e 67 20 50 72 65 61 63 68 65 72', // 9 @48: "Working Preacher"
  '08 0f 15 1f 24 27 29 40 43 48', // tabela @5b
  '00 00 00 00 00 00 01 01',
  '00 00 00 00 00 00 00 0a',
  '00 00 00 00 00 00 00 00',
  '00 00 00 00 00 00 00 5b',
)

function trailer(objects: number, table: number, top = 0): string {
  const u64 = (value: number) => `00 00 00 00 00 00 00 ${value.toString(16).padStart(2, '0')}`
  return ['00 00 00 00 00 00 01 01', u64(objects), u64(top), u64(table)].join(' ')
}

describe('property list binária', () => {
  it('lê o dicionário de preferências do app Swift', () => {
    expect(isBinaryPlist(PREFERENCES)).toBe(true)
    expect(parseBinaryPlist(PREFERENCES)).toEqual({
      'api.bible': 'naa',
      'drive.fontSize': 14,
      count: 3,
      enabled: true,
    })
  })

  it('lê UTF-16, inteiros com e sem sinal, datas, dados, nulo, real de 4 bytes e UID', () => {
    const value = parseBinaryPlist(SCALARS) as unknown[]
    expect(value[0]).toBe('Sermão ✝')
    expect(value[1]).toBe(-42)
    expect((value[2] as Date).toISOString()).toBe('2026-10-04T03:00:00.000Z')
    expect(value[3]).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(value[4]).toBeNull()
    expect(value[5]).toBe(false)
    expect(value[6]).toBe(1.5)
    expect(value[7]).toEqual(new PlistUID(7))
    expect(value[8]).toBe('texto ascii com mais de quinze')
    expect(value[9]).toBe(300)
    expect(value[10]).toBe(70000)
  })

  it('lê estruturas aninhadas, objetos compartilhados e não altera o protótipo', () => {
    const value = parseBinaryPlist(NESTED) as Record<string, unknown>
    expect(value.sites).toEqual([{ name: 'Working Preacher' }, { name: 'Working Preacher' }])
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.keys(value)).toEqual(['sites', '__proto__', 'blob'])
    expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe('x')
    expect(value.blob).toEqual(Uint8Array.from({ length: 20 }, (_, index) => index))
  })

  it('devolve bigint para inteiros fora da faixa segura', () => {
    // [0] inteiro de 8 bytes 2^62
    const bytes = hex(HEADER, '13 40 00 00 00 00 00 00 00', '08', trailer(1, 0x11))
    expect(parseBinaryPlist(bytes)).toBe(2n ** 62n)
  })

  it('rejeita cabeçalho errado, arquivo truncado, referências circulares e fora da tabela', () => {
    expect(() => parseBinaryPlist(new TextEncoder().encode('<?xml version="1.0"?><plist/>'))).toThrow(
      BinaryPlistError,
    )
    expect(() => parseBinaryPlist(PREFERENCES.slice(0, 60))).toThrow(BinaryPlistError)
    // array que contém a si mesmo
    expect(() => parseBinaryPlist(hex(HEADER, 'a1 00', '08', trailer(1, 0x0a)))).toThrow(/circular/)
    // array que aponta para o objeto 5, inexistente
    expect(() => parseBinaryPlist(hex(HEADER, 'a1 05', '08', trailer(1, 0x0a)))).toThrow(BinaryPlistError)
    // string que declara 9 bytes mas tem 3
    expect(() => parseBinaryPlist(hex(HEADER, '59 61 62 63', '08', trailer(1, 0x0c)))).toThrow(
      BinaryPlistError,
    )
    // chave de dicionário numérica
    expect(() => parseBinaryPlist(hex(HEADER, 'd1 01 01', '10 01', '08 0b', trailer(2, 0x0d)))).toThrow(
      /Chave/,
    )
  })
})
