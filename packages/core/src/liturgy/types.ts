/** Tipos da Estêvão API v2 (respostas em snake_case convertidas para camelCase). */

export const ESTEVAO_API_BASE_URL = 'https://api.caminhoanglicano.com.br'

export interface LiturgicalSeason {
  slug?: string | null
  name?: string | null
}

export interface Celebration {
  id?: number | null
  slug?: string | null
  name: string
  type?: string | null
  rank?: number | null
  color?: string | null
}

export interface BibleVerse {
  chapter?: number | null
  number: number
  text: string
}

export interface BiblePassageText {
  format?: string | null
  bible?: string | null
  verses?: BibleVerse[] | null
  content?: string | null
}

export interface BiblePassage {
  reference: string
  bible: string
  text?: BiblePassageText | null
}

export interface LiturgicalReading {
  slot: string
  reference: string
  title?: string | null
  alternatives?: string[] | null
  text?: BiblePassageText | null
}

export interface LiturgicalCollect {
  title?: string | null
  subtitle?: string | null
  kind?: string | null
  text?: string | null
  preface?: string | null
}

export interface LiturgicalDay {
  date: string
  dayOfWeek?: string | null
  sundayName?: string | null
  season?: LiturgicalSeason | null
  color?: string | null
  isSunday?: boolean | null
  isHolyDay?: boolean | null
  celebration?: Celebration | null
  celebrations?: Celebration[] | null
  readings?: LiturgicalReading[] | null
  collect?: LiturgicalCollect[] | null
}

export interface BibleVersion {
  code: string
  name: string
  fullName?: string | null
  language?: string | null
  description?: string | null
  publisher?: string | null
  year?: number | null
  isRecommended?: boolean | null
  versificationSystem?: string | null
  license?: string | null
}

export interface PrayerBookCatalogEntry {
  code: string
  name: string
  description?: string | null
  language?: string | null
  jurisdiction?: string | null
  year?: number | null
  isRecommended?: boolean | null
  imageUrl?: string | null
  thumbnailUrl?: string | null
}

export interface LiturgicalSettings {
  prayerBook: string
  language: string
  bible: string
  readingType: string
}

export const DEFAULT_LITURGICAL_SETTINGS: LiturgicalSettings = {
  prayerBook: 'loc_2027',
  language: 'pt-BR',
  bible: 'nvt',
  readingType: '',
}

const READING_LABELS: Record<string, string> = {
  first_reading: 'Primeira leitura',
  psalm: 'Salmo',
  psalm_alternative: 'Salmo alternativo',
  second_reading: 'Segunda leitura',
  gospel: 'Evangelho',
}

export function readingLabel(reading: Pick<LiturgicalReading, 'slot' | 'title'>): string {
  const known = READING_LABELS[reading.slot]
  if (known) return known
  if (reading.title) return reading.title
  const words = reading.slot.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function readingId(reading: Pick<LiturgicalReading, 'slot' | 'reference'>): string {
  return `${reading.slot}:${reading.reference}`
}

/** Posição comparável de um versículo (capítulo pode faltar em respostas antigas). */
export interface VersePosition {
  chapter: number | null
  number: number
}

export function versePosition(verse: BibleVerse, fallbackChapter: number | null = null): VersePosition {
  return { chapter: verse.chapter ?? fallbackChapter, number: verse.number }
}

export function versePositionId(position: VersePosition): string {
  return `${position.chapter ?? '?'}:${position.number}`
}

export function compareVersePositions(left: VersePosition, right: VersePosition): number {
  const leftChapter = left.chapter ?? Number.MIN_SAFE_INTEGER
  const rightChapter = right.chapter ?? Number.MIN_SAFE_INTEGER
  if (leftChapter !== rightChapter) return leftChapter - rightChapter
  return left.number - right.number
}

export function prayerBookSubtitle(entry: PrayerBookCatalogEntry): string {
  const parts = [entry.jurisdiction, entry.year !== null && entry.year !== undefined ? String(entry.year) : null, entry.language]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length === 0 ? 'Livro de oração' : parts.join(' · ')
}

export function prayerBookDescription(entry: PrayerBookCatalogEntry): string {
  const value = entry.description?.trim()
  return value ? value : 'Descrição não informada'
}

function initials(value: string, maximum: number): string {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, maximum)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase()
}

export function prayerBookMonogram(entry: PrayerBookCatalogEntry): string {
  if (entry.code.toLowerCase().includes('loc')) return 'LOC'
  return initials(entry.name, 3) || 'LOC'
}

export function jurisdictionMonogram(entry: PrayerBookCatalogEntry): string | null {
  if (!entry.jurisdiction) return null
  return initials(entry.jurisdiction, 4) || null
}

/** Só aceita capas em https; caminhos relativos são resolvidos contra o host da API. */
export function prayerBookCoverURL(entry: PrayerBookCatalogEntry): string | null {
  const raw = entry.thumbnailUrl ?? entry.imageUrl
  if (!raw) return null
  try {
    const resolved = new URL(raw, ESTEVAO_API_BASE_URL)
    return resolved.protocol === 'https:' ? resolved.toString() : null
  } catch {
    return null
  }
}

/** Cores litúrgicas em português ou inglês normalizadas. */
export type LiturgicalColor = 'green' | 'white' | 'red' | 'purple' | 'rose' | 'black' | 'blue' | 'gold'

export function normalizeLiturgicalColor(value: string | null | undefined): LiturgicalColor | null {
  if (!value) return null
  const normalized = value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim()
  const table: Record<string, LiturgicalColor> = {
    green: 'green',
    verde: 'green',
    white: 'white',
    branco: 'white',
    branca: 'white',
    red: 'red',
    vermelho: 'red',
    vermelha: 'red',
    purple: 'purple',
    violet: 'purple',
    roxo: 'purple',
    roxa: 'purple',
    violeta: 'purple',
    rose: 'rose',
    pink: 'rose',
    rosa: 'rose',
    rosado: 'rose',
    black: 'black',
    preto: 'black',
    preta: 'black',
    blue: 'blue',
    azul: 'blue',
    gold: 'gold',
    dourado: 'gold',
    ouro: 'gold',
  }
  return table[normalized] ?? null
}
