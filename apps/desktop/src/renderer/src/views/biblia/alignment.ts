/**
 * Alinhamento das traduções por capítulo e versículo (porte de BibleComparisonView, Swift).
 * Funções puras: recebem as passagens já carregadas e devolvem as linhas da comparação.
 */
import { parseReference } from '@pregar/core/bible/reference'
import { compareVersePositions, versePosition, versePositionId } from '@pregar/core/liturgy/types'
import type { BiblePassageText, VersePosition } from '@pregar/core/liturgy/types'

export type PassageScope = 'pericope' | 'chapter'

/** "João 3:16-18" → "João 3"; "Salmo 23" fica igual. */
export function chapterReference(reference: string): string {
  return reference.replace(/[.:]\d+[a-z]?([–-].*)?$/, '')
}

export function requestReference(reference: string, scope: PassageScope): string {
  const trimmed = reference.trim()
  return scope === 'chapter' ? chapterReference(trimmed).trim() : trimmed
}

/** Rótulo do botão de capítulo: "Capítulo 3". */
export function chapterButtonLabel(reference: string): string {
  const last = chapterReference(reference.trim()).split(' ').pop() ?? ''
  return /\d/.test(last) ? `Capítulo ${last}` : 'Capítulo'
}

/** A referência atravessa capítulos ("João 3:16–4:2")? */
export function spansMultipleChapters(reference: string): boolean {
  const parsed = parseReference(reference)
  if (!parsed) return false
  return (parsed.endChapter ?? parsed.chapter) !== parsed.chapter
}

/** Capítulo usado quando a API não informa o capítulo de cada versículo (só vale para um capítulo). */
export function fallbackChapter(reference: string): number | null {
  if (spansMultipleChapters(reference)) return null
  return parseReference(reference)?.chapter ?? null
}

/** Tradução principal primeiro, depois as de comparação, sem repetir. */
export function displayedVersionCodes(main: string, comparisons: readonly string[]): string[] {
  const result = [main]
  for (const code of comparisons) if (code && !result.includes(code)) result.push(code)
  return result
}

/**
 * Numa referência entre capítulos, respostas antigas sem `chapter` em cada versículo não podem ser
 * alinhadas: fundir os versículos repetidos (3:16 e 4:16) seria errado.
 */
export function chapterCoordinatesUnavailable(
  reference: string,
  passages: readonly (BiblePassageText | undefined)[],
): boolean {
  if (!spansMultipleChapters(reference)) return false
  return passages.some((passage) => {
    if (!passage) return false
    const verses = passage.verses ?? []
    if (verses.length === 0) return true
    return verses.some((verse) => verse.chapter === null || verse.chapter === undefined)
  })
}

/**
 * Posições presentes em qualquer tradução, ordenadas. Quando nenhuma tradução traz versículos mas
 * alguma traz texto corrido, devolve uma única linha com número 0 (texto inteiro).
 */
export function alignedPositions(reference: string, passages: readonly (BiblePassageText | undefined)[]): VersePosition[] {
  if (chapterCoordinatesUnavailable(reference, passages)) return []
  const fallback = fallbackChapter(reference)
  const seen = new Map<string, VersePosition>()
  for (const passage of passages) {
    for (const verse of passage?.verses ?? []) {
      const position = versePosition(verse, fallback)
      const id = versePositionId(position)
      if (!seen.has(id)) seen.set(id, position)
    }
  }
  if (seen.size > 0) return [...seen.values()].sort(compareVersePositions)
  const hasContent = passages.some((passage) => Boolean(passage?.content?.trim()))
  return hasContent ? [{ chapter: fallback, number: 0 }] : []
}

/** Texto de uma tradução numa posição; null se a tradução não tem esse versículo. */
export function verseText(reference: string, passage: BiblePassageText | undefined, position: VersePosition): string | null {
  if (!passage) return null
  if (position.number === 0) return passage.content?.trim() || null
  const fallback = fallbackChapter(reference)
  const id = versePositionId(position)
  const verse = (passage.verses ?? []).find((candidate) => versePositionId(versePosition(candidate, fallback)) === id)
  return verse?.text ?? null
}

/** "16" num só capítulo; "3:16" quando a referência atravessa capítulos. */
export function verseLabel(reference: string, position: VersePosition): string {
  if (position.number === 0) return ''
  if (spansMultipleChapters(reference) && position.chapter !== null) return `${position.chapter}:${position.number}`
  return String(position.number)
}

export interface ComparisonRow {
  id: string
  label: string
  cells: { code: string; text: string | null }[]
}

export function comparisonRows(
  reference: string,
  codes: readonly string[],
  passageFor: (code: string) => BiblePassageText | undefined,
): ComparisonRow[] {
  const passages = codes.map(passageFor)
  return alignedPositions(reference, passages).map((position) => ({
    id: versePositionId(position),
    label: verseLabel(reference, position),
    cells: codes.map((code, index) => ({ code, text: verseText(reference, passages[index], position) })),
  }))
}

/** Rodapé: "João 3:16 · 2 traduções · Estêvão API v2". */
export function footerStatus(reference: string, count: number): string {
  const trimmed = reference.trim()
  if (!trimmed) return 'Digite uma referência e pressione Enter para comparar traduções.'
  return `${trimmed} · ${count} ${count === 1 ? 'tradução' : 'traduções'} · Estêvão API v2`
}

export const CROSS_CHAPTER_MESSAGE =
  'A resposta da Estêvão API não informa o capítulo de cada versículo. Atualize a API para comparar referências entre capítulos.'
