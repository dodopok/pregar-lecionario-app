/**
 * Chave de uma preparação. A do lecionário é a data (`2026-11-08`); a avulsa (casamento, funeral,
 * segunda pregação no mesmo dia) ganha um sufixo curto (`2026-11-08-k3x9`) e continua ordenada
 * junto da data no calendário e no Arquivo. Todas as validações do app passam por aqui.
 */

import { SERMON_KEY_PATTERN, isDateKey, isSermonKey, sermonDateOf } from '@pregar/core/util/dates'

export { SERMON_KEY_PATTERN, isSermonKey, sermonDateOf }
export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type SermonKind = 'lectionary' | 'free'

export function isDateKeyLike(value: string): boolean {
  return DATE_KEY_PATTERN.test(value) && isDateKey(value)
}

export function isFreeSermonKey(key: string): boolean {
  return key.length > 10 && SERMON_KEY_PATTERN.test(key)
}

export function sermonKindOf(key: string): SermonKind {
  return isFreeSermonKey(key) ? 'free' : 'lectionary'
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Nova chave avulsa para a data: sufixo de quatro caracteres sem letras ambíguas. */
export function newFreeSermonKey(dateKey: string, random: () => number = Math.random): string {
  if (!isDateKeyLike(dateKey)) throw new Error('Data de preparação inválida.')
  let suffix = ''
  for (let index = 0; index < 4; index += 1) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? 'a'
  return `${dateKey}-${suffix}`
}

/** Limite superior inclusivo para consultas por intervalo de chaves (inclui as avulsas do último dia). */
export function sermonKeyUpperBound(dateKey: string): string {
  return `${dateKey}-~`
}
