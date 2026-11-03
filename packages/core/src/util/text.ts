/**
 * Utilitários de texto equivalentes às dobras de caixa e diacríticos do Foundation.
 * As funções preservam o comprimento em UTF-16 para letras latinas pré-compostas,
 * então posições calculadas na versão dobrada valem para o texto original.
 */

/** Remove diacríticos (á → a, ç → c) sem mudar a caixa. */
export function foldDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC')
}

/** Remove diacríticos e passa para minúsculas. */
export function foldCaseAndDiacritics(value: string): string {
  return foldDiacritics(value).toLocaleLowerCase('en-US')
}

/**
 * Normalização usada em buscas e comparações de referências: sem acentos, minúsculas,
 * traços unificados e espaços colapsados.
 */
export function normalizeForSearch(value: string): string {
  return foldCaseAndDiacritics(value)
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Conta palavras como o editor: sequências separadas por espaço que contenham letra ou número. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return matches ? matches.length : 0
}

/** Ritmo padrão de pregação usado nas estimativas (≈ 96 palavras por minuto, até o Ensaio medir o seu). */
export const PREACHING_WORDS_PER_MINUTE = 96

/** Limites aceitos para um ritmo medido ou digitado (fala muito lenta ou muito rápida). */
export const PREACHING_WPM_RANGE = { min: 60, max: 180 } as const

/** Palavras por página impressa na folha do púlpito (fonte 18 pt, entrelinha generosa). */
export const PULPIT_WORDS_PER_PAGE = 260

/** Minutos de pregação estimados para `wordCount` palavras no ritmo dado (padrão: 96 ppm). */
export function estimatedPreachingMinutes(wordCount: number, wordsPerMinute = PREACHING_WORDS_PER_MINUTE): number {
  const rate = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : PREACHING_WORDS_PER_MINUTE
  return wordCount / rate
}

/** Páginas estimadas da folha do púlpito (sempre pelo menos 1 quando há texto). */
export function estimatedPulpitPages(wordCount: number, wordsPerPage = PULPIT_WORDS_PER_PAGE): number {
  if (wordCount <= 0) return 0
  return Math.max(1, Math.ceil(wordCount / wordsPerPage))
}

/** Ritmo medido no Ensaio, limitado à faixa plausível; nulo quando a medição não vale (muito curta). */
export function measuredWordsPerMinute(words: number, elapsedSeconds: number): number | null {
  if (words < 80 || elapsedSeconds < 30) return null
  const rate = Math.round((words / elapsedSeconds) * 60)
  return Math.min(PREACHING_WPM_RANGE.max, Math.max(PREACHING_WPM_RANGE.min, rate))
}

/** Texto curto da duração estimada: "≈ 18 min" ou "≈ 1 h 05". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return `${hours} h ${String(rest).padStart(2, '0')}`
}

export function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return value.slice(0, Math.max(0, maximum - 1)).trimEnd() + '…'
}
