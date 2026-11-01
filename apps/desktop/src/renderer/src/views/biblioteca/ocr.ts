/**
 * OCR sob demanda na janela da Biblioteca: renderiza as páginas sem texto selecionável com o
 * PDF.js e reconhece com o tesseract.js (português e inglês). O worker e o núcleo wasm vêm
 * empacotados com o app; os dados de idioma são servidos pelo processo principal
 * (`pregar-asset://tessdata`), baixados uma única vez. Nada é carregado de CDN aqui.
 */
import { joinRecognizedLines } from '@pregar/core/library/text-source'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { closeLibraryPdf, openLibraryPdf, renderPageToCanvas } from './pdf-render'

/** Resolução da página para o OCR (o tesseract rende melhor perto de 300 dpi). */
const OCR_DPI = 300
const MAX_OCR_PIXELS = 12_000_000

export interface RecognizePagesOptions {
  url: string
  /** Páginas físicas (1-based). */
  pages: readonly number[]
  langPath: string
  signal: AbortSignal
  onProgress(done: number, total: number): void
}

interface TesseractLine {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

async function createOcrWorker(langPath: string) {
  const [{ createWorker, OEM }, workerPath, corePath] = await Promise.all([
    import('tesseract.js'),
    import('tesseract.js/dist/worker.min.js?url'),
    import('tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'),
  ])
  return createWorker(['por', 'eng'], OEM.LSTM_ONLY, {
    workerPath: workerPath.default,
    corePath: corePath.default,
    langPath,
    // Worker carregado do próprio app (não de blob), para o núcleo wasm não depender da CSP da janela.
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: () => undefined,
    errorHandler: () => undefined,
  })
}

function abortError(): Error {
  const error = new Error('OCR interrompido.')
  error.name = 'AbortError'
  return error
}

/**
 * Reconhece as páginas em ordem. Devolve o texto por página física (só as que produziram texto),
 * com as linhas ordenadas como o app Swift fazia com o Vision. Cancelar interrompe a página
 * atual e rejeita com `AbortError`; nada é gravado.
 */
export async function recognizePages(options: RecognizePagesOptions): Promise<Record<number, string>> {
  const { signal } = options
  if (signal.aborted) throw abortError()
  const texts: Record<number, string> = {}
  let document: PDFDocumentProxy | null = null
  const worker = await createOcrWorker(options.langPath)
  const onAbort = () => void worker.terminate()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    document = await openLibraryPdf(options.url)
    options.onProgress(0, options.pages.length)
    for (const [index, pageNumber] of options.pages.entries()) {
      if (signal.aborted) throw abortError()
      const page = await document.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const canvas = await renderPageToCanvas(page, (base.width * OCR_DPI) / 72, MAX_OCR_PIXELS)
      page.cleanup()
      if (signal.aborted) throw abortError()
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
      const lines: TesseractLine[] = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
      const text = lines.length
        ? joinRecognizedLines(
            lines
              .map((line) => ({ text: line.text.trim(), left: line.bbox.x0, top: line.bbox.y0, bottom: line.bbox.y1 }))
              .filter((line) => line.text !== ''),
            canvas.height,
          )
        : (data.text ?? '').trim()
      if (text.trim() !== '') texts[pageNumber] = text
      canvas.width = 0
      canvas.height = 0
      options.onProgress(index + 1, options.pages.length)
    }
    return texts
  } catch (error) {
    if (signal.aborted) throw abortError()
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
    void worker.terminate().catch(() => undefined)
    if (document) await closeLibraryPdf(document)
  }
}
