import { describe, expect, it } from 'vitest'
import type { SermonSummary } from '@shared/types'
import {
  STATE_LABELS,
  archiveRowLabel,
  archiveSummary,
  driveStatus,
  formatDateKey,
  longDate,
  nextRowIndex,
  occasionLines,
  placeholderFor,
  referencesToCount,
  sermonTitle,
  snippetParts,
} from '../../src/renderer/src/views/arquivo/archive-helpers'

function summary(overrides: Partial<SermonSummary> = {}): SermonSummary {
  return {
    dateKey: '2026-10-04',
    title: '',
    liturgicalOccasion: 'Próprio 22',
    liturgicalCelebration: 'Décimo Nono Domingo depois de Pentecostes',
    liturgicalSeason: 'Tempo Comum',
    mainReadingReference: 'Mateus 21:33-46',
    wordCount: 1234,
    modifiedAt: '2026-10-03T12:00:00.000Z',
    state: 'inProgress',
    driveSyncedAt: null,
    tabletPdfUpdatedAt: null,
    ...overrides,
  }
}

describe('Arquivo', () => {
  it('formata datas sem fuso horário', () => {
    expect(formatDateKey('2026-10-04')).toBe('04/10/2026')
    expect(longDate('2026-03-01')).toBe('1 de março de 2026')
    expect(formatDateKey('inválida')).toBe('inválida')
  })

  it('resume a contagem como no app Swift', () => {
    expect(archiveSummary(0, 0)).toBe('nenhuma preparação ainda')
    expect(archiveSummary(1, 1)).toBe('1 preparação')
    expect(archiveSummary(12, 12)).toBe('12 preparações')
    expect(archiveSummary(12, 3)).toBe('3 de 12 preparações')
  })

  it('título, ocasião e rótulo acessível', () => {
    expect(sermonTitle(summary())).toBe('Mateus 21:33-46')
    expect(sermonTitle(summary({ title: 'A vinha', mainReadingReference: null }))).toBe('A vinha')
    expect(sermonTitle(summary({ mainReadingReference: null }))).toBe('Preparação sem título')
    expect(occasionLines(summary())).toEqual({ primary: 'Próprio 22', context: 'Tempo Comum · Décimo Nono Domingo depois de Pentecostes' })
    expect(occasionLines(summary({ liturgicalOccasion: null, liturgicalSeason: null }))).toEqual({
      primary: 'Décimo Nono Domingo depois de Pentecostes',
      context: 'Décimo Nono Domingo depois de Pentecostes',
    })
    expect(occasionLines(summary({ liturgicalOccasion: null, liturgicalCelebration: null, liturgicalSeason: null }))).toEqual({ primary: '—', context: '' })
    expect(archiveRowLabel(summary())).toBe('Mateus 21:33-46, Próprio 22, 4 de outubro de 2026')
  })

  it('estados e cópia', () => {
    expect(STATE_LABELS).toEqual({ empty: 'sem rascunho', inProgress: 'em preparação', exported: 'pronta para pregar' })
    expect(driveStatus(summary())).toEqual({ label: 'sem cópia', time: null, saved: false })
    const now = new Date(2026, 9, 4, 18, 0)
    const today = new Date(2026, 9, 4, 14, 32).toISOString()
    expect(driveStatus(summary({ tabletPdfUpdatedAt: today }), now)).toEqual({ label: 'PDF salvo', time: 'hoje, 14:32', saved: true })
    const earlier = new Date(2026, 9, 1, 9, 5).toISOString()
    expect(driveStatus(summary({ driveSyncedAt: earlier }), now)).toEqual({ label: 'Google Doc', time: '01/10, 09:05', saved: true })
  })

  it('trecho da busca de texto marca a ocorrência', () => {
    expect(snippetParts('…a «graça» de Deus…')).toEqual([
      { text: '…a ', marked: false },
      { text: 'graça', marked: true },
      { text: ' de Deus…', marked: false },
    ])
    expect(snippetParts('sem marcas')).toEqual([{ text: 'sem marcas', marked: false }])
  })

  it('placeholders por modo', () => {
    expect(placeholderFor('passage')).toBe('Mateus 21')
    expect(placeholderFor('occasion')).toBe('Próprio 22')
    expect(placeholderFor('date')).toBe('04/10/2026')
    expect(placeholderFor('text')).toBe('palavra ou frase do manuscrito')
  })

  it('pede contagens só de referências novas e distintas', () => {
    const known = new Map([['Mateus 21:33-46', 3]])
    expect(
      referencesToCount(
        [summary(), summary({ mainReadingReference: 'Romanos 13:8-14' }), summary({ mainReadingReference: ' Romanos 13:8-14 ' }), summary({ mainReadingReference: null })],
        known,
      ),
    ).toEqual(['Romanos 13:8-14'])
  })

  it('navegação por teclado', () => {
    expect(nextRowIndex('ArrowDown', 0, 5)).toBe(1)
    expect(nextRowIndex('ArrowDown', 4, 5)).toBe(4)
    expect(nextRowIndex('ArrowUp', 0, 5)).toBe(0)
    expect(nextRowIndex('End', 0, 5)).toBe(4)
    expect(nextRowIndex('PageDown', 0, 30)).toBe(10)
    expect(nextRowIndex('Enter', 0, 5)).toBeNull()
    expect(nextRowIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
