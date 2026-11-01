/**
 * `PdfTextSource` do domínio implementado com o PDF.js (build legado para Node), usado no
 * processo utilitário de indexação. Sem canvas: só camada de texto, sumário e metadados.
 */
import type { PdfMetadata, PdfOutlineItem, PdfPageText, PdfTextSource } from '@pregar/core/library/text-source'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageTextFromItems, type PositionedTextItem } from './text-lines'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let loaded: Promise<PdfJs> | null = null

/**
 * Carrega o PDF.js com o "worker" no mesmo processo: no processo utilitário do Electron o PDF.js
 * não se reconhece como Node e tentaria criar um Web Worker; com `globalThis.pdfjsWorker` ele usa
 * o manipulador local.
 */
export function loadPdfJs(): Promise<PdfJs> {
  loaded ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return loaded
}

/** Abre o PDF a partir dos bytes, sem fontes do sistema, sem `eval` e sem canvas. */
export async function openPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    verbosity: 0,
  })
  return task.promise
}

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}

async function destinationPageIndex(document: PDFDocumentProxy, dest: OutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await document.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const target: unknown = explicit[0]
    if (typeof target === 'number') return Number.isInteger(target) && target >= 0 && target < document.numPages ? target : null
    if (target && typeof target === 'object' && 'num' in target) {
      return await document.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    }
    return null
  } catch {
    return null
  }
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\0/g, '').trim()
  return trimmed === '' ? null : trimmed
}

/** Metadados extras exibidos como sugestão (o domínio usa título e autoria). */
export interface PdfDocumentInfo extends PdfMetadata {
  subject?: string | null
  keywords?: string | null
  creator?: string | null
  producer?: string | null
}

export class PdfJsTextSource implements PdfTextSource {
  constructor(
    readonly document: PDFDocumentProxy,
    private readonly util: PdfJs['Util'],
  ) {}

  static async open(data: Uint8Array): Promise<PdfJsTextSource> {
    const pdfjs = await loadPdfJs()
    return new PdfJsTextSource(await openPdfDocument(data), pdfjs.Util)
  }

  get pageCount(): number {
    return this.document.numPages
  }

  async outline(): Promise<readonly PdfOutlineItem[]> {
    const nodes = ((await this.document.getOutline()) ?? []) as unknown as OutlineNode[]
    const convert = async (items: readonly OutlineNode[]): Promise<PdfOutlineItem[]> => {
      const result: PdfOutlineItem[] = []
      // Em lotes, para não abrir centenas de pedidos de destino de uma vez.
      for (let start = 0; start < items.length; start += 32) {
        const batch = items.slice(start, start + 32)
        const converted = await Promise.all(
          batch.map(async (item) => ({
            title: typeof item.title === 'string' ? item.title : null,
            pageIndex: await destinationPageIndex(this.document, item.dest),
            children: await convert(item.items ?? []),
          })),
        )
        result.push(...converted)
      }
      return result
    }
    return convert(nodes)
  }

  async pageText(pageIndex: number): Promise<PdfPageText | null> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.pageCount) return null
    const page = await this.document.getPage(pageIndex + 1)
    try {
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent({ includeMarkedContent: false })
      const items: PositionedTextItem[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const transform = this.util.transform(viewport.transform, item.transform) as number[]
        const fontSize = Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || Math.abs(item.height) || 1
        items.push({
          str: item.str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          width: Math.abs(item.width),
          fontSize,
          hasEOL: item.hasEOL,
        })
      }
      const text = pageTextFromItems(items)
      if (!text) return null
      return {
        text: text.text,
        lines: text.lines.map((line) => ({ text: line.text, x: line.x, y: line.y, width: line.width, height: line.height })),
      }
    } finally {
      page.cleanup()
    }
  }

  async metadata(): Promise<PdfDocumentInfo> {
    try {
      const { info, metadata } = await this.document.getMetadata()
      const dictionary = (info ?? {}) as Record<string, unknown>
      const xmp = metadata as { get?(name: string): unknown } | null
      return {
        title: textValue(dictionary.Title) ?? textValue(xmp?.get?.('dc:title')),
        author: textValue(dictionary.Author) ?? textValue(xmp?.get?.('dc:creator')),
        subject: textValue(dictionary.Subject),
        keywords: textValue(dictionary.Keywords),
        creator: textValue(dictionary.Creator),
        producer: textValue(dictionary.Producer),
      }
    } catch {
      return {}
    }
  }

  async destroy(): Promise<void> {
    await this.document.loadingTask.destroy()
  }
}
