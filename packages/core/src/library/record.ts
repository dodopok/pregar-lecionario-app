import type { PdfLibraryMetadataOverrides, PdfLibraryRecord } from './model'
import { localizedStandardCompare, trimWhitespace } from './text-utils'

function nonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = trimWhitespace(value)
  return trimmed === '' ? undefined : trimmed
}

/** Título exibido: a correção do usuário, quando preenchida, ou o título extraído. */
export function recordDisplayTitle(record: PdfLibraryRecord): string {
  return nonEmpty(record.metadataOverrides?.title) ?? record.title
}

/**
 * Autoria exibida. Havendo correção, ela vale mesmo vazia (o usuário pode ter apagado uma
 * autoria errada); sem correção, usa a autoria extraída.
 */
export function recordDisplayAuthor(record: PdfLibraryRecord): string | undefined {
  return record.metadataOverrides ? nonEmpty(record.metadataOverrides.author) : record.author
}

export function recordDisplayPublisher(record: PdfLibraryRecord): string | undefined {
  return nonEmpty(record.metadataOverrides?.publisher)
}

export function recordDisplayYear(record: PdfLibraryRecord): string | undefined {
  return nonEmpty(record.metadataOverrides?.year)
}

export function recordDisplayVolume(record: PdfLibraryRecord): string | undefined {
  return nonEmpty(record.metadataOverrides?.volume)
}

export function recordDisplayEdition(record: PdfLibraryRecord): string | undefined {
  return nonEmpty(record.metadataOverrides?.edition)
}

export function recordDisplayLanguage(record: PdfLibraryRecord): string | undefined {
  return nonEmpty(record.metadataOverrides?.language)
}

/** Créditos na ordem da Biblioteca: autoria, editora, ano, volume, edição, idioma e cópia. */
export function recordDisplayCredits(record: PdfLibraryRecord): string[] {
  return [
    recordDisplayAuthor(record),
    recordDisplayPublisher(record),
    recordDisplayYear(record),
    recordDisplayVolume(record),
    recordDisplayEdition(record),
    recordDisplayLanguage(record),
    record.copyLabel,
  ].filter((value): value is string => value !== undefined)
}

/** Registro reindexado mantendo a correção local de metadados do registro anterior. */
export function preservingMetadata(
  record: PdfLibraryRecord,
  previous: PdfLibraryRecord | null | undefined,
): PdfLibraryRecord {
  const refreshed: PdfLibraryRecord = { ...record }
  if (previous?.metadataOverrides) refreshed.metadataOverrides = previous.metadataOverrides
  else delete refreshed.metadataOverrides
  return refreshed
}

/** Valores iniciais da folha de correção: o que está sendo exibido hoje. */
export function metadataOverridesFromRecord(record: PdfLibraryRecord): PdfLibraryMetadataOverrides {
  return {
    title: recordDisplayTitle(record),
    author: recordDisplayAuthor(record) ?? '',
    publisher: recordDisplayPublisher(record) ?? '',
    year: recordDisplayYear(record) ?? '',
    volume: recordDisplayVolume(record) ?? '',
    edition: recordDisplayEdition(record) ?? '',
    language: recordDisplayLanguage(record) ?? '',
  }
}

/** Ordem da lista da Biblioteca: título exibido, com números em ordem natural. */
export function compareLibraryRecords(left: PdfLibraryRecord, right: PdfLibraryRecord): number {
  return localizedStandardCompare(recordDisplayTitle(left), recordDisplayTitle(right))
}
