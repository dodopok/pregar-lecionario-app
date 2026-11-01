import { z } from 'zod'
import { createRevisionSnapshot, SermonHistoryStore } from '@pregar/core/history'
import type { HistoryStorage, SermonRevision } from '@pregar/core/history'
import type { SermonSnapshotInput } from '@shared/ipc-content'
import type { MainContext } from '../../context'
import { handle, UserFacingError } from '../../ipc/router'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const snapshotSchema = z.object({
  title: z.string().max(500),
  mainReadingReference: z.string().max(200).nullable(),
  mainReadingSlot: z.string().max(60).nullable(),
  doc: z.string().max(20_000_000),
  plainText: z.string().max(5_000_000),
})

/** Histórico de versões no SQLite: uma linha por versão, com retenção das 100 mais recentes. */
class SqliteHistoryStorage implements HistoryStorage {
  constructor(private readonly context: MainContext) {}

  async list(key: string): Promise<SermonRevision[]> {
    return this.context.database
      .all<{ payload: string }>('select payload from sermon_revisions where date_key = ? order by version', key)
      .map((row) => JSON.parse(row.payload) as SermonRevision)
  }

  async save(key: string, revisions: SermonRevision[]): Promise<void> {
    const { database } = this.context
    database.transaction(() => {
      database.run('delete from sermon_revisions where date_key = ?', key)
      for (const revision of revisions) {
        database.run(
          'insert into sermon_revisions (id, date_key, version, payload, created_at) values (?, ?, ?, ?, ?)',
          revision.id,
          key,
          revision.version,
          JSON.stringify(revision),
          revision.createdAt,
        )
      }
    })
  }
}

function snapshot(input: SermonSnapshotInput) {
  return createRevisionSnapshot({
    title: input.title,
    mainReadingReference: input.mainReadingReference,
    mainReadingSlot: input.mainReadingSlot,
    content: { format: 'tiptap-json', data: input.doc },
    plainText: input.plainText,
  })
}

export function registerHistory(context: MainContext): void {
  const store = new SermonHistoryStore(new SqliteHistoryStorage(context))

  handle('history:list', ({ dateKey: key }) => store.revisions(dateKey.parse(key)))
  handle('history:capture', ({ dateKey: key, snapshot: input, force }) =>
    store.capture(snapshot(snapshotSchema.parse(input)), dateKey.parse(key), force ? { force: true } : {}),
  )
  handle('history:restore', async ({ dateKey: key, revisionId, current }, event) => {
    const day = dateKey.parse(key)
    const revisions = await store.revisions(day)
    const revision = revisions.find((item) => item.id === revisionId)
    if (!revision) throw new UserFacingError('Esta versão não existe mais no histórico.')
    if (revision.content?.format === 'rtf') {
      throw new UserFacingError('Esta versão veio do app antigo e precisa ser convertida pela importação do backup.')
    }
    let record = context.sermons.get(day)
    const updated = await store.restore(day, revision, snapshot(snapshotSchema.parse(current)), (restored) => {
      record = context.sermons.save(day, {
        title: restored.title,
        mainReadingReference: restored.mainReadingReference,
        mainReadingSlot: restored.mainReadingSlot,
        doc: restored.content?.data ?? null,
        plainText: restored.plainText,
        wordCount: restored.wordCount,
      })
    })
    context.windows.broadcast('sermon:changed', { dateKey: day, origin: event.sender.id })
    return { record: record!, revisions: updated }
  })
}
