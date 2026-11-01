import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { SermonReviewMaterialError } from '@pregar/core/library'
import type { WorkerErrorInfo, WorkerInbound, WorkerOutbound, WorkerRequestType, WorkerRequests } from './worker-protocol'

export type JobPriority = 'high' | 'low'

interface Job {
  id: number
  type: WorkerRequestType
  payload: unknown
  priority: JobPriority
  resolve(value: unknown): void
  reject(error: Error): void
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  started: boolean
}

/** Pedidos simultâneos no worker (um de fundo e um da interface, por exemplo). */
const MAX_IN_FLIGHT = 2
/** Sem pedidos por este tempo, o processo utilitário é encerrado para liberar memória. */
const IDLE_SHUTDOWN_MS = 120_000

export class WorkerError extends Error {
  constructor(readonly info: WorkerErrorInfo) {
    super(info.message)
    this.name = info.name === 'AbortError' ? 'AbortError' : 'WorkerError'
  }
}

/**
 * Cliente do processo utilitário de indexação (`out/main/indexer.js`). Mantém uma fila com
 * prioridade: pedidos da interface (importação, OCR, revisão) passam à frente da reindexação
 * de fundo. O processo é criado sob demanda, recriado se cair e encerrado quando ocioso.
 */
export class IndexerClient {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly queue: Job[] = []
  private readonly running = new Map<number, Job>()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly entry = defaultEntry()) {}

  request<T extends WorkerRequestType>(
    type: T,
    payload: WorkerRequests[T]['req'],
    options: { priority?: JobPriority; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<WorkerRequests[T]['res']> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError())
        return
      }
      const job: Job = {
        id: this.nextId++,
        type,
        payload,
        priority: options.priority ?? 'high',
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
        signal: options.signal,
        started: false,
      }
      options.signal?.addEventListener(
        'abort',
        () => {
          if (job.started) {
            this.child?.postMessage({ kind: 'cancel', id: job.id } satisfies WorkerInbound)
          } else {
            const index = this.queue.indexOf(job)
            if (index >= 0) this.queue.splice(index, 1)
            job.reject(abortError())
          }
        },
        { once: true },
      )
      // Pedidos da interface entram antes dos de fundo, preservando a ordem entre iguais.
      if (job.priority === 'high') {
        const firstLow = this.queue.findIndex((queued) => queued.priority === 'low')
        if (firstLow >= 0) this.queue.splice(firstLow, 0, job)
        else this.queue.push(job)
      } else {
        this.queue.push(job)
      }
      this.pump()
    })
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.child?.kill()
    this.child = null
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const cMaps = pdfjsCMapDirectory()
    const child = utilityProcess.fork(this.entry, [], {
      serviceName: 'Pregar · Indexador de PDFs',
      stdio: 'pipe',
      env: { ...process.env, ...(cMaps ? { PREGAR_PDFJS_CMAPS: cMaps } : {}) },
    })
    child.stdout?.on('data', () => undefined)
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = String(chunk).trim()
      if (text && !/Warning: |TT: |Indexing all PDF objects/.test(text)) console.warn('[indexador]', text.slice(0, 500))
    })
    child.once('spawn', () => {
      // A indexação nunca deve competir com as janelas.
      try {
        if (child.pid) setPriority(child.pid, 10)
      } catch {
        // Sem permissão para mudar a prioridade: segue normal.
      }
    })
    child.on('message', (message: WorkerOutbound) => this.onMessage(message))
    child.once('exit', (code) => {
      if (this.child === child) this.child = null
      const pending = [...this.running.values()]
      this.running.clear()
      for (const job of pending) {
        job.reject(new WorkerError({ message: `O indexador de PDFs foi interrompido (código ${code}). Tente novamente.` }))
      }
      this.pump()
    })
    this.child = child
    return child
  }

  private pump(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    while (this.running.size < MAX_IN_FLIGHT && this.queue.length > 0) {
      // Só um pedido de fundo por vez.
      const index = this.queue.findIndex(
        (job) => job.priority === 'high' || ![...this.running.values()].some((running) => running.priority === 'low'),
      )
      if (index < 0) break
      const [job] = this.queue.splice(index, 1)
      if (!job) break
      job.started = true
      this.running.set(job.id, job)
      this.ensureChild().postMessage({ kind: 'request', id: job.id, type: job.type, payload: job.payload } satisfies WorkerInbound)
    }
    if (this.running.size === 0 && this.queue.length === 0 && this.child) {
      this.idleTimer = setTimeout(() => {
        if (this.running.size === 0 && this.queue.length === 0) {
          this.child?.kill()
          this.child = null
        }
      }, IDLE_SHUTDOWN_MS)
      this.idleTimer.unref?.()
    }
  }

  private onMessage(message: WorkerOutbound): void {
    const job = this.running.get(message.id)
    if (!job) return
    if (message.kind === 'progress') {
      job.onProgress?.(message.done, message.total)
      return
    }
    this.running.delete(message.id)
    if (message.kind === 'result') job.resolve(message.value)
    else job.reject(toError(message.error))
    this.pump()
  }
}

/** `out/main/indexer.js`, ao lado do bundle principal (ou um nível acima, se este código for para um chunk). */
/**
 * Pasta dos CMaps do PDF.js (texto de PDFs em chinês, japonês e coreano sem fonte embutida): nos
 * recursos do app instalado, ou no node_modules do repositório durante o desenvolvimento e os testes.
 */
export function pdfjsCMapDirectory(): string | null {
  const resources = (process as { resourcesPath?: string }).resourcesPath
  const packaged = resources ? join(resources, 'pdfjs-cmaps') : null
  if (packaged && existsSync(packaged)) return packaged
  let directory = __dirname
  for (let level = 0; level < 8; level++) {
    const candidate = join(directory, 'node_modules', 'pdfjs-dist', 'cmaps')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

function defaultEntry(): string {
  const beside = join(__dirname, 'indexer.js')
  return existsSync(beside) ? beside : join(__dirname, '..', 'indexer.js')
}

function abortError(): Error {
  const error = new Error('Operação cancelada.')
  error.name = 'AbortError'
  return error
}

function toError(info: WorkerErrorInfo): Error {
  if (info.reviewCode) return new SermonReviewMaterialError(info.reviewCode, info.materialTitle)
  if (info.name === 'AbortError') return abortError()
  return new WorkerError(info)
}
