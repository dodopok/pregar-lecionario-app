import { describe, expect, it } from 'vitest'
import {
  LiturgicalDateContext,
  explicitProper,
  firstSundayOfAdvent,
  liturgicalProperDay,
  liturgicalYearLetter,
  properDesignation,
  properNumberForDate,
  properShortDesignation,
} from '../../src/liturgy/calendar'
import { FavoriteSourceURLs } from '../../src/sources'

const sunday = (year: number, month: number, day: number) => new Date(year, month - 1, day)

describe('calendário litúrgico', () => {
  it('1º Domingo do Advento é o primeiro domingo a partir de 27/11', () => {
    expect(firstSundayOfAdvent(2025).getDate()).toBe(30)
    expect(firstSundayOfAdvent(2026).getDate()).toBe(29)
    expect(firstSundayOfAdvent(2027).getDate()).toBe(28)
    expect(firstSundayOfAdvent(2022).getDate()).toBe(27)
    const advent2028 = firstSundayOfAdvent(2028)
    expect([advent2028.getMonth(), advent2028.getDate()]).toEqual([11, 3])
    for (const year of [2022, 2025, 2026, 2027, 2028]) expect(firstSundayOfAdvent(year).getDay()).toBe(0)
  })

  it('o ciclo A/B/C vira no 1º Domingo do Advento, não em 1º de janeiro', () => {
    expect(liturgicalYearLetter(new Date(2025, 10, 29))).toBe('C')
    expect(liturgicalYearLetter(new Date(2025, 10, 30))).toBe('A')
    expect(liturgicalYearLetter(new Date(2026, 0, 1))).toBe('A')
    expect(liturgicalYearLetter(new Date(2026, 10, 28, 23, 59))).toBe('A')
    expect(liturgicalYearLetter(new Date(2026, 10, 29))).toBe('B')
    expect(liturgicalYearLetter(new Date(2026, 10, 29, 18, 30))).toBe('B')
    expect(liturgicalYearLetter(new Date(2027, 5, 6))).toBe('B')
    expect(liturgicalYearLetter(new Date(2027, 10, 28))).toBe('C')
    expect(liturgicalYearLetter(new Date(2028, 11, 3))).toBe('A')
    expect(liturgicalYearLetter(new Date(Number.NaN))).toBeNull()
  })

  it('numera os Próprios de 3 (22–28/05) a 29 (20–26/11), só aos domingos', () => {
    expect(properNumberForDate(sunday(2026, 5, 24))).toBe(3)
    expect(properNumberForDate(sunday(2026, 5, 17))).toBeNull()
    expect(properNumberForDate(sunday(2026, 9, 27))).toBe(21)
    expect(properNumberForDate(sunday(2026, 10, 4))).toBe(22)
    expect(properNumberForDate(sunday(2026, 11, 22))).toBe(29)
    expect(properNumberForDate(sunday(2026, 11, 29))).toBeNull()
    expect(properNumberForDate(new Date(2026, 9, 5))).toBeNull()
    // Fronteiras exatas: 22/05 e 26/11 caindo em domingo (2022), inclusive com horário.
    expect(properNumberForDate(sunday(2022, 5, 22))).toBe(3)
    expect(properNumberForDate(new Date(2022, 10, 20, 10))).toBe(29)
    expect(properNumberForDate(new Date(2028, 4, 28, 12))).toBe(3)
    expect(properNumberForDate(new Date(2023, 10, 26, 12))).toBe(29)
  })

  it('Próprio explícito na ocasião, com ou sem ano', () => {
    expect(explicitProper('Proper 21 A')).toEqual({ number: 21, year: 'A' })
    expect(explicitProper('Proper 21A')).toEqual({ number: 21, year: 'A' })
    expect(explicitProper('Próprio 7, ano C')).toEqual({ number: 7, year: 'C' })
    expect(explicitProper('PROPER 12 — Year B')).toEqual({ number: 12, year: 'B' })
    expect(explicitProper('Próprio 22')).toEqual({ number: 22, year: '' })
    expect(explicitProper('Proper 2 A')).toBeNull()
    expect(explicitProper('Proper 30')).toBeNull()
    expect(explicitProper('Todos os Santos')).toBeNull()
    expect(explicitProper('')).toBeNull()
    expect(explicitProper(null)).toBeNull()
  })

  it('completa o ano do Próprio explícito pela data, mesmo fora do domingo', () => {
    expect(liturgicalProperDay('Próprio 22', new Date(2026, 9, 6), false)).toEqual({ number: 22, year: 'A' })
    expect(liturgicalProperDay('Proper 22', null, true)).toBeNull()
    expect(liturgicalProperDay('Proper 22 B', null, false)).toEqual({ number: 22, year: 'B' })
  })

  it('deduz o Próprio dos domingos do Tempo Comum e depois de Pentecostes', () => {
    const date = sunday(2026, 10, 4)
    expect(liturgicalProperDay('19º Domingo depois de Pentecostes', date, true)).toEqual({
      number: 22,
      year: 'A',
    })
    expect(liturgicalProperDay('27º Domingo do Tempo Comum', date, true)).toEqual({ number: 22, year: 'A' })
    expect(liturgicalProperDay('Twenty-Seventh Sunday in Ordinary Time', date, true)).toEqual({
      number: 22,
      year: 'A',
    })
    expect(liturgicalProperDay('Todos os Santos', date, true)).toBeNull()
    expect(liturgicalProperDay('19º Domingo depois de Pentecostes', date, false)).toBeNull()
    expect(liturgicalProperDay(null, date, true)).toBeNull()
    expect(liturgicalProperDay('Domingo de Pentecostes', sunday(2026, 5, 24), true)).toEqual({
      number: 3,
      year: 'A',
    })
    expect(LiturgicalDateContext.properDay('Tempo Comum', sunday(2027, 7, 4), true)).toEqual({
      number: 9,
      year: 'B',
    })
    expect(LiturgicalDateContext.yearLetter(sunday(2027, 11, 28))).toBe('C')
  })

  it('designações exibidas na Mesa', () => {
    expect(properDesignation({ number: 22, year: 'A' })).toBe('Próprio 22')
    expect(properShortDesignation({ number: 22, year: 'A' })).toBe('Próprio 22 A')
    expect(properShortDesignation({ number: 22, year: '' })).toBe('Próprio 22')
  })

  it('a mesma numeração abre o "Today in the Spirit" do Anglican Compass', () => {
    expect(
      FavoriteSourceURLs.anglicanCompass(
        'Mateus 21.33-46',
        '19º Domingo depois de Pentecostes',
        sunday(2026, 10, 4),
        true,
      ),
    ).toBe('https://anglicancompass.com/today-in-the-spirit-proper-22a/')
    expect(FavoriteSourceURLs.anglicanCompass('Romanos 13.8-14', 'Proper 18 A', null, false)).toBe(
      'https://anglicancompass.com/today-in-the-spirit-proper-18a/',
    )
    // Depois do Advento o ciclo muda para B.
    expect(FavoriteSourceURLs.anglicanCompass('Marcos 1.1-8', 'Proper 22', sunday(2026, 11, 29), false)).toBe(
      'https://anglicancompass.com/today-in-the-spirit-proper-22b/',
    )
    // Sem Próprio conhecido, cai na busca do site.
    const search = new URL(
      FavoriteSourceURLs.anglicanCompass(
        'Isaías 64.1-9',
        '1º Domingo do Advento',
        sunday(2026, 11, 29),
        true,
      ),
    )
    expect(search.searchParams.get('s')).toBe('Today in the Spirit 1º Domingo do Advento Isaiah 64:1-9')
  })
})
