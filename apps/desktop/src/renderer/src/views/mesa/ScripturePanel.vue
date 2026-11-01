<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, CircleCheck, Circle, KeyRound, PanelLeftClose, Quote, RefreshCw, CalendarX } from 'lucide-vue-next'
import { readingId, readingLabel } from '@pregar/core/liturgy/types'
import type { BiblePassageText, BibleVersion, LiturgicalReading } from '@pregar/core/liturgy/types'
import { longDatePt, parseDateKey } from '@pregar/core/util/dates'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke, shortcut } from '@/lib/api'
import { insertEpigraph } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'

const emit = defineEmits<{ collapse: [] }>()
const mesa = useMesaStore()
const app = useAppStore()
const expanded = ref<Set<string>>(new Set())
const versions = ref<BibleVersion[]>([])

const primaryBible = computed(() => app.settings.liturgy.bible)
const translations = computed(() => {
  const codes = [primaryBible.value, ...app.settings.liturgy.comparisonBibles.filter((code) => code !== primaryBible.value)]
  return codes.map((code) => ({ code, label: versions.value.find((version) => version.code === code)?.name ?? code.toUpperCase() }))
})
const readings = computed(() => mesa.day?.readings ?? [])
const collects = computed(() => (mesa.day?.collect ?? []).filter((collect) => collect.text?.trim()))
const celebrations = computed(() => (mesa.day?.celebrations ?? []).filter((item) => item.name !== mesa.day?.celebration?.name))
const showingPreviousDay = computed(() => Boolean(mesa.day && mesa.day.date !== mesa.selectedDateKey && mesa.dayLoading))

watch(
  () => mesa.day?.date,
  () => {
    // O Evangelho (ou o texto principal) abre expandido, como no app Swift.
    const next = new Set<string>()
    for (const reading of readings.value) {
      if (isPrimary(reading) || (!mesa.record?.mainReadingReference && reading.slot === 'gospel')) next.add(readingId(reading))
    }
    expanded.value = next
  },
  { immediate: true },
)

void invoke('liturgy:bibleVersions')
  .then((list) => (versions.value = list))
  .catch(() => undefined)

function isPrimary(reading: LiturgicalReading): boolean {
  return mesa.record?.mainReadingReference === reading.reference && mesa.record?.mainReadingSlot === reading.slot
}

function toggle(reading: LiturgicalReading): void {
  const id = readingId(reading)
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

async function choose(reading: LiturgicalReading): Promise<void> {
  await mesa.chooseMainReading(reading)
  expanded.value = new Set([...expanded.value, readingId(reading)])
}

function textFor(reading: LiturgicalReading): BiblePassageText | null | undefined {
  if (mesa.selectedBible === primaryBible.value) return reading.text
  return mesa.alternativeTexts[mesa.selectedBible]?.[readingId(reading)]
}

function openBible(reference: string): void {
  void invoke('app:openWindow', { window: 'biblia', route: `/biblia?ref=${encodeURIComponent(reference)}` })
}

function selectedDayLabel(): string {
  const date = parseDateKey(mesa.selectedDateKey)
  return date ? longDatePt(date) : mesa.selectedDateKey
}
</script>

<template>
  <section class="scripture" aria-label="Leituras do dia">
    <header class="scripture__header">
      <SectionLabel title="Leituras" />
      <span class="spacer" />
      <select
        v-if="translations.length > 0 && mesa.day"
        class="field field--compact"
        :value="mesa.selectedBible"
        title="Tradução exibida nas leituras"
        aria-label="Tradução exibida nas leituras"
        @change="mesa.loadTranslation(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="translation in translations" :key="translation.code" :value="translation.code">{{ translation.code.toUpperCase() }}</option>
      </select>
      <PButton variant="icon" compact :label="`Ocultar painel de leituras (${shortcut('⇧⌥⌘2')})`" @click="emit('collapse')">
        <PanelLeftClose :size="15" />
      </PButton>
    </header>

    <div v-if="mesa.day" class="scroll scripture__body" :aria-busy="showingPreviousDay">
      <div v-if="showingPreviousDay" class="scripture__overlay" role="status">
        <Spinner />
        <span>Atualizando leituras para {{ selectedDayLabel() }}…</span>
      </div>

      <section v-if="collects.length > 0" class="collect" aria-label="Coleta do dia">
        <SectionLabel :title="collects.length === 1 ? 'Coleta do dia' : 'Coletas do dia'" class="collect__label" />
        <article v-for="(collect, index) in collects" :key="index" class="collect__item">
          <p v-if="collect.title || collect.subtitle" class="collect__title">{{ [collect.title, collect.subtitle].filter(Boolean).join(' · ') }}</p>
          <p class="serif collect__text selectable">{{ collect.text }}</p>
          <PButton variant="link" compact title="Insere a coleta no início do manuscrito, como citação em bloco" @click="insertEpigraph(collect.text ?? '', collect.title ? `Coleta · ${collect.title}` : 'Coleta do dia')">
            <Quote :size="13" /> Inserir como epígrafe
          </PButton>
        </article>
        <p class="collect__hint">A coleta se liga às leituras e ao tempo litúrgico; lê-la antes ajuda a ver conexões.</p>
      </section>

      <article
        v-for="reading in readings"
        :key="readingId(reading)"
        class="reading"
        :class="{ 'reading--primary': isPrimary(reading) }"
      >
        <div class="reading__head">
          <button type="button" class="reading__toggle" :aria-expanded="expanded.has(readingId(reading))" @click="toggle(reading)">
            <span class="reading__label">
              {{ readingLabel(reading).toUpperCase() }}<span v-if="reading.slot === 'gospel' && readingLabel(reading) !== 'Evangelho'" class="reading__gospel"> · EVANGELHO</span>
            </span>
            <span class="serif reading__reference">{{ reading.reference }}</span>
            <span v-if="reading.alternatives?.length" class="reading__alternatives">ou {{ reading.alternatives.join(' · ') }}</span>
          </button>
          <button
            type="button"
            class="reading__choose"
            :title="isPrimary(reading) ? 'Texto principal do sermão' : 'Usar como texto principal'"
            :aria-label="isPrimary(reading) ? 'Desmarcar texto principal' : `Usar ${readingLabel(reading)} como texto principal`"
            :aria-pressed="isPrimary(reading)"
            @click="choose(reading)"
          >
            <CircleCheck v-if="isPrimary(reading)" :size="18" />
            <Circle v-else :size="18" />
          </button>
        </div>
        <div v-if="isPrimary(reading)" class="reading__primary-row">
          <SectionLabel title="Texto principal do sermão" class="reading__primary-label" />
          <PButton variant="link" compact title="Abrir na Bíblia para comparar traduções" @click="openBible(reading.reference)"><BookOpen :size="13" /> Comparar</PButton>
        </div>
        <div v-if="expanded.has(readingId(reading))" class="reading__text selectable">
          <template v-if="textFor(reading)?.verses?.length">
            <p v-for="verse in textFor(reading)!.verses!" :key="`${verse.chapter}:${verse.number}`" class="verse">
              <span class="verse__number">{{ verse.number }}</span>
              <span class="serif verse__text">{{ verse.text }}</span>
            </p>
          </template>
          <p v-else-if="textFor(reading)?.content" class="serif verse__text">{{ textFor(reading)!.content }}</p>
          <p v-else-if="mesa.selectedBible !== primaryBible && mesa.loadingBibles.has(mesa.selectedBible)" class="reading__status">
            <Spinner :size="12" /> Buscando em {{ mesa.selectedBible.toUpperCase() }}…
          </p>
          <p v-else class="reading__status">O texto desta leitura não está disponível nesta tradução.</p>
        </div>
      </article>

      <section v-if="celebrations.length > 0" class="celebrations">
        <SectionLabel title="Comemorações" />
        <p v-for="celebration in celebrations" :key="celebration.name" class="celebration">{{ celebration.name }}</p>
      </section>

      <p v-if="readings.length === 0" class="reading__status">Não há leituras cadastradas para este dia no livro de oração escolhido.</p>
    </div>

    <div v-else class="scripture__empty">
      <template v-if="mesa.dayLoading">
        <Spinner />
        <p>Consultando o calendário…</p>
      </template>
      <template v-else-if="app.liturgyAccess.mode === 'none'">
        <KeyRound :size="22" aria-hidden="true" />
        <p>Conecte a Estêvão API para carregar as leituras do dia.</p>
        <p class="muted">Assinantes do Pregar não precisam de chave.</p>
        <PButton variant="primary" @click="invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/conta' })">Assinar ou configurar</PButton>
      </template>
      <template v-else-if="mesa.dayError">
        <CalendarX :size="22" aria-hidden="true" />
        <p class="scripture__error-title">Não foi possível carregar este dia</p>
        <p class="muted">{{ mesa.dayError }}</p>
        <PButton variant="secondary" @click="mesa.loadDay()"><RefreshCw :size="13" /> Tentar novamente</PButton>
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
  height: 45px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 16px;
}
.field--compact {
  height: 24px;
  font-size: 11px;
  padding: 0 6px;
}
.scripture__body {
  position: relative;
  flex: 1;
  padding: 0 12px 24px;
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
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
}
.collect {
  margin: 4px 0 12px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  background: var(--accent-softer);
}
.collect__label :deep(*),
.collect__label {
  color: var(--accent);
}
.collect__title {
  margin: 6px 0 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.collect__text {
  margin: 6px 0 4px;
  font-size: 13px;
  line-height: 1.5;
}
.collect__hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--muted);
}
.reading {
  padding: 12px 10px;
  border-radius: 9px;
  border-bottom: 1px solid var(--line);
}
.reading--primary {
  border-bottom-color: transparent;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.reading__head {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}
.reading__toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
}
.reading__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.reading--primary .reading__label,
.reading__gospel {
  color: var(--accent);
}
.reading__reference {
  font-size: 16px;
  font-weight: 600;
}
.reading__alternatives {
  font-size: 12px;
  color: var(--muted);
}
.reading__choose {
  flex: none;
  width: 27px;
  height: 27px;
  border: none;
  border-radius: 14px;
  background: none;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--muted) 55%, transparent);
}
.reading__choose:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.reading--primary .reading__choose {
  color: var(--accent);
}
.reading__primary-row {
  display: flex;
  align-items: center;
  margin-top: 6px;
}
.reading__primary-label {
  color: var(--accent);
  flex: 1;
}
.reading__text {
  margin-top: 8px;
}
.verse {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 8px;
  margin: 0 0 8px;
}
.verse__number {
  font-size: 10px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--accent) 85%, transparent);
  padding-top: 3px;
}
.verse__text {
  font-size: 14px;
  line-height: 1.5;
  color: color-mix(in srgb, var(--ink) 90%, transparent);
  margin: 0;
}
.reading__status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--muted);
  margin: 8px 0;
}
.celebrations {
  margin-top: 14px;
  padding: 0 10px;
}
.celebration {
  margin: 6px 0 0;
  font-size: 12px;
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
  font-size: 12px;
  color: var(--muted);
}
.scripture__empty p {
  margin: 0;
  max-width: 260px;
}
.scripture__error-title {
  font-weight: 600;
  color: var(--ink);
}
</style>
