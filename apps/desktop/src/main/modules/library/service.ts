import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseReference } from '@pregar/core/bible/reference'
import {
  SermonReviewMaterialError,
  confidenceLabel,
  decodeLibraryRecord,
  decodeLibraryRecords,
  encodeLibraryRecord,
  findingMethodLabel,
  migrateLibraryRecords,
  ocrResultNotice,
  preservingMetadata,
  recordDisplayAuthor,
  recordDisplayCredits,
  recordDisplayTitle,
  compareLibraryRecords,
  sectionId,
  type PdfLibraryMetadataOverrides,
  type PdfLibraryRecord,
  type PdfSectionLocation,
  type ReviewMaterialSource,
} from '@pregar/core/library'
import { sectionLinkKey } from '@pregar/core/reader/state'
import type {
  LibraryImportResult,
  LibraryOcrCandidates,
  LibraryOcrOutcome,
  LibrarySectionConfidence,
  LibrarySectionMatch,
  LibrarySectionRow,
  LibraryStatus,
  LibraryWork,
} from '@shared/ipc-library'
import { UserFacingError } from '../../ipc/router'
import { checkPdfFile, currentFileInfo, libraryKey, PdfFileError } from './files'
import { SectionMatchIndex } from './matches'
import type { LibraryStore } from './store'
import { coverFileName } from './urls'
import type { IndexerClient, JobPriority } from './worker-client'

const MAX_COVER_BYTES = 2 * 1024 * 1024
const MAX_OCR_PAGE_CHARS = 200_000

export interface LibraryServiceEvents {
  changed(revision: number): void
  status(status: LibraryStatus): void
}

function confidenceOf(section: PdfSectionLocation): LibrarySectionConfidence {
  switch (section.findingMethod) {
    case 'bookmark':
      return 'high'
    case 'textHeading':
      return 'medium'
    case 'ocrHeading':
      return 'low'
    default:
      return 'unverified'
  }
}

export function sectionRow(section: PdfSectionLocation): LibrarySectionRow {
  return {
    id: sectionId(section),
    title: section.title,
    context: section.context ?? null,
    startPage: section.startPage,
    endPage: section.endPage,
    method: section.findingMethod ?? 'unknown',
    methodLabel: findingMethodLabel(section),
    confidence: confidenceOf(section),
    confidenceLabel: confidenceLabel(section),
    isReference: parseReference(section.title) !== null,
    components: (section.components ?? []).map((component) => ({
      kind: component.kind,
      title: component.title,
      author: component.author ?? null,
      startPage: component.location.start.page,
    })),
  }
}

function cleanOverrides(value: PdfLibraryMetadataOverrides): PdfLibraryMetadataOverrides {
  const clean = (text: unknown) => (typeof text === 'string' ? text.trim().slice(0, 500) : '')
  return {
    title: clean(value.title),
    author: clean(value.author),
    publisher: clean(value.publisher),
    year: clean(value.year),
    volume: clean(value.volume),
    edition: clean(value.edition),
    language: clean(value.language),
  }
}

/**
 * Acervo da Biblioteca no processo principal: registros em memória (fonte das respostas rápidas
 * às janelas), persistência em SQLite, fila de indexação no processo utilitário e capas.
 */
export class LibraryService {
  private readonly records = new Map<string, PdfLibraryRecord>()
  private loaded = false
  private migrated = false
  private revision = 0
  private matchIndex: SectionMatchIndex | null = null
  private sorted: PdfLibraryRecord[] | null = null
  private readonly coverVersions = new Map<string, number | null>()

  private readonly highQueue: string[] = []
  private readonly lowQueue: string[] = []
  private readonly queued = new Map<string, JobPriority>()
  private current: string | null = null
  private running = false
  private batchDone = 0
  private batchTotal = 0
  private failures: { name: string; reason: string }[] = []
  private readonly waiters = new Map<string, (() => void)[]>()

  constructor(
    private readonly store: LibraryStore,
    private readonly client: IndexerClient,
    private readonly thumbnails: string,
    private readonly events: LibraryServiceEvents,
  ) {}

  // MARK: Carregamento e migração

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const { records } = this.store.loadAll()
    const withEmbeddedCovers: PdfLibraryRecord[] = []
    for (const record of records) {
      const key = libraryKey(record.path)
      const normalized: PdfLibraryRecord = key === record.path ? record : { ...record, path: key, id: key }
      if (this.extractEmbeddedCover(normalized)) withEmbeddedCovers.push(normalized)
      this.records.set(key, normalized)
    }
    // Capas do JSON do app Swift viram arquivos; o registro fica leve.
    this.store.saveMany(withEmbeddedCovers)
  }

  /** Grava a capa embutida (base64) como arquivo e a retira do registro. */
  private extractEmbeddedCover(record: PdfLibraryRecord): boolean {
    if (!record.coverJPEG) return false
    try {
      const data = Buffer.from(record.coverJPEG, 'base64')
      if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) {
        const file = this.coverPath(record.path)
        if (!existsSync(file)) {
          writeFileSync(file, data)
          this.coverVersions.delete(record.path)
        }
      }
    } catch {
      // Capa ilegível: será gerada de novo pela janela.
    }
    delete record.coverJPEG
    return true
  }

  /** Migração ao abrir a Biblioteca (como no Swift): reindexa em segundo plano só o que precisa. */
  private startMigration(): void {
    if (this.migrated) return
    this.migrated = true
    const { records, pathsToReindex } = migrateLibraryRecords([...this.records.values()])
    const reindex = new Set(pathsToReindex)
    const changed: PdfLibraryRecord[] = []
    for (const record of records) {
      const previous = this.records.get(record.path)
      if (previous !== record && !reindex.has(record.path)) changed.push(record)
      this.records.set(record.path, record)
    }
    this.store.saveMany(changed)
    if (changed.length > 0) this.changed()
    this.enqueue([...reindex].filter((path) => existsSync(path)), 'low')
  }

  // MARK: Consultas

  private sortedRecords(): PdfLibraryRecord[] {
    this.ensureLoaded()
    this.sorted ??= [...this.records.values()].sort(compareLibraryRecords)
    return this.sorted
  }

  private index(): SectionMatchIndex {
    this.matchIndex ??= new SectionMatchIndex(this.sortedRecords())
    return this.matchIndex
  }

  private coverPath(path: string): string {
    return join(this.thumbnails, coverFileName(createHash('sha256').update(path).digest('hex')))
  }

  private coverURL(path: string): string | null {
    let version = this.coverVersions.get(path)
    if (version === undefined) {
      try {
        version = Math.round(statSync(this.coverPath(path)).mtimeMs)
      } catch {
        version = null
      }
      this.coverVersions.set(path, version)
    }
    if (version === null) return null
    return `pregar-asset://cover/${basename(this.coverPath(path))}?v=${version}`
  }

  private toWork(record: PdfLibraryRecord): LibraryWork {
    return {
      id: record.id,
      path: record.path,
      title: recordDisplayTitle(record),
      author: recordDisplayAuthor(record) ?? null,
      credits: recordDisplayCredits(record),
      extracted: { title: record.title, author: record.author ?? null },
      overrides: record.metadataOverrides ? { ...record.metadataOverrides } : null,
      pageCount: record.pageCount,
      bookmarkCount: record.bookmarkCount,
      sectionCount: record.sections?.length ?? record.bookmarkCount,
      copyLabel: record.copyLabel ?? null,
      ocrPageCount: record.ocrPageNumbers?.length ?? 0,
      coverURL: this.coverURL(record.path),
      available: existsSync(record.path),
      indexing: this.queued.has(record.path) || this.current === record.path,
    }
  }

  private recordFor(id: string): PdfLibraryRecord {
    this.ensureLoaded()
    const record = typeof id === 'string' ? this.records.get(libraryKey(id)) : undefined
    if (!record) throw new UserFacingError('Esta obra não está mais na Biblioteca.')
    return record
  }

  works(): LibraryWork[] {
    this.ensureLoaded()
    this.startMigration()
    return this.sortedRecords().map((record) => this.toWork(record))
  }

  work(id: string): LibraryWork {
    return this.toWork(this.recordFor(id))
  }

  sections(id: string): LibrarySectionRow[] {
    return (this.recordFor(id).sections ?? []).map(sectionRow)
  }

  sectionsForPath(path: string): LibrarySectionRow[] {
    this.ensureLoaded()
    const record = this.records.get(libraryKey(path))
    return (record?.sections ?? []).map(sectionRow)
  }

  matches(reference: string): LibrarySectionMatch[] {
    return this.index().matches(reference)
  }

  matchCounts(references: readonly string[]): Record<string, number> {
    const index = this.index()
    const result: Record<string, number> = {}
    for (const reference of references) result[reference] = index.count(reference)
    return result
  }

  count(): { works: number; sections: number } {
    const records = this.sortedRecords()
    return {
      works: records.length,
      sections: records.reduce((total, record) => total + (record.sections?.length ?? record.bookmarkCount), 0),
    }
  }

  isRegistered(path: string): boolean {
    this.ensureLoaded()
    return this.records.has(libraryKey(path))
  }

  /** Caminho registrado correspondente (para o protocolo), ou `null`. */
  registeredPath(path: string): string | null {
    this.ensureLoaded()
    const key = libraryKey(path)
    return this.records.has(key) ? key : null
  }

  status(): LibraryStatus {
    return {
      indexing: this.running,
      done: this.batchDone,
      total: this.batchTotal,
      current: this.current ? basename(this.current) : null,
      failures: [...this.failures],
    }
  }

  // MARK: Fila de indexação

  private changed(): void {
    this.revision += 1
    this.sorted = null
    this.matchIndex = null
    this.events.changed(this.revision)
  }

  private emitStatus(): void {
    this.events.status(this.status())
  }

  private enqueue(paths: readonly string[], priority: JobPriority): void {
    if (paths.length === 0) return
    if (!this.running && this.highQueue.length === 0 && this.lowQueue.length === 0) {
      this.batchDone = 0
      this.batchTotal = 0
      this.failures = []
    }
    for (const path of paths) {
      const existing = this.queued.get(path)
      if (existing === 'high' || (existing === 'low' && priority === 'low')) continue
      if (existing === 'low') {
        // Promovido: sai da fila de fundo.
        this.lowQueue.splice(this.lowQueue.indexOf(path), 1)
      } else {
        this.batchTotal += 1
      }
      this.queued.set(path, priority)
      ;(priority === 'high' ? this.highQueue : this.lowQueue).push(path)
    }
    this.emitStatus()
    this.changed()
    void this.drain()
  }

  private whenProcessed(path: string): Promise<void> {
    if (!this.queued.has(path) && this.current !== path) return Promise.resolve()
    return new Promise((resolve) => {
      const list = this.waiters.get(path) ?? []
      list.push(resolve)
      this.waiters.set(path, list)
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const path = this.highQueue.shift() ?? this.lowQueue.shift()
        if (path === undefined) break
        const priority = this.queued.get(path) ?? 'low'
        this.queued.delete(path)
        this.current = path
        this.emitStatus()
        try {
          await this.indexOne(path, priority)
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'falha desconhecida'
          this.failures.push({ name: basename(path), reason })
          console.warn('[biblioteca] falha ao indexar', basename(path), reason)
        }
        this.current = null
        this.batchDone += 1
        for (const resolve of this.waiters.get(path) ?? []) resolve()
        this.waiters.delete(path)
        this.changed()
      }
    } finally {
      this.running = false
      this.current = null
      this.emitStatus()
    }
  }

  private async indexOne(path: string, priority: JobPriority): Promise<void> {
    const file = await currentFileInfo(path)
    if (!file) throw new Error('arquivo não encontrado')
    const previous = this.records.get(path) ?? null
    const { record: encoded } = await this.client.request(
      'index',
      { file, previous: previous ? encodeLibraryRecord(previous) : null },
      { priority },
    )
    const decoded = decodeLibraryRecord(encoded)
    if (!decoded) throw new Error('índice inválido')
    // Removida da Biblioteca durante a indexação de fundo: não volta.
    if (previous && !this.records.has(path)) return
    const record = preservingMetadata(decoded, previous)
    delete record.coverJPEG
    if (
      previous &&
      (previous.fileSizeBytes !== file.sizeBytes || previous.fileModificationDate !== file.modificationDate)
    ) {
      await this.deleteCover(path)
    }
    this.records.set(path, record)
    this.store.save(record)
  }

  // MARK: Ações

  /**
   * Confere e envia à indexação. `strict` vale para caminhos vindos da janela; `reindexExisting`
   * reindexa os já registrados (reimportação do Drive atualiza os mesmos caminhos).
   */
  async importPaths(
    paths: readonly unknown[],
    options: { strict: boolean; reindexExisting?: boolean },
  ): Promise<{ result: LibraryImportResult; done: Promise<void> }> {
    this.ensureLoaded()
    if (!Array.isArray(paths) || paths.length > 500) throw new UserFacingError('Lista de arquivos inválida.')
    const result: LibraryImportResult = { queued: 0, alreadyInLibrary: 0, skipped: [] }
    const accepted: string[] = []
    const existing: string[] = []
    for (const raw of new Set(paths)) {
      if (typeof raw !== 'string') {
        result.skipped.push({ name: String(raw), reason: 'caminho inválido' })
        continue
      }
      try {
        const file = await checkPdfFile(raw, { strict: options.strict })
        if (this.records.has(file.path)) {
          result.alreadyInLibrary += 1
          existing.push(file.path)
        } else if (!accepted.includes(file.path)) {
          accepted.push(file.path)
        }
      } catch (error) {
        const reason = error instanceof PdfFileError ? error.message : 'não foi possível ler o arquivo'
        result.skipped.push({ name: basename(raw) || raw, reason })
      }
    }
    const toIndex = options.reindexExisting ? [...accepted, ...existing] : accepted
    result.queued = accepted.length
    this.startMigration()
    this.enqueue(toIndex, 'high')
    const done = Promise.all(toIndex.map((path) => this.whenProcessed(path))).then(() => undefined)
    return { result, done }
  }

  reindex(id?: string): void {
    this.ensureLoaded()
    const paths = id === undefined ? this.sortedRecords().map((record) => record.path) : [this.recordFor(id).path]
    this.enqueue(
      paths.filter((path) => existsSync(path)),
      'high',
    )
  }

  async remove(id: string): Promise<void> {
    const record = this.recordFor(id)
    this.records.delete(record.path)
    this.store.delete(record.path)
    const priority = this.queued.get(record.path)
    if (priority) {
      const queue = priority === 'high' ? this.highQueue : this.lowQueue
      queue.splice(queue.indexOf(record.path), 1)
      this.queued.delete(record.path)
      this.batchTotal = Math.max(0, this.batchTotal - 1)
      for (const resolve of this.waiters.get(record.path) ?? []) resolve()
      this.waiters.delete(record.path)
    }
    await this.deleteCover(record.path)
    this.changed()
    this.emitStatus()
  }

  saveMetadata(id: string, metadata: PdfLibraryMetadataOverrides | null): LibraryWork {
    const record = this.recordFor(id)
    const updated: PdfLibraryRecord = { ...record }
    if (metadata === null) delete updated.metadataOverrides
    else if (typeof metadata === 'object') updated.metadataOverrides = cleanOverrides(metadata)
    else throw new UserFacingError('Metadados inválidos.')
    this.records.set(record.path, updated)
    this.store.save(updated)
    this.changed()
    return this.toWork(updated)
  }

  async saveCover(id: string, jpeg: unknown): Promise<string> {
    const record = this.recordFor(id)
    if (!(jpeg instanceof Uint8Array)) throw new UserFacingError('Capa inválida.')
    const data = Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
    if (data.length < 4 || data.length > MAX_COVER_BYTES || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
      throw new UserFacingError('Capa inválida.')
    }
    const target = this.coverPath(record.path)
    const temporary = `${target}.tmp`
    await writeFile(temporary, data)
    await rename(temporary, target)
    this.coverVersions.delete(record.path)
    this.revision += 1
    this.events.changed(this.revision)
    return this.coverURL(record.path) ?? ''
  }

  private async deleteCover(path: string): Promise<void> {
    await rm(this.coverPath(path), { force: true })
    this.coverVersions.set(path, null)
  }

  async ocrCandidates(id: string): Promise<LibraryOcrCandidates> {
    const record = this.recordFor(id)
    const file = await currentFileInfo(record.path)
    if (!file) throw new UserFacingError('Não foi possível abrir o PDF para reconhecer o texto.')
    return this.client.request('ocrCandidates', { file, previous: encodeLibraryRecord(record) }, { priority: 'high' })
  }

  async ocrApply(id: string, texts: unknown): Promise<LibraryOcrOutcome> {
    const record = this.recordFor(id)
    if (!texts || typeof texts !== 'object' || Array.isArray(texts)) throw new UserFacingError('Resultado do OCR inválido.')
    const clean: Record<number, string> = {}
    for (const [key, value] of Object.entries(texts as Record<string, unknown>)) {
      const page = Number(key)
      if (!Number.isInteger(page) || page < 1 || page > record.pageCount || typeof value !== 'string') continue
      clean[page] = value.slice(0, MAX_OCR_PAGE_CHARS)
    }
    const file = await currentFileInfo(record.path)
    if (!file) throw new UserFacingError('Não foi possível abrir o PDF para reconhecer o texto.')
    const result = await this.client.request(
      'ocrApply',
      { file, previous: encodeLibraryRecord(record), texts: clean },
      { priority: 'high' },
    )
    const decoded = decodeLibraryRecord(result.record)
    if (!decoded) throw new UserFacingError('Não foi possível abrir o PDF para reconhecer o texto.')
    const latest = this.records.get(record.path)
    if (!latest) throw new UserFacingError('Esta obra não está mais na Biblioteca.')
    const updated = preservingMetadata(decoded, latest)
    delete updated.coverJPEG
    this.records.set(record.path, updated)
    this.store.save(updated)
    this.changed()
    return {
      notice: ocrResultNotice({ ...result, record: updated }),
      work: this.toWork(updated),
    }
  }

  async extractReviewSources(input: {
    path: string
    title: string
    reference: string | null
    physicalPage: number
  }): Promise<ReviewMaterialSource[]> {
    this.ensureLoaded()
    const key = libraryKey(input.path)
    const record = this.records.get(key)
    if (!record) throw SermonReviewMaterialError.sourceUnavailable(input.title)
    const file = await currentFileInfo(key)
    const tab = {
      id: createHash('sha1').update(`${key}|${input.physicalPage}`).digest('hex').slice(0, 12),
      title: input.title,
      location: key,
      physicalPage: input.physicalPage,
      reference: input.reference,
    }
    const { sources } = await this.client.request(
      'review',
      { file, record: encodeLibraryRecord(record), tab, targetReference: input.reference },
      { priority: 'high' },
    )
    return sources
  }

  // MARK: Páginas lembradas e backup

  rememberedPage(path: string, reference: string): number | null {
    const page = this.store.sectionLinks()[sectionLinkKey(libraryKey(path), reference)]
    return typeof page === 'number' ? page : null
  }

  rememberPage(path: string, reference: string, page: number | null): void {
    const links = this.store.sectionLinks()
    const key = sectionLinkKey(libraryKey(path), reference)
    if (page === null) delete links[key]
    else if (Number.isInteger(page) && page >= 1 && page <= 100_000) links[key] = page
    else throw new UserFacingError('Página inválida.')
    this.store.setSectionLinks(links)
  }

  exportSectionLinks(): Record<string, number> {
    return { ...this.store.sectionLinks() }
  }

  replaceSectionLinks(links: Record<string, number>): void {
    const clean: Record<string, number> = {}
    for (const [key, value] of Object.entries(links ?? {})) {
      if (typeof key === 'string' && Number.isInteger(value) && value >= 1) clean[key] = value
    }
    this.store.setSectionLinks(clean)
  }

  /** Registros no JSON do domínio, com a capa embutida como no app Swift. */
  exportRecords(): unknown[] {
    return this.sortedRecords().map((record) => {
      const exported: PdfLibraryRecord = { ...record }
      try {
        exported.coverJPEG = readFileSync(this.coverPath(record.path)).toString('base64')
      } catch {
        // Sem capa gerada.
      }
      return encodeLibraryRecord(exported)
    })
  }

  async replaceRecords(raw: unknown[]): Promise<void> {
    this.ensureLoaded()
    const decoded = decodeLibraryRecords(raw)
    const next = new Map<string, PdfLibraryRecord>()
    for (const record of decoded) {
      const key = libraryKey(record.path)
      const normalized: PdfLibraryRecord = { ...record, path: key, id: key }
      if (normalized.coverJPEG) {
        await this.deleteCover(key)
        this.extractEmbeddedCover(normalized)
      }
      next.set(key, normalized)
    }
    // Fila e capas de obras que não existem mais.
    this.highQueue.length = 0
    this.lowQueue.length = 0
    for (const path of this.queued.keys()) for (const resolve of this.waiters.get(path) ?? []) resolve()
    this.queued.clear()
    for (const path of this.records.keys()) if (!next.has(path)) await this.deleteCover(path)
    this.records.clear()
    for (const [key, record] of next) this.records.set(key, record)
    this.coverVersions.clear()
    this.store.replaceAll([...next.values()])
    this.migrated = false
    this.changed()
    this.startMigration()
    this.emitStatus()
  }
}
