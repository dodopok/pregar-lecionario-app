import {
  englishReference as formatEnglishReference,
  englishBookName,
  parseReference,
} from '../bible/reference'
import { liturgicalProperDay } from '../liturgy/calendar'

/**
 * Endereços das fontes favoritas embutidas. Porte de `FavoriteSourceURLs` do app Swift: o
 * Working Preacher abre o arquivo por perícope e usa a busca oficial para intervalos entre
 * capítulos; o Anglican Compass abre o "Today in the Spirit" do Próprio quando ele é conhecido.
 */

const QUERY_ALLOWED = /^[A-Za-z0-9!$'()*,\-./:;?@_~]$/

/**
 * Codifica um valor de consulta como `urlQueryAllowed` menos `&=+#` do Foundation: espaços viram
 * `%20` e `:` permanece legível ("Matthew%2021:33-22:4").
 */
export function percentEncodeSearchQuery(value: string): string {
  let result = ''
  for (const char of value) {
    if (QUERY_ALLOWED.test(char)) {
      result += char
      continue
    }
    try {
      result += encodeURIComponent(char)
    } catch {
      // Surrogate isolado: não há representação UTF-8 válida.
    }
  }
  return result
}

function englishReference(reference: string): string {
  const passage = parseReference(reference)
  return passage ? formatEnglishReference(passage) : reference
}

function searchURL(host: string, query: string): string {
  return `https://${host}/?s=${percentEncodeSearchQuery(query)}`
}

function workingPreacher(reference: string): string {
  const passage = parseReference(reference)
  if (passage && passage.startVerse !== null && (passage.endChapter ?? passage.chapter) === passage.chapter) {
    const endVerse = passage.endVerse ?? passage.startVerse
    const book = englishBookName(passage).toLowerCase().replaceAll(' ', '-')
    const slug = `${book}-${passage.chapter}_${passage.startVerse}-${endVerse}`
    return `https://www.workingpreacher.org/posts-by-tag/${slug}`
  }
  return searchURL('www.workingpreacher.org', englishReference(reference))
}

function anglicanCompass(
  reference: string,
  occasion: string | null | undefined,
  date: Date | null = null,
  isSunday = false,
): string {
  const proper = liturgicalProperDay(occasion, date, isSunday)
  if (proper && proper.year !== '') {
    return `https://anglicancompass.com/today-in-the-spirit-proper-${proper.number}${proper.year.toLowerCase()}/`
  }
  const query = ['Today in the Spirit', occasion, englishReference(reference)]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(' ')
  return searchURL('anglicancompass.com', query)
}

function anglicanCompassDetail(
  occasion: string | null | undefined,
  date: Date | null,
  isSunday: boolean,
): string {
  const proper = liturgicalProperDay(occasion, date, isSunday)
  if (!proper || proper.year === '') return `Today in the Spirit · ${occasion ?? 'lecionário'}`
  return `Today in the Spirit · Proper ${proper.number}${proper.year}`
}

function myPastoralPonderings(reference: string): string {
  return searchURL('mypastoralponderings.com', englishReference(reference))
}

function bobCornwall(reference: string): string {
  return searchURL('www.bobcornwall.com', englishReference(reference))
}

export const FavoriteSourceURLs = {
  workingPreacher,
  anglicanCompass,
  anglicanCompassDetail,
  myPastoralPonderings,
  bobCornwall,
} as const
