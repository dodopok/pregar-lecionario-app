/**
 * Captura automática após 12 segundos sem edição (`scheduleHistorySnapshot` da Mesa no Swift).
 * O snapshot é congelado no momento do agendamento: a tarefa adiada nunca lê o rascunho vivo,
 * que pode ter mudado de data ou sido fechado durante o atraso.
 */
import { createRevisionSnapshot } from './model'
import type { SermonRevision, SermonRevisionSnapshot } from './model'
import type { SermonHistoryStore } from './store'
import { historyMessages } from './presentation'

export const HISTORY_IDLE_DELAY_MS = 12_000

export interface HistoryTimers {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HistoryCaptureSchedulerOptions {
  delayMs?: number
  timers?: HistoryTimers
  onCaptured?: (dateKey: string, revisions: SermonRevision[]) => void
  /** Recebe o erro e a mensagem pronta para o usuário. */
  onError?: (error: unknown, message: string) => void
}

interface PendingCapture {
  dateKey: string
  snapshot: SermonRevisionSnapshot
  handle: unknown
}

const defaultTimers: HistoryTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class HistoryCaptureScheduler {
  private pending: PendingCapture | null = null
  private readonly delayMs: number
  private readonly timers: HistoryTimers

  constructor(
    private readonly store: SermonHistoryStore,
    private readonly options: HistoryCaptureSchedulerOptions = {},
  ) {
    this.delayMs = options.delayMs ?? HISTORY_IDLE_DELAY_MS
    this.timers = options.timers ?? defaultTimers
  }

  get isPending(): boolean {
    return this.pending !== null
  }

  /** Reinicia o atraso com o snapshot atual; o agendamento anterior é cancelado. */
  schedule(dateKey: string, snapshot: SermonRevisionSnapshot): void {
    this.cancel()
    const frozen = createRevisionSnapshot(snapshot)
    const handle = this.timers.setTimeout(() => {
      if (this.pending?.handle !== handle) return
      this.pending = null
      void this.run(dateKey, frozen)
    }, this.delayMs)
    this.pending = { dateKey, snapshot: frozen, handle }
  }

  /** Cancela a captura pendente (fechar a Mesa, trocar de sermão). */
  cancel(): void {
    if (!this.pending) return
    this.timers.clearTimeout(this.pending.handle)
    this.pending = null
  }

  /** Grava imediatamente a captura pendente, se houver. */
  async flush(): Promise<SermonRevision[] | null> {
    const pending = this.pending
    if (!pending) return null
    this.cancel()
    return this.run(pending.dateKey, pending.snapshot)
  }

  private async run(dateKey: string, snapshot: SermonRevisionSnapshot): Promise<SermonRevision[] | null> {
    try {
      const revisions = await this.store.capture(snapshot, dateKey)
      this.options.onCaptured?.(dateKey, revisions)
      return revisions
    } catch (error) {
      this.options.onError?.(error, historyMessages.saveFailed(error))
      return null
    }
  }
}
