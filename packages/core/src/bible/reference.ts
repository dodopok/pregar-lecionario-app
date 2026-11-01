import { escapeRegExp, foldCaseAndDiacritics, foldDiacritics, normalizeForSearch } from '../util/text'

/**
 * Referência bíblica normalizada. Porte de `ScriptureReference` do app Swift: aceita nomes e
 * abreviações em português e inglês, ponto ou dois-pontos, traços variados, intervalos entre
 * capítulos e listas de versículos no mesmo capítulo.
 */
export interface ScriptureReference {
  /** Nome canônico em inglês minúsculo, por exemplo "romans" ou "1 corinthians". */
  book: string
  chapter: number
  startVerse: number | null
  endChapter: number | null
  endVerse: number | null
}

interface BookDefinition {
  canonical: string
  english: string
  portuguese: string
  aliases: string[]
}

export const BIBLE_BOOKS: readonly BookDefinition[] = [
  { canonical: 'genesis', english: 'Genesis', portuguese: 'Gênesis', aliases: ['genesis', 'gen', 'gn'] },
  { canonical: 'exodus', english: 'Exodus', portuguese: 'Êxodo', aliases: ['exodus', 'exod', 'exodo', 'ex'] },
  { canonical: 'leviticus', english: 'Leviticus', portuguese: 'Levítico', aliases: ['leviticus', 'lev', 'levitico'] },
  { canonical: 'numbers', english: 'Numbers', portuguese: 'Números', aliases: ['numbers', 'num', 'numeros', 'nm'] },
  { canonical: 'deuteronomy', english: 'Deuteronomy', portuguese: 'Deuteronômio', aliases: ['deuteronomy', 'deut', 'deuteronomio', 'dt'] },
  { canonical: 'joshua', english: 'Joshua', portuguese: 'Josué', aliases: ['joshua', 'josh', 'josue'] },
  { canonical: 'judges', english: 'Judges', portuguese: 'Juízes', aliases: ['judges', 'judg', 'juizes'] },
  { canonical: 'ruth', english: 'Ruth', portuguese: 'Rute', aliases: ['ruth', 'rute'] },
  { canonical: '1 samuel', english: '1 Samuel', portuguese: '1 Samuel', aliases: ['1 samuel', 'i samuel', '1 sam', '1sm'] },
  { canonical: '2 samuel', english: '2 Samuel', portuguese: '2 Samuel', aliases: ['2 samuel', 'ii samuel', '2 sam', '2sm'] },
  { canonical: '1 kings', english: '1 Kings', portuguese: '1 Reis', aliases: ['1 kings', 'i kings', '1 kgs', '1 reis'] },
  { canonical: '2 kings', english: '2 Kings', portuguese: '2 Reis', aliases: ['2 kings', 'ii kings', '2 kgs', '2 reis'] },
  { canonical: '1 chronicles', english: '1 Chronicles', portuguese: '1 Crônicas', aliases: ['1 chronicles', 'i chronicles', '1 chron', '1 cronicas'] },
  { canonical: '2 chronicles', english: '2 Chronicles', portuguese: '2 Crônicas', aliases: ['2 chronicles', 'ii chronicles', '2 chron', '2 cronicas'] },
  { canonical: 'ezra', english: 'Ezra', portuguese: 'Esdras', aliases: ['ezra', 'esdras'] },
  { canonical: 'nehemiah', english: 'Nehemiah', portuguese: 'Neemias', aliases: ['nehemiah', 'neh', 'neemias'] },
  { canonical: 'esther', english: 'Esther', portuguese: 'Ester', aliases: ['esther', 'ester'] },
  { canonical: 'job', english: 'Job', portuguese: 'Jó', aliases: ['job', 'jo'] },
  { canonical: 'psalms', english: 'Psalms', portuguese: 'Salmos', aliases: ['psalms', 'psalm', 'ps', 'sl', 'salmos', 'salmo'] },
  { canonical: 'proverbs', english: 'Proverbs', portuguese: 'Provérbios', aliases: ['proverbs', 'prov', 'proverbios'] },
  { canonical: 'ecclesiastes', english: 'Ecclesiastes', portuguese: 'Eclesiastes', aliases: ['ecclesiastes', 'eccl', 'eclesiastes'] },
  { canonical: 'song of solomon', english: 'Song of Solomon', portuguese: 'Cantares', aliases: ['song of solomon', 'song of songs', 'cantares'] },
  { canonical: 'isaiah', english: 'Isaiah', portuguese: 'Isaías', aliases: ['isaiah', 'isa', 'isaias'] },
  { canonical: 'jeremiah', english: 'Jeremiah', portuguese: 'Jeremias', aliases: ['jeremiah', 'jer', 'jeremias'] },
  { canonical: 'lamentations', english: 'Lamentations', portuguese: 'Lamentações', aliases: ['lamentations', 'lam', 'lamentacoes'] },
  { canonical: 'ezekiel', english: 'Ezekiel', portuguese: 'Ezequiel', aliases: ['ezekiel', 'ezek', 'ezequiel'] },
  { canonical: 'daniel', english: 'Daniel', portuguese: 'Daniel', aliases: ['daniel', 'dan'] },
  { canonical: 'hosea', english: 'Hosea', portuguese: 'Oseias', aliases: ['hosea', 'os'] },
  { canonical: 'joel', english: 'Joel', portuguese: 'Joel', aliases: ['joel'] },
  { canonical: 'amos', english: 'Amos', portuguese: 'Amós', aliases: ['amos'] },
  { canonical: 'obadiah', english: 'Obadiah', portuguese: 'Obadias', aliases: ['obadiah', 'obadias'] },
  { canonical: 'jonah', english: 'Jonah', portuguese: 'Jonas', aliases: ['jonah', 'jonas'] },
  { canonical: 'micah', english: 'Micah', portuguese: 'Miqueias', aliases: ['micah', 'miqueias'] },
  { canonical: 'nahum', english: 'Nahum', portuguese: 'Naum', aliases: ['nahum', 'naum'] },
  { canonical: 'habakkuk', english: 'Habakkuk', portuguese: 'Habacuque', aliases: ['habakkuk', 'habacuque'] },
  { canonical: 'zephaniah', english: 'Zephaniah', portuguese: 'Sofonias', aliases: ['zephaniah', 'sofonias'] },
  { canonical: 'haggai', english: 'Haggai', portuguese: 'Ageu', aliases: ['haggai', 'ageu'] },
  { canonical: 'zechariah', english: 'Zechariah', portuguese: 'Zacarias', aliases: ['zechariah', 'zc', 'zacarias'] },
  { canonical: 'malachi', english: 'Malachi', portuguese: 'Malaquias', aliases: ['malachi', 'malaquias'] },
  { canonical: 'matthew', english: 'Matthew', portuguese: 'Mateus', aliases: ['matthew', 'matt', 'mateus', 'mt'] },
  { canonical: 'mark', english: 'Mark', portuguese: 'Marcos', aliases: ['mark', 'marcos', 'mk'] },
  { canonical: 'luke', english: 'Luke', portuguese: 'Lucas', aliases: ['luke', 'lucas', 'lk'] },
  { canonical: 'john', english: 'John', portuguese: 'João', aliases: ['john', 'joao', 'jn'] },
  { canonical: 'acts', english: 'Acts', portuguese: 'Atos', aliases: ['acts', 'atos'] },
  { canonical: 'romans', english: 'Romans', portuguese: 'Romanos', aliases: ['romans', 'rom', 'rm', 'romanos'] },
  { canonical: '1 corinthians', english: '1 Corinthians', portuguese: '1 Coríntios', aliases: ['1 corinthians', 'i corinthians', '1 cor', '1 corintios'] },
  { canonical: '2 corinthians', english: '2 Corinthians', portuguese: '2 Coríntios', aliases: ['2 corinthians', 'ii corinthians', '2 cor', '2 corintios'] },
  { canonical: 'galatians', english: 'Galatians', portuguese: 'Gálatas', aliases: ['galatians', 'gal', 'galatas'] },
  { canonical: 'ephesians', english: 'Ephesians', portuguese: 'Efésios', aliases: ['ephesians', 'eph', 'efesios'] },
  { canonical: 'philippians', english: 'Philippians', portuguese: 'Filipenses', aliases: ['philippians', 'phil', 'filipenses'] },
  { canonical: 'colossians', english: 'Colossians', portuguese: 'Colossenses', aliases: ['colossians', 'col', 'colossenses'] },
  { canonical: '1 thessalonians', english: '1 Thessalonians', portuguese: '1 Tessalonicenses', aliases: ['1 thessalonians', 'i thessalonians', '1 thess', '1 tessalonicenses'] },
  { canonical: '2 thessalonians', english: '2 Thessalonians', portuguese: '2 Tessalonicenses', aliases: ['2 thessalonians', 'ii thessalonians', '2 thess', '2 tessalonicenses'] },
  { canonical: '1 timothy', english: '1 Timothy', portuguese: '1 Timóteo', aliases: ['1 timothy', 'i timothy', '1 tim', '1 timoteo'] },
  { canonical: '2 timothy', english: '2 Timothy', portuguese: '2 Timóteo', aliases: ['2 timothy', 'ii timothy', '2 tim', '2 timoteo'] },
  { canonical: 'titus', english: 'Titus', portuguese: 'Tito', aliases: ['titus', 'tito'] },
  { canonical: 'philemon', english: 'Philemon', portuguese: 'Filemom', aliases: ['philemon', 'filemom'] },
  { canonical: 'hebrews', english: 'Hebrews', portuguese: 'Hebreus', aliases: ['hebrews', 'heb', 'hebreus'] },
  { canonical: 'james', english: 'James', portuguese: 'Tiago', aliases: ['james', 'tiago'] },
  { canonical: '1 peter', english: '1 Peter', portuguese: '1 Pedro', aliases: ['1 peter', 'i peter', '1 pet', '1 pedro'] },
  { canonical: '2 peter', english: '2 Peter', portuguese: '2 Pedro', aliases: ['2 peter', 'ii peter', '2 pet', '2 pedro'] },
  { canonical: '1 john', english: '1 John', portuguese: '1 João', aliases: ['1 john', 'i john', '1 jn', '1 joao'] },
  { canonical: '2 john', english: '2 John', portuguese: '2 João', aliases: ['2 john', 'ii john', '2 jn', '2 joao'] },
  { canonical: '3 john', english: '3 John', portuguese: '3 João', aliases: ['3 john', 'iii john', '3 jn', '3 joao'] },
  { canonical: 'jude', english: 'Jude', portuguese: 'Judas', aliases: ['jude', 'judas'] },
  { canonical: 'revelation', english: 'Revelation', portuguese: 'Apocalipse', aliases: ['revelation', 'rev', 'apocalipse'] },
]

interface BookPattern {
  book: string
  source: string
}

const BOOK_PATTERNS: BookPattern[] = BIBLE_BOOKS.flatMap((book) =>
  book.aliases.map((alias) => ({
    book: book.canonical,
    source: `(?<![\\p{L}\\d])${escapeRegExp(alias)}(?![\\p{L}])\\s*(\\d+)(?:\\s*[:.]\\s*(\\d+)(?:\\s*[-–—]\\s*(?:(\\d+)\\s*[:.]\\s*)?(\\d+))?)?`,
  })),
).sort((left, right) => right.source.length - left.source.length)

const COMPILED_PATTERNS = BOOK_PATTERNS.map((item) => ({ book: item.book, regex: new RegExp(item.source, 'giu') }))

interface ExplicitMatch {
  reference: ScriptureReference
  index: number
  length: number
}

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function explicitMatches(normalized: string): ExplicitMatch[] {
  const found: ExplicitMatch[] = []
  for (const pattern of COMPILED_PATTERNS) {
    pattern.regex.lastIndex = 0
    for (const match of normalized.matchAll(pattern.regex)) {
      const chapter = toInt(match[1])
      if (chapter === null) continue
      found.push({
        reference: {
          book: pattern.book,
          chapter,
          startVerse: toInt(match[2]),
          endChapter: toInt(match[3]),
          endVerse: toInt(match[4]),
        },
        index: match.index ?? 0,
        length: match[0].length,
      })
    }
  }
  found.sort((left, right) => (left.index === right.index ? right.length - left.length : left.index - right.index))
  const accepted: ExplicitMatch[] = []
  for (const match of found) {
    const overlaps = accepted.some(
      (existing) => match.index < existing.index + existing.length && existing.index < match.index + match.length,
    )
    if (!overlaps) accepted.push(match)
  }
  return accepted
}

function referenceKey(reference: ScriptureReference): string {
  return `${reference.book}|${reference.chapter}|${reference.startVerse ?? 0}|${reference.endChapter ?? 0}|${reference.endVerse ?? 0}`
}

/** Todas as referências explícitas do texto, incluindo continuações como "13:8-10, 12". */
export function parseAllReferences(value: string): ScriptureReference[] {
  const normalized = foldCaseAndDiacritics(value)
  const matches = explicitMatches(normalized)
  const references: ScriptureReference[] = []
  const continuation = /[,;]\s*(\d+)(?:\s*[-–—]\s*(\d+))?/g
  matches.forEach((item, position) => {
    references.push(item.reference)
    if (item.reference.startVerse === null) return
    const tailStart = item.index + item.length
    const next = matches[position + 1]
    const tailEnd = next ? next.index : normalized.length
    if (tailEnd < tailStart) return
    const tail = normalized.slice(tailStart, tailEnd)
    continuation.lastIndex = 0
    for (const match of tail.matchAll(continuation)) {
      const start = toInt(match[1])
      if (start === null || start > 200) continue
      const end = toInt(match[2]) ?? start
      references.push({
        book: item.reference.book,
        chapter: item.reference.chapter,
        startVerse: start,
        endChapter: item.reference.chapter,
        endVerse: end,
      })
    }
  })
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key = referenceKey(reference)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseReference(value: string): ScriptureReference | null {
  return parseAllReferences(value)[0] ?? null
}

/**
 * Referência que abre um cabeçalho: começa na posição 0, tem versículo, é a única referência
 * da linha e o título que vem depois começa com maiúscula.
 */
export function parseHeadingReference(value: string): ScriptureReference | null {
  const normalized = foldDiacritics(value)
  const first = explicitMatches(normalized)[0]
  if (!first || first.index !== 0 || first.reference.startVerse === null) return null
  if (parseAllReferences(value).length !== 1) return null
  const title = normalized.slice(first.index + first.length).trim()
  // Como no Swift (`title.first?.isUppercase ?? true`): título vazio ou iniciado por maiúscula.
  const firstChar = Array.from(title)[0]
  if (firstChar !== undefined && !/\p{Lu}/u.test(firstChar)) return null
  return first.reference
}

export function normalizedReferenceText(value: string): string {
  return normalizeForSearch(value)
}

export function bookDefinition(canonical: string): BookDefinition | undefined {
  return BIBLE_BOOKS.find((book) => book.canonical === canonical)
}

export function englishBookName(reference: ScriptureReference): string {
  return bookDefinition(reference.book)?.english ?? reference.book
}

export function portugueseBookName(reference: ScriptureReference): string {
  return bookDefinition(reference.book)?.portuguese ?? reference.book
}

function formatRange(reference: ScriptureReference, bookName: string): string {
  let value = `${bookName} ${reference.chapter}`
  const finalChapter = reference.endChapter ?? reference.chapter
  if (reference.startVerse !== null) {
    value += `:${reference.startVerse}`
    if (finalChapter !== reference.chapter) {
      value += reference.endVerse !== null ? `-${finalChapter}:${reference.endVerse}` : `-${finalChapter}`
    } else if (reference.endVerse !== null && reference.endVerse !== reference.startVerse) {
      value += `-${reference.endVerse}`
    }
  } else if (finalChapter !== reference.chapter) {
    value += `-${finalChapter}`
  }
  return value
}

/** "Romans 13:8-14", "John 3:16-4:1" */
export function englishReference(reference: ScriptureReference): string {
  return formatRange(reference, englishBookName(reference))
}

/** "Romanos 13:8–14" com traço meia-risca, para exibição em português. */
export function portugueseReference(reference: ScriptureReference): string {
  return formatRange(reference, portugueseBookName(reference)).replace('-', '–')
}

export function sameReference(left: ScriptureReference | null, right: ScriptureReference | null): boolean {
  if (!left || !right) return false
  return referenceKey(left) === referenceKey(right)
}

/** Posição comparável (capítulo × 1000 + versículo) para cálculos de intervalo. */
export interface VerseSpan {
  book: string
  start: number
  end: number
  /** Verdadeiro quando a referência não tem versículos e cobre capítulos inteiros. */
  wholeChapters: boolean
}

export function verseSpan(reference: ScriptureReference): VerseSpan {
  const endChapter = reference.endChapter ?? reference.chapter
  if (reference.startVerse === null) {
    return {
      book: reference.book,
      start: reference.chapter * 1000,
      end: endChapter * 1000 + 999,
      wholeChapters: true,
    }
  }
  const endVerse =
    reference.endVerse ?? (reference.endChapter !== null && reference.endChapter !== reference.chapter ? 999 : reference.startVerse)
  return {
    book: reference.book,
    start: reference.chapter * 1000 + reference.startVerse,
    end: endChapter * 1000 + endVerse,
    wholeChapters: false,
  }
}

export type PassageRelationKind = 'exact' | 'contains' | 'partial' | 'context'

export interface PassageRelation {
  kind: PassageRelationKind
  /** Intervalo comum, quando há sobreposição. */
  common?: ScriptureReference
}

function spanToReference(book: string, start: number, end: number): ScriptureReference {
  const startChapter = Math.floor(start / 1000)
  const startVerse = start % 1000
  const endChapter = Math.floor(end / 1000)
  const endVerse = end % 1000
  return {
    book,
    chapter: startChapter,
    startVerse: startVerse === 0 ? null : startVerse,
    endChapter: endChapter === startChapter ? null : endChapter,
    endVerse: endVerse === 999 ? null : endVerse,
  }
}

/**
 * Relação entre o material (`candidate`) e a passagem da preparação (`target`): mesma passagem,
 * material que contém a passagem, sobreposição parcial ou apenas o mesmo livro e capítulo.
 */
export function passageRelation(candidate: ScriptureReference, target: ScriptureReference): PassageRelation | null {
  if (candidate.book !== target.book) return null
  const a = verseSpan(candidate)
  const b = verseSpan(target)
  if (a.start === b.start && a.end === b.end) return { kind: 'exact' }
  if (a.start <= b.start && a.end >= b.end) return { kind: 'contains' }
  const commonStart = Math.max(a.start, b.start)
  const commonEnd = Math.min(a.end, b.end)
  if (commonStart <= commonEnd) {
    return { kind: 'partial', common: spanToReference(target.book, commonStart, commonEnd) }
  }
  const sameChapter =
    Math.floor(a.start / 1000) <= Math.floor(b.end / 1000) && Math.floor(b.start / 1000) <= Math.floor(a.end / 1000)
  return sameChapter ? { kind: 'context' } : null
}
