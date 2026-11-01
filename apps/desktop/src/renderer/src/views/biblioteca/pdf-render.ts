/**
 * PDF.js na janela da Biblioteca: renderiza a primeira página para a capa e páginas inteiras
 * para o OCR. O PDF vem do protocolo pregar-pdf (só caminhos registrados, com Range).
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type * as Pdfjs from 'pdfjs-dist'

type PdfjsModule = typeof Pdfjs

let pdfjsModule: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsModule ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  pdfjsModule.catch(() => {
    pdfjsModule = null
  })
  return pdfjsModule
}

// Decodificadores wasm (JBIG2/CCITT das digitalizações, JPEG 2000 e perfis de cor) e fontes
// padrão (PDFs com Helvetica/Times sem fonte embutida), empacotados pelo Vite e entregues por esta
// fábrica: nada vem de endereço externo e nenhuma fonte é carregada por URL (a CSP não permite).
const BINARY_ASSETS: Record<string, () => Promise<{ default: string }>> = {
  'wasmUrl/jbig2.wasm': () => import('pdfjs-dist/wasm/jbig2.wasm?url'),
  'wasmUrl/openjpeg.wasm': () => import('pdfjs-dist/wasm/openjpeg.wasm?url'),
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

class LibraryBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const loader = BINARY_ASSETS[`${kind}/${filename}`]
    if (!loader) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    const response = await fetch((await loader()).default)
    if (!response.ok) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

export async function openLibraryPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs()
  return pdfjs.getDocument({
    url,
    BinaryDataFactory: LibraryBinaryDataFactory,
    useWorkerFetch: false,
    // A fábrica ignora estes endereços; o PDF.js só exige que existam.
    wasmUrl: 'pregar-pdfjs://wasm/',
    standardFontDataUrl: 'pregar-pdfjs://fonts/',
    disableAutoFetch: true,
    enableXfa: false,
    // Sem substituição por fontes do sistema: ela carregaria as Liberation por URL, bloqueada pela
    // CSP. Fontes não embutidas usam os dados padrão acima ou a família genérica.
    useSystemFonts: false,
  }).promise
}

export async function closeLibraryPdf(document: PDFDocumentProxy): Promise<void> {
  try {
    await document.loadingTask.destroy()
  } catch {
    // Já fechado.
  }
}

/** Renderiza a página num canvas com a largura pedida (fundo branco, sem anotações). */
export async function renderPageToCanvas(page: PDFPageProxy, width: number, maxPixels = 16_000_000): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 })
  let scale = width / base.width
  // Limita páginas muito grandes para não estourar a memória do canvas.
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (context) {
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  await page.render({ canvas, viewport, background: 'rgb(255,255,255)', annotationMode: 0 }).promise
  return canvas
}

function canvasToJPEG(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Não foi possível gerar a capa.'))
          return
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
      },
      'image/jpeg',
      quality,
    )
  })
}

/** Capa: primeira página com 240 px de largura (o dobro do maior uso na janela), em JPEG. */
export async function renderCoverJPEG(url: string): Promise<Uint8Array> {
  const document = await openLibraryPdf(url)
  try {
    const page = await document.getPage(1)
    const canvas = await renderPageToCanvas(page, 240)
    page.cleanup()
    return await canvasToJPEG(canvas, 0.82)
  } finally {
    await closeLibraryPdf(document)
  }
}
