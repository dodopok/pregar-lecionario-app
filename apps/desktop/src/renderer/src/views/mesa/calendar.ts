import { addDays, dateKey, monthNamePt, nextSunday, parseDateKey, startOfDay } from '@pregar/core/util/dates'
import type { SermonPreparationState } from '@shared/types'

export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export const STATE_TITLES: Record<SermonPreparationState, string> = {
  empty: 'sem rascunho',
  inProgress: 'em preparação',
  exported: 'pronta para pregar',
}

/** Células do mês (com vazios no início para alinhar o domingo). */
export function monthCells(month: string): (string | null)[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year!, monthNumber! - 1, 1)
  const days = new Date(year!, monthNumber!, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(dateKey(new Date(year!, monthNumber! - 1, day)))
  return cells
}

/** Domingos do mês; quando o mês tem quatro, inclui o primeiro domingo do mês seguinte (como no Swift). */
export function monthSundays(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const result: string[] = []
  const last = new Date(year!, monthNumber!, 0).getDate()
  for (let day = 1; day <= last; day += 1) {
    const date = new Date(year!, monthNumber! - 1, day)
    if (date.getDay() === 0) result.push(dateKey(date))
  }
  const nextFirst = new Date(year!, monthNumber!, 1)
  if (result.length < 5 && nextFirst.getDay() === 0) result.push(dateKey(nextFirst))
  return result
}

export function monthTitle(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const name = monthNamePt(monthNumber! - 1)
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`
}

export function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(year!, monthNumber! - 1 + amount, 1)
  return dateKey(date).slice(0, 7)
}

export function shiftDays(key: string, days: number): string {
  const date = parseDateKey(key) ?? new Date()
  return dateKey(addDays(date, days))
}

/** Ritmo da semana do workshop: contagem regressiva e orientação para o próximo domingo. */
export function weekRhythm(today: Date, state: SermonPreparationState): { sunday: string; countdown: string; guidance: string } {
  const sunday = nextSunday(today)
  const days = Math.round((startOfDay(sunday).getTime() - startOfDay(today).getTime()) / 86_400_000)
  const countdown = days === 0 ? 'É hoje' : days === 1 ? 'Falta 1 dia' : `Faltam ${days} dias`
  let guidance: string
  if (state === 'exported') guidance = 'Cópia pronta. Releia com calma e descanse.'
  else if (days === 0) guidance = 'Dia de pregar: caminhe tranquilamente pelo texto.'
  else if (days === 1) guidance = 'Véspera: revise e prepare a cópia para o tablet.'
  else if (days >= 2 && days <= 4) guidance = 'Hora de escrever, com o texto já ruminado.'
  else guidance = 'Semana de releitura: leia e releia os textos do domingo.'
  return { sunday: dateKey(sunday), countdown, guidance }
}
