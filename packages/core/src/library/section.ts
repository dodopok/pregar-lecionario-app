import { normalizeForSearch } from '../util/text'
import type { PdfSectionComponent, PdfSectionFindingMethod, PdfSectionLocation } from './model'

export interface PdfSectionLocationInit {
  title: string
  startPage: number
  endPage: number
  context?: string | null
  components?: PdfSectionComponent[] | null
  /** Padrão `unknown`, como o inicializador Swift; `null` reproduz um registro antigo sem origem. */
  findingMethod?: PdfSectionFindingMethod | null
}

/** Equivalente ao inicializador de `PDFSectionLocation` (origem padrão `unknown`). */
export function makeSectionLocation(init: PdfSectionLocationInit): PdfSectionLocation {
  const section: PdfSectionLocation = { title: init.title, startPage: init.startPage, endPage: init.endPage }
  if (init.context !== undefined && init.context !== null) section.context = init.context
  if (init.components !== undefined && init.components !== null) section.components = init.components
  const method = init.findingMethod === undefined ? 'unknown' : init.findingMethod
  if (method !== null) section.findingMethod = method
  return section
}

/** Identificador estável na lista: título e página inicial. */
export function sectionId(section: Pick<PdfSectionLocation, 'title' | 'startPage'>): string {
  return `${section.title}|${section.startPage}`
}

export function componentId(component: PdfSectionComponent): string {
  return `${component.kind}|${component.location.start.page}|${component.location.start.utf16Offset}`
}

/**
 * Normalização do filtro de seções: sem acentos, minúsculas, espaços colapsados e traços
 * unificados, para que `Matthew 21:23-32` encontre `Matthew 21:23–32`.
 */
export function normalizeSectionQuery(value: string): string {
  return normalizeForSearch(value.replace(/[\u2010-\u2015\u2212]/g, '-'))
}

/** Filtro da Biblioteca: consulta vazia aceita tudo; procura no título e no contexto. */
export function sectionMatchesSearch(
  section: Pick<PdfSectionLocation, 'title' | 'context'>,
  query: string,
): boolean {
  const normalizedQuery = normalizeSectionQuery(query)
  if (normalizedQuery === '') return true
  return [section.title, section.context]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => normalizeSectionQuery(value).includes(normalizedQuery))
}

export function findingMethodLabel(section: Pick<PdfSectionLocation, 'findingMethod'>): string {
  switch (section.findingMethod) {
    case 'bookmark':
      return 'bookmark do PDF'
    case 'textHeading':
      return 'cabeçalho textual'
    case 'ocrHeading':
      return 'cabeçalho reconhecido por OCR'
    default:
      return 'não identificado'
  }
}

export function confidenceLabel(section: Pick<PdfSectionLocation, 'findingMethod'>): string {
  switch (section.findingMethod) {
    case 'bookmark':
      return 'alta'
    case 'textHeading':
      return 'média'
    case 'ocrHeading':
      return 'baixa · conferir'
    default:
      return 'não verificada'
  }
}

export function hasHighConfidence(section: Pick<PdfSectionLocation, 'findingMethod'>): boolean {
  return section.findingMethod === 'bookmark'
}

/** Seção que contém a página: a última que começa até ela (painel do Leitor). */
export function activeSectionForPage<T extends Pick<PdfSectionLocation, 'startPage'>>(
  sections: readonly T[],
  page: number,
): T | undefined {
  return sections.findLast((section) => section.startPage <= page)
}
