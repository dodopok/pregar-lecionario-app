<script setup lang="ts">
/**
 * Bíblia comparativa (porte de BibleComparisonView): referência com Enter, perícope ou capítulo,
 * tradução principal mais as de comparação, versículos alinhados por capítulo e versículo numa
 * única rolagem. A Mesa abre esta janela com `?ref=`.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BookText, KeyRound, Search, X } from 'lucide-vue-next'
import type { BiblePassageText, BibleVersion } from '@pregar/core/liturgy/types'
import WindowHeader from '@/components/WindowHeader.vue'
import Segmented from '@/components/Segmented.vue'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import TranslationMenu from './TranslationMenu.vue'
import {
  CROSS_CHAPTER_MESSAGE,
  chapterButtonLabel,
  chapterCoordinatesUnavailable,
  comparisonRows,
  displayedVersionCodes,
  footerStatus,
  requestReference,
  spansMultipleChapters,
} from './alignment'
import type { PassageScope } from './alignment'

const DEFAULT_COMPARISON_FLAG = 'pregar.biblia.defaultComparison'
/** Largura mínima de cada coluna, como no Swift; acima disso as colunas dividem a janela. */
const MIN_COLUMN = 280

const app = useAppStore()
const route = useRoute()
const router = useRouter()

const initial = typeof route.query.ref === 'string' ? route.query.ref.trim() : ''
const input = ref(initial)
const query = ref(initial)
const scope = ref<PassageScope>('pericope')
const versions = ref<BibleVersion[]>([])
const versionsLoading = ref(false)
const catalogError = ref<string | null>(null)
const passages = ref<Record<string, BiblePassageText>>({})
const failures = ref<Record<string, string>>({})
const pending = ref<Set<string>>(new Set())
const errorText = ref<string | null>(null)
let loadToken = 0

const hasAccess = computed(() => app.liturgyAccess.mode !== 'none')
const mainBible = computed(() => app.settings.liturgy.bible)
const codes = computed(() => {
  const catalogue = versions.value
  const comparisons = app.settings.liturgy.comparisonBibles.filter(
    (code) => catalogue.length === 0 || catalogue.some((version) => version.code === code),
  )
  return displayedVersionCodes(mainBible.value, comparisons)
})
const reference = computed(() => requestReference(query.value, scope.value))
const requestKey = computed(() => `${reference.value}|${codes.value.join(',')}|${app.liturgyAccess.mode}`)
const isLoading = computed(() => pending.value.size > 0)
const passageFor = (code: string) => passages.value[`${reference.value}|${code}`]
const rows = computed(() => comparisonRows(reference.value, codes.value, passageFor))
const crossChapter = computed(() => spansMultipleChapters(reference.value))
const coordinatesMissing = computed(() => !isLoading.value && chapterCoordinatesUnavailable(reference.value, codes.value.map(passageFor)))
const availableToAdd = computed(() => versions.value.filter((version) => !codes.value.includes(version.code)))
const scopeOptions = computed<{ value: PassageScope; label: string; title: string }[]>(() => [
  { value: 'pericope', label: 'Perícope', title: 'Só os versículos da referência' },
  { value: 'chapter', label: chapterButtonLabel(query.value), title: 'O capítulo inteiro' },
])
const gridColumns = computed(() => `repeat(${codes.value.length}, minmax(${MIN_COLUMN}px, 1fr))`)
const emptyMessage = computed(() => {
  if (isLoading.value) return 'Carregando as traduções…'
  if (coordinatesMissing.value) return CROSS_CHAPTER_MESSAGE
  if (!reference.value) return 'Digite uma referência, como João 3:16, e pressione Enter.'
  return errorText.value ?? 'Nenhum texto disponível para esta referência.'
})

function versionHeader(code: string): { name: string; detail: string } {
  const version = versions.value.find((candidate) => candidate.code === code)
  if (!version) return { name: code.toUpperCase(), detail: '' }
  return { name: version.name, detail: version.fullName ?? version.language ?? '' }
}

async function loadVersions(): Promise<void> {
  if (!hasAccess.value) {
    catalogError.value = 'Configure a chave da Estêvão API para carregar o catálogo.'
    return
  }
  versionsLoading.value = true
  catalogError.value = null
  try {
    versions.value = await invoke('liturgy:bibleVersions')
    applyDefaultComparison()
  } catch (caught) {
    catalogError.value = errorMessage(caught)
  } finally {
    versionsLoading.value = false
  }
}

/** Na primeira vez, abre ao lado a tradução recomendada (como o app Swift fazia com a NAA). */
function applyDefaultComparison(): void {
  if (app.settings.liturgy.comparisonBibles.length > 0) return
  try {
    if (localStorage.getItem(DEFAULT_COMPARISON_FLAG)) return
    localStorage.setItem(DEFAULT_COMPARISON_FLAG, '1')
  } catch {
    return
  }
  const recommended = versions.value.find((version) => version.code !== mainBible.value && version.isRecommended)
  if (recommended) void app.updateSettings({ liturgy: { comparisonBibles: [recommended.code] } })
}

async function loadPassages(): Promise<void> {
  const token = ++loadToken
  errorText.value = null
  const target = reference.value
  if (!target) {
    pending.value = new Set()
    return
  }
  if (!hasAccess.value) {
    pending.value = new Set()
    errorText.value = 'Configure sua chave da Estêvão API nas Preferências.'
    return
  }
  const missing = codes.value.filter((code) => !passages.value[`${target}|${code}`])
  pending.value = new Set(missing)
  const nextFailures: Record<string, string> = {}
  await Promise.all(
    missing.map(async (code) => {
      try {
        const passage = await invoke('liturgy:passage', { reference: target, bible: code })
        if (token === loadToken || reference.value === target) passages.value = { ...passages.value, [`${target}|${code}`]: passage }
      } catch (caught) {
        nextFailures[code] = errorMessage(caught)
      } finally {
        if (token === loadToken) {
          const next = new Set(pending.value)
          next.delete(code)
          pending.value = next
        }
      }
    }),
  )
  if (token !== loadToken) return
  failures.value = nextFailures
  if (codes.value.every((code) => !passages.value[`${target}|${code}`])) {
    const first = Object.values(nextFailures)[0]
    errorText.value = first
      ? `Não foi possível carregar nenhuma tradução desta passagem. ${first}`
      : 'Não foi possível carregar nenhuma tradução desta passagem.'
  }
}

function retry(): void {
  const target = reference.value
  const kept = Object.fromEntries(Object.entries(passages.value).filter(([key]) => !key.startsWith(`${target}|`)))
  passages.value = kept
  void loadPassages()
}

function commit(): void {
  const trimmed = input.value.trim()
  input.value = trimmed
  query.value = trimmed
  if (route.query.ref !== trimmed) void router.replace({ path: '/biblia', query: trimmed ? { ref: trimmed } : {} })
}

function setComparison(code: string, selected: boolean): void {
  if (code === mainBible.value) return
  const current = app.settings.liturgy.comparisonBibles
  const next = selected ? (current.includes(code) ? current : [...current, code]) : current.filter((item) => item !== code)
  void app.updateSettings({ liturgy: { comparisonBibles: next } })
}

watch(
  () => route.query.ref,
  (value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed && trimmed !== query.value) {
      input.value = trimmed
      query.value = trimmed
    }
  },
)
watch(requestKey, () => void loadPassages())
watch(hasAccess, (value) => {
  if (value && versions.value.length === 0) void loadVersions()
})
onMounted(() => {
  void loadVersions()
  void loadPassages()
})
</script>

<template>
  <div class="bible">
    <WindowHeader>
      <template #leading>
        <form class="bible__search" role="search" title="Digite a referência e pressione Enter" @submit.prevent="commit">
          <Search :size="13" aria-hidden="true" />
          <input
            v-model="input"
            class="bible__input"
            placeholder="Referência, ex. João 3:16"
            aria-label="Referência bíblica"
            aria-describedby="bible-hint"
            spellcheck="false"
            autofocus
          />
          <span id="bible-hint" class="visually-hidden">Pressione Enter para buscar.</span>
        </form>
        <Segmented v-model="scope" class="bible__scope" label="Trecho" :options="scopeOptions" />
      </template>
      <template #trailing>
        <div class="bible__chips" aria-label="Traduções abertas" role="group">
          <template v-for="code in codes" :key="code">
            <span v-if="code === mainBible" class="chip chip--primary" title="Tradução principal. Para trocar, use Preferências › Estêvão API.">
              {{ code.toUpperCase() }}
            </span>
            <button
              v-else
              type="button"
              class="chip"
              :title="`Remover ${code.toUpperCase()} da comparação`"
              :aria-label="`Remover ${code.toUpperCase()} da comparação`"
              @click="setComparison(code, false)"
            >
              {{ code.toUpperCase() }}<X :size="11" aria-hidden="true" />
            </button>
          </template>
          <TranslationMenu
            :available="availableToAdd"
            :loading="versionsLoading"
            :error="catalogError"
            :has-catalog="versions.length > 0"
            @add="setComparison($event, true)"
            @retry="loadVersions"
          />
        </div>
      </template>
    </WindowHeader>

    <div v-if="!hasAccess" class="bible__locked">
      <KeyRound :size="26" aria-hidden="true" />
      <h2 class="bible__locked-title">Conecte a Estêvão API</h2>
      <p>Configure sua chave da Estêvão API nas Preferências, ou assine o Proper para ler a Bíblia sem chave.</p>
      <div class="bible__locked-actions">
        <PButton variant="primary" @click="invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/conta' })">Assinar o Proper</PButton>
        <PButton @click="invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/estevao' })">Usar minha chave</PButton>
      </div>
    </div>

    <div v-else class="bible__scroll scroll">
      <div
        class="grid"
        role="table"
        :aria-label="`Comparação de traduções: ${reference || 'sem referência'}`"
        :style="{ gridTemplateColumns: gridColumns, minWidth: `${codes.length * MIN_COLUMN}px` }"
      >
        <div class="grid__row" role="row">
          <div v-for="code in codes" :key="code" class="grid__head" :class="{ 'grid__head--primary': code === mainBible }" role="columnheader">
            <span class="grid__head-name">{{ versionHeader(code).name }}</span>
            <span v-if="versionHeader(code).detail" class="grid__head-detail">· {{ versionHeader(code).detail }}</span>
            <Spinner v-if="pending.has(code)" :size="11" class="grid__head-spinner" :label="`Carregando ${code.toUpperCase()}`" />
            <span v-else-if="failures[code] && !passageFor(code)" class="grid__head-failed" :title="failures[code]">indisponível</span>
          </div>
        </div>

        <div v-if="rows.length === 0" class="grid__row" role="row">
          <div class="grid__empty" role="cell">
            <Spinner v-if="isLoading" :size="16" />
            <BookText v-else :size="20" aria-hidden="true" />
            <p>{{ emptyMessage }}</p>
            <PButton v-if="!isLoading && reference" @click="retry">Tentar novamente</PButton>
          </div>
        </div>

        <template v-else>
          <div v-for="row in rows" :key="row.id" class="grid__row" role="row">
            <div v-for="cell in row.cells" :key="cell.code" class="verse" role="cell">
              <span v-if="row.label" class="verse__number" :class="{ 'verse__number--wide': crossChapter }">{{ row.label }}</span>
              <p v-if="cell.text" class="verse__text selectable">{{ cell.text }}</p>
              <p v-else-if="pending.has(cell.code)" class="verse__missing">Consultando…</p>
              <p v-else class="verse__missing">Versículo indisponível</p>
            </div>
          </div>
        </template>
      </div>
    </div>

    <footer class="bible__footer">
      <span class="bible__status">{{ footerStatus(reference, codes.length) }}</span>
      <span v-if="errorText && rows.length > 0" class="bible__error">{{ errorText }}</span>
      <span class="spacer" />
      <Spinner v-if="isLoading" :size="12" />
    </footer>
  </div>
</template>

<style scoped>
.bible {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.bible :deep(.window-header) {
  background: var(--canvas);
}
.bible__search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 260px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-button);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--muted);
}
.bible__search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.bible__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}
.bible__input::placeholder {
  font-weight: 400;
  color: var(--muted);
}
.bible__scope {
  margin-left: 10px;
}
.bible__chips {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
}
button.chip:hover {
  border-color: var(--danger);
  color: var(--danger);
}
.chip--primary {
  padding: 0 14px;
  border-color: transparent;
  font-weight: 600;
  color: var(--accent-contrast);
  background: var(--accent);
}
.bible__scroll {
  flex: 1;
  min-height: 0;
}
.grid {
  display: grid;
  width: 100%;
}
.grid__row {
  display: contents;
}
.grid__head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 42px;
  padding: 0 18px;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
  border-right: 1px solid var(--line);
  font-size: 12px;
  font-weight: 600;
  min-width: 0;
}
.grid__head:last-child,
.verse:last-child {
  border-right: none;
}
.grid__head--primary .grid__head-name {
  color: var(--accent);
}
.grid__head-detail {
  font-weight: 400;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid__head-spinner {
  flex: none;
}
.grid__head-failed {
  font-size: 11px;
  font-weight: 500;
  color: var(--warning);
}
.grid__empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 180px;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.grid__empty p {
  margin: 0;
  max-width: 520px;
  font-size: 12px;
}
.verse {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  min-height: 62px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  border-right: 1px solid var(--line);
  background: var(--paper);
  min-width: 0;
}
.verse__number {
  flex: none;
  width: 18px;
  padding-top: 5px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.verse__number--wide {
  width: 34px;
}
.verse__text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 19px;
  line-height: 1.5;
  color: var(--ink);
}
.verse__missing {
  margin: 0;
  padding-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.bible__locked {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--muted);
}
.bible__locked svg {
  color: var(--accent);
}
.bible__locked-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}
.bible__locked p {
  margin: 0;
  max-width: 420px;
  font-size: 13px;
}
.bible__locked-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.bible__footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 30px;
  padding: 0 16px;
  border-top: 1px solid var(--line);
  background: var(--canvas);
  font-size: 11px;
  color: var(--muted);
}
.bible__status,
.bible__error {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bible__error {
  color: var(--danger);
  font-size: 10px;
}
</style>
