/**
 * Armazenamento do histórico de versões, porte de `SermonRevisionStore`. A persistência é
 * injetada (`HistoryStorage`): no app desktop, SQLite no processo principal; nos testes, memória.
 * As operações são serializadas, como no actor Swift, para que duas capturas não intercalem
 * leitura e gravação da mesma data.
 */
import { isDateKey } from '../util/dates'
import { createRevision, revisionSnapshot, snapshotsMatch, sortRevisions } from './model'
import type { SermonRevision, SermonRevisionSnapshot } from './model'

/** Revisões guardadas por data do sermão (chave yyyy-MM-dd). */
export interface HistoryStorage {
  list(dateKey: string): Promise<SermonRevision[]>
  /** Substitui todas as revisões da data. */
  save(dateKey: string, revisions: SermonRevision[]): Promise<void>
}

/** Retenção das 100 versões mais recentes por sermão. */
export const HISTORY_RETENTION_LIMIT = 100

/** Resumos gravados nas revisões, iguais ao app Swift. */
export const HISTORY_SUMMARIES = {
  saved: 'Edição salva',
  beforeRestore: 'Antes da restauração',
  restoredFrom: (version: number) => `Restaurada de v${version}`,
} as const

export interface CaptureOptions {
  summary?: string
  /** Cria a versão mesmo quando o conteúdo repete a última (restauração explícita). */
  force?: boolean
}

export interface SermonHistoryStoreOptions {
  now?: () => Date
  newId?: () => string
  retentionLimit?: number
}

export class SermonHistoryStore {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly retentionLimit: number

  constructor(
    private readonly storage: HistoryStorage,
    options: SermonHistoryStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID())
    this.retentionLimit = Math.max(1, options.retentionLimit ?? HISTORY_RETENTION_LIMIT)
  }

  /** Revisões da data em ordem crescente de versão. */
  revisions(dateKey: string): Promise<SermonRevision[]> {
    return this.enqueue(() => this.load(dateKey))
  }

  /**
   * Grava uma versão nova, salvo quando o snapshot repete a última e `force` não foi pedido.
   * Devolve a lista completa após a retenção.
   */
  capture(
    snapshot: SermonRevisionSnapshot,
    dateKey: string,
    options: CaptureOptions = {},
  ): Promise<SermonRevision[]> {
    return this.enqueue(() => this.captureNow(snapshot, dateKey, options))
  }

  /**
   * Restaura uma versão sem descartar a edição atual: grava a edição em curso como
   * "Antes da restauração" (deduplicada), aplica o conteúdo restaurado ao rascunho por meio de
   * `apply` e grava sempre uma versão nova "Restaurada de vN", mesmo com conteúdo idêntico.
   * `apply` não deve chamar este armazenamento.
   */
  async restore(
    dateKey: string,
    revision: SermonRevision,
    current: SermonRevisionSnapshot,
    apply: (snapshot: SermonRevisionSnapshot) => void | Promise<void>,
  ): Promise<SermonRevision[]> {
    await this.capture(current, dateKey, { summary: HISTORY_SUMMARIES.beforeRestore })
    const restored = revisionSnapshot(revision)
    await apply(restored)
    return this.capture(restored, dateKey, {
      summary: HISTORY_SUMMARIES.restoredFrom(revision.version),
      force: true,
    })
  }

  private async load(dateKey: string): Promise<SermonRevision[]> {
    assertDateKey(dateKey)
    return sortRevisions(await this.storage.list(dateKey))
  }

  private async captureNow(
    snapshot: SermonRevisionSnapshot,
    dateKey: string,
    options: CaptureOptions,
  ): Promise<SermonRevision[]> {
    const revisions = await this.load(dateKey)
    const latest = revisions.at(-1)
    if (!options.force && latest && snapshotsMatch(latest, snapshot)) return revisions

    revisions.push(
      createRevision({
        id: this.newId(),
        version: (latest?.version ?? 0) + 1,
        createdAt: this.now().toISOString(),
        summary: options.summary ?? HISTORY_SUMMARIES.saved,
        snapshot,
      }),
    )
    if (revisions.length > this.retentionLimit) revisions.splice(0, revisions.length - this.retentionLimit)
    await this.storage.save(dateKey, revisions)
    return [...revisions]
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }
}

function assertDateKey(dateKey: string): void {
  if (!isDateKey(dateKey)) throw new Error(`Data de sermão inválida para o histórico: ${dateKey}`)
}

/** Armazenamento em memória, útil em testes e na versão leve sem banco local. */
export class MemoryHistoryStorage implements HistoryStorage {
  readonly files = new Map<string, SermonRevision[]>()

  async list(dateKey: string): Promise<SermonRevision[]> {
    return [...(this.files.get(dateKey) ?? [])]
  }

  async save(dateKey: string, revisions: SermonRevision[]): Promise<void> {
    this.files.set(dateKey, [...revisions])
  }
}
