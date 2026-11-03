<script setup lang="ts">
/**
 * Leituras do dia em tela cheia: índice à esquerda, coluna de leitura ao centro com a tipografia
 * da Bíblia, tamanho do texto, tradução e impressão. Esc fecha.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AArrowDown, AArrowUp, Check, Printer, X } from 'lucide-vue-next'
import type { BiblePassageText, BibleVersion, LiturgicalReading } from '@pregar/core/liturgy/types'
import { readingId, readingLabel } from '@pregar/core/liturgy/types'
import { longDatePt, parseDateKey } from '@pregar/core/util/dates'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import {
  contentParagraphs,
  isPoetry,
  poetryLines,
  proseRuns,
  readingAnchor,
  readingIndex,
  readingsPrintHtml,
} from './readings'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()
const app = useAppStore()
const toasts = useToasts()

const FONT = { min: 15, max: 28, step: 1 }
const fontSize = ref(19)
const current = ref<string | null>(null)
const versions = ref<BibleVersion[]>([])
const body = ref<HTMLElement | null>(null)

const date = computed(() => parseDateKey(mesa.selectedDateKey))
const title = computed(() => mesa.occasion ?? (date.value ? longDatePt(date.value) : mesa.selectedDateKey))
const subtitle = computed(() => (date.value && mesa.occasion ? longDatePt(date.value) : ''))
const index = computed(() => readingIndex(mesa.day, false))
const collects = computed(() => (mesa.day?.collect ?? []).filter((collect) => collect.text?.trim()))
const readings = computed(() => mesa.day?.readings ?? [])
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

function textFor(reading: LiturgicalReading): BiblePassageText | null | undefined {
  if (mesa.selectedBible === primaryBible.value) return reading.text
  return mesa.alternativeTexts[mesa.selectedBible]?.[readingId(reading)]
}

function isPrimary(reading: LiturgicalReading): boolean {
  return (
    mesa.record?.mainReadingReference === reading.reference && mesa.record?.mainReadingSlot === reading.slot
  )
}

function go(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function setFont(delta: number): void {
  fontSize.value = Math.min(FONT.max, Math.max(FONT.min, fontSize.value + delta))
}

async function print(): Promise<void> {
  if (!mesa.day) return
  const texts: Record<string, BiblePassageText | null | undefined> = {}
  for (const reading of readings.value) texts[readingId(reading)] = textFor(reading)
  try {
    const result = await invoke('tablet:print', {
      html: readingsPrintHtml(mesa.day, {
        title: title.value,
        subtitle: subtitle.value,
        bible: mesa.selectedBible,
        texts,
      }),
      title: `Leituras · ${title.value}`,
    })
    if (result.message) toasts.show(result.message, 'error')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

let observer: IntersectionObserver | null = null
onMounted(async () => {
  document.addEventListener('keydown', onKeydown, true)
  void invoke('liturgy:bibleVersions')
    .then((list) => (versions.value = list))
    .catch(() => undefined)
  await nextTick()
  body.value?.focus()
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) current.value = (visible[0].target as HTMLElement).id
    },
    { root: body.value, rootMargin: '-10% 0px -70% 0px', threshold: 0 },
  )
  for (const entry of index.value) {
    const element = document.getElementById(entry.id)
    if (element) observer.observe(element)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  observer?.disconnect()
})
</script>

<template>
  <div class="reading-view" role="dialog" aria-modal="true" aria-label="Leituras do dia em tela cheia">
    <aside class="reading-view__index">
      <header class="reading-view__head">
        <p class="eyebrow">Leituras do dia</p>
        <h1 class="serif reading-view__title">{{ title }}</h1>
        <p v-if="subtitle" class="reading-view__subtitle">{{ subtitle }}</p>
      </header>
      <nav class="reading-view__nav" aria-label="Ir para a leitura">
        <button
          v-for="entry in index"
          :key="entry.id"
          type="button"
          class="nav-item"
          :class="{
            'nav-item--current': current === entry.id,
            'nav-item--primary': entry.reading && isPrimary(entry.reading),
          }"
          :aria-current="current === entry.id ? 'location' : undefined"
          :title="entry.title"
          @click="go(entry.id)"
        >
          <span class="nav-item__label">{{
            entry.kind === 'collect' ? 'Coleta' : readingLabel(entry.reading!)
          }}</span>
          <span class="serif nav-item__reference">{{
            entry.kind === 'collect' ? 'Oração do dia' : entry.reading!.reference
          }}</span>
          <Check
            v-if="entry.reading && isPrimary(entry.reading)"
            :size="13"
            class="nav-item__check"
            aria-label="texto principal"
          />
        </button>
      </nav>
      <div class="reading-view__tools">
        <div class="tool-row" role="group" aria-label="Tamanho do texto">
          <PButton
            variant="icon"
            compact
            label="Diminuir o texto"
            :disabled="fontSize <= FONT.min"
            @click="setFont(-FONT.step)"
            ><AArrowDown :size="15"
          /></PButton>
          <span class="tool-row__value">{{ fontSize }} px</span>
          <PButton
            variant="icon"
            compact
            label="Aumentar o texto"
            :disabled="fontSize >= FONT.max"
            @click="setFont(FONT.step)"
            ><AArrowUp :size="15"
          /></PButton>
        </div>
        <select
          v-if="translations.length > 1"
          class="field field--compact"
          :value="mesa.selectedBible"
          aria-label="Tradução exibida"
          @change="mesa.loadTranslation(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="translation in translations" :key="translation.code" :value="translation.code">
            {{ translation.label }}
          </option>
        </select>
        <PButton compact @click="print"><Printer :size="13" /> Imprimir leituras</PButton>
      </div>
      <PButton class="reading-view__close" @click="emit('close')"><X :size="14" /> Fechar (Esc)</PButton>
    </aside>

    <div ref="body" class="scroll reading-view__body selectable" tabindex="-1">
      <div class="reading-view__column" :style="{ fontSize: `${fontSize}px` }">
        <section v-if="collects.length > 0" id="reading-collect" class="passage passage--collect">
          <p class="eyebrow passage__eyebrow">
            {{ collects.length === 1 ? 'Coleta do dia' : 'Coletas do dia' }}
          </p>
          <article v-for="(collect, position) in collects" :key="position" class="collect">
            <p v-if="collect.title || collect.subtitle" class="collect__title">
              {{ [collect.title, collect.subtitle].filter(Boolean).join(' · ') }}
            </p>
            <p class="serif collect__text">{{ collect.text }}</p>
          </article>
        </section>

        <section
          v-for="reading in readings"
          :id="readingAnchor(reading)"
          :key="readingId(reading)"
          class="passage"
          :class="{ 'passage--primary': isPrimary(reading) }"
        >
          <p class="eyebrow passage__eyebrow">
            {{ readingLabel(reading)
            }}<span v-if="isPrimary(reading)" class="passage__badge">Texto principal</span>
          </p>
          <h2 class="serif passage__reference">{{ reading.reference }}</h2>
          <p v-if="reading.alternatives?.length" class="passage__alternatives">
            ou {{ reading.alternatives.join(' · ') }}
          </p>
          <div v-if="isPoetry(textFor(reading))" class="poem">
            <p
              v-for="(line, position) in poetryLines(textFor(reading))"
              :key="position"
              class="poem__line"
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
          <p v-else class="passage__status">O texto desta leitura não está disponível nesta tradução.</p>
        </section>
        <p v-if="readings.length === 0" class="passage__status">
          Não há leituras cadastradas para este dia no livro de oração escolhido.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reading-view {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  background: var(--paper);
  animation: fade 0.16s var(--ease);
}
.reading-view__index {
  flex: none;
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: calc(20px + var(--window-controls-top, 0px)) 16px 16px calc(16px + var(--window-controls-inset));
  border-right: 1px solid var(--line);
  background: var(--sidebar);
  overflow: auto;
}
.reading-view__title {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}
.reading-view__subtitle {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
}
.reading-view__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-button);
  background: none;
  text-align: left;
}
.nav-item:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.nav-item--current {
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--line);
}
.nav-item__label {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.nav-item--primary .nav-item__label {
  color: var(--accent-ink);
}
.nav-item__reference {
  font-size: var(--text-lg);
  font-weight: 600;
}
.nav-item__check {
  position: absolute;
  right: 10px;
  top: 10px;
  color: var(--accent);
}
.reading-view__tools {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tool-row__value {
  min-width: 46px;
  text-align: center;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.field--compact {
  height: 26px;
  font-size: var(--text-sm);
}
.reading-view__close {
  align-self: flex-start;
}
.reading-view__body {
  flex: 1;
  min-width: 0;
  outline: none;
}
.reading-view__column {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 32px 120px;
  line-height: 1.6;
}
.passage {
  padding: 22px 0 26px;
  border-bottom: 1px solid var(--line);
}
.passage--primary {
  margin: 14px -20px 0;
  padding: 20px 20px 24px 17px;
  border-bottom: none;
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
  background: var(--accent-softer);
}
.passage__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
}
.passage--primary .passage__eyebrow {
  color: var(--accent-ink);
}
.passage__badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
}
.passage__reference {
  margin: 4px 0 10px;
  font-size: 1.25em;
  font-weight: 600;
}
.passage__alternatives {
  margin: -6px 0 10px;
  font-size: var(--text-sm);
  color: var(--muted);
}
.prose {
  margin: 0 0 0.7em;
}
.verse-number {
  font-family: var(--font-ui);
  font-size: 0.6em;
  font-weight: 700;
  color: var(--accent-ink);
  margin-right: 3px;
  line-height: 0;
  vertical-align: 0.55em;
}
.poem {
  font-family: var(--font-serif);
}
.poem__line {
  margin: 0;
  padding-left: 1.4em;
  text-indent: -1.4em;
}
.poem__line--in {
  padding-left: 2.6em;
}
.collect {
  margin-bottom: 14px;
}
.collect__title {
  margin: 0 0 2px;
  font-size: var(--text-sm);
  color: var(--muted);
}
.collect__text {
  margin: 0;
  font-style: italic;
}
.passage__status {
  font-size: var(--text-sm);
  color: var(--muted);
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
