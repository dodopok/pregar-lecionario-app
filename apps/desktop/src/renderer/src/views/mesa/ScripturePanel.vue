<script setup lang="ts">
/**
 * Painel de leituras: todas as leituras do dia abertas com o texto inteiro (ou só a principal),
 * chips para pular entre elas, botão explícito "Usar como texto principal", selo no texto
 * escolhido, salmos com recuo pendente e leitura em tela cheia.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  CalendarX,
  Check,
  KeyRound,
  Maximize2,
  PanelLeftClose,
  Quote,
  RefreshCw,
} from 'lucide-vue-next'
import { readingId, readingLabel } from '@pregar/core/liturgy/types'
import type { BiblePassageText, BibleVersion, LiturgicalReading } from '@pregar/core/liturgy/types'
import { longDatePt, parseDateKey, sermonDateOf, shortDatePt } from '@pregar/core/util/dates'
import type { ReadingsView } from '@shared/settings'
import PButton from '@/components/PButton.vue'
import Segmented from '@/components/Segmented.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke, shortcut } from '@/lib/api'
import { insertEpigraph } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { contentParagraphs, isPoetry, poetryLines, proseRuns, readingAnchor, readingIndex } from './readings'

const emit = defineEmits<{ collapse: [] }>()
const mesa = useMesaStore()
const app = useAppStore()
const versions = ref<BibleVersion[]>([])
const body = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const width = ref(360)
const current = ref<string | null>(null)

const VIEW_OPTIONS: { value: ReadingsView; label: string; title: string }[] = [
  { value: 'all', label: 'Todas', title: 'Todas as leituras abertas, com o texto inteiro' },
  {
    value: 'main',
    label: 'Só a principal',
    title: 'Só o texto principal aberto; as outras ficam em uma linha',
  },
]

const view = computed(() => app.settings.panels.readingsView)
const compact = computed(() => width.value < 330)
const primaryBible = computed(() => app.settings.liturgy.bible)
const translations = computed(() => {
  const codes = [
    primaryBible.value,
    ...app.settings.liturgy.comparisonBibles.filter((code) => code !== primaryBible.value),
  ]
  return codes.map((code) => ({
    code,
    label: versions.value.find((version) => version.code === code)?.name ?? code.toUpperCase(),
  }))
})
const readings = computed(() => mesa.day?.readings ?? [])
const collects = computed(() => (mesa.day?.collect ?? []).filter((collect) => collect.text?.trim()))
const celebrations = computed(() =>
  (mesa.day?.celebrations ?? []).filter((item) => item.name !== mesa.day?.celebration?.name),
)
const index = computed(() => readingIndex(mesa.day, compact.value))
const showingPreviousDay = computed(() =>
  Boolean(mesa.day && mesa.day.date !== mesa.selectedDateKey && mesa.dayLoading),
)
const hasPrimary = computed(() => Boolean(mesa.record?.mainReadingReference))
const preview = computed(
  () => app.liturgyAccess.mode === 'preview' && !app.settings.onboarding.previewNoticeDismissed,
)
const previewUntil = computed(() => {
  const to = app.liturgyAccess.preview?.to
  const date = to ? parseDateKey(to) : null
  return date ? shortDatePt(date) : null
})
const outsidePreview = computed(() => mesa.dayErrorCode === 'preview_window')

void invoke('liturgy:bibleVersions')
  .then((list) => (versions.value = list))
  .catch(() => undefined)

function isPrimary(reading: LiturgicalReading): boolean {
  return (
    mesa.record?.mainReadingReference === reading.reference && mesa.record?.mainReadingSlot === reading.slot
  )
}

/** Em "Só a principal", as outras leituras ficam em uma linha; sem principal, todas abrem. */
function expanded(reading: LiturgicalReading): boolean {
  if (view.value === 'all' || !hasPrimary.value) return true
  return isPrimary(reading)
}

function setView(value: ReadingsView): void {
  void app.updateSettings({ panels: { readingsView: value } })
}

async function choose(reading: LiturgicalReading): Promise<void> {
  await mesa.chooseMainReading(reading)
  await nextTick()
  go(readingAnchor(reading))
}

function textFor(reading: LiturgicalReading): BiblePassageText | null | undefined {
  if (mesa.selectedBible === primaryBible.value) return reading.text
  return mesa.alternativeTexts[mesa.selectedBible]?.[readingId(reading)]
}

function openBible(reference: string): void {
  void invoke('app:openWindow', { window: 'biblia', route: `/biblia?ref=${encodeURIComponent(reference)}` })
}

function wholeChapter(reference: string): string {
  const match = /^((?:\d\s*)?[\p{L}]+(?:\s+[\p{L}]+)*\s+\d+)/u.exec(reference)
  return match?.[1] ?? reference
}

function go(id: string): void {
  const element = document.getElementById(id)
  if (!element || !body.value) return
  body.value.scrollTo({ top: element.offsetTop - 8, behavior: 'smooth' })
}

function selectedDayLabel(): string {
  const date = parseDateKey(sermonDateOf(mesa.selectedDateKey))
  return date ? longDatePt(date) : mesa.selectedDateKey
}

function dismissPreview(): void {
  void app.updateSettings({ onboarding: { previewNoticeDismissed: true } })
}

let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null

function observeSections(): void {
  observer?.disconnect()
  if (!body.value) return
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) current.value = (visible[0].target as HTMLElement).id
    },
    { root: body.value, rootMargin: '-8% 0px -75% 0px', threshold: 0 },
  )
  for (const entry of index.value) {
    const element = document.getElementById(entry.id)
    if (element) observer.observe(element)
  }
}

watch(
  () => [mesa.day?.date, index.value.length, view.value],
  () => {
    current.value = null
    void nextTick(observeSections)
  },
)

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  if (panel.value) resizeObserver.observe(panel.value)
  void nextTick(observeSections)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  resizeObserver?.disconnect()
})
</script>

<template>
  <section ref="panel" class="scripture" aria-label="Leituras do dia">
    <header class="scripture__header">
      <div class="scripture__row">
        <h2 class="eyebrow">Leituras</h2>
        <span class="spacer" />
        <Segmented
          v-if="readings.length > 1"
          :model-value="view"
          label="Quais leituras mostrar"
          :options="
            compact
              ? VIEW_OPTIONS.map((option) => ({
                  ...option,
                  label: option.value === 'main' ? 'Principal' : option.label,
                }))
              : VIEW_OPTIONS
          "
          compact
          @update:model-value="setView"
        />
        <select
          v-if="translations.length > 1 && mesa.day && !compact"
          class="field field--compact"
          :value="mesa.selectedBible"
          title="Tradução exibida nas leituras"
          aria-label="Tradução exibida nas leituras"
          @change="mesa.loadTranslation(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="translation in translations" :key="translation.code" :value="translation.code">
            {{ translation.code.toUpperCase() }}
          </option>
        </select>
        <PButton
          v-if="mesa.day"
          variant="icon"
          compact
          label="Ler em tela cheia"
          :title="`Ler as leituras do dia em tela cheia (${shortcut('⇧⌥⌘L')})`"
          @click="mesa.openFullscreen('readings')"
        >
          <Maximize2 :size="14" />
        </PButton>
        <PButton
          variant="icon"
          compact
          :label="`Ocultar leituras (${shortcut('⇧⌥⌘2')})`"
          @click="emit('collapse')"
        >
          <PanelLeftClose :size="15" />
        </PButton>
      </div>
      <nav v-if="index.length > 1" class="scripture__chips" aria-label="Ir para a leitura">
        <button
          v-for="entry in index"
          :key="entry.id"
          type="button"
          class="chip"
          :class="{
            'chip--active': current === entry.id && !(entry.reading && isPrimary(entry.reading)),
            'chip--accent': entry.reading && isPrimary(entry.reading),
          }"
          :aria-current="current === entry.id ? 'location' : undefined"
          :title="entry.title"
          @click="go(entry.id)"
        >
          <Check v-if="entry.reading && isPrimary(entry.reading)" :size="11" aria-hidden="true" />{{
            entry.label
          }}
        </button>
        <span v-if="compact && translations.length > 1" class="spacer" />
        <select
          v-if="compact && translations.length > 1 && mesa.day"
          class="field field--compact"
          :value="mesa.selectedBible"
          aria-label="Tradução exibida nas leituras"
          @change="mesa.loadTranslation(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="translation in translations" :key="translation.code" :value="translation.code">
            {{ translation.code.toUpperCase() }}
          </option>
        </select>
      </nav>
    </header>

    <div v-if="mesa.day" ref="body" class="scroll scripture__body" :aria-busy="showingPreviousDay">
      <div v-if="showingPreviousDay" class="scripture__overlay" role="status">
        <Spinner />
        <span>Atualizando leituras para {{ selectedDayLabel() }}…</span>
      </div>

      <aside v-if="mesa.isFree" class="notice notice--free" role="note">
        <p class="notice__text">
          <strong>Preparação avulsa.</strong> Estas são as leituras de {{ selectedDayLabel() }} no lecionário.
          O texto principal pode ser qualquer passagem: use o chip do cabeçalho e escolha “Outra passagem”.
        </p>
      </aside>
      <aside v-if="preview" class="notice" role="status">
        <p class="notice__text">
          <strong>Degustação.</strong>
          {{
            previewUntil ? `As leituras aparecem até ${previewUntil}.` : 'Só as próximas semanas aparecem.'
          }}
          Conecte para ver qualquer data e revisar.
        </p>
        <div class="notice__actions">
          <PButton variant="link" compact @click="mesa.openSheet('connect')">Conectar</PButton>
          <PButton variant="ghost" compact @click="dismissPreview">Entendi</PButton>
        </div>
      </aside>

      <section v-if="collects.length > 0" id="reading-collect" class="collect" aria-label="Coleta do dia">
        <p class="eyebrow collect__label">{{ collects.length === 1 ? 'Coleta do dia' : 'Coletas do dia' }}</p>
        <article v-for="(collect, position) in collects" :key="position" class="collect__item">
          <p v-if="collect.title || collect.subtitle" class="collect__title">
            {{ [collect.title, collect.subtitle].filter(Boolean).join(' · ') }}
          </p>
          <p class="serif collect__text selectable">{{ collect.text }}</p>
          <PButton
            variant="link"
            compact
            title="Insere a coleta no início do manuscrito, como citação em bloco"
            @click="
              insertEpigraph(
                collect.text ?? '',
                collect.title ? `Coleta · ${collect.title}` : 'Coleta do dia',
              )
            "
          >
            <Quote :size="13" /> Inserir como epígrafe
          </PButton>
        </article>
      </section>

      <article
        v-for="reading in readings"
        :id="readingAnchor(reading)"
        :key="readingId(reading)"
        class="reading"
        :class="{ 'reading--primary': isPrimary(reading), 'reading--collapsed': !expanded(reading) }"
        :aria-label="
          isPrimary(reading) ? `${readingLabel(reading)}, texto principal do sermão` : readingLabel(reading)
        "
      >
        <div class="reading__head">
          <span class="eyebrow reading__label">
            {{ readingLabel(reading)
            }}<span v-if="reading.slot === 'gospel' && readingLabel(reading) !== 'Evangelho'">
              · Evangelho</span
            >
          </span>
          <span v-if="isPrimary(reading)" class="reading__badge">Texto principal</span>
          <span class="spacer" />
          <button
            v-if="isPrimary(reading)"
            type="button"
            class="reading__swap"
            title="Deixar de usar esta leitura como texto principal"
            @click="choose(reading)"
          >
            Trocar
          </button>
          <button
            v-else
            type="button"
            class="reading__choose"
            :title="`Usar ${readingLabel(reading)} (${reading.reference}) como texto principal do sermão`"
            :aria-label="`Usar ${readingLabel(reading)} como texto principal`"
            @click="choose(reading)"
          >
            {{ compact ? 'Texto principal' : 'Usar como texto principal' }}
          </button>
        </div>
        <h3 class="serif reading__reference">{{ reading.reference }}</h3>
        <p v-if="reading.alternatives?.length && expanded(reading)" class="reading__alternatives">
          ou {{ reading.alternatives.join(' · ') }}
        </p>

        <div v-if="expanded(reading)" class="reading__text selectable">
          <div v-if="isPoetry(textFor(reading))" class="poem">
            <p
              v-for="(line, position) in poetryLines(textFor(reading))"
              :key="position"
              class="serif poem__line"
              :class="{ 'poem__line--in': line.indent === 1 }"
            >
              <sup v-if="line.number !== null" class="verse-number">{{ line.number }}</sup
              >{{ line.text }}
            </p>
          </div>
          <p v-else-if="textFor(reading)?.verses?.length" class="serif prose">
            <template v-for="run in proseRuns(textFor(reading))" :key="run.number"
              ><sup class="verse-number">{{ run.number }}</sup
              >{{ run.text }}{{ ' ' }}</template
            >
          </p>
          <template v-else-if="textFor(reading)?.content">
            <p
              v-for="(paragraph, position) in contentParagraphs(textFor(reading)!.content)"
              :key="position"
              class="serif prose"
            >
              {{ paragraph }}
            </p>
          </template>
          <p
            v-else-if="mesa.selectedBible !== primaryBible && mesa.loadingBibles.has(mesa.selectedBible)"
            class="reading__status"
          >
            <Spinner :size="12" /> Buscando em {{ mesa.selectedBible.toUpperCase() }}…
          </p>
          <p v-else class="reading__status">O texto desta leitura não está disponível nesta tradução.</p>
          <div v-if="isPrimary(reading)" class="reading__actions">
            <PButton
              variant="link"
              compact
              title="Abrir na Bíblia para comparar traduções"
              @click="openBible(reading.reference)"
              ><BookOpen :size="13" /> Comparar traduções</PButton
            >
            <PButton
              variant="link"
              compact
              title="Ler o capítulo inteiro na Bíblia"
              @click="openBible(wholeChapter(reading.reference))"
              >Capítulo inteiro</PButton
            >
          </div>
        </div>
      </article>

      <section v-if="celebrations.length > 0" class="celebrations">
        <p class="eyebrow">Comemorações</p>
        <p v-for="celebration in celebrations" :key="celebration.name" class="celebration">
          {{ celebration.name }}
        </p>
      </section>

      <p v-if="readings.length === 0" class="reading__status">
        Não há leituras cadastradas para este dia no livro de oração escolhido.
      </p>
    </div>

    <div v-else class="scripture__empty">
      <template v-if="mesa.dayLoading">
        <Spinner />
        <p>Consultando o calendário…</p>
      </template>
      <template v-else-if="app.liturgyAccess.mode === 'none'">
        <KeyRound :size="22" aria-hidden="true" />
        <p class="scripture__error-title">As leituras ainda não estão conectadas</p>
        <p class="muted">
          Assine o Pregar ou salve a sua chave da Estêvão API para carregar o calendário e as leituras.
        </p>
        <PButton variant="primary" @click="mesa.openSheet('connect')">Conectar</PButton>
      </template>
      <template v-else-if="outsidePreview">
        <CalendarX :size="22" aria-hidden="true" />
        <p class="scripture__error-title">Fora da degustação</p>
        <p class="muted">{{ mesa.dayError }}</p>
        <PButton variant="primary" @click="mesa.openSheet('connect')"
          >Conectar para ver qualquer data</PButton
        >
      </template>
      <template v-else-if="mesa.dayError">
        <CalendarX :size="22" aria-hidden="true" />
        <p class="scripture__error-title">Não foi possível carregar este dia</p>
        <p class="muted">{{ mesa.dayError }}</p>
        <PButton variant="secondary" @click="mesa.loadDay()"
          ><RefreshCw :size="13" /> Tentar novamente</PButton
        >
      </template>
    </div>
  </section>
</template>

<style scoped>
.scripture {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--paper);
  min-width: 0;
}
.scripture__header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px 10px 16px;
  border-bottom: 1px solid var(--line);
}
.scripture__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.scripture__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
}
.scripture__chips .chip {
  height: 22px;
  padding: 0 8px;
}
.field--compact {
  height: 24px;
  font-size: var(--text-xs);
  padding: 0 4px;
}
.scripture__body {
  position: relative;
  flex: 1;
  padding: 0 14px 28px 16px;
}
.scripture__overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--muted);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
}
.notice {
  margin: 12px 0 4px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
}
.notice--free {
  background: var(--accent-softer);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.notice__text {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.5;
}
.notice__actions {
  display: flex;
  gap: 4px;
  margin: 4px 0 0 -6px;
}
.collect {
  margin: 14px 0 6px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  background: var(--accent-softer);
}
.collect__label {
  color: var(--accent-ink);
}
.collect__title {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--muted);
}
.collect__text {
  margin: 6px 0 2px;
  font-size: 14px;
  line-height: 1.55;
  font-style: italic;
}
.reading {
  padding: 18px 0 20px;
  border-bottom: 1px solid var(--line);
}
.reading--collapsed {
  padding: 12px 0;
}
.reading--primary {
  margin: 14px -14px 0 -16px;
  padding: 16px 14px 20px 13px;
  border-bottom: none;
  border-left: 3px solid var(--accent);
  background: var(--accent-softer);
}
.reading__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  min-width: 0;
}
.reading__label {
  white-space: nowrap;
}
.reading--primary .reading__label {
  color: var(--accent-ink);
}
.reading__badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}
.reading__choose {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--surface);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.reading__choose:hover {
  border-color: var(--accent);
  color: var(--accent-ink);
}
.reading__swap {
  flex: none;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--accent-ink);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.reading__swap:hover {
  background: var(--accent-soft);
}
.reading__reference {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.reading--collapsed .reading__reference {
  margin-bottom: 0;
  font-size: 15px;
}
.reading__alternatives {
  margin: -6px 0 10px;
  font-size: var(--text-sm);
  color: var(--muted);
}
.reading__text {
  font-size: 15px;
  line-height: 1.6;
}
.prose {
  margin: 0 0 10px;
}
.verse-number {
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--accent-ink);
  margin: 0 3px 0 1px;
  line-height: 0;
  vertical-align: 0.5em;
}
.poem__line {
  margin: 0;
  padding-left: 18px;
  text-indent: -18px;
}
.poem__line--in {
  padding-left: 36px;
}
.reading__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 0 -6px;
}
.reading__status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-sm);
  color: var(--muted);
  margin: 8px 0;
}
.celebrations {
  margin-top: 16px;
}
.celebration {
  margin: 6px 0 0;
  font-size: var(--text-md);
}
.scripture__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px;
  text-align: center;
  font-size: var(--text-md);
  color: var(--muted);
}
.scripture__empty p {
  margin: 0;
  max-width: 280px;
  line-height: 1.5;
}
.scripture__error-title {
  font-weight: 600;
  color: var(--ink);
}
</style>
