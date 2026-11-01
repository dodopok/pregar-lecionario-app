import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { md5, md5Hex } from '../../src/drive/md5'

describe('MD5', () => {
  it('confere os vetores de teste da RFC 1321', () => {
    const vectors: [string, string][] = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
      [
        '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
        '57edf4a22be3c955ac49da2e2107b67a',
      ],
    ]
    for (const [input, expected] of vectors) expect(md5Hex(input)).toBe(expected)
  })

  it('coincide com o MD5 do Node nas fronteiras de bloco e em entradas maiores', () => {
    const lengths = [...Array.from({ length: 140 }, (_, index) => index), 1_000, 65_536, 1_048_577]
    for (const length of lengths) {
      const data = new Uint8Array(randomBytes(length))
      expect(md5Hex(data), `comprimento ${length}`).toBe(createHash('md5').update(data).digest('hex'))
    }
  })

  it('aceita ArrayBuffer e vistas com deslocamento', () => {
    const backing = new Uint8Array(randomBytes(300))
    const view = backing.subarray(17, 250)
    const expected = createHash('md5').update(view).digest('hex')
    expect(md5Hex(view)).toBe(expected)
    expect(md5Hex(view.slice().buffer)).toBe(expected)
    expect(md5('abc')).toHaveLength(16)
  })

  it('codifica texto em UTF-8', () => {
    expect(md5Hex('Sermão')).toBe(createHash('md5').update('Sermão', 'utf8').digest('hex'))
  })
})
