<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Archive, CircleArrowRight, SearchX } from 'lucide-vue-next'
import { countTabsMarkedForReview } from '@pregar/core/reader/model'
import type { ArchiveSearchMode, SermonSummary } from '@shared/types'
import EmptyState from '@/components/EmptyState.vue'
import Segmented from '@/components/Segmented.vue'
import Spinner from '@/components/Spinner.vue'
import WindowHeader from '@/components/WindowHeader.vue'
import { errorMessage, invoke, on, platform } from '@/lib/api'
import { useToasts } from '@/stores/toasts'
import {
  SEARCH_MODES,
  STATE_LABELS,
  archiveRowLabel,
  archiveSummary,
  driveStatus,
  formatDateKey,
  formatWordCount,
  nextRowIndex,
  occasionLines,
  placeholderFor,
  referencesToCount,
  sermonTitle,
  snippetParts,
} from './archive-helpers'

const toasts = useToasts()

const all = ref<SermonSummary[]>([])
const results = ref<SermonSummary[]>([])
const loaded = ref(false)
const searching = ref(false)
const mode = ref<ArchiveSearchMode>('passage')
const query = ref('')
const activeIndex = ref(0)

const hasQuery = computed(() => query.value.trim() !== '')
const summary = computed(() => (loaded.value ? archiveSummary(all.value.length, hasQuery.value ? results.value.length : all.value.length) : ''))
const rows = computed(() => (hasQuery.value ? results.value : all.value))
const modeOptions = SEARCH_MODES.map(({ value, label }) => ({
  value,
  label,
  title: 'Passagem, ocasião litúrgica, data ou qualquer trecho do manuscrito',
}))

// MARK: Lista e busca

async function loadAll(): Promise<void> {
  try {
    all.value = await invoke('sermons:list')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
  loaded.value = true
}

let searchSerial = 0
async function search(): Promise<void> {
  const serial = ++searchSerial
  if (!hasQuery.value) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  try {
    const found = await invoke('sermons:search', { mode: mode.value, query: query.value.trim() })
    if (serial === searchSerial) results.value = found
  } catch (error) {
    if (serial === searchSerial) toasts.show(errorMessage(error), 'error')
  } finally {
    if (serial === searchSerial) searching.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch([query, mode], () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void search(), 140)
  activeIndex.value = 0
})

// MARK: Materiais (calculados só para as linhas visíveis)

const materialCounts = reactive(new Map<string, number>())
const reviewCounts = reactive(new Map<string, number>())
const visibleKeys = new Set<string>()
let observer: IntersectionObserver | null = null
let countTimer: ReturnType<typeof setTimeout> | null = null

function visibleSummaries(): SermonSummary[] {
  return rows.value.filter((row) => visibleKeys.has(row.dateKey))
}

function scheduleCounts(): void {
  if (countTimer) return
  countTimer = setTimeout(async () => {
    countTimer = null
    const visible = visibleSummaries()
    const references = referencesToCount(visible, materialCounts)
    if (references.length > 0) {
      try {
        const counts = await invoke('library:matchCounts', { references })
        for (const [reference, count] of Object.entries(counts)) materialCounts.set(reference, count)
      } catch {
        // Sem Biblioteca: as células ficam com "—".
      }
    }
    for (const row of visible) {
      if (!row.mainReadingReference || reviewCounts.has(row.dateKey)) continue
      reviewCounts.set(row.dateKey, 0)
      invoke('reader:tabsForSermon', { dateKey: row.dateKey })
        .then((tabs) => reviewCounts.set(row.dateKey, countTabsMarkedForReview(tabs, row.mainReadingReference, row.dateKey)))
        .catch(() => undefined)
    }
  }, 60)
}

function observe(element: Element | null, dateKey: string): void {
  if (!element || !observer) return
  ;(element as HTMLElement).dataset.key = dateKey
  observer.observe(element)
}

function materialsFor(row: SermonSummary): string {
  const reference = row.mainReadingReference?.trim()
  if (!reference) return '—'
  const count = materialCounts.get(reference)
  return count === undefined ? '…' : `${count} PDFs`
}

// MARK: Abertura e teclado

const list = ref<HTMLElement | null>(null)

async function openRow(row: SermonSummary): Promise<void> {
  try {
    await invoke('app:openWindow', { window: 'mesa', route: `/mesa?date=${row.dateKey}` })
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function onListKeydown(event: KeyboardEvent): Promise<void> {
  const target = nextRowIndex(event.key, activeIndex.value, rows.value.length)
  if (target === null) return
  event.preventDefault()
  activeIndex.value = target
  await nextTick()
  const element = list.value?.querySelector<HTMLElement>(`[data-row="${target}"]`)
  element?.focus()
  element?.scrollIntoView({ block: 'nearest' })
}

function onFocusIn(event: FocusEvent): void {
  const index = Number((event.target as HTMLElement).dataset.row)
  if (Number.isInteger(index)) activeIndex.value = index
}

const searchField = ref<HTMLInputElement | null>(null)
function onGlobalKeydown(event: KeyboardEvent): void {
  const modifier = platform() === 'darwin' ? event.metaKey : event.ctrlKey
  if (modifier && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchField.value?.focus()
    searchField.value?.select()
  } else if (event.key === 'ArrowDown' && document.activeElement === searchField.value && rows.value.length > 0) {
    event.preventDefault()
    activeIndex.value = 0
    list.value?.querySelector<HTMLElement>('[data-row="0"]')?.focus()
  }
}

// MARK: Ciclo de vida

const unsubscribe: (() => void)[] = []
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    refreshTimer = null
    await loadAll()
    await search()
  }, 300)
}

onMounted(async () => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.key
        if (!key) continue
        if (entry.isIntersecting) visibleKeys.add(key)
        else visibleKeys.delete(key)
      }
      scheduleCounts()
    },
    { root: list.value, rootMargin: '200px 0px' },
  )
  window.addEventListener('keydown', onGlobalKeydown)
  unsubscribe.push(
    on('sermon:changed', scheduleRefresh),
    on('library:changed', () => {
      materialCounts.clear()
      scheduleCounts()
    }),
  )
  await loadAll()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', onGlobalKeydown)
  for (const off of unsubscribe) off()
  for (const timer of [searchTimer, countTimer, refreshTimer]) if (timer) clearTimeout(timer)
})

watch(rows, () => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(0, rows.value.length - 1))
  scheduleCounts()
})
</script>

<template>
  <div class="archive">
    <WindowHeader title="Arquivo" :subtitle="summary">
      <template #trailing>
        <Segmented v-model="mode" :options="modeOptions" label="Buscar por" compact />
        <div class="archive__search">
          <input
            ref="searchField"
            v-model="query"
            class="field"
            type="search"
            :placeholder="placeholderFor(mode)"
            aria-label="Buscar no Arquivo"
            aria-controls="archive-rows"
            spellcheck="false"
          />
          <Spinner v-if="searching" class="archive__spinner" :size="12" label="Buscando" />
        </div>
      </template>
    </WindowHeader>

    <div class="archive__table">
      <div class="archive__head" aria-hidden="true">
        <span>Data</span>
        <span>Ocasião</span>
        <span>Título · passagem principal</span>
        <span class="col-words">Palavras</span>
        <span>Estado</span>
        <span>Materiais</span>
        <span class="col-drive">Drive</span>
        <span />
      </div>

      <div v-if="!loaded" class="archive__loading"><Spinner label="Carregando o Arquivo" /></div>
      <EmptyState
        v-else-if="all.length === 0"
        :icon="Archive"
        title="Arquivo vazio"
        message="Cada data aberta na Mesa cria uma preparação; elas aparecem aqui com ocasião, passagem e materiais."
      />
      <EmptyState
        v-else-if="hasQuery && !searching && results.length === 0"
        :icon="SearchX"
        :title="`Nenhum resultado para “${query.trim()}”`"
        message="Verifique a ortografia ou tente outro modo de busca."
      />
      <ol
        v-show="loaded && rows.length > 0"
        id="archive-rows"
        ref="list"
        class="archive__rows scroll"
        aria-label="Preparações"
        @keydown="onListKeydown"
        @focusin="onFocusIn"
      >
        <li v-for="(row, index) in rows" :key="row.dateKey" :ref="(element) => observe(element as Element | null, row.dateKey)">
          <button
            type="button"
            class="archive-row"
            :data-row="index"
            :tabindex="index === activeIndex ? 0 : -1"
            :aria-label="archiveRowLabel(row)"
            aria-describedby="archive-row-hint"
            title="Abrir esta preparação na Mesa"
            @click="openRow(row)"
          >
            <span class="archive-row__date">{{ formatDateKey(row.dateKey) }}</span>
            <span class="archive-row__occasion">
              <span class="archive-row__primary">{{ occasionLines(row).primary }}</span>
              <span v-if="occasionLines(row).context" class="archive-row__secondary">{{ occasionLines(row).context }}</span>
            </span>
            <span class="archive-row__title-cell">
              <span class="archive-row__title serif">{{ sermonTitle(row) }}</span>
              <span v-if="row.mainReadingReference" class="archive-row__secondary">
                {{ row.mainReadingReference }}
                <span class="compact-only"> · {{ formatWordCount(row.wordCount) }} palavras</span>
              </span>
              <span v-if="mode === 'text' && row.snippet" class="archive-row__snippet">
                <template v-for="(part, partIndex) in snippetParts(row.snippet)" :key="partIndex">
                  <mark v-if="part.marked">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span class="archive-row__words col-words">{{ formatWordCount(row.wordCount) }}</span>
            <span class="archive-row__state" :class="`archive-row__state--${row.state}`">
              <span class="archive-row__dot" aria-hidden="true" />
              {{ STATE_LABELS[row.state] }}
            </span>
            <span class="archive-row__materials">
              <span>{{ materialsFor(row) }}</span>
              <span v-if="(reviewCounts.get(row.dateKey) ?? 0) > 0" class="archive-row__secondary">
                {{ reviewCounts.get(row.dateKey) }} na revisão
              </span>
            </span>
            <span class="archive-row__drive col-drive">
              <span :class="{ 'archive-row__saved': driveStatus(row).saved }">{{ driveStatus(row).label }}</span>
              <span v-if="driveStatus(row).time" class="archive-row__secondary">{{ driveStatus(row).time }}</span>
            </span>
            <CircleArrowRight class="archive-row__go" :size="15" aria-hidden="true" />
          </button>
        </li>
      </ol>
      <span id="archive-row-hint" class="visually-hidden">Abre a preparação na Mesa</span>
    </div>
  </div>
</template>

<style scoped>
.archive {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  container-type: inline-size;
  container-name: archive;
}
.archive__search {
  position: relative;
  width: 250px;
}
.archive__search .field {
  width: 100%;
  padding-right: 26px;
}
.archive__search .field::-webkit-search-cancel-button {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--muted);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 3l6 6M9 3l-6 6' stroke='black' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
}
.archive__spinner {
  position: absolute;
  right: 8px;
  top: 8px;
}
.archive__table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.archive__head,
.archive-row {
  display: grid;
  grid-template-columns: 92px minmax(140px, 200px) minmax(180px, 1fr) 72px 136px 84px 110px 18px;
  column-gap: 12px;
  padding: 0 22px;
}
.archive__head {
  flex: none;
  height: 34px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
.archive__rows {
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}
.archive__loading {
  flex: 1;
  display: grid;
  place-items: center;
}
.archive__table > :deep(.empty) {
  flex: 1;
  justify-content: center;
}
.archive-row {
  width: 100%;
  min-height: 58px;
  align-items: center;
  padding-top: 9px;
  padding-bottom: 9px;
  border: none;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  text-align: left;
  transition: background 0.1s;
}
.archive-row:hover {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.archive-row:active {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.archive-row:focus-visible {
  outline-offset: -2px;
  background: var(--accent-softer);
}
.archive-row > span {
  min-width: 0;
}
.archive-row__date {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.archive-row__occasion,
.archive-row__title-cell,
.archive-row__materials,
.archive-row__drive {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.archive-row__primary {
  font-size: 12px;
  color: var(--ink);
}
.archive-row__secondary {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.archive-row__title-cell .archive-row__secondary {
  font-size: 11px;
}
.archive-row__title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink);
}
.archive-row__snippet {
  font-size: 11px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.archive-row__snippet mark {
  color: var(--ink);
  background: var(--accent-soft);
  border-radius: 2px;
}
.archive-row__words {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.archive-row__state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.archive-row__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
}
.archive-row__state--inProgress {
  color: var(--ink);
}
.archive-row__state--inProgress .archive-row__dot {
  background: var(--warning);
}
.archive-row__state--exported {
  color: var(--accent);
  font-weight: 500;
}
.archive-row__state--exported .archive-row__dot {
  background: var(--accent);
}
.archive-row__materials > span:first-child {
  font-size: 12px;
  color: var(--ink);
}
.archive-row__drive {
  font-size: 10px;
  color: var(--muted);
}
.archive-row__saved {
  color: var(--accent);
}
.archive-row__go {
  color: var(--accent);
}
.compact-only {
  display: none;
}

/* Janelas estreitas: palavras e cópia saem das colunas. */
@container archive (max-width: 1040px) {
  .archive__head,
  .archive-row {
    grid-template-columns: 88px minmax(130px, 180px) minmax(160px, 1fr) 130px 76px 18px;
  }
  .col-words,
  .col-drive {
    display: none;
  }
  .compact-only {
    display: inline;
  }
}
@container archive (max-width: 1000px) {
  .archive__search {
    width: 190px;
  }
}
</style>
