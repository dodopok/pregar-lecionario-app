/**
 * Detecção de metadados de sermões antigos (importação): data da pregação, passagem principal e
 * título, lidos do nome do arquivo e das primeiras linhas do texto. Tudo aqui é sugestão; a pessoa
 * confere cada linha na folha de importação antes de gravar.
 */
import { BIBLE_BOOKS, canonicalReference, locateReferences } from '../bible/reference'
import type { LocatedReference, ScriptureReference } from '../bible/reference'
import { isDateKey } from '../util/dates'
import { countWords, escapeRegExp, foldCaseAndDiacritics, truncate } from '../util/text'

export type MetadataSource = 'filename' | 'text' | 'none'

export interface SermonMetadataInput {
  fileName: string
  /** Texto corrido do documento convertido; só as primeiras linhas são examinadas. */
  text: string
  /**
   * Data de modificação do arquivo. Não vale como data da pregação (cópias, backups e
   * sincronizações a alteram), por isso não entra na detecção; fica disponível a quem chama.
   */
  mtime?: Date | string | null
  /** Data de referência para anos de dois dígitos e para rejeitar datas futuras (padrão: agora). */
  now?: Date
}

export interface SermonMetadata {
  dateKey: string | null
  /** Passagem na forma gravada em `mainReadingReference` ("Mateus 25:1-13"). */
  reference: string | null
  title: string
  confidence: { date: MetadataSource; reference: MetadataSource }
}

export interface DetectedDate {
  dateKey: string
  index: number
  length: number
}

export interface DetectedReference {
  reference: ScriptureReference
  /** Forma canônica ("Mateus 25:1-13"). */
  text: string
  index: number
  length: number
}

/** Quantas linhas do começo do texto são examinadas. */
export const METADATA_LINES = 15
export const TITLE_MAX_LENGTH = 120

// MARK: Datas

const MONTHS: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  january: 1,
  fevereiro: 2,
  fev: 2,
  february: 2,
  feb: 2,
  marco: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  maio: 5,
  mai: 5,
  may: 5,
  junho: 6,
  jun: 6,
  june: 6,
  julho: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  setembro: 9,
  set: 9,
  september: 9,
  sept: 9,
  sep: 9,
  outubro: 10,
  out: 10,
  october: 10,
  oct: 10,
  novembro: 11,
  nov: 11,
  november: 11,
  dezembro: 12,
  dez: 12,
  december: 12,
  dec: 12,
}

const MONTH_ALTERNATION = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join('|')

type DateOrder = 'numeric' | 'textual'

interface DatePattern {
  regex: RegExp
  order: DateOrder
  /** Dia antes do mês nos padrões numéricos (dd-mm-aaaa); falso para aaaa-mm-dd e aaaammdd. */
  dayFirst: boolean
}

const DATE_PATTERNS: DatePattern[] = [
  // 2023-11-12, 2023/11/12, 2023.11.12
  {
    regex: /(?<![\d\p{L}])(?<y>\d{4})(?<s>[-._/ ])(?<m>\d{1,2})\k<s>(?<d>\d{1,2})(?!\d)/gu,
    order: 'numeric',
    dayFirst: false,
  },
  // 20231112
  { regex: /(?<![\d\p{L}])(?<y>\d{4})(?<m>\d{2})(?<d>\d{2})(?!\d)/gu, order: 'numeric', dayFirst: false },
  // 12-11-2023, 12/11/2023, 12.11.2023, 12 11 2023
  {
    regex: /(?<![\d\p{L}])(?<d>\d{1,2})(?<s>[-._/ ])(?<m>\d{1,2})\k<s>(?<y>\d{4})(?!\d)/gu,
    order: 'numeric',
    dayFirst: true,
  },
  // 12.11.23, 12/11/23, 12-11-23 (ano de dois dígitos só com separador explícito, para não confundir com listas)
  {
    regex: /(?<![\d\p{L}])(?<d>\d{1,2})(?<s>[-./])(?<m>\d{1,2})\k<s>(?<y>\d{2})(?!\d)/gu,
    order: 'numeric',
    dayFirst: true,
  },
  // 12 de novembro de 2023, 12 nov 2023, 12-nov-23, 1º de janeiro de 2024
  {
    regex: new RegExp(
      `(?<![\\d\\p{L}])(?<d>\\d{1,2})\\s*[º°]?\\s*(?:de\\s+)?(?:[-./]\\s*)?(?<mon>${MONTH_ALTERNATION})(?![\\p{L}])\\.?\\s*(?:de\\s+|,\\s*)?(?:[-./]\\s*)?(?<y>\\d{4}|\\d{2})(?!\\d)`,
      'gu',
    ),
    order: 'textual',
    dayFirst: true,
  },
  // November 12, 2023
  {
    regex: new RegExp(
      `(?<![\\d\\p{L}])(?<mon>${MONTH_ALTERNATION})(?![\\p{L}])\\.?\\s+(?<d>\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?<y>\\d{4})(?!\\d)`,
      'gu',
    ),
    order: 'textual',
    dayFirst: false,
  },
]

/** Ano de dois dígitos: 20xx até o ano que vem, 19xx depois disso. */
export function resolveYear(raw: string, now: Date): number {
  const value = Number.parseInt(raw, 10)
  if (raw.length === 4) return value
  const pivot = (now.getFullYear() + 1) % 100
  return value <= pivot ? 2000 + value : 1900 + value
}

function plausibleYear(year: number, now: Date): boolean {
  return year >= 1900 && year <= now.getFullYear() + 1
}

function toDateKey(year: number, month: number, day: number): string | null {
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isDateKey(key) ? key : null
}

function dateFromGroups(pattern: DatePattern, groups: Record<string, string | undefined>, now: Date): string | null {
  const year = resolveYear(groups.y ?? '', now)
  if (!plausibleYear(year, now)) return null
  const day = Number.parseInt(groups.d ?? '', 10)
  let month: number
  if (pattern.order === 'textual') {
    month = MONTHS[groups.mon ?? ''] ?? 0
  } else {
    month = Number.parseInt(groups.m ?? '', 10)
    // 03/04/2022 é 3 de abril (dia/mês); 04/13/2022 só faz sentido como mês/dia.
    if (pattern.dayFirst && month > 12 && day <= 12) return toDateKey(year, day, month)
  }
  return toDateKey(year, month, day)
}

/** Primeira data plausível do texto (a que aparece antes vence; empate vai para a mais longa). */
export function findDate(value: string, now = new Date()): DetectedDate | null {
  const folded = foldCaseAndDiacritics(value.normalize('NFC'))
  let best: DetectedDate | null = null
  for (const pattern of DATE_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of folded.matchAll(pattern.regex)) {
      const dateKey = dateFromGroups(pattern, match.groups ?? {}, now)
      if (!dateKey) continue
      const index = match.index ?? 0
      const length = match[0].length
      if (!best || index < best.index || (index === best.index && length > best.length)) best = { dateKey, index, length }
    }
  }
  return best
}

// MARK: Passagens

const ALIAS_ALTERNATION = BIBLE_BOOKS.flatMap((book) => book.aliases)
  .map(escapeRegExp)
  .sort((left, right) => right.length - left.length)
  .join('|')

/** "Jo 3,16" e "Mt 25,1-13": vírgula logo depois do capítulo é separador de versículo. */
const COMMA_VERSE = new RegExp(`(?<![\\p{L}\\d])(${ALIAS_ALTERNATION})(\\.?\\s*\\d{1,3})\\s*,\\s*(?=\\d)`, 'giu')

/**
 * Prepara a linha para o analisador compartilhado sem mudar o comprimento (as posições valem
 * para o texto original): "Jo" sem acento é João (não Jó) e a vírgula de "3,16" vira dois-pontos.
 */
export function prepareReferenceText(value: string): string {
  const johnFixed = value.normalize('NFC').replace(/(?<![\p{L}])jo(?=\.?\s*\d)/giu, 'jn')
  return foldCaseAndDiacritics(johnFixed).replace(COMMA_VERSE, (_match, alias: string, chapter: string) => `${alias}${chapter}:`)
}

function located(value: string): LocatedReference[] {
  return locateReferences(prepareReferenceText(value))
}

/** Primeira passagem bíblica do texto, na forma canônica. */
export function findReference(value: string): DetectedReference | null {
  const first = located(value)[0]
  if (!first) return null
  return { reference: first.reference, text: canonicalReference(first.reference), index: first.index, length: first.length }
}

// MARK: Título

const LABEL_WORDS =
  'texto(?:\\s+base)?|leituras?|passagem|evangelho|data|tema|titulo|referencias?|base\\s+biblica|pregad[oa]\\s+em|pregacao|sermao|culto|homilia|domingo|segunda|terca|quarta|quinta|sexta|sabado|feira'
const EDGE_SEPARATORS = '[\\s\\-–—|·•:;,.()\\[\\]"\'“”‘’#*_]'
/** Pontuação solta e rótulos com dois-pontos ("Título:", "Texto –") no começo da linha (texto já dobrado). */
const LEADING_NOISE = new RegExp(`^(?:${EDGE_SEPARATORS}+|(?:${LABEL_WORDS})(?![\\p{L}])\\s*[:\\-–—]\\s*)+`, 'u')
const TRAILING_NOISE = new RegExp(`${EDGE_SEPARATORS}+$`, 'u')
const STOP_WORDS = new RegExp(`(?<![\\p{L}])(?:${LABEL_WORDS}|de|do|da|dos|das|em|no|na|nos|nas|e|o|a|os|as|um|uma)(?![\\p{L}])`, 'giu')

interface Span {
  start: number
  end: number
}

function spansOf(line: string, now: Date): Span[] {
  const spans: Span[] = []
  const date = findDate(line, now)
  if (date) spans.push({ start: date.index, end: date.index + date.length })
  for (const item of located(line)) spans.push({ start: item.index, end: item.index + item.length })
  return spans.sort((left, right) => left.start - right.start)
}

/** Substitui os trechos (posições UTF-16) por espaços, mantendo o comprimento. */
function blank(line: string, spans: Span[]): string {
  let result = ''
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    result += line.slice(cursor, span.start) + ' '.repeat(span.end - span.start)
    cursor = span.end
  }
  return result + line.slice(cursor)
}

function meaningfulLength(value: string): number {
  return (foldCaseAndDiacritics(value).replace(STOP_WORDS, ' ').match(/[\p{L}\p{N}]/gu) ?? []).length
}

/** A linha só carrega data, passagem e rótulos ("Texto: Mateus 25", "Domingo, 12/11/2023"). */
export function isMetadataOnlyLine(line: string, now = new Date()): boolean {
  return meaningfulLength(blank(line.normalize('NFC'), spansOf(line.normalize('NFC'), now))) < 3
}

/** Dobra para comparar sem mudar o comprimento; se a dobra mudar o tamanho (raro), compara o original. */
function foldedForOffsets(value: string): string {
  const folded = foldCaseAndDiacritics(value)
  return folded.length === value.length ? folded : value
}

/** Limites de `folded[start, end)` sem a pontuação solta e os rótulos das pontas. */
function trimRange(folded: string, start: number, end: number): [number, number] {
  const leading = LEADING_NOISE.exec(folded.slice(start, end))
  if (leading) start += leading[0].length
  const trailing = TRAILING_NOISE.exec(folded.slice(start, end))
  if (trailing) end -= trailing[0].length
  return [start, Math.max(start, end)]
}

function trimNoise(value: string): string {
  const [start, end] = trimRange(foldedForOffsets(value), 0, value.length)
  return value.slice(start, end)
}

/**
 * Título de uma linha: tira data e passagem quando estão nas pontas e separadas por pontuação
 * ("As dez virgens – Mateus 25:1-13"), mas conserva as que fazem parte da frase
 * ("O amor de Deus em João 3:16"). Devolve null quando não sobra título.
 */
export function titleFromLine(line: string, now = new Date()): string | null {
  const normalized = line.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (isMetadataOnlyLine(normalized, now)) return null
  const spans = spansOf(normalized, now)
  const folded = foldedForOffsets(normalized)
  let start = 0
  let end = normalized.length
  let changed = true
  while (changed) {
    changed = false
    const [trimmedStart, trimmedEnd] = trimRange(folded, start, end)
    if (trimmedStart !== start || trimmedEnd !== end) {
      start = trimmedStart
      end = trimmedEnd
      changed = true
    }
    const atStart = spans.find((span) => span.start === start && span.end <= end)
    if (atStart) {
      const after = folded.slice(atStart.end, end).trimStart()
      if (after === '' || /^[-–—|·•:;,)\]]/.test(after)) {
        start = atStart.end
        changed = true
      }
    }
    const atEnd = spans.find((span) => span.end === end && span.start >= start)
    if (atEnd) {
      const before = folded.slice(start, atEnd.start).trimEnd()
      if (before === '' || /[-–—|·•:;,([]$/.test(before)) {
        end = atEnd.start
        changed = true
      }
    }
  }
  const title = trimNoise(normalized.slice(start, end).replace(/\(\s*\)|\[\s*\]/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  if (meaningfulLength(title) < 3) return null
  return truncate(title, TITLE_MAX_LENGTH)
}

/**
 * Título a partir do nome do arquivo: sem extensão, com `_` e `-` virando espaços e sem a data e
 * a passagem já detectadas. `meaningful` diz se sobraram palavras além delas.
 */
export function fileNameTitle(fileName: string, remove: Span[] = []): { title: string; meaningful: boolean } {
  const stem = fileName.normalize('NFC').replace(/\.[^.]+$/, '')
  const spaced = (value: string) =>
    value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const withoutMetadata = trimNoise(spaced(blank(stem, remove)))
    .replace(/\s+/g, ' ')
    .trim()
  if (meaningfulLength(withoutMetadata) >= 3) return { title: truncate(withoutMetadata, TITLE_MAX_LENGTH), meaningful: true }
  const plain = spaced(stem)
  return { title: truncate(plain || 'Sermão importado', TITLE_MAX_LENGTH), meaningful: false }
}

export function titleFromFileName(fileName: string, remove: Span[] = []): string {
  return fileNameTitle(fileName, remove).title
}

/** Frase de corpo de texto, não título: termina em pontuação de frase, é longa ou tem muitas palavras. */
export function looksLikeBodyText(line: string): boolean {
  return /[.;:,…]$/u.test(line) || line.length >= 100 || countWords(line) > 14
}

/** Primeiras linhas não vazias do texto. */
export function firstLines(text: string, limit = METADATA_LINES): string[] {
  return text
    .normalize('NFC')
    .split(/\r?\n|\u2028|\u2029/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, limit)
}

// MARK: Detecção completa

export function detectSermonMetadata(input: SermonMetadataInput): SermonMetadata {
  const now = input.now ?? new Date()
  const fileName = input.fileName.normalize('NFC')
  const stem = fileName.replace(/\.[^.]+$/, '')
  const lines = firstLines(input.text)

  let dateKey: string | null = null
  let dateSource: MetadataSource = 'none'
  const fileDate = findDate(stem, now)
  if (fileDate) {
    dateKey = fileDate.dateKey
    dateSource = 'filename'
  } else {
    for (const line of lines) {
      const found = findDate(line, now)
      if (found) {
        dateKey = found.dateKey
        dateSource = 'text'
        break
      }
    }
  }

  let reference: string | null = null
  let referenceSource: MetadataSource = 'none'
  const fileReference = findReference(stem)
  if (fileReference) {
    reference = fileReference.text
    referenceSource = 'filename'
  } else {
    for (const line of lines) {
      const found = findReference(line)
      if (found) {
        reference = found.text
        referenceSource = 'text'
        break
      }
    }
  }

  let title: string | null = null
  for (const line of lines) {
    title = titleFromLine(line, now)
    if (title) break
  }
  const remove: Span[] = []
  if (fileDate) remove.push({ start: fileDate.index, end: fileDate.index + fileDate.length })
  if (fileReference) remove.push({ start: fileReference.index, end: fileReference.index + fileReference.length })
  const fromFile = fileNameTitle(fileName, remove.sort((left, right) => left.start - right.start))
  // Um nome de arquivo com palavras próprias ("2023-11-12 As dez virgens") é o título que a pessoa
  // escolheu; vale mais do que a primeira linha do texto. Um nome genérico ("sermao") só ganha da
  // primeira linha quando ela parece corpo de texto; um nome só de data ou passagem, nunca.
  const fileHasWords = fromFile.meaningful || /\p{L}/u.test(fileName.replace(/\.[^.]+$/, ''))
  if (!title || fromFile.meaningful || (fileHasWords && looksLikeBodyText(title))) title = fromFile.title

  return { dateKey, reference, title, confidence: { date: dateSource, reference: referenceSource } }
}
