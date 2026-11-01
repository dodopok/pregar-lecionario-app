import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_IDLE_DELAY_MS,
  HISTORY_RETENTION_LIMIT,
  HistoryCaptureScheduler,
  MemoryHistoryStorage,
  SermonHistoryStore,
  comparisonColumns,
  createRevisionSnapshot,
  currentVersionNumber,
  historyButtonLabel,
  isHistoryDirty,
  previousRevisions,
  sermonRevisionListSchema,
  snapshotsMatch,
  statusBarVersionNumber,
} from '../../src/history'
import type { HistoryStorage, SermonRevision, SnapshotInput } from '../../src/history'

const DATE = '2026-10-04'

function tiptap(text: string) {
  return {
    format: 'tiptap-json' as const,
    data: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }),
  }
}

function snapshot(text: string, extra: Partial<SnapshotInput> = {}) {
  return createRevisionSnapshot({
    title: 'Mateus 21',
    mainReadingReference: 'Mateus 21.33-46',
    mainReadingSlot: 'gospel',
    content: tiptap(text),
    plainText: text,
    ...extra,
  })
}

function clock(start = Date.UTC(2026, 9, 4, 12)) {
  let current = start
  return () => new Date((current += 1000))
}

describe('histórico de versões', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('grava versões distintas, deduplica conteúdo idêntico e relê após reabrir o armazenamento', async () => {
    const storage = new MemoryHistoryStorage()
    const first = snapshot('primeira versão')
    const edited = snapshot('versão revisada')

    const store = new SermonHistoryStore(storage, { now: clock() })
    const firstSave = await store.capture(first, DATE)
    const duplicateSave = await store.capture(first, DATE)
    const secondSave = await store.capture(edited, DATE, { summary: 'Edição salva' })
    const reopened = new SermonHistoryStore(storage)
    const loaded = await reopened.revisions(DATE)

    expect(firstSave.map((revision) => revision.version)).toEqual([1])
    expect(duplicateSave.map((revision) => revision.version)).toEqual([1])
    expect(secondSave.map((revision) => revision.version)).toEqual([1, 2])
    expect(loaded.map((revision) => revision.version)).toEqual([1, 2])
    expect(loaded.at(-1)?.content).toEqual(edited.content)
    expect(loaded.at(-1)?.wordCount).toBe(2)
    expect(sermonRevisionListSchema.safeParse(loaded).success).toBe(true)
  })

  it('restauração explícita cria versão mesmo com conteúdo inalterado', async () => {
    const empty = createRevisionSnapshot({ title: '', content: null })
    const store = new SermonHistoryStore(new MemoryHistoryStorage())

    await store.capture(empty, DATE)
    const restored = await store.capture(empty, DATE, { summary: 'Restaurada de v1', force: true })

    expect(restored.map((revision) => revision.version)).toEqual([1, 2])
    expect(restored.at(-1)?.summary).toBe('Restaurada de v1')
  })

  it('restaurar preserva a edição em curso e sempre numera uma versão nova', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage(), { now: clock() })
    const [v1] = await store.capture(snapshot('texto original'), DATE)
    await store.capture(snapshot('texto revisado'), DATE)
    const current = snapshot('edição ainda não salva')
    const applied: string[] = []

    const revisions = await store.restore(DATE, v1!, current, (restored) => {
      applied.push(restored.plainText)
    })

    expect(applied).toEqual(['texto original'])
    expect(revisions.map((revision) => [revision.version, revision.summary])).toEqual([
      [1, 'Edição salva'],
      [2, 'Edição salva'],
      [3, 'Antes da restauração'],
      [4, 'Restaurada de v1'],
    ])
    expect(revisions[2]?.plainText).toBe('edição ainda não salva')
    expect(snapshotsMatch(revisions[3]!, v1!)).toBe(true)
  })

  it('não duplica "Antes da restauração" quando a edição já está salva', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    const [v1] = await store.capture(snapshot('a'), DATE)
    const latest = await store.capture(snapshot('b'), DATE)

    const revisions = await store.restore(DATE, v1!, latest.at(-1)!, () => {})

    expect(revisions.map((revision) => revision.summary)).toEqual([
      'Edição salva',
      'Edição salva',
      'Restaurada de v1',
    ])
  })

  it('mantém só as 100 versões mais recentes e continua a numeração', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    let revisions: SermonRevision[] = []
    for (let index = 1; index <= HISTORY_RETENTION_LIMIT + 5; index += 1) {
      revisions = await store.capture(snapshot(`versão ${index}`), DATE)
    }
    expect(revisions).toHaveLength(100)
    expect(revisions[0]?.version).toBe(6)
    expect(revisions.at(-1)?.version).toBe(105)
    const next = await store.capture(snapshot('mais uma'), DATE)
    expect(next.at(-1)?.version).toBe(106)
  })

  it('serializa capturas simultâneas da mesma data', async () => {
    const inner = new MemoryHistoryStorage()
    const slow: HistoryStorage = {
      list: async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return inner.list(key)
      },
      save: (key, revisions) => inner.save(key, revisions),
    }
    const store = new SermonHistoryStore(slow)
    await Promise.all([store.capture(snapshot('a'), DATE), store.capture(snapshot('b'), DATE)])
    expect((await store.revisions(DATE)).map((revision) => revision.version)).toEqual([1, 2])
  })

  it('carrega snapshots RTF herdados e ordena por versão', async () => {
    const storage = new MemoryHistoryStorage()
    const rtf = createRevisionSnapshot({
      title: 'Antigo',
      content: { format: 'rtf', data: '{\\rtf1 texto}' },
      wordCount: 1,
    })
    const store = new SermonHistoryStore(storage)
    await store.capture(rtf, DATE)
    await store.capture(snapshot('novo'), DATE)
    storage.files.set(DATE, [...(await storage.list(DATE))].reverse())

    const loaded = await store.revisions(DATE)
    expect(loaded.map((revision) => revision.content?.format)).toEqual(['rtf', 'tiptap-json'])
    expect(loaded[0]?.wordCount).toBe(1)
  })

  it('rejeita datas fora do formato yyyy-MM-dd', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    await expect(store.revisions('04/10/2026')).rejects.toThrow()
  })

  it('snapshot é imutável e conta palavras do texto simples', () => {
    const value = snapshot('Anotação escrita com cuidado.')
    expect(value.wordCount).toBe(4)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.content)).toBe(true)
  })
})

describe('captura após inatividade', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('captura o snapshot congelado no agendamento, 12 s depois da última edição', async () => {
    vi.useFakeTimers()
    const storage = new MemoryHistoryStorage()
    const store = new SermonHistoryStore(storage)
    const captured: SermonRevision[][] = []
    const scheduler = new HistoryCaptureScheduler(store, {
      onCaptured: (_, revisions) => captured.push(revisions),
    })

    const draft = { title: 'Mateus 21', text: 'primeiro rascunho' }
    scheduler.schedule(DATE, snapshot(draft.text, { title: draft.title }))
    await vi.advanceTimersByTimeAsync(HISTORY_IDLE_DELAY_MS - 1000)
    draft.text = 'segundo rascunho'
    scheduler.schedule(DATE, snapshot(draft.text, { title: draft.title }))
    draft.text = 'alterado depois do agendamento'
    await vi.advanceTimersByTimeAsync(HISTORY_IDLE_DELAY_MS - 1)
    expect(captured).toHaveLength(0)
    expect(scheduler.isPending).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    expect(scheduler.isPending).toBe(false)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.map((revision) => revision.plainText)).toEqual(['segundo rascunho'])
  })

  it('cancelar descarta a captura pendente e flush grava imediatamente', async () => {
    vi.useFakeTimers()
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    const scheduler = new HistoryCaptureScheduler(store)

    scheduler.schedule(DATE, snapshot('descartada'))
    scheduler.cancel()
    await vi.advanceTimersByTimeAsync(HISTORY_IDLE_DELAY_MS * 2)
    expect(await store.revisions(DATE)).toEqual([])

    scheduler.schedule(DATE, snapshot('imediata'))
    const flushed = await scheduler.flush()
    expect(flushed?.map((revision) => revision.plainText)).toEqual(['imediata'])
    await vi.advanceTimersByTimeAsync(HISTORY_IDLE_DELAY_MS)
    expect(await store.revisions(DATE)).toHaveLength(1)
  })

  it('relata falha de gravação com a mensagem do app', async () => {
    const failing: HistoryStorage = {
      list: async () => [],
      save: async () => {
        throw new Error('disco cheio')
      },
    }
    const messages: string[] = []
    const scheduler = new HistoryCaptureScheduler(new SermonHistoryStore(failing), {
      onError: (_, message) => messages.push(message),
    })
    scheduler.schedule(DATE, snapshot('x'))
    expect(await scheduler.flush()).toBeNull()
    expect(messages).toEqual(['Não foi possível salvar uma versão local: disco cheio'])
  })
})

describe('apresentação do histórico', () => {
  it('numera a edição em curso e lista as anteriores sem repetir a atual', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    await store.capture(snapshot('um'), DATE)
    const revisions = await store.capture(snapshot('dois'), DATE)

    const saved = snapshot('dois')
    expect(currentVersionNumber(revisions, saved)).toBe(2)
    expect(isHistoryDirty(revisions, saved)).toBe(false)
    expect(previousRevisions(revisions, saved).map((revision) => revision.version)).toEqual([1])

    const editing = snapshot('três')
    expect(currentVersionNumber(revisions, editing)).toBe(3)
    expect(isHistoryDirty(revisions, editing)).toBe(true)
    expect(previousRevisions(revisions, editing).map((revision) => revision.version)).toEqual([2, 1])

    expect(currentVersionNumber([], editing)).toBe(1)
    expect(isHistoryDirty([], editing)).toBe(false)
    expect(statusBarVersionNumber([], true)).toBe(1)
    expect(statusBarVersionNumber(revisions, true)).toBe(3)
    expect(historyButtonLabel(3)).toBe('v3 · histórico')
  })

  it('monta as colunas da comparação lado a lado', async () => {
    const store = new SermonHistoryStore(new MemoryHistoryStorage())
    const [v1] = await store.capture(createRevisionSnapshot({ title: 'Vazio', content: null }), DATE)
    const [left, right] = comparisonColumns(snapshot('texto atual'), 2, v1!)
    expect(left).toEqual({ title: 'v2 · edição atual', text: 'texto atual', isEmpty: false })
    expect(right).toEqual({
      title: 'v1 · Edição salva',
      text: 'Esta versão não contém texto.',
      isEmpty: true,
    })
  })
})
