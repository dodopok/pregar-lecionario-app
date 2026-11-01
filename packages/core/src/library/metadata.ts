import {
  containsIgnoringCase,
  exceedsCharacterCount,
  parseSwiftInt,
  splitOmittingEmpty,
  trimWhitespace,
} from './text-utils'

/** Título que identifica o layout do Feasting on the Word (componentes e janela OCR de 48 linhas). */
export function isFeastingTitle(title: string): boolean {
  return containsIgnoringCase(title, 'Feasting on the Word')
}

/** Último componente do caminho, sem a extensão (`deletingPathExtension().lastPathComponent`). */
export function filenameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** "Cópia 2" para "Obra (1)": o sufixo numérico do Finder indica uma cópia do mesmo arquivo. */
export function copyLabelFromFilename(filename: string): string | undefined {
  const match = /\s\((\d+)\)$/u.exec(filename)
  const number = match?.[1] === undefined ? null : parseSwiftInt(match[1])
  return number === null ? undefined : `Cópia ${number + 1}`
}

function isUseful(value: string): boolean {
  const lowered = value.toLowerCase()
  return value !== '' && lowered !== 'untitled' && lowered !== 'unknown'
}

function normalizeTitle(value: string): string {
  return trimWhitespace(value.replaceAll('_', ' ').replace(/\s+/gu, ' '))
}

function isGenericMetadataTitle(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    normalized.startsWith('microsoft word -') ||
    normalized.startsWith('about:blank') ||
    normalized.endsWith('.indd') ||
    exceedsCharacterCount(normalized, 140)
  )
}

/** Nome do arquivo apresentável: sem sufixo de cópia, sublinhados viram espaços e " - " vira ": ". */
export function cleanPdfFilename(filename: string): string {
  return trimWhitespace(
    filename
      .replace(/\s*\(\d+\)$/u, '')
      .replaceAll('_', ' ')
      .replace(/\s+/gu, ' ')
      .replaceAll(' - ', ': '),
  )
}

const FEASTING_FILENAME = /feasting[-_ ]on[-_ ]the[-_ ]word.*?year[-_ ]?([abc]).*?volume[-_ ]?([1-4])/iu

/**
 * Título da obra: o título dos metadados quando útil (não vazio, não "untitled", não gerado
 * pelo Word/InDesign); senão o nome do arquivo, reconhecendo Feasting e Connections.
 */
export function titleFromPdfMetadata(metadataTitle: string | null | undefined, filename: string): string {
  if (metadataTitle !== null && metadataTitle !== undefined) {
    const normalized = normalizeTitle(metadataTitle)
    if (isUseful(normalized) && !isGenericMetadataTitle(normalized)) return normalized
  }
  const cleanedFilename = cleanPdfFilename(filename)
  const feasting = FEASTING_FILENAME.exec(filename)
  const year = feasting?.[1]
  const volume = feasting?.[2]
  if (year !== undefined && volume !== undefined) {
    return `Feasting on the Word: Year ${year.toUpperCase()}, Volume ${volume}`
  }
  if (containsIgnoringCase(cleanedFilename, 'connections')) {
    return 'Connections: A Lectionary Commentary for Preaching and Worship'
  }
  return cleanedFilename
}

/**
 * Autoria a partir do campo Author: nomes separados por ";" e invertidos quando vêm como
 * "Sobrenome, Nome"; mais de três viram "A, B et al."; no Feasting, organizadores ganham "(orgs.)".
 */
export function authorsFromPdfMetadata(value: string | null | undefined, title: string): string | undefined {
  if (value === null || value === undefined || !isUseful(value)) return undefined
  const people = splitOmittingEmpty(value, ';')
    .map((raw) => {
      const name = trimWhitespace(raw).replace(/^\.+|\.+$/g, '')
      const parts = splitOmittingEmpty(name, ',', 1).map(trimWhitespace)
      const [last, first] = parts
      return parts.length === 2 && last !== undefined && first !== undefined ? `${first} ${last}` : name
    })
    .filter((name) => name !== '')
  if (people.length === 0) return undefined
  if (people.length > 3) return `${people.slice(0, 2).join(', ')} et al.`
  const names = people.join(' & ')
  return isFeastingTitle(title) && people.length > 1 ? `${names} (orgs.)` : names
}
