/** Chave de data local no formato yyyy-MM-dd, igual à `SermonDateKey` do app Swift. */
export function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Converte uma chave yyyy-MM-dd em data local à meia-noite. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
    return null
  }
  return date
}

export function isDateKey(value: string): boolean {
  return parseDateKey(value) !== null
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Próximo domingo a partir de `date` (o próprio dia, se já for domingo). */
export function nextSunday(date: Date): Date {
  const day = startOfDay(date)
  return addDays(day, (7 - day.getDay()) % 7)
}

/**
 * Próximo dia de pregação a partir de `date` (o próprio dia conta), dado o conjunto de dias da semana
 * em que a pessoa prega (0 = domingo). Sem dias válidos, vale o domingo.
 */
export function nextPreachingDay(date: Date, weekdays: readonly number[]): Date {
  const valid = new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
  if (valid.size === 0) return nextSunday(date)
  const day = startOfDay(date)
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(day, offset)
    if (valid.has(candidate.getDay())) return candidate
  }
  return nextSunday(date)
}

/** Dias que faltam de `from` até `to` (0 no mesmo dia; negativo se `to` já passou). */
export function daysBetween(from: Date, to: Date): number {
  const a = startOfDay(from).getTime()
  const b = startOfDay(to).getTime()
  return Math.round((b - a) / 86_400_000)
}

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

export function monthNamePt(monthIndex: number): string {
  return MONTHS_PT[((monthIndex % 12) + 12) % 12] ?? ''
}

export function weekdayNamePt(dayIndex: number): string {
  return WEEKDAYS_PT[((dayIndex % 7) + 7) % 7] ?? ''
}

/** "27 de setembro de 2026" */
export function longDatePt(date: Date): string {
  return `${date.getDate()} de ${monthNamePt(date.getMonth())} de ${date.getFullYear()}`
}

/** "27/09/2026" */
export function shortDatePt(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

/** Aceita dd/MM/yyyy e devolve a chave yyyy-MM-dd. */
export function parseBrazilianDate(value: string): string | null {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value)
  if (!match) return null
  const [, d, m, y] = match
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isDateKey(key) ? key : null
}
