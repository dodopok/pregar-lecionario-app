import { describe, expect, it } from 'vitest'
import {
  formatDateKey,
  isFreePreparation,
  longDate,
  occasionLines,
} from '../../src/renderer/src/views/arquivo/archive-helpers'

describe('preparações avulsas no Arquivo', () => {
  it('formata a data de uma chave com sufixo', () => {
    expect(formatDateKey('2026-11-14-k3x9')).toBe('14/11/2026')
    expect(longDate('2026-11-14-k3x9')).toBe('14 de novembro de 2026')
    expect(isFreePreparation('2026-11-14-k3x9')).toBe(true)
    expect(isFreePreparation('2026-11-14')).toBe(false)
  })

  it('marca a ocasião como avulsa', () => {
    expect(
      occasionLines({
        dateKey: '2026-11-14-k3x9',
        liturgicalOccasion: 'Casamento de Ana e Pedro',
        liturgicalCelebration: null,
        liturgicalSeason: null,
      }),
    ).toEqual({ primary: 'Casamento de Ana e Pedro', context: 'Avulsa' })
    expect(
      occasionLines({
        dateKey: '2026-11-15',
        liturgicalOccasion: 'Próprio 28',
        liturgicalCelebration: null,
        liturgicalSeason: 'Tempo Comum',
      }),
    ).toEqual({
      primary: 'Próprio 28',
      context: 'Tempo Comum',
    })
  })
})
