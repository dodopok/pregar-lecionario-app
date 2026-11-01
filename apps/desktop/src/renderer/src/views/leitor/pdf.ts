/**
 * PDF.js no Leitor: carregamento sob demanda do visor, documentos em cache (os das abas
 * recentes ficam abertos) e fonte de texto para calcular seções quando a Biblioteca não as tem.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfOutlineItem, PdfTextSource } from '@pregar/core/library'
import { textFromItems } from './reader-ui'

type PdfjsModule = typeof import('pdfjs-dist')
type ViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs')

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

// Recursos binários do PDF.js (fontes padrão e decodificadores wasm de JBIG2, JPEG 2000 e cores),
// empacotados pelo Vite e entregues por esta fábrica em vez de uma pasta servida.
const BINARY_ASSETS: Record<string, () => Promise<{ default: string }>> = {
  'wasmUrl/openjpeg.wasm': () => import('pdfjs-dist/wasm/openjpeg.wasm?url'),
  'wasmUrl/jbig2.wasm': () => import('pdfjs-dist/wasm/jbig2.wasm?url'),
  'wasmUrl/qcms_bg.wasm': () => import('pdfjs-dist/wasm/qcms_bg.wasm?url'),
  'standardFontDataUrl/FoxitDingbats.pfb': () => import('pdfjs-dist/standard_fonts/FoxitDingbats.pfb?url'),
  'standardFontDataUrl/FoxitFixed.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixed.pfb?url'),
  'standardFontDataUrl/FoxitFixedBold.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedBold.pfb?url'),
  'standardFontDataUrl/FoxitFixedBoldItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb?url'),
  'standardFontDataUrl/FoxitFixedItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb?url'),
  'standardFontDataUrl/FoxitSerif.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerif.pfb?url'),
  'standardFontDataUrl/FoxitSerifBold.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifBold.pfb?url'),
  'standardFontDataUrl/FoxitSerifBoldItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb?url'),
  'standardFontDataUrl/FoxitSerifItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb?url'),
  'standardFontDataUrl/FoxitSymbol.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSymbol.pfb?url'),
  'standardFontDataUrl/LiberationSans-Bold.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url'),
  'standardFontDataUrl/LiberationSans-BoldItalic.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?url'),
  'standardFontDataUrl/LiberationSans-Italic.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?url'),
  'standardFontDataUrl/LiberationSans-Regular.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url'),
}

class ReaderBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const loader = BINARY_ASSETS[`${kind}/${filename}`]
    if (!loader) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    const response = await fetch((await loader()).default)
    if (!response.ok) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

interface CachedDocument {
  url: string
  promise: Promise<PDFDocumentProxy>
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
    BinaryDataFactory: ReaderBinaryDataFactory,
    useWorkerFetch: false,
    // A fábrica acima ignora estes endereços; o PDF.js só exige que existam.
    standardFontDataUrl: 'pregar-pdfjs://fonts/',
    wasmUrl: 'pregar-pdfjs://wasm/',
    // Busca só os trechos necessários (o protocolo pregar-pdf atende Range).
    disableAutoFetch: true,
    enableXfa: false,
  })
  const entry: CachedDocument = { url, promise: task.promise, used: ++clock }
  documents.set(url, entry)
  task.promise.catch(() => documents.delete(url))
  evict(url)
  return entry.promise
}

/** Esquece um documento que falhou, para "Tentar novamente" abrir do zero. */
export function forgetPdfDocument(url: string): void {
  const cached = documents.get(url)
  documents.delete(url)
  void cached?.promise.then((document) => document.destroy()).catch(() => undefined)
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
