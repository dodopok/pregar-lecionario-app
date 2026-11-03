import { describe, expect, it } from 'vitest'
import { daysBetween, nextPreachingDay, nextSunday } from '../src/util/dates'
import {
  estimatedPreachingMinutes,
  estimatedPulpitPages,
  formatMinutes,
  measuredWordsPerMinute,
  PREACHING_WORDS_PER_MINUTE,
} from '../src/util/text'

describe('nextPreachingDay', () => {
  // 2026-11-03 é uma terça-feira.
  const tuesday = new Date(2026, 10, 3, 15, 30)

  it('vale o domingo quando não há dias configurados', () => {
    expect(nextPreachingDay(tuesday, [])).toEqual(nextSunday(tuesday))
    expect(nextPreachingDay(tuesday, [9, -1])).toEqual(nextSunday(tuesday))
  })

  it('escolhe o dia mais próximo entre os configurados, contando o próprio dia', () => {
    expect(nextPreachingDay(tuesday, [0, 3]).getDay()).toBe(3)
    expect(nextPreachingDay(tuesday, [2]).getDate()).toBe(3)
    expect(nextPreachingDay(tuesday, [6, 0]).getDay()).toBe(6)
  })

  it('devolve meia-noite local', () => {
    const result = nextPreachingDay(tuesday, [0])
    expect(result.getHours()).toBe(0)
    expect(result.getDay()).toBe(0)
    expect(result.getDate()).toBe(8)
  })
})

describe('daysBetween', () => {
  it('conta dias inteiros ignorando a hora', () => {
    expect(daysBetween(new Date(2026, 10, 3, 23), new Date(2026, 10, 8, 1))).toBe(5)
    expect(daysBetween(new Date(2026, 10, 8), new Date(2026, 10, 3))).toBe(-5)
    expect(daysBetween(new Date(2026, 10, 3, 1), new Date(2026, 10, 3, 22))).toBe(0)
  })
})

describe('estimativas de pregação', () => {
  it('usa o ritmo padrão e aceita um ritmo próprio', () => {
    expect(estimatedPreachingMinutes(PREACHING_WORDS_PER_MINUTE * 10)).toBe(10)
    expect(estimatedPreachingMinutes(1200, 120)).toBe(10)
    expect(estimatedPreachingMinutes(960, 0)).toBe(10)
    expect(estimatedPreachingMinutes(960, Number.NaN)).toBe(10)
  })

  it('estima páginas da folha do púlpito', () => {
    expect(estimatedPulpitPages(0)).toBe(0)
    expect(estimatedPulpitPages(12)).toBe(1)
    expect(estimatedPulpitPages(1800)).toBe(7)
    expect(estimatedPulpitPages(1000, 500)).toBe(2)
  })

  it('só aceita medições do Ensaio com texto e tempo suficientes', () => {
    expect(measuredWordsPerMinute(50, 120)).toBeNull()
    expect(measuredWordsPerMinute(500, 20)).toBeNull()
    expect(measuredWordsPerMinute(480, 300)).toBe(96)
    expect(measuredWordsPerMinute(2000, 60)).toBe(180)
    expect(measuredWordsPerMinute(100, 600)).toBe(60)
  })

  it('formata minutos de forma curta', () => {
    expect(formatMinutes(17.6)).toBe('18 min')
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(65)).toBe('1 h 05')
    expect(formatMinutes(-3)).toBe('0 min')
  })
})
