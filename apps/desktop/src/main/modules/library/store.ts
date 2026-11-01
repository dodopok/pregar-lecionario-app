import { decodeLibraryRecord, encodeLibraryRecord, type PdfLibraryRecord } from '@pregar/core/library'
import type { LocalDatabase } from '../../storage/db'
import type { KeyValueStore } from '../../storage/db'

/**
 * Persistência do acervo: um JSON por registro (mesma codificação do domínio e do app Swift),
 * numa tabela própria do módulo. As páginas lembradas por passagem ficam no armazenamento
 * chave-valor.
 */
export class LibraryStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly kv: KeyValueStore,
  ) {
    database.db.exec(
      `create table if not exists library_records (
         path text primary key,
         payload text not null,
         updated_at text not null
       )`,
    )
  }

  loadAll(): { records: PdfLibraryRecord[]; invalid: number } {
    const rows = this.database.all<{ path: string; payload: string }>('select path, payload from library_records')
    const records: PdfLibraryRecord[] = []
    let invalid = 0
    for (const row of rows) {
      try {
        const record = decodeLibraryRecord(JSON.parse(row.payload))
        if (record) records.push(record)
        else invalid += 1
      } catch {
        invalid += 1
      }
    }
    return { records, invalid }
  }

  save(record: PdfLibraryRecord): void {
    this.database.run(
      'insert into library_records (path, payload, updated_at) values (?, ?, ?) on conflict(path) do update set payload = excluded.payload, updated_at = excluded.updated_at',
      record.path,
      JSON.stringify(encodeLibraryRecord(record)),
      new Date().toISOString(),
    )
  }

  saveMany(records: readonly PdfLibraryRecord[]): void {
    if (records.length === 0) return
    this.database.transaction(() => {
      for (const record of records) this.save(record)
    })
  }

  delete(path: string): void {
    this.database.run('delete from library_records where path = ?', path)
  }

  replaceAll(records: readonly PdfLibraryRecord[]): void {
    this.database.transaction(() => {
      this.database.run('delete from library_records')
      for (const record of records) this.save(record)
    })
  }

  sectionLinks(): Record<string, number> {
    return this.kv.get<Record<string, number>>('links') ?? {}
  }

  setSectionLinks(links: Record<string, number>): void {
    this.kv.set('links', links)
  }
}
