import { parseAllReferences, parseReference, type ScriptureReference } from '../bible/reference'
import type { PdfLibraryRecord, PdfSectionLocation } from './model'

/** Relação de uma seção com a passagem procurada, da mais forte para a mais fraca. */
export type PdfSectionMatchKind = 'exact' | 'partial' | 'context'

/** Ordem numérica do Swift (`exact = 0`, `partial = 1`, `context = 2`). */
export const PDF_SECTION_MATCH_ORDER: Readonly<Record<PdfSectionMatchKind, number>> = {
  exact: 0,
  partial: 1,
  context: 2,
}

/**
 * Igualdade de referências usada pelo indexador: capítulo final ausente equivale ao inicial,
 * mas versículo final ausente só é igual a outro ausente. Difere de `sameReference` de
 * `bible/reference`, que compara o capítulo final ausente como 0.
 */
export function sameIndexedReference(left: ScriptureReference, right: ScriptureReference): boolean {
  return (
    left.book === right.book &&
    left.chapter === right.chapter &&
    left.startVerse === right.startVerse &&
    (left.endChapter ?? left.chapter) === (right.endChapter ?? right.chapter) &&
    left.endVerse === right.endVerse
  )
}

/** Igualdade campo a campo (`==` do struct Swift). */
export function referencesEqual(left: ScriptureReference | null, right: ScriptureReference | null): boolean {
  if (!left || !right) return left === right
  return (
    left.book === right.book &&
    left.chapter === right.chapter &&
    left.startVerse === right.startVerse &&
    left.endChapter === right.endChapter &&
    left.endVerse === right.endVerse
  )
}

/** Referências citadas no título e no contexto da seção. */
export function sectionReferences(
  section: Pick<PdfSectionLocation, 'title' | 'context'>,
): ScriptureReference[] {
  return [section.title, section.context]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => parseAllReferences(value))
}

function chapterWithin(chapter: number, candidate: ScriptureReference): boolean {
  return chapter >= candidate.chapter && chapter <= (candidate.endChapter ?? candidate.chapter)
}

/**
 * Compara a seção com a passagem: `exact` quando alguma referência da seção contém a passagem
 * inteira, `partial` quando só há sobreposição e `context` quando um dos lados não tem
 * versículos e o capítulo coincide.
 */
export function matchSection(
  section: Pick<PdfSectionLocation, 'title' | 'context'>,
  reference: string | ScriptureReference,
): PdfSectionMatchKind | null {
  const target = typeof reference === 'string' ? parseReference(reference) : reference
  if (!target) return null
  let hasPartial = false
  for (const candidate of sectionReferences(section)) {
    if (candidate.book !== target.book) continue
    const targetStart = target.startVerse
    if (targetStart === null) {
      if (chapterWithin(target.chapter, candidate)) return 'context'
      continue
    }
    const candidateStart = candidate.startVerse
    if (candidateStart === null) {
      if (chapterWithin(target.chapter, candidate)) return 'context'
      continue
    }
    const targetEndChapter = target.endChapter ?? target.chapter
    const targetEndVerse = target.endVerse ?? targetStart
    const candidateEndChapter = candidate.endChapter ?? candidate.chapter
    const candidateEndVerse = candidate.endVerse ?? candidateStart
    const targetStartsBeforeCandidateEnds =
      target.chapter < candidateEndChapter ||
      (target.chapter === candidateEndChapter && targetStart <= candidateEndVerse)
    const candidateStartsBeforeTargetEnds =
      candidate.chapter < targetEndChapter ||
      (candidate.chapter === targetEndChapter && candidateStart <= targetEndVerse)
    if (!(targetStartsBeforeCandidateEnds && candidateStartsBeforeTargetEnds)) continue
    const containsStart =
      candidate.chapter < target.chapter ||
      (candidate.chapter === target.chapter && candidateStart <= targetStart)
    const containsEnd =
      candidateEndChapter > targetEndChapter ||
      (candidateEndChapter === targetEndChapter && candidateEndVerse >= targetEndVerse)
    if (containsStart && containsEnd) return 'exact'
    hasPartial = true
  }
  return hasPartial ? 'partial' : null
}

/** Quantas seções do acervo coincidem com a leitura (contagem do Arquivo). */
export function matchingSectionCount(
  records: readonly PdfLibraryRecord[],
  reference: string | null | undefined,
): number {
  if (reference === null || reference === undefined) return 0
  const target = parseReference(reference)
  if (!target) return 0
  return records.reduce(
    (count, record) =>
      count + (record.sections ?? []).filter((section) => matchSection(section, target) !== null).length,
    0,
  )
}
