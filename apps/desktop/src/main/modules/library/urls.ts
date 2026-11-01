/**
 * Endereços dos protocolos da Biblioteca e leitura do cabeçalho Range. Puro (sem Electron),
 * para ser testado.
 *
 * - `pregar-pdf://open/<base64url(caminho absoluto)>` serve um PDF registrado na Biblioteca.
 * - `pregar-asset://cover/<arquivo>.jpg` serve a capa gerada pela janela da Biblioteca.
 * - `pregar-asset://tessdata/<idioma>.traineddata.gz` serve os dados de idioma do OCR.
 */

export const PDF_SCHEME = 'pregar-pdf'
export const ASSET_SCHEME = 'pregar-asset'
export const TESSDATA_URL = `${ASSET_SCHEME}://tessdata`

/** base64url (sem preenchimento) do texto em UTF-8; usa só APIs comuns ao Node e ao navegador. */
export function encodePathSegment(path: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(path)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodePathSegment(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function pdfURLForPath(path: string): string {
  return `${PDF_SCHEME}://open/${encodePathSegment(path)}`
}

/**
 * Caminho codificado num endereço `pregar-pdf://open/…`, ou `null` quando o endereço não tem
 * exatamente essa forma (outro host, mais segmentos, caracteres fora do base64url).
 */
export function pathFromPdfURL(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PDF_SCHEME}:` || parsed.hostname !== 'open') return null
  const segment = parsed.pathname.replace(/^\//, '')
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null
  const decoded = decodePathSegment(segment)
  // Base64 inválido, UTF-8 inválido ou caminho com NUL não são aceitos.
  if (decoded === null || decoded === '' || decoded.includes('\0') || encodePathSegment(decoded) !== segment) return null
  return decoded
}

/** Nome do arquivo da capa: hash do caminho, para não expor o caminho na URL. */
export function coverFileName(hashHex: string): string {
  return `${hashHex.slice(0, 32)}.jpg`
}

export type AssetTarget = { kind: 'cover'; file: string } | { kind: 'tessdata'; file: string }

const COVER_FILE = /^[a-f0-9]{32}\.jpg$/
const TESSDATA_FILE = /^(por|eng)\.traineddata\.gz$/

/** Arquivo pedido em `pregar-asset://…`, somente nos formatos esperados (sem barras nem `..`). */
export function assetTargetFromURL(url: string): AssetTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:`) return null
  const file = parsed.pathname.replace(/^\//, '')
  if (parsed.hostname === 'cover' && COVER_FILE.test(file)) return { kind: 'cover', file }
  if (parsed.hostname === 'tessdata' && TESSDATA_FILE.test(file)) return { kind: 'tessdata', file }
  return null
}

export type ByteRange = { start: number; end: number }

/**
 * Intervalo pedido no cabeçalho Range (`bytes=a-b`, `bytes=a-` ou `bytes=-n`). Devolve `null`
 * sem cabeçalho (arquivo inteiro), `'unsatisfiable'` para intervalos fora do arquivo e, com
 * vários intervalos, só o primeiro (o PDF.js pede um por vez).
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null
  const match = /^\s*bytes\s*=\s*(.+)$/i.exec(header)
  if (!match) return null
  const first = match[1]!.split(',')[0]!.trim()
  const parts = /^(\d*)\s*-\s*(\d*)$/.exec(first)
  if (!parts) return null
  const [, startText = '', endText = ''] = parts
  if (startText === '' && endText === '') return null
  if (size <= 0) return 'unsatisfiable'
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

/** `Content-Disposition` com o nome do arquivo em UTF-8 (RFC 6266). */
export function inlineDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** Origem autorizada a ler PDFs e capas: janelas do app (arquivo local ou servidor do Vite). */
export function isAllowedOrigin(origin: string | null | undefined, devServer: string | undefined): boolean {
  if (origin === null || origin === undefined || origin === '' || origin === 'null' || origin === 'file://') return true
  if (devServer) {
    try {
      return new URL(devServer).origin === origin
    } catch {
      return false
    }
  }
  return false
}
