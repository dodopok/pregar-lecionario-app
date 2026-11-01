/**
 * Índice em memória das seções do acervo para responder rapidamente às correspondências por
 * passagem (painel Materiais da Mesa e contagem do Arquivo). Puro: só o domínio.
 */
import { parseReference, type ScriptureReference } from '@pregar/core/bible/reference'
import { sectionReferences, PDF_SECTION_MATCH_ORDER } from '@pregar/core/library/matching'
import type { PdfSectionMatchKind } from '@pregar/core/library/matching'
import type { PdfLibraryRecord, PdfSectionLocation } from '@pregar/core/library/model'
import { recordDisplayAuthor, recordDisplayTitle } from '@pregar/core/library/record'
import { localizedStandardCompare } from '@pregar/core/library/text-utils'
import type { LibrarySectionMatch } from '@shared/ipc-library'

interface IndexedSection {
  record: PdfLibraryRecord
  section: PdfSectionLocation
  /** Referências do título e do contexto, lidas uma vez por revisão do acervo. */
  references: ScriptureReference[]
}

function chapterWithin(chapter: number, candidate: ScriptureReference): boolean {
  return chapter >= candidate.chapter && chapter <= (candidate.endChapter ?? candidate.chapter)
}

/**
 * Mesma regra de `matchSection` do domínio, sobre referências já lidas: `exact` quando alguma
 * referência contém a passagem inteira, `partial` quando só se sobrepõem e `context` quando um
 * dos lados não tem versículos e o capítulo coincide. (Um teste confere a equivalência.)
 */
export function matchReferences(candidates: readonly ScriptureReference[], target: ScriptureReference): PdfSectionMatchKind | null {
  let hasPartial = false
  for (const candidate of candidates) {
    if (candidate.book !== target.book) continue
    const targetStart = target.startVerse
    const candidateStart = candidate.startVerse
    if (targetStart === null || candidateStart === null) {
      if (chapterWithin(target.chapter, candidate)) return 'context'
      continue
    }
    const targetEndChapter = target.endChapter ?? target.chapter
    const targetEndVerse = target.endVerse ?? targetStart
    const candidateEndChapter = candidate.endChapter ?? candidate.chapter
    const candidateEndVerse = candidate.endVerse ?? candidateStart
    const targetStartsBeforeCandidateEnds =
      target.chapter < candidateEndChapter || (target.chapter === candidateEndChapter && targetStart <= candidateEndVerse)
    const candidateStartsBeforeTargetEnds =
      candidate.chapter < targetEndChapter || (candidate.chapter === targetEndChapter && candidateStart <= targetEndVerse)
    if (!(targetStartsBeforeCandidateEnds && candidateStartsBeforeTargetEnds)) continue
    const containsStart =
      candidate.chapter < target.chapter || (candidate.chapter === target.chapter && candidateStart <= targetStart)
    const containsEnd =
      candidateEndChapter > targetEndChapter || (candidateEndChapter === targetEndChapter && candidateEndVerse >= targetEndVerse)
    if (containsStart && containsEnd) return 'exact'
    hasPartial = true
  }
  return hasPartial ? 'partial' : null
}

export class SectionMatchIndex {
  /** Seções agrupadas pelos livros citados no título ou no contexto. */
  private readonly byBook = new Map<string, IndexedSection[]>()
  private readonly cache = new Map<string, LibrarySectionMatch[]>()

  constructor(records: readonly PdfLibraryRecord[]) {
    for (const record of records) {
      for (const section of record.sections ?? []) {
        const references = sectionReferences(section)
        const entry: IndexedSection = { record, section, references }
        for (const book of new Set(references.map((reference) => reference.book))) {
          let list = this.byBook.get(book)
          if (!list) this.byBook.set(book, (list = []))
          list.push(entry)
        }
      }
    }
  }

  /**
   * Seções que correspondem à passagem, das mais fortes (passagem coincidente) às mais fracas
   * (contexto), depois por obra e página.
   */
  matches(reference: string): LibrarySectionMatch[] {
    const key = reference.trim()
    const cached = this.cache.get(key)
    if (cached) return cached
    const target = parseReference(key)
    const result: LibrarySectionMatch[] = []
    if (target) {
      for (const { record, section, references } of this.byBook.get(target.book) ?? []) {
        const kind = matchReferences(references, target)
        if (kind === null) continue
        result.push({
          recordId: record.id,
          path: record.path,
          workTitle: recordDisplayTitle(record),
          author: recordDisplayAuthor(record) ?? null,
          section,
          kind,
        })
      }
    }
    result.sort(compareMatches)
    if (this.cache.size > 400) this.cache.clear()
    this.cache.set(key, result)
    return result
  }

  count(reference: string | null | undefined): number {
    if (!reference) return 0
    return this.matches(reference).length
  }
}

export function compareMatches(left: LibrarySectionMatch, right: LibrarySectionMatch): number {
  return (
    PDF_SECTION_MATCH_ORDER[left.kind] - PDF_SECTION_MATCH_ORDER[right.kind] ||
    localizedStandardCompare(left.workTitle, right.workTitle) ||
    left.section.startPage - right.section.startPage
  )
}

/** Agrupa as correspondências por relação com a passagem, na ordem exata → parcial → contexto. */
export function groupMatches(matches: readonly LibrarySectionMatch[]): { kind: PdfSectionMatchKind; items: LibrarySectionMatch[] }[] {
  const groups: { kind: PdfSectionMatchKind; items: LibrarySectionMatch[] }[] = []
  for (const kind of ['exact', 'partial', 'context'] as const) {
    const items = matches.filter((match) => match.kind === kind)
    if (items.length > 0) groups.push({ kind, items })
  }
  return groups
}
