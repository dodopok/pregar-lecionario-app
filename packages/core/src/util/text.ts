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
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)
  return matches ? matches.length : 0
}

/** Estimativa de minutos de pregação usada na barra de status (≈ 96 palavras por minuto). */
export const PREACHING_WORDS_PER_MINUTE = 96

export function estimatedPreachingMinutes(wordCount: number): number {
  return wordCount / PREACHING_WORDS_PER_MINUTE
}

export function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return value.slice(0, Math.max(0, maximum - 1)).trimEnd() + '…'
}
