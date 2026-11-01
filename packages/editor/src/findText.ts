/**
 * Localiza no documento um trecho literal citado pela revisão. A comparação usa a tolerância do
 * validador (`containsExact` em @pregar/core/ai/structured): espaços em sequência, inclusive
 * quebras, contam como um só e o texto é comparado em NFC. Além disso, aspas tipográficas
 * equivalem às retas, e, se nada for achado, maiúsculas e minúsculas são ignoradas.
 */
import { plainTextWithPositions, type ManuscriptContent } from './richDocument'

const QUOTE_FOLDS: Record<string, string> = {
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '«': '"',
  '»': '"',
  '″': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
}

interface NormalizedText {
  text: string
  /** Para cada caractere normalizado, o primeiro e o último índice no texto original. */
  first: number[]
  last: number[]
}

function normalizeWithMap(value: string): NormalizedText {
  const result: NormalizedText = { text: '', first: [], last: [] }
  let inSpace = false
  // Agrupa letra + diacríticos para comparar em NFC sem perder o mapa de posições.
  for (const match of value.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const cluster = match[0]
    const start = match.index ?? 0
    const end = start + cluster.length - 1
    if (/^\s$/u.test(cluster)) {
      if (!inSpace) {
        result.text += ' '
        result.first.push(start)
        result.last.push(end)
      } else {
        result.last[result.last.length - 1] = end
      }
      inSpace = true
      continue
    }
    inSpace = false
    for (const character of cluster.normalize('NFC')) {
      const folded = QUOTE_FOLDS[character] ?? character
      for (let unit = 0; unit < folded.length; unit += 1) {
        result.text += folded[unit]
        result.first.push(start)
        result.last.push(end)
      }
    }
  }
  return result
}

/** Normalização usada para conferir citações: NFC, espaços colapsados e aspas unificadas. */
export function normalizeQuoteText(value: string): string {
  return normalizeWithMap(value.trim()).text.trim()
}

/** Minúsculas caractere a caractere, preservando o comprimento para o mapa de posições. */
function lowerPreservingLength(value: string): string {
  let result = ''
  for (const character of value) {
    const lower = character.toLocaleLowerCase('pt-BR')
    result += lower.length === character.length ? lower : character
  }
  return result
}

export interface TextRange {
  from: number
  to: number
}

/**
 * Posições ProseMirror (from/to) do trecho no documento, ou null quando não houver. Tenta a
 * comparação normalizada exata; depois ignora maiúsculas e minúsculas.
 */
export function findTextRange(content: ManuscriptContent, quote: string): TextRange | null {
  const needle = normalizeQuoteText(quote)
  if (!needle) return null
  const source = plainTextWithPositions(content)
  const haystack = normalizeWithMap(source.text)
  const attempts: Array<[string, string]> = [
    [haystack.text, needle],
    [lowerPreservingLength(haystack.text), lowerPreservingLength(needle)],
  ]
  for (const [text, target] of attempts) {
    let index = text.indexOf(target)
    while (index >= 0) {
      const range = mapRange(haystack, index, index + target.length - 1, source.starts, source.ends)
      if (range) return range
      index = text.indexOf(target, index + 1)
    }
  }
  return null
}

function mapRange(haystack: NormalizedText, firstIndex: number, lastIndex: number, starts: number[], ends: number[]): TextRange | null {
  const startOriginal = haystack.first[firstIndex]
  const endOriginal = haystack.last[lastIndex]
  if (startOriginal === undefined || endOriginal === undefined) return null
  // Marcadores sintéticos (lista, quebra entre parágrafos) não têm posição e são pulados.
  let from = -1
  for (let index = startOriginal; index <= endOriginal && from < 0; index += 1) from = starts[index] ?? -1
  let to = -1
  for (let index = endOriginal; index >= startOriginal && to < 0; index -= 1) to = ends[index] ?? -1
  if (from < 0 || to < 0 || to <= from) return null
  return { from, to }
}
