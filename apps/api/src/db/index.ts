import { Kysely, PostgresDialect } from 'kysely'
import { Migrator } from 'kysely/migration'
import type { Migration, MigrationProvider } from 'kysely/migration'
import pg from 'pg'
import type { Database } from './schema'
import * as initial from './migrations/0001_initial'

// Datas em timestamptz voltam como Date; numeric continua string (precisão do custo).
const migrations: Record<string, Migration> = {
  '0001_initial': initial,
}

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations
  }
}

export interface DatabaseOptions {
  connectionString: string
  ssl?: boolean
  max?: number
}

export function createDatabase(options: DatabaseOptions): { db: Kysely<Database>; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'pregar-api',
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool }
}

export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() })
  const { error, results } = await migrator.migrateToLatest()
  const applied = (results ?? []).filter((item: { status: string }) => item.status === 'Success').map((item: { migrationName: string }) => item.migrationName)
  if (error) throw error instanceof Error ? error : new Error(String(error))
  return applied
}

export type { Database }
