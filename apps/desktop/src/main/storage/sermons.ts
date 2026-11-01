import { normalizeForSearch, countWords } from '@pregar/core/util/text'
import { parseBrazilianDate } from '@pregar/core/util/dates'
import { parseReference, passageRelation } from '@pregar/core/bible/reference'
import type { ArchiveSearchMode, SermonPatch, SermonPreparationState, SermonRecord, SermonSummary } from '@shared/types'
import type { LocalDatabase } from './db'

interface SermonRow {
  date_key: string
  title: string
  liturgical_occasion: string | null
  liturgical_celebration: string | null
  liturgical_season: string | null
  prayer_book_id: string | null
  main_reading_reference: string | null
  main_reading_slot: string | null
  doc: string | null
  plain_text: string
  word_count: number
  tablet_pdf_path: string | null
  tablet_pdf_updated_at: string | null
  drive_draft_key: string | null
  drive_document_id: string | null
  drive_revision_id: string | null
  drive_synced_at: string | null
  drive_synced_content_hash: string | null
  drive_sync_error: string | null
  created_at: string
  modified_at: string
}

const COLUMNS: Record<string, keyof SermonRow> = {
  title: 'title',
  liturgicalOccasion: 'liturgical_occasion',
  liturgicalCelebration: 'liturgical_celebration',
  liturgicalSeason: 'liturgical_season',
  prayerBookId: 'prayer_book_id',
  mainReadingReference: 'main_reading_reference',
  mainReadingSlot: 'main_reading_slot',
  doc: 'doc',
  plainText: 'plain_text',
  wordCount: 'word_count',
  tabletPdfPath: 'tablet_pdf_path',
  tabletPdfUpdatedAt: 'tablet_pdf_updated_at',
}

const DRIVE_COLUMNS: Record<string, keyof SermonRow> = {
  draftKey: 'drive_draft_key',
  documentId: 'drive_document_id',
  revisionId: 'drive_revision_id',
  syncedAt: 'drive_synced_at',
  syncedContentHash: 'drive_synced_content_hash',
  syncError: 'drive_sync_error',
}

function toRecord(row: SermonRow): SermonRecord {
  return {
    dateKey: row.date_key,
    title: row.title,
    liturgicalOccasion: row.liturgical_occasion,
    liturgicalCelebration: row.liturgical_celebration,
    liturgicalSeason: row.liturgical_season,
    prayerBookId: row.prayer_book_id,
    mainReadingReference: row.main_reading_reference,
    mainReadingSlot: row.main_reading_slot,
    doc: row.doc,
    plainText: row.plain_text,
    wordCount: row.word_count,
    tabletPdfPath: row.tablet_pdf_path,
    tabletPdfUpdatedAt: row.tablet_pdf_updated_at,
    drive: {
      draftKey: row.drive_draft_key,
      documentId: row.drive_document_id,
      revisionId: row.drive_revision_id,
      syncedAt: row.drive_synced_at,
      syncedContentHash: row.drive_synced_content_hash,
      syncError: row.drive_sync_error,
    },
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  }
}

export function preparationState(row: Pick<SermonRow, 'word_count' | 'tablet_pdf_updated_at' | 'drive_synced_at'>): SermonPreparationState {
  if (row.tablet_pdf_updated_at || row.drive_synced_at) return 'exported'
  return row.word_count > 0 ? 'inProgress' : 'empty'
}

function toSummary(row: SermonRow, snippet?: string): SermonSummary {
  return {
    dateKey: row.date_key,
    title: row.title,
    liturgicalOccasion: row.liturgical_occasion,
    liturgicalCelebration: row.liturgical_celebration,
    liturgicalSeason: row.liturgical_season,
    mainReadingReference: row.main_reading_reference,
    wordCount: row.word_count,
    modifiedAt: row.modified_at,
    state: preparationState(row),
    driveSyncedAt: row.drive_synced_at,
    tabletPdfUpdatedAt: row.tablet_pdf_updated_at,
    ...(snippet ? { snippet } : {}),
  }
}

const SUMMARY_COLUMNS =
  'date_key, title, liturgical_occasion, liturgical_celebration, liturgical_season, main_reading_reference, word_count, modified_at, tablet_pdf_updated_at, drive_synced_at, plain_text'

export class SermonRepository {
  constructor(private readonly database: LocalDatabase) {}

  get(dateKey: string): SermonRecord | null {
    const row = this.database.get<SermonRow>('select * from sermons where date_key = ?', dateKey)
    return row ? toRecord(row) : null
  }

  save(dateKey: string, patch: SermonPatch, now = new Date()): SermonRecord {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Data de preparação inválida.')
    const timestamp = now.toISOString()
    return this.database.transaction(() => {
      const existing = this.database.get<SermonRow>('select * from sermons where date_key = ?', dateKey)
      if (!existing) {
        this.database.run('insert into sermons (date_key, created_at, modified_at) values (?, ?, ?)', dateKey, timestamp, timestamp)
      }
      const assignments: string[] = []
      const values: (string | number | null)[] = []
      const normalized: SermonPatch = { ...patch }
      if (normalized.plainText !== undefined && normalized.wordCount === undefined) {
        normalized.wordCount = countWords(normalized.plainText)
      }
      for (const [key, column] of Object.entries(COLUMNS)) {
        const value = (normalized as Record<string, unknown>)[key]
        if (value === undefined) continue
        assignments.push(`${column} = ?`)
        values.push(value as string | number | null)
      }
      for (const [key, column] of Object.entries(DRIVE_COLUMNS)) {
        const value = (normalized.drive as Record<string, unknown> | undefined)?.[key]
        if (value === undefined) continue
        assignments.push(`${column} = ?`)
        values.push(value as string | null)
      }
      const contentChanged = ['doc', 'plainText', 'title'].some((key) => (normalized as Record<string, unknown>)[key] !== undefined)
      if (contentChanged) {
        assignments.push('modified_at = ?')
        values.push(timestamp)
      }
      if (assignments.length > 0) {
        this.database.run(`update sermons set ${assignments.join(', ')} where date_key = ?`, ...values, dateKey)
      }
      const row = this.database.get<SermonRow>('select * from sermons where date_key = ?', dateKey)!
      if (contentChanged || !existing) {
        this.database.run('delete from sermons_fts where date_key = ?', dateKey)
        this.database.run('insert into sermons_fts (date_key, title, body) values (?, ?, ?)', dateKey, row.title, row.plain_text)
      }
      return toRecord(row)
    })
  }

  /** Todos os sermões completos (backup). */
  all(): SermonRecord[] {
    return this.database.all<SermonRow>('select * from sermons order by date_key').map(toRecord)
  }

  /** Substitui todos os sermões (restauração de backup), reconstruindo o índice de busca. */
  replaceAll(records: SermonRecord[]): void {
    this.database.transaction(() => {
      this.database.run('delete from sermons')
      this.database.run('delete from sermons_fts')
      for (const record of records) {
        this.database.run(
          `insert into sermons (date_key, title, liturgical_occasion, liturgical_celebration, liturgical_season, prayer_book_id,
            main_reading_reference, main_reading_slot, doc, plain_text, word_count, tablet_pdf_path, tablet_pdf_updated_at,
            drive_draft_key, drive_document_id, drive_revision_id, drive_synced_at, drive_synced_content_hash, drive_sync_error,
            created_at, modified_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          record.dateKey,
          record.title,
          record.liturgicalOccasion,
          record.liturgicalCelebration,
          record.liturgicalSeason,
          record.prayerBookId,
          record.mainReadingReference,
          record.mainReadingSlot,
          record.doc,
          record.plainText,
          record.wordCount || countWords(record.plainText),
          record.tabletPdfPath,
          record.tabletPdfUpdatedAt,
          record.drive.draftKey,
          record.drive.documentId,
          record.drive.revisionId,
          record.drive.syncedAt,
          record.drive.syncedContentHash,
          record.drive.syncError,
          record.createdAt,
          record.modifiedAt,
        )
        this.database.run('insert into sermons_fts (date_key, title, body) values (?, ?, ?)', record.dateKey, record.title, record.plainText)
      }
    })
  }

  list(): SermonSummary[] {
    return this.database
      .all<SermonRow>(`select ${SUMMARY_COLUMNS} from sermons where word_count > 0 or title <> '' order by date_key desc`)
      .map((row) => toSummary(row))
  }

  states(from: string, to: string): Record<string, SermonPreparationState> {
    const rows = this.database.all<SermonRow>(
      'select date_key, word_count, tablet_pdf_updated_at, drive_synced_at from sermons where date_key between ? and ?',
      from,
      to,
    )
    return Object.fromEntries(rows.map((row) => [row.date_key, preparationState(row)]))
  }

  search(mode: ArchiveSearchMode, query: string): SermonSummary[] {
    const trimmed = query.trim()
    if (!trimmed) return this.list()
    const all = this.database.all<SermonRow>(`select ${SUMMARY_COLUMNS} from sermons where word_count > 0 or title <> '' order by date_key desc`)
    const needle = normalizeForSearch(trimmed)
    switch (mode) {
      case 'passage': {
        const target = parseReference(trimmed)
        return all
          .filter((row) => {
            const reference = row.main_reading_reference ?? ''
            if (target) {
              const candidate = parseReference(reference)
              if (candidate && passageRelation(candidate, target)) return true
            }
            return normalizeForSearch(reference).includes(needle)
          })
          .map((row) => toSummary(row))
      }
      case 'occasion':
        return all
          .filter((row) =>
            [row.liturgical_occasion, row.liturgical_celebration, row.liturgical_season, row.title].some((value) =>
              normalizeForSearch(value ?? '').includes(needle),
            ),
          )
          .map((row) => toSummary(row))
      case 'date': {
        const key = parseBrazilianDate(trimmed) ?? trimmed
        const partial = /^(\d{1,2})\/(\d{4})$/.exec(trimmed)
        const prefix = partial ? `${partial[2]}-${partial[1]!.padStart(2, '0')}` : key
        return all.filter((row) => row.date_key.startsWith(prefix)).map((row) => toSummary(row))
      }
      case 'text': {
        const terms = trimmed
          .split(/\s+/)
          .map((term) => term.replace(/"/g, ''))
          .filter(Boolean)
          .map((term) => `"${term}"*`)
          .join(' ')
        if (!terms) return []
        const matches = this.database.all<{ date_key: string; snippet: string }>(
          "select date_key, snippet(sermons_fts, 2, '«', '»', '…', 14) as snippet from sermons_fts where sermons_fts match ? order by rank limit 200",
          terms,
        )
        const byKey = new Map(all.map((row) => [row.date_key, row]))
        return matches
          .map((match) => {
            const row = byKey.get(match.date_key)
            return row ? toSummary(row, match.snippet) : null
          })
          .filter((item): item is SermonSummary => item !== null)
      }
    }
  }
}
