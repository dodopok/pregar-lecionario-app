import type { SermonReviewReportPersistence } from '@pregar/core/ai'
import type { SermonReviewReport } from '@pregar/core/ai'
import type { LocalDatabase } from './db'

/** Relatórios de revisão por data do sermão (sem o manuscrito completo, como no Swift). */
export class ReviewReportRepository implements SermonReviewReportPersistence {
  constructor(private readonly database: LocalDatabase) {}

  async load(dateKey: string): Promise<unknown> {
    const row = this.database.get<{ payload: string }>('select payload from review_reports where date_key = ?', dateKey)
    return row ? (JSON.parse(row.payload) as unknown) : null
  }

  async save(dateKey: string, reports: SermonReviewReport[]): Promise<void> {
    this.database.run(
      'insert into review_reports (date_key, payload, updated_at) values (?, ?, ?) on conflict(date_key) do update set payload = excluded.payload, updated_at = excluded.updated_at',
      dateKey,
      JSON.stringify(reports),
      new Date().toISOString(),
    )
  }

  all(): Record<string, unknown[]> {
    const rows = this.database.all<{ date_key: string; payload: string }>('select date_key, payload from review_reports')
    return Object.fromEntries(rows.map((row) => [row.date_key, JSON.parse(row.payload) as unknown[]]))
  }

  replaceAll(reports: Record<string, unknown[]>): void {
    this.database.transaction(() => {
      this.database.run('delete from review_reports')
      for (const [dateKey, list] of Object.entries(reports)) {
        this.database.run('insert into review_reports (date_key, payload, updated_at) values (?, ?, ?)', dateKey, JSON.stringify(list), new Date().toISOString())
      }
    })
  }
}
