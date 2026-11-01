import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import {
  ASSET_SCHEME,
  PDF_SCHEME,
  assetTargetFromURL,
  inlineDisposition,
  isAllowedOrigin,
  parseRange,
  pathFromPdfURL,
} from './urls'

const EXPOSED_HEADERS = 'Accept-Ranges, Content-Range, Content-Length, Content-Encoding, Content-Disposition'

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && origin !== 'null' ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

function plain(status: number, message: string, origin: string | null): Response {
  return new Response(message, { status, headers: { ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** Resposta de arquivo com suporte a Range (206) e HEAD, transmitida do disco sem carregar tudo. */
async function fileResponse(request: Request, path: string, contentType: string, extra: Record<string, string> = {}): Promise<Response> {
  const origin = request.headers.get('origin')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return plain(404, 'Arquivo não encontrado.', origin)
  const size = info.size
  const headers: Record<string, string> = {
    ...corsHeaders(origin),
    ...extra,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
  }
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const length = size === 0 ? 0 : end - start + 1
  headers['Content-Length'] = String(length)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const status = range ? 206 : 200
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })
  const stream = createReadStream(path, { start, end, highWaterMark: 256 * 1024 })
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers })
}

export interface LibraryProtocolOptions {
  /** Caminho registrado na Biblioteca para o caminho decodificado da URL (ou `null`). */
  registeredPath(path: string): string | null
  thumbnailsFolder: string
  tessdataFolder: string
}

/**
 * `pregar-pdf://open/<base64url>` só serve PDFs registrados na Biblioteca; `pregar-asset://`
 * só serve capas e dados do OCR com nomes no formato esperado. Ambos aceitam apenas pedidos das
 * janelas do app.
 */
export function registerLibraryProtocols(options: LibraryProtocolOptions): void {
  const devServer = process.env.ELECTRON_RENDERER_URL

  protocol.handle(PDF_SCHEME, async (request) => {
    const origin = request.headers.get('origin')
    if (!isAllowedOrigin(origin, devServer)) return plain(403, 'Origem não autorizada.', null)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Método não permitido.', origin)
    const decoded = pathFromPdfURL(request.url)
    const path = decoded === null ? null : options.registeredPath(decoded)
    if (!path) return plain(404, 'PDF não encontrado na Biblioteca.', origin)
    return fileResponse(request, path, 'application/pdf', { 'Content-Disposition': inlineDisposition(basename(path)) })
  })

  protocol.handle(ASSET_SCHEME, async (request) => {
    const origin = request.headers.get('origin')
    if (!isAllowedOrigin(origin, devServer)) return plain(403, 'Origem não autorizada.', null)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'Método não permitido.', origin)
    const target = assetTargetFromURL(request.url)
    if (!target) return plain(404, 'Recurso não encontrado.', origin)
    if (target.kind === 'cover') {
      // A URL da capa leva a versão (?v=), então pode ficar em cache.
      return fileResponse(request, join(options.thumbnailsFolder, target.file), 'image/jpeg', { 'Cache-Control': 'private, max-age=604800' })
    }
    return fileResponse(request, join(options.tessdataFolder, target.file), 'application/gzip')
  })
}
