/**
 * PDF.js no Leitor: carregamento sob demanda do visor, documentos em cache (os das abas
 * recentes ficam abertos) e fonte de texto para calcular seções quando a Biblioteca não as tem.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type * as PdfjsNamespace from 'pdfjs-dist'
import type * as ViewerNamespace from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { PdfOutlineItem, PdfTextSource } from '@pregar/core/library'
import { textFromItems } from './reader-ui'
import { pdfjsAssetOptions } from '../../lib/pdfjs-assets'

type PdfjsModule = typeof PdfjsNamespace
type ViewerModule = typeof ViewerNamespace

export interface PdfjsBundle {
  pdfjs: PdfjsModule
  viewer: ViewerModule
}

let bundle: Promise<PdfjsBundle> | null = null

/** O visor (`pdf_viewer.mjs`) lê `globalThis.pdfjsLib`: precisa vir depois de `pdf.mjs`. */
export function loadPdfjs(): Promise<PdfjsBundle> {
  bundle ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs')
    await import('pdfjs-dist/web/pdf_viewer.css')
    return { pdfjs, viewer }
  })()
  bundle.catch(() => {
    bundle = null
  })
  return bundle
}

interface CachedDocument {
  url: string
  promise: Promise<PDFDocumentProxy>
  destroy: () => Promise<void>
  used: number
}

const MAX_CACHED_DOCUMENTS = 4
const documents = new Map<string, CachedDocument>()
let clock = 0

/** Abre (ou reaproveita) o documento. Mantém os últimos quatro abertos; os demais são liberados. */
export async function openPdfDocument(url: string): Promise<PDFDocumentProxy> {
  const cached = documents.get(url)
  if (cached) {
    cached.used = ++clock
    return cached.promise
  }
  const { pdfjs } = await loadPdfjs()
  const task = pdfjs.getDocument({
    url,
    // Fontes padrão, CMaps e wasm vêm empacotados (iguais nos três sistemas).
    ...pdfjsAssetOptions,
    // Busca só os trechos necessários (o protocolo pregar-pdf atende Range).
    disableAutoFetch: true,
    enableXfa: false,
  })
  const entry: CachedDocument = { url, promise: task.promise, destroy: () => task.destroy(), used: ++clock }
  documents.set(url, entry)
  task.promise.catch(() => documents.delete(url))
  evict(url)
  return entry.promise
}

/** Esquece um documento que falhou, para "Tentar novamente" abrir do zero. */
export function forgetPdfDocument(url: string): void {
  const cached = documents.get(url)
  documents.delete(url)
  void cached?.destroy().catch(() => undefined)
}

function evict(keep: string): void {
  if (documents.size <= MAX_CACHED_DOCUMENTS) return
  const victims = [...documents.values()].filter((entry) => entry.url !== keep).sort((a, b) => a.used - b.used)
  for (const victim of victims.slice(0, documents.size - MAX_CACHED_DOCUMENTS)) forgetPdfDocument(victim.url)
}

/** Página física (1-based) de um destino do PDF (nome ou matriz explícita). */
export async function destinationPage(document: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await document.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target = explicit[0] as unknown
    if (Number.isInteger(target)) return (target as number) + 1
    if (target && typeof target === 'object' && 'num' in target && 'gen' in target) {
      return (await document.getPageIndex(target as { num: number; gen: number })) + 1
    }
    return null
  } catch {
    return null
  }
}

/** Destino explícito (matriz) de um nome, para abrir em nova aba. */
export async function explicitDestination(document: PDFDocumentProxy, dest: string | unknown[]): Promise<unknown[] | null> {
  try {
    const value = typeof dest === 'string' ? await document.getDestination(dest) : dest
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Fonte de texto do índice da Biblioteca a partir do PDF.js (cancelável). */
export function pdfTextSource(document: PDFDocumentProxy, signal: AbortSignal): PdfTextSource {
  const check = () => {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
  }
  type RawOutline = { title: string; dest: string | unknown[] | null; items: RawOutline[] }
  const convert = async (items: readonly RawOutline[]): Promise<PdfOutlineItem[]> => {
    const result: PdfOutlineItem[] = []
    for (const item of items) {
      check()
      const page = item.dest === null ? null : await destinationPage(document, item.dest)
      result.push({
        title: item.title === '' ? null : item.title,
        pageIndex: page === null ? null : page - 1,
        children: await convert(item.items ?? []),
      })
    }
    return result
  }
  return {
    pageCount: document.numPages,
    async outline() {
      check()
      const outline = (await document.getOutline()) as RawOutline[] | null
      return outline ? convert(outline) : []
    },
    async pageText(pageIndex: number) {
      check()
      const page = await document.getPage(pageIndex + 1)
      try {
        const content = await page.getTextContent()
        check()
        const text = textFromItems(content.items as { str?: string; hasEOL?: boolean }[])
        return text === '' ? null : { text }
      } finally {
        page.cleanup()
      }
    },
    async metadata() {
      const { info } = (await document.getMetadata()) as { info?: { Title?: string; Author?: string } }
      return { title: info?.Title ?? null, author: info?.Author ?? null }
    },
  }
}

/** Autor (metadados do arquivo), páginas e rótulos impressos. */
export async function documentDetails(document: PDFDocumentProxy): Promise<{ author: string | null; labels: string[] | null }> {
  const [metadata, labels] = await Promise.all([
    document.getMetadata().catch(() => null) as Promise<{ info?: { Author?: string } } | null>,
    document.getPageLabels().catch(() => null),
  ])
  const author = metadata?.info?.Author?.trim()
  return { author: author ? author : null, labels }
}
