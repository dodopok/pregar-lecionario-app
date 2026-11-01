import { startOfDay } from '../util/dates'
import { normalizeForSearch } from '../util/text'

/**
 * Contexto litúrgico derivado da data: ciclo A/B/C (que vira no 1º Domingo do Advento) e
 * numeração dos Próprios do Tempo Comum (Lecionário Comum Revisado, Próprio 3 a 29).
 * Porte de `LiturgicalDateContext` e `LiturgicalProperDay` do app Swift. Tudo em horário local,
 * como o `Calendar.current` do macOS.
 */

export type LiturgicalYearLetter = 'A' | 'B' | 'C'

export interface LiturgicalProperDay {
  number: number
  /** Ciclo A/B/C; vazio quando a ocasião cita o Próprio sem ano e não há data para deduzi-lo. */
  year: LiturgicalYearLetter | ''
}

export const FIRST_PROPER = 3
export const LAST_PROPER = 29

/** "Próprio 22" */
export function properDesignation(proper: LiturgicalProperDay): string {
  return `Próprio ${proper.number}`
}

/** "Próprio 22 A" (ou só "Próprio 22" sem ano). */
export function properShortDesignation(proper: LiturgicalProperDay): string {
  const designation = properDesignation(proper)
  return proper.year === '' ? designation : `${designation} ${proper.year}`
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function isProperNumber(value: number): boolean {
  return Number.isInteger(value) && value >= FIRST_PROPER && value <= LAST_PROPER
}

/** 1º Domingo do Advento do ano civil: o primeiro domingo a partir de 27 de novembro. */
export function firstSundayOfAdvent(year: number): Date {
  const base = new Date(year, 10, 27)
  const daysToSunday = (7 - base.getDay()) % 7
  return new Date(year, 10, 27 + daysToSunday)
}

/** Letra do ciclo dominical; o ano litúrgico começa no 1º Domingo do Advento. */
export function liturgicalYearLetter(date: Date): LiturgicalYearLetter | null {
  if (!isValidDate(date)) return null
  const year = date.getFullYear()
  const advent = firstSundayOfAdvent(year)
  const liturgicalYear = startOfDay(date).getTime() >= advent.getTime() ? year : year - 1
  switch (((liturgicalYear % 3) + 3) % 3) {
    case 0:
      return 'A'
    case 1:
      return 'B'
    default:
      return 'C'
  }
}

function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end - start) / 86_400_000)
}

/**
 * Número do Próprio para um domingo entre 22 de maio e 26 de novembro: o Próprio 3 é o domingo
 * entre 22 e 28 de maio, e cada semana soma um. Outros dias devolvem `null`.
 */
export function properNumberForDate(date: Date): number | null {
  if (!isValidDate(date) || date.getDay() !== 0) return null
  const year = date.getFullYear()
  const first = new Date(year, 4, 22)
  const last = new Date(year, 10, 26)
  const day = startOfDay(date)
  // Comparação por dia civil: um domingo 26/11 ao meio-dia ainda é o Próprio 29.
  if (day.getTime() < first.getTime() || day.getTime() > last.getTime()) return null
  const proper = FIRST_PROPER + Math.floor(calendarDaysBetween(first, day) / 7)
  return isProperNumber(proper) ? proper : null
}

/** Próprio citado na própria ocasião ("Proper 21 A", "Próprio 21", "Proper 21A, Year A"). */
export function explicitProper(occasion: string | null | undefined): LiturgicalProperDay | null {
  if (!occasion) return null
  const normalized = normalizeForSearch(occasion)
  const match = /(?:proprio|proper)\s+(\d+)\s*([abc])?/.exec(normalized)
  if (!match?.[1]) return null
  const number = Number.parseInt(match[1], 10)
  if (!isProperNumber(number)) return null
  let year = match[2]?.toUpperCase()
  const yearMatch = /(?:ano|year)\s+([abc])|(?:proprio|proper)\s+\d+\s+([abc])/.exec(normalized)
  if (yearMatch) {
    const letter = yearMatch[1] ?? yearMatch[2]
    if (letter) year = letter.toUpperCase()
  }
  return { number, year: (year ?? '') as LiturgicalYearLetter | '' }
}

/**
 * Próprio do dia: o explícito na ocasião (completando o ano pela data) ou, para um domingo do
 * Tempo Comum/depois de Pentecostes, o calculado pela data.
 */
export function liturgicalProperDay(
  occasion: string | null | undefined,
  date: Date | null | undefined,
  isSunday: boolean,
): LiturgicalProperDay | null {
  const explicit = explicitProper(occasion)
  if (explicit) {
    if (explicit.year !== '') return explicit
    if (date) {
      const year = liturgicalYearLetter(date)
      if (year) return { number: explicit.number, year }
    }
  }
  if (occasion === null || occasion === undefined || !date || !isSunday) return null
  const normalized = normalizeForSearch(occasion)
  if (
    !normalized.includes('tempo comum') &&
    !normalized.includes('ordinary time') &&
    !normalized.includes('pentecost')
  ) {
    return null
  }
  const number = properNumberForDate(date)
  const year = liturgicalYearLetter(date)
  if (number === null || year === null) return null
  return { number, year }
}

/** Mesmo agrupamento do Swift, para quem porta código que chama `LiturgicalDateContext`. */
export const LiturgicalDateContext = {
  properDay: liturgicalProperDay,
  yearLetter: liturgicalYearLetter,
} as const
