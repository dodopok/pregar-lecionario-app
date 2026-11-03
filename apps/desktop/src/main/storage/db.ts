import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'

/** Migrações do banco local. Cada passo roda uma vez, na ordem; nunca edite um passo publicado. */
const MIGRATIONS: string[] = [
  `create table settings (key text primary key, value text not null);
   create table sermons (
     date_key text primary key,
     title text not null default '',
     liturgical_occasion text,
     liturgical_celebration text,
     liturgical_season text,
     prayer_book_id text,
     main_reading_reference text,
     main_reading_slot text,
     doc text,
     plain_text text not null default '',
     word_count integer not null default 0,
     tablet_pdf_path text,
     tablet_pdf_updated_at text,
     drive_draft_key text,
     drive_document_id text,
     drive_revision_id text,
     drive_synced_at text,
     drive_synced_content_hash text,
     drive_sync_error text,
     created_at text not null,
     modified_at text not null
   );
   create virtual table sermons_fts using fts5(date_key unindexed, title, body, tokenize = 'unicode61 remove_diacritics 2');
   create table sermon_revisions (
     id text primary key,
     date_key text not null,
     version integer not null,
     payload text not null,
     created_at text not null
   );
   create index sermon_revisions_date on sermon_revisions(date_key, version);
   create table review_reports (date_key text primary key, payload text not null, updated_at text not null);
   create table kv (namespace text not null, key text not null, value text not null, expires_at integer, primary key (namespace, key));`,
  // Ideias locais (antes só existiam no documento do Google Drive).
  `create table ideas (
     id text primary key,
     text text not null,
     date_key text,
     reference text,
     source text not null default 'local',
     source_title text,
     done integer not null default 0,
     created_at text not null,
     modified_at text not null
   );
   create index ideas_date on ideas(date_key, created_at);`,
]

export class LocalDatabase {
  readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 3000;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('create table if not exists schema_migrations (version integer primary key, applied_at text not null)')
    const row = this.db.prepare('select coalesce(max(version), 0) as version from schema_migrations').get() as { version: number }
    for (let index = row.version; index < MIGRATIONS.length; index += 1) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[index]!)
        this.db.prepare('insert into schema_migrations (version, applied_at) values (?, ?)').run(index + 1, new Date().toISOString())
      })
    }
  }

  transaction<T>(work: () => T): T {
    this.db.exec('begin immediate')
    try {
      const result = work()
      this.db.exec('commit')
      return result
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[]
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params)
  }

  close(): void {
    this.db.close()
  }
}

/** Armazenamento chave-valor com expiração opcional, por espaço de nomes (caches e estados). */
export class KeyValueStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly namespace: string,
  ) {}

  get<T>(key: string): T | undefined {
    const row = this.database.get<{ value: string; expires_at: number | null }>(
      'select value, expires_at from kv where namespace = ? and key = ?',
      this.namespace,
      key,
    )
    if (!row) return undefined
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      this.delete(key)
      return undefined
    }
    return JSON.parse(row.value) as T
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.database.run(
      'insert into kv (namespace, key, value, expires_at) values (?, ?, ?, ?) on conflict(namespace, key) do update set value = excluded.value, expires_at = excluded.expires_at',
      this.namespace,
      key,
      JSON.stringify(value),
      ttlMs ? Date.now() + ttlMs : null,
    )
  }

  delete(key: string): void {
    this.database.run('delete from kv where namespace = ? and key = ?', this.namespace, key)
  }

  clear(): void {
    this.database.run('delete from kv where namespace = ?', this.namespace)
  }

  entries<T>(): [string, T][] {
    return this.database
      .all<{ key: string; value: string }>('select key, value from kv where namespace = ?', this.namespace)
      .map((row) => [row.key, JSON.parse(row.value) as T])
  }
}
