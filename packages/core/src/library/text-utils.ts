/**
 * Equivalentes dos conjuntos de caracteres e das comparações do Foundation usados pelo
 * indexador Swift. Mantidos aqui para reproduzir os limites de linha, as contagens e os
 * offsets UTF-16 exatamente como o app macOS calculava.
 */

const EDGE_WHITESPACE = /^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu
const NEWLINE_CHARACTER = /[\n\v\f\r\u0085\u2028\u2029]/u
const WHITESPACE_RUN = /[\p{White_Space}]+/u

/** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWhitespace(value: string): string {
  return value.replace(EDGE_WHITESPACE, '')
}

/** Texto não vazio depois de aparar espaços; devolve o original (sem aparar), como `nonempty` no Swift. */
export function nonBlank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return trimWhitespace(value) === '' ? null : value
}

/**
 * `components(separatedBy: .newlines)`: cada caractere de quebra separa, então `\r\n` gera um
 * componente vazio entre as duas linhas (o que conta para o limite de linhas por página).
 */
export function splitNewlines(value: string): string[] {
  return value.split(NEWLINE_CHARACTER)
}

/** `split(whereSeparator: \.isWhitespace)` sem subsequências vazias. */
export function splitWords(value: string): string[] {
  return value.split(WHITESPACE_RUN).filter((part) => part !== '')
}

/**
 * `split(separator:maxSplits:)` do Swift com `omittingEmptySubsequences: true`: partes vazias
 * não contam para `maxSplits`.
 */
export function splitOmittingEmpty(
  value: string,
  separator: string,
  maxSplits = Number.POSITIVE_INFINITY,
): string[] {
  const result: string[] = []
  if (maxSplits === 0 || value === '') {
    if (value !== '') result.push(value)
    return result
  }
  let start = 0
  let index = 0
  while (index < value.length) {
    if (value[index] === separator) {
      const appended = index > start
      if (appended) result.push(value.slice(start, index))
      index += 1
      start = index
      if (appended && result.length === maxSplits) break
      continue
    }
    index += 1
  }
  if (start < value.length) result.push(value.slice(start))
  return result
}

const graphemes =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** `String.count > limit` (contagem de grafemas, como no Swift). */
export function exceedsCharacterCount(value: string, limit: number): boolean {
  // Um grafema ocupa ao menos uma unidade UTF-16; textos curtos dispensam a segmentação.
  if (value.length <= limit) return false
  if (!graphemes) return Array.from(value).length > limit
  let count = 0
  for (const _ of graphemes.segment(value)) {
    count += 1
    if (count > limit) return true
  }
  return false
}

/** `localizedCaseInsensitiveContains`. */
export function containsIgnoringCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** `localizedCaseInsensitiveCompare(...) == .orderedSame`. */
export function equalsIgnoringCase(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

const standardCollator = new Intl.Collator(undefined, { numeric: true })

/** `localizedStandardCompare`: ordem do Finder, com números em ordem numérica. */
export function localizedStandardCompare(left: string, right: string): number {
  return standardCollator.compare(left, right)
}

/** `text.utf8.count` sem alocar o texto codificado. */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else bytes += 3
  }
  return bytes
}

/** Inteiro como `Int(String)` do Swift: sinal opcional e somente dígitos ASCII. */
export function parseSwiftInt(value: string): number | null {
  if (!/^[+-]?\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Linha de um texto com o intervalo UTF-16 de `NSString.lineRange`, incluindo o terminador. */
export interface TextLineRange {
  start: number
  end: number
  /** Texto da linha, incluindo o terminador. */
  text: string
}

const LINE_TERMINATOR = /\r\n|[\n\r\u0085\u2028\u2029]/gu

/** Divide como `NSString.lineRange(for:)`: cada linha inclui o seu terminador (`\r\n` conta como um). */
export function lineRanges(text: string): TextLineRange[] {
  const lines: TextLineRange[] = []
  let offset = 0
  while (offset < text.length) {
    LINE_TERMINATOR.lastIndex = offset
    const match = LINE_TERMINATOR.exec(text)
    const end = match ? match.index + match[0].length : text.length
    lines.push({ start: offset, end, text: text.slice(offset, end) })
    offset = end
  }
  return lines
}
