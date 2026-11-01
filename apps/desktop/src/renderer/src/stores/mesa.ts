import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { BiblePassageText, LiturgicalDay, LiturgicalReading } from '@pregar/core/liturgy/types'
import { readingId } from '@pregar/core/liturgy/types'
import type { SermonRevision } from '@pregar/core/history'
import type { SermonReviewReport } from '@pregar/core/ai'
import { countWords } from '@pregar/core/util/text'
import { addDays, dateKey, parseDateKey } from '@pregar/core/util/dates'
import type { SermonPatch, SermonPreparationState, SermonRecord } from '@shared/types'
import type { SermonSnapshotInput } from '@shared/ipc-content'
import { invoke, errorMessage, on } from '@/lib/api'
import { editorRichDocument } from '@/lib/editorBridge'
import { useAppStore } from './app'

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

const SAVE_PAUSE_MS = 350
const SAVE_MAX_MS = 2000
const HISTORY_DELAY_MS = 12_000
const DRIVE_DELAY_MS = 2000

/**
 * Estado da preparação aberta na Mesa: data, dia litúrgico, sermão (salvamento agrupado igual ao
 * app Swift: 350 ms de pausa, no máximo 2 s durante digitação contínua), histórico e Drive.
 */
export const useMesaStore = defineStore('mesa', () => {
  const app = useAppStore()
  const selectedDateKey = ref(dateKey(new Date()))
  const calendarMonth = ref(selectedDateKey.value.slice(0, 7))
  const day = shallowRef<LiturgicalDay | null>(null)
  const dayLoading = ref(false)
  const dayError = ref<string | null>(null)
  const record = shallowRef<SermonRecord | null>(null)
  const saveState = ref<SaveState>('saved')
  const saveError = ref<string | null>(null)
  const wordCount = ref(0)
  const revisions = shallowRef<SermonRevision[]>([])
  const historyDirty = ref(false)
  const reviews = shallowRef<SermonReviewReport[]>([])
  const states = ref<Record<string, SermonPreparationState>>({})
  const selectedBible = ref(app.settings.liturgy.bible)
  const alternativeTexts = ref<Record<string, Record<string, BiblePassageText>>>({})
  const loadingBibles = ref<Set<string>>(new Set())
  /** Versão do documento carregada no editor; muda quando outra janela ou uma restauração troca o texto. */
  const documentRevision = ref(0)
  const focusMode = ref(false)
  const contextTab = ref<'materials' | 'ideas' | 'review'>('materials')
  const activeSheet = ref<null | 'review' | 'questions' | 'tablet' | 'history' | 'rehearsal' | 'drive' | 'shortcuts' | 'commands' | 'onboarding'>(null)
  const reviewCriteriaPreset = ref<string[]>(['spelling', 'fidelity', 'structure', 'clarity', 'tone'])

  /** Leitura preguiçosa do conteúdo: o JSON só é serializado na gravação, não a cada tecla. */
  let pending: (() => { doc: string; plainText: string }) | null = null
  let pauseTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let historyTimer: ReturnType<typeof setTimeout> | null = null
  let driveTimer: ReturnType<typeof setTimeout> | null = null
  let dayRequest = 0

  const isSunday = computed(() => Boolean(day.value?.isSunday) || parseDateKey(selectedDateKey.value)?.getDay() === 0)
  const occasion = computed(() => day.value?.sundayName ?? day.value?.celebration?.name ?? day.value?.season?.name ?? null)
  const mainReference = computed(() => record.value?.mainReadingReference ?? '')
  const currentVersion = computed(() => Math.max(1, (revisions.value.at(-1)?.version ?? 0) + (historyDirty.value ? 1 : 0)))

  async function loadDay(): Promise<void> {
    const key = selectedDateKey.value
    const request = (dayRequest += 1)
    dayLoading.value = true
    dayError.value = null
    try {
      const loaded = await invoke('liturgy:day', { dateKey: key })
      if (request !== dayRequest) return
      day.value = loaded
      if (loaded.color && loaded.color !== app.settings.liturgy.lastColor) {
        void app.updateSettings({ liturgy: { lastColor: loaded.color } })
      }
      app.applyLiturgicalColor(loaded.color ?? null)
      void persistLiturgicalMetadata(loaded)
    } catch (error) {
      if (request !== dayRequest) return
      dayError.value = errorMessage(error)
      day.value = null
    } finally {
      if (request === dayRequest) dayLoading.value = false
    }
  }

  /** Guarda ocasião, celebração e tempo no sermão para o Arquivo, sem trocar título nem leitura principal. */
  async function persistLiturgicalMetadata(loaded: LiturgicalDay): Promise<void> {
    if (!record.value || record.value.dateKey !== loaded.date) return
    const patch = {
      liturgicalOccasion: loaded.sundayName ?? null,
      liturgicalCelebration: loaded.celebration?.name ?? null,
      liturgicalSeason: loaded.season?.name ?? null,
      prayerBookId: app.settings.liturgy.prayerBook,
    }
    const current = record.value
    if (
      current.liturgicalOccasion === patch.liturgicalOccasion &&
      current.liturgicalCelebration === patch.liturgicalCelebration &&
      current.liturgicalSeason === patch.liturgicalSeason &&
      current.prayerBookId === patch.prayerBookId
    ) {
      return
    }
    record.value = await invoke('sermons:save', { dateKey: loaded.date, patch })
  }

  async function loadRecord(): Promise<void> {
    const key = selectedDateKey.value
    const loaded = await invoke('sermons:get', { dateKey: key })
    if (key !== selectedDateKey.value) return
    record.value = loaded ?? (await invoke('sermons:save', { dateKey: key, patch: {} }))
    wordCount.value = record.value.wordCount
    documentRevision.value += 1
    saveState.value = 'saved'
    if (day.value && day.value.date === key) void persistLiturgicalMetadata(day.value)
  }

  async function loadSideData(): Promise<void> {
    const key = selectedDateKey.value
    const [loadedRevisions, loadedReviews] = await Promise.all([
      invoke('history:list', { dateKey: key }).catch(() => [] as SermonRevision[]),
      invoke('reviews:list', { dateKey: key }).catch(() => [] as SermonReviewReport[]),
    ])
    if (key !== selectedDateKey.value) return
    revisions.value = loadedRevisions
    reviews.value = loadedReviews
    const latest = loadedRevisions.at(-1)
    historyDirty.value = Boolean(record.value && record.value.wordCount > 0 && (!latest || latest.plainText !== record.value.plainText))
  }

  async function loadStates(): Promise<void> {
    const [year, month] = calendarMonth.value.split('-').map(Number)
    const from = dateKey(addDays(new Date(year!, month! - 1, 1), -7))
    const to = dateKey(addDays(new Date(year!, month!, 0), 14))
    states.value = await invoke('sermons:states', { from, to }).catch(() => ({}))
  }

  async function selectDate(key: string): Promise<void> {
    if (!parseDateKey(key)) return
    await flush()
    cancelTimers()
    selectedDateKey.value = key
    if (calendarMonth.value !== key.slice(0, 7)) calendarMonth.value = key.slice(0, 7)
    alternativeTexts.value = {}
    selectedBible.value = app.settings.liturgy.bible
    revisions.value = []
    reviews.value = []
    historyDirty.value = false
    await Promise.all([loadRecord(), loadDay()])
    void loadSideData()
    void loadStates()
  }

  function cancelTimers(): void {
    for (const timer of [historyTimer, driveTimer]) if (timer) clearTimeout(timer)
    historyTimer = null
    driveTimer = null
  }

  /** Chamado pelo editor a cada mudança de conteúdo; `read` só é chamado quando o texto é gravado. */
  function contentChanged(read: () => { doc: string; plainText: string }, words?: number): void {
    pending = read
    if (words !== undefined) wordCount.value = words
    saveState.value = 'pending'
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = setTimeout(() => void flush(), SAVE_PAUSE_MS)
    if (!maxTimer) maxTimer = setTimeout(() => void flush(), SAVE_MAX_MS)
  }

  async function flush(): Promise<void> {
    if (pauseTimer) clearTimeout(pauseTimer)
    if (maxTimer) clearTimeout(maxTimer)
    pauseTimer = null
    maxTimer = null
    if (!pending || !record.value) return
    const key = record.value.dateKey
    const read = pending
    pending = null
    const payload = read()
    wordCount.value = countWords(payload.plainText)
    saveState.value = 'saving'
    try {
      record.value = await invoke('sermons:save', { dateKey: key, patch: { doc: payload.doc, plainText: payload.plainText } })
      saveState.value = pending ? 'pending' : 'saved'
      saveError.value = null
      historyDirty.value = true
      scheduleHistory()
      scheduleDriveSync()
      if (record.value.wordCount > 0 && states.value[key] !== 'exported') states.value = { ...states.value, [key]: 'inProgress' }
    } catch (error) {
      pending = pending ?? (() => payload)
      saveState.value = 'error'
      saveError.value = errorMessage(error)
    }
  }

  function snapshotInput(): SermonSnapshotInput | null {
    const current = record.value
    if (!current?.doc) return null
    return {
      title: current.title,
      mainReadingReference: current.mainReadingReference,
      mainReadingSlot: current.mainReadingSlot,
      doc: current.doc,
      plainText: current.plainText,
    }
  }

  function scheduleHistory(): void {
    if (historyTimer) clearTimeout(historyTimer)
    // O snapshot é capturado agora, antes do atraso, como no app Swift.
    const snapshot = snapshotInput()
    const key = selectedDateKey.value
    if (!snapshot) return
    historyTimer = setTimeout(async () => {
      try {
        const updated = await invoke('history:capture', { dateKey: key, snapshot })
        if (key === selectedDateKey.value) {
          revisions.value = updated
          historyDirty.value = false
        }
      } catch {
        // Falha no histórico não interrompe a escrita; a próxima pausa tenta de novo.
      }
    }, HISTORY_DELAY_MS)
  }

  function scheduleDriveSync(): void {
    if (driveTimer) clearTimeout(driveTimer)
    if (!record.value?.drive.documentId) return
    const key = selectedDateKey.value
    driveTimer = setTimeout(async () => {
      const document = editorRichDocument(record.value?.title)
      if (!document || key !== selectedDateKey.value) return
      const result = await invoke('drive:sync', { dateKey: key, document }).catch(() => null)
      if (result?.record && key === selectedDateKey.value) record.value = { ...result.record, doc: record.value?.doc ?? result.record.doc }
    }, DRIVE_DELAY_MS)
  }

  async function updateRecord(patch: SermonPatch): Promise<void> {
    if (!record.value) return
    await flush()
    record.value = await invoke('sermons:save', { dateKey: record.value.dateKey, patch })
  }

  /** Escolhe (ou desmarca) a leitura principal; o título acompanha enquanto não for editado. */
  async function chooseMainReading(reading: LiturgicalReading): Promise<void> {
    const current = record.value
    if (!current) return
    if (current.mainReadingReference === reading.reference && current.mainReadingSlot === reading.slot) {
      await updateRecord({ mainReadingReference: null, mainReadingSlot: null })
      return
    }
    const titleFollows = !current.title || current.title === current.mainReadingReference
    await updateRecord({
      mainReadingReference: reading.reference,
      mainReadingSlot: reading.slot,
      ...(titleFollows ? { title: reading.reference } : {}),
    })
  }

  async function loadTranslation(bible: string): Promise<void> {
    selectedBible.value = bible
    if (bible === app.settings.liturgy.bible || !day.value) return
    const missing = (day.value.readings ?? []).filter((reading) => !alternativeTexts.value[bible]?.[readingId(reading)])
    if (missing.length === 0 || loadingBibles.value.has(bible)) return
    loadingBibles.value = new Set([...loadingBibles.value, bible])
    try {
      for (const reading of missing) {
        try {
          const text = await invoke('liturgy:passage', { reference: reading.reference, bible })
          alternativeTexts.value = {
            ...alternativeTexts.value,
            [bible]: { ...(alternativeTexts.value[bible] ?? {}), [readingId(reading)]: text },
          }
        } catch {
          continue
        }
      }
    } finally {
      const next = new Set(loadingBibles.value)
      next.delete(bible)
      loadingBibles.value = next
    }
  }

  function openSheet(sheet: NonNullable<typeof activeSheet.value>): void {
    void flush()
    activeSheet.value = sheet
  }

  function requestReview(criteria: string[] = ['spelling', 'fidelity', 'structure', 'clarity', 'tone']): void {
    reviewCriteriaPreset.value = criteria
    contextTab.value = 'review'
    if (!app.settings.panels.materialsOpen) void app.updateSettings({ panels: { materialsOpen: true } })
    openSheet('review')
  }

  function initialize(): void {
    const requested = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('date')
    void selectDate(requested && parseDateKey(requested) ? requested : selectedDateKey.value)
    on('sermon:changed', async ({ dateKey: changed, origin }) => {
      void loadStates()
      if (changed !== selectedDateKey.value || origin === -1) return
      // Mudança feita por outra janela (restauração, Drive, tablet): recarrega sem perder digitação pendente.
      const fresh = await invoke('sermons:get', { dateKey: changed })
      if (!fresh || pending) return
      const docChanged = fresh.doc !== record.value?.doc
      record.value = fresh
      if (docChanged) documentRevision.value += 1
    })
    let liturgyKey = JSON.stringify([app.settings.liturgy.prayerBook, app.settings.liturgy.language, app.settings.liturgy.bible, app.settings.liturgy.readingType])
    on('settings:changed', (next) => {
      const key = JSON.stringify([next.liturgy.prayerBook, next.liturgy.language, next.liturgy.bible, next.liturgy.readingType])
      if (key !== liturgyKey) {
        liturgyKey = key
        alternativeTexts.value = {}
        selectedBible.value = next.liturgy.bible
        void loadDay()
      }
    })
    on('account:changed', () => {
      if (!day.value) void loadDay()
    })
    // Ao fechar a janela ou sair do app, o processo principal espera este salvamento (até 2 s).
    void invoke('app:guardClose', { enabled: true }).catch(() => undefined)
    on('app:willClose', () => {
      void flush()
        .catch(() => undefined)
        .finally(() => void invoke('app:closeReady').catch(() => undefined))
    })
    window.addEventListener('beforeunload', () => void flush())
  }

  return {
    selectedDateKey,
    calendarMonth,
    day,
    dayLoading,
    dayError,
    record,
    saveState,
    saveError,
    wordCount,
    revisions,
    historyDirty,
    reviews,
    states,
    selectedBible,
    alternativeTexts,
    loadingBibles,
    documentRevision,
    focusMode,
    contextTab,
    activeSheet,
    reviewCriteriaPreset,
    isSunday,
    occasion,
    mainReference,
    currentVersion,
    initialize,
    selectDate,
    loadDay,
    loadStates,
    loadSideData,
    contentChanged,
    flush,
    updateRecord,
    chooseMainReading,
    loadTranslation,
    openSheet,
    requestReview,
    snapshotInput,
  }
})
