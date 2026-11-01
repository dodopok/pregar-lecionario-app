/**
 * Processo utilitário de indexação: abre PDFs com o PDF.js e roda o indexador do domínio
 * (bookmarks, cabeçalhos, Feasting, OCR já reconhecido e extração para a revisão), fora do
 * processo principal. Recebe pedidos por `process.parentPort`; cada pedido pode ser cancelado.
 */
import { readFile } from 'node:fs/promises'
import {
  SermonReviewMaterialError,
  cachedPdfTextSource,
  decodeLibraryRecord,
  encodeLibraryRecord,
  extractPdfReviewSources,
  indexPdf,
  recognizeScannedPages,
  type PdfLibraryRecord,
  type PdfTextSource,
} from '@pregar/core/library'
import { pdfPageString } from '@pregar/core/library/text-source'
import { nonBlank } from '@pregar/core/library/text-utils'
import { PdfJsTextSource } from '../modules/library/pdf-source'
import type {
  WorkerErrorInfo,
  WorkerFile,
  WorkerInbound,
  WorkerOutbound,
  WorkerRequestType,
  WorkerRequests,
} from '../modules/library/worker-protocol'

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

interface OpenDocument {
  key: string
  raw: PdfJsTextSource
  source: PdfTextSource
  lastUsed: number
}

/** Documentos abertos recentemente (OCR pede candidatos e depois aplica o resultado). */
const documents = new Map<string, Promise<OpenDocument>>()
const MAX_OPEN_DOCUMENTS = 2
const IDLE_CLOSE_MS = 60_000
let idleTimer: NodeJS.Timeout | null = null

function documentKey(file: WorkerFile): string {
  return `${file.path}|${file.sizeBytes}|${file.modificationDate}`
}

async function closeDocument(key: string): Promise<void> {
  const entry = documents.get(key)
  documents.delete(key)
  try {
    await (await entry)?.raw.destroy()
  } catch {
    // Documento que nem abriu.
  }
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    for (const key of [...documents.keys()]) void closeDocument(key)
  }, IDLE_CLOSE_MS)
  idleTimer.unref?.()
}

async function openDocument(file: WorkerFile): Promise<OpenDocument> {
  const key = documentKey(file)
  let entry = documents.get(key)
  if (!entry) {
    entry = (async () => {
      const data = new Uint8Array(await readFile(file.path))
      const raw = await PdfJsTextSource.open(data)
      return { key, raw, source: cachedPdfTextSource(raw), lastUsed: Date.now() }
    })()
    documents.set(key, entry)
    entry.catch(() => documents.delete(key))
    // Fecha os mais antigos além do limite.
    if (documents.size > MAX_OPEN_DOCUMENTS) {
      const settled = await Promise.allSettled([...documents.values()])
      const open = settled
        .filter((result): result is PromiseFulfilledResult<OpenDocument> => result.status === 'fulfilled')
        .map((result) => result.value)
        .filter((document) => document.key !== key)
        .sort((a, b) => a.lastUsed - b.lastUsed)
      for (const document of open.slice(0, Math.max(0, documents.size - MAX_OPEN_DOCUMENTS))) {
        void closeDocument(document.key)
      }
    }
  }
  const document = await entry
  document.lastUsed = Date.now()
  scheduleIdleClose()
  return document
}

function decodePrevious(value: object | null): PdfLibraryRecord | null {
  return value ? decodeLibraryRecord(value) : null
}

function fileInfo(file: WorkerFile) {
  return { path: file.path, sizeBytes: file.sizeBytes, modificationDate: file.modificationDate }
}

/** Mensagem em português para falhas do PDF.js. */
function describeError(error: unknown): WorkerErrorInfo {
  if (error instanceof SermonReviewMaterialError) {
    return { message: error.message, reviewCode: error.code, materialTitle: error.materialTitle, name: error.name }
  }
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError') return { message: 'Operação cancelada.', name }
  if (name === 'PasswordException') return { message: 'Este PDF está protegido por senha e não pode ser indexado.', name }
  if (name === 'InvalidPDFException') return { message: 'O arquivo não é um PDF válido ou está corrompido.', name }
  const code = (error as { code?: string }).code
  if (code === 'ENOENT') return { message: 'O arquivo não foi encontrado no caminho original.', name: 'ENOENT' }
  if (code === 'EACCES' || code === 'EPERM') return { message: 'Sem permissão para ler este arquivo.', name: code }
  return { message: error instanceof Error ? error.message : String(error), name }
}

type Handler<T extends WorkerRequestType> = (
  payload: WorkerRequests[T]['req'],
  context: { signal: AbortSignal; progress(done: number, total: number): void },
) => Promise<WorkerRequests[T]['res']>

const handlers: { [T in WorkerRequestType]: Handler<T> } = {
  async index({ file, previous }, { signal }) {
    const document = await openDocument(file)
    const record = await indexPdf(document.source, fileInfo(file), { previousRecord: decodePrevious(previous), signal })
    if (!record) throw new Error('O PDF não tem páginas.')
    return { record: encodeLibraryRecord(record) }
  },

  async ocrCandidates({ file, previous }, { signal, progress }) {
    const document = await openDocument(file)
    const source = document.source
    const previousRecord = decodePrevious(previous)
    const sameFile =
      previousRecord?.path === file.path &&
      previousRecord.fileSizeBytes === file.sizeBytes &&
      previousRecord.fileModificationDate !== undefined &&
      Math.abs(previousRecord.fileModificationDate - file.modificationDate) <= 0.001
    const scanned = new Set(sameFile ? (previousRecord?.ocrPageNumbers ?? []) : [])
    const candidates: number[] = []
    for (let pageNumber = 1; pageNumber <= source.pageCount; pageNumber += 1) {
      if (pageNumber % 16 === 0) {
        signal.throwIfAborted()
        progress(pageNumber, source.pageCount)
      }
      if (nonBlank(await pdfPageString(source, pageNumber)) === null) candidates.push(pageNumber)
    }
    return {
      pageCount: source.pageCount,
      candidatePageCount: candidates.length,
      pages: candidates.filter((page) => !scanned.has(page)),
    }
  },

  async ocrApply({ file, previous, texts }, { signal }) {
    const document = await openDocument(file)
    const result = await recognizeScannedPages(document.source, fileInfo(file), {
      previousRecord: decodePrevious(previous),
      signal,
      recognizePage: async (pageIndex) => {
        const text = texts[pageIndex + 1]
        return typeof text === 'string' && text.trim() !== '' ? text : null
      },
    })
    if (!result) throw new Error('O PDF não tem páginas.')
    return {
      record: encodeLibraryRecord(result.record),
      candidatePageCount: result.candidatePageCount,
      scannedPageCount: result.scannedPageCount,
      recognizedTextPageCount: result.recognizedTextPageCount,
      sectionsFound: result.sectionsFound,
    }
  },

  async review({ file, record, tab, targetReference }) {
    let source: PdfTextSource | null = null
    if (file) {
      try {
        source = (await openDocument(file)).source
      } catch {
        source = null
      }
    }
    const decoded = record ? decodeLibraryRecord(record) : null
    const sources = await extractPdfReviewSources({
      tab,
      targetReference,
      source,
      libraryRecords: decoded ? [decoded] : [],
    })
    return { sources }
  },
}

export function runIndexerWorker(): void {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!port) return
  const controllers = new Map<number, AbortController>()
  const post = (message: WorkerOutbound) => port.postMessage(message)

  port.on('message', (event) => {
    const message = event.data as WorkerInbound
    if (!message || typeof message !== 'object') return
    if (message.kind === 'cancel') {
      controllers.get(message.id)?.abort()
      return
    }
    if (message.kind !== 'request') return
    const handler = handlers[message.type] as Handler<WorkerRequestType> | undefined
    if (!handler) {
      post({ kind: 'error', id: message.id, error: { message: `Pedido desconhecido: ${String(message.type)}` } })
      return
    }
    const controller = new AbortController()
    controllers.set(message.id, controller)
    const progress = (done: number, total: number) => post({ kind: 'progress', id: message.id, done, total })
    handler(message.payload as never, { signal: controller.signal, progress })
      .then((value) => post({ kind: 'result', id: message.id, value }))
      .catch((error: unknown) => post({ kind: 'error', id: message.id, error: describeError(error) }))
      .finally(() => controllers.delete(message.id))
  })

  // Avisos do PDF.js sobre fontes e recursos ausentes não interessam ao usuário.
  process.on('unhandledRejection', (reason) => console.error('[indexer] rejeição não tratada', reason))
}
