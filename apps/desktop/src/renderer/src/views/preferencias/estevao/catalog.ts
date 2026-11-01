/** Ordenação e busca nos catálogos da Estêvão API (livros de oração e traduções). Funções puras. */
import type { BibleVersion, PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

/** Busca por nome, código, descrição, jurisdição e idioma; recomendados primeiro, depois os mais novos. */
export function filterPrayerBooks(books: readonly PrayerBookCatalogEntry[], query: string): PrayerBookCatalogEntry[] {
  const needle = fold(query.trim())
  const matching = books.filter(
    (book) =>
      !needle ||
      [book.name, book.code, book.description, book.jurisdiction, book.language]
        .filter((value): value is string => Boolean(value))
        .some((value) => fold(value).includes(needle)),
  )
  return [...matching].sort((left, right) => {
    const leftRecommended = left.isRecommended === true
    const rightRecommended = right.isRecommended === true
    if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1
    if ((left.year ?? 0) !== (right.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0)
    return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' })
  })
}

/** Livro selecionado mesmo antes do catálogo chegar (o padrão LOC 2027 tem dados conhecidos). */
export function selectedPrayerBook(books: readonly PrayerBookCatalogEntry[], code: string): PrayerBookCatalogEntry {
  const found = books.find((book) => book.code === code)
  if (found) return found
  if (code === 'loc_2027') {
    return {
      code: 'loc_2027',
      name: 'REB - 2027',
      description: 'Livro de Oração Comum da Rede Episcopal Brasileira (2027)',
      language: 'pt-BR',
      jurisdiction: 'Rede Episcopal Brasileira',
      year: 2027,
      isRecommended: false,
    }
  }
  return { code, name: 'Livro de oração selecionado' }
}

/** Nome do idioma em português ("português (Brasil)"); cai no código se o navegador não souber. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(code)
    if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    // Código fora do padrão BCP 47.
  }
  return code
}

/** Idiomas oferecidos: os do catálogo, o atual e o português do Brasil, sem repetir. */
export function languageOptions(books: readonly PrayerBookCatalogEntry[], current: string): { value: string; label: string }[] {
  const codes = new Set<string>(['pt-BR'])
  for (const book of books) if (book.language?.trim()) codes.add(book.language.trim())
  if (current.trim()) codes.add(current.trim())
  return [...codes]
    .map((value) => ({ value, label: `${languageName(value)} · ${value}` }))
    .sort((left, right) => (left.value === 'pt-BR' ? -1 : right.value === 'pt-BR' ? 1 : left.label.localeCompare(right.label, 'pt-BR')))
}

/** "NVT — Nova Versão Transformadora · pt-BR". */
export function bibleVersionLabel(version: BibleVersion): string {
  const fullName = version.fullName ? ` — ${version.fullName}` : ''
  const language = version.language ? ` · ${version.language}` : ''
  return `${version.name}${fullName}${language}`
}

/** Traduções conhecidas para quando o catálogo ainda não carregou (as mesmas do app Swift). */
export const FALLBACK_BIBLES: BibleVersion[] = [
  { code: 'nvt', name: 'NVT' },
  { code: 'nvi', name: 'NVI' },
  { code: 'naa', name: 'NAA' },
  { code: 'ara', name: 'ARA' },
]
