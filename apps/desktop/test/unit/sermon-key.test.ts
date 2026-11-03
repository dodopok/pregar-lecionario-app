import { describe, expect, it } from 'vitest'
import {
  isFreeSermonKey,
  isSermonKey,
  newFreeSermonKey,
  sermonDateOf,
  sermonKeyUpperBound,
  sermonKindOf,
} from '../../src/shared/sermon-key'

describe('chave de preparação', () => {
  it('aceita a data do lecionário e a avulsa com sufixo', () => {
    expect(isSermonKey('2026-11-08')).toBe(true)
    expect(isSermonKey('2026-11-08-k3x9')).toBe(true)
    expect(isSermonKey('2026-11-08-K3X9')).toBe(false)
    expect(isSermonKey('2026-11-08-k3x')).toBe(false)
    expect(isSermonKey('08/11/2026')).toBe(false)
  })

  it('separa a data e o tipo', () => {
    expect(sermonDateOf('2026-11-08-k3x9')).toBe('2026-11-08')
    expect(sermonDateOf('2026-11-08')).toBe('2026-11-08')
    expect(isFreeSermonKey('2026-11-08-k3x9')).toBe(true)
    expect(isFreeSermonKey('2026-11-08')).toBe(false)
    expect(sermonKindOf('2026-11-08-k3x9')).toBe('free')
    expect(sermonKindOf('2026-11-08')).toBe('lectionary')
  })

  it('gera chaves avulsas válidas e ordenadas junto da data', () => {
    const key = newFreeSermonKey('2026-11-08', () => 0.5)
    expect(isFreeSermonKey(key)).toBe(true)
    expect(key > '2026-11-08').toBe(true)
    expect(key < '2026-11-09').toBe(true)
    expect(key < sermonKeyUpperBound('2026-11-08')).toBe(true)
    expect(() => newFreeSermonKey('amanhã')).toThrow()
  })
})
