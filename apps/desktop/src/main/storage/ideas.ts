import { randomUUID } from 'node:crypto'
import type { Idea, IdeaInput, IdeaPatch, IdeaSource } from '@shared/ipc-ideas'
import type { LocalDatabase } from './db'

interface IdeaRow {
  id: string
  text: string
  date_key: string | null
  reference: string | null
  source: string
  source_title: string | null
  done: number
  created_at: string
  modified_at: string
}

const SOURCES: IdeaSource[] = ['local', 'drive', 'reading', 'material', 'bible', 'reader']

function toIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    text: row.text,
    dateKey: row.date_key,
    reference: row.reference,
    source: (SOURCES as string[]).includes(row.source) ? (row.source as IdeaSource) : 'local',
    sourceTitle: row.source_title,
    done: row.done === 1,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  }
}

export const IDEA_MAX_LENGTH = 4000

/** Ideias guardadas no banco local (a aba Ideias da Mesa não depende mais do Google Drive). */
export class IdeaRepository {
  constructor(private readonly database: LocalDatabase) {}

  list(options: { dateKey?: string | null; includeLoose?: boolean; includeDone?: boolean } = {}): Idea[] {
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (options.dateKey) {
      if (options.includeLoose) {
        clauses.push('(date_key = ? or date_key is null)')
      } else {
        clauses.push('date_key = ?')
      }
      params.push(options.dateKey)
    } else if (options.dateKey === null) {
      clauses.push('date_key is null')
    }
    if (!options.includeDone) clauses.push('done = 0')
    const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''
    return this.database
      .all<IdeaRow>(`select * from ideas ${where} order by done asc, created_at desc`, ...params)
      .map(toIdea)
  }

  get(id: string): Idea | null {
    const row = this.database.get<IdeaRow>('select * from ideas where id = ?', id)
    return row ? toIdea(row) : null
  }

  add(input: IdeaInput, now = new Date()): Idea {
    const text = input.text.trim()
    if (!text) throw new Error('Escreva a ideia antes de guardar.')
    const id = randomUUID()
    const timestamp = now.toISOString()
    this.database.run(
      `insert into ideas (id, text, date_key, reference, source, source_title, done, created_at, modified_at)
       values (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      text.slice(0, IDEA_MAX_LENGTH),
      input.dateKey ?? null,
      input.reference ?? null,
      input.source ?? 'local',
      input.sourceTitle ?? null,
      timestamp,
      timestamp,
    )
    return this.get(id)!
  }

  update(id: string, patch: IdeaPatch, now = new Date()): Idea {
    const existing = this.get(id)
    if (!existing) throw new Error('Essa ideia já não existe.')
    const assignments: string[] = []
    const values: (string | number | null)[] = []
    if (patch.text !== undefined) {
      const text = patch.text.trim()
      if (!text) throw new Error('A ideia não pode ficar vazia.')
      assignments.push('text = ?')
      values.push(text.slice(0, IDEA_MAX_LENGTH))
    }
    if (patch.dateKey !== undefined) {
      assignments.push('date_key = ?')
      values.push(patch.dateKey)
    }
    if (patch.reference !== undefined) {
      assignments.push('reference = ?')
      values.push(patch.reference)
    }
    if (patch.done !== undefined) {
      assignments.push('done = ?')
      values.push(patch.done ? 1 : 0)
    }
    if (assignments.length === 0) return existing
    assignments.push('modified_at = ?')
    values.push(now.toISOString())
    this.database.run(`update ideas set ${assignments.join(', ')} where id = ?`, ...values, id)
    return this.get(id)!
  }

  delete(id: string): void {
    this.database.run('delete from ideas where id = ?', id)
  }

  /** Liga ideias soltas (ou de outra data) à preparação indicada. */
  adopt(ids: string[], dateKey: string, now = new Date()): Idea[] {
    const timestamp = now.toISOString()
    this.database.transaction(() => {
      for (const id of ids)
        this.database.run(
          'update ideas set date_key = ?, modified_at = ? where id = ?',
          dateKey,
          timestamp,
          id,
        )
    })
    return this.list({ dateKey })
  }

  /** Todas as ideias, para o backup. */
  all(): Idea[] {
    return this.database.all<IdeaRow>('select * from ideas order by created_at').map(toIdea)
  }

  /** Substitui todas as ideias (restauração de backup). */
  replaceAll(ideas: Idea[]): void {
    this.database.transaction(() => {
      this.database.run('delete from ideas')
      for (const idea of ideas) {
        this.database.run(
          `insert into ideas (id, text, date_key, reference, source, source_title, done, created_at, modified_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          idea.id,
          idea.text,
          idea.dateKey,
          idea.reference,
          idea.source,
          idea.sourceTitle,
          idea.done ? 1 : 0,
          idea.createdAt,
          idea.modifiedAt,
        )
      }
    })
  }
}
