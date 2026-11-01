<script setup lang="ts">
/**
 * Mapa do sermão devolvido pela revisão (porte de `SermonStructureMapView`): as três partes com a
 * função de cada uma, a ideia dominante, os movimentos, o lugar da Boa Nova e as quatro páginas.
 * Cada trecho é um botão que seleciona a passagem correspondente no manuscrito.
 */
import { computed } from 'vue'
import { CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleX, History, ScanText } from 'lucide-vue-next'
import {
  STRUCTURE_ANCHOR_STATUS_TITLES,
  STRUCTURE_IDEA_STATUS_TITLES,
  STRUCTURE_PAGE_SHORT_TITLES,
  STRUCTURE_PAGE_TITLES,
  STRUCTURE_PRESENCE_TITLES,
  STRUCTURE_SECTION_EXPECTATIONS,
  STRUCTURE_SECTION_TITLES,
  STRUCTURE_VERDICT_TITLES,
} from '@pregar/core/ai'
import type { SermonStructureAssessment, StructurePage, StructureSection } from '@pregar/core/ai'
import SectionLabel from '@/components/SectionLabel.vue'

const props = withDefaults(defineProps<{ structure: SermonStructureAssessment; stale?: boolean; compact?: boolean }>(), {
  stale: false,
  compact: false,
})
const emit = defineEmits<{ select: [quote: string] }>()

const verdictTone = computed(() => ({ solid: 'accent', attention: 'warning', fragile: 'danger' })[props.structure.verdict])

function sectionTone(section: StructureSection): 'accent' | 'warning' | 'danger' {
  return section.assessment === 'fulfills' ? 'accent' : section.assessment === 'partial' ? 'warning' : 'danger'
}

function pageTone(page: StructurePage): 'accent' | 'warning' | 'muted' {
  return page.status === 'present' ? 'accent' : page.status === 'brief' ? 'warning' : 'muted'
}

function pageHelp(page: StructurePage): string {
  return page.quote ? `${STRUCTURE_PAGE_TITLES[page.page]}: ir ao trecho` : `${STRUCTURE_PAGE_TITLES[page.page]}: não localizada`
}

const anchors = computed(() => [
  {
    id: 'idea',
    title: 'Ideia dominante',
    status: STRUCTURE_IDEA_STATUS_TITLES[props.structure.centralIdea.status],
    positive: props.structure.centralIdea.status === 'clear',
    statement: props.structure.centralIdea.statement,
    quote: props.structure.centralIdea.quote,
    note: props.structure.centralIdea.note,
  },
  {
    id: 'gospel',
    title: 'Boa Nova de Cristo',
    status: STRUCTURE_ANCHOR_STATUS_TITLES[props.structure.gospel.status],
    positive: props.structure.gospel.status === 'explicit',
    statement: '',
    quote: props.structure.gospel.quote,
    note: props.structure.gospel.note,
  },
])
</script>

<template>
  <section class="map" :class="{ 'map--compact': compact }" aria-label="Mapa do sermão">
    <header class="map__header">
      <h3 class="serif map__title">Mapa do sermão</h3>
      <span class="map__verdict" :class="`tone-bg--${verdictTone}`" :aria-label="`Veredito: ${STRUCTURE_VERDICT_TITLES[structure.verdict]}`">
        {{ STRUCTURE_VERDICT_TITLES[structure.verdict] }}
      </span>
    </header>
    <p v-if="stale" class="map__stale"><History :size="12" aria-hidden="true" /> O texto mudou depois deste mapa.</p>
    <p v-if="structure.summary" class="map__summary">{{ structure.summary }}</p>

    <ul class="map__sections" role="list">
      <li v-for="section in structure.sections" :key="section.kind" class="map__section">
        <span class="map__section-icon" :class="`tone--${sectionTone(section)}`" aria-hidden="true">
          <CircleCheck v-if="section.assessment === 'fulfills'" :size="14" />
          <CircleAlert v-else-if="section.assessment === 'partial'" :size="14" />
          <CircleX v-else :size="14" />
        </span>
        <div class="map__section-body">
          <div class="map__row">
            <span class="map__section-title">{{ STRUCTURE_SECTION_TITLES[section.kind] }}</span>
            <span class="map__status" :class="`tone--${sectionTone(section)}`">{{ STRUCTURE_PRESENCE_TITLES[section.assessment] }}</span>
            <span class="spacer" />
            <button
              v-if="section.startQuote"
              type="button"
              class="map__go"
              :aria-label="`Ir ao início da ${STRUCTURE_SECTION_TITLES[section.kind].toLowerCase()} no manuscrito`"
              title="Ir ao trecho no manuscrito"
              @click="emit('select', section.startQuote)"
            >
              <ScanText :size="13" />
            </button>
          </div>
          <p class="map__expectation">{{ STRUCTURE_SECTION_EXPECTATIONS[section.kind] }}</p>
          <p v-if="section.note" class="map__note">{{ section.note }}</p>
        </div>
      </li>
    </ul>

    <template v-for="(anchor, index) in anchors" :key="anchor.id">
      <div class="map__anchor">
        <div class="map__row">
          <SectionLabel :title="anchor.title" tag="h4" />
          <span class="map__status" :class="anchor.positive ? 'tone--accent' : 'tone--warning'">{{ anchor.status }}</span>
          <span class="spacer" />
          <button
            v-if="anchor.quote"
            type="button"
            class="map__go"
            :aria-label="`Ir ao trecho da ${anchor.title.toLowerCase()} no manuscrito`"
            title="Ir ao trecho no manuscrito"
            @click="emit('select', anchor.quote)"
          >
            <ScanText :size="13" />
          </button>
        </div>
        <p v-if="anchor.statement" class="serif map__statement">{{ anchor.statement }}</p>
        <button v-if="anchor.quote" type="button" class="map__quote" title="Selecionar este trecho no manuscrito" @click="emit('select', anchor.quote)">
          “{{ anchor.quote }}”
        </button>
        <p v-if="anchor.note" class="map__note">{{ anchor.note }}</p>
      </div>

      <div v-if="index === 0 && structure.movements.length > 0" class="map__movements">
        <SectionLabel title="Movimentos" tag="h4" />
        <ol class="map__movement-list">
          <li v-for="(movement, position) in structure.movements" :key="position" class="map__movement">
            <span class="map__movement-number" aria-hidden="true">{{ position + 1 }}.</span>
            <span class="map__movement-label">{{ movement.label }}</span>
            <button
              v-if="movement.startQuote"
              type="button"
              class="map__go"
              :aria-label="`Ir ao movimento ${position + 1} no manuscrito`"
              title="Ir ao trecho no manuscrito"
              @click="emit('select', movement.startQuote)"
            >
              <ScanText :size="13" />
            </button>
          </li>
        </ol>
      </div>
    </template>

    <div class="map__pages">
      <SectionLabel title="Quatro páginas" tag="h4" />
      <div class="map__page-grid">
        <button
          v-for="page in structure.fourPages"
          :key="page.page"
          type="button"
          class="map__page"
          :disabled="!page.quote"
          :title="pageHelp(page)"
          :aria-label="pageHelp(page)"
          @click="page.quote && emit('select', page.quote)"
        >
          <span :class="`tone--${pageTone(page)}`" aria-hidden="true">
            <CircleCheck v-if="page.status === 'present'" :size="11" />
            <CircleDot v-else-if="page.status === 'brief'" :size="11" />
            <CircleDashed v-else :size="11" />
          </span>
          <span class="map__page-title">{{ STRUCTURE_PAGE_SHORT_TITLES[page.page] }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
}
.map__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.map__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.map--compact .map__title {
  font-size: 14px;
}
.map__verdict {
  flex: none;
  height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent-contrast);
}
.tone-bg--accent {
  background: var(--accent);
}
.tone-bg--warning {
  background: var(--warning);
}
.tone-bg--danger {
  background: var(--danger);
}
.tone--accent {
  color: var(--accent);
}
.tone--warning {
  color: var(--warning);
}
.tone--danger {
  color: var(--danger);
}
.tone--muted {
  color: var(--muted);
}
.map__stale {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 10px;
  color: var(--warning);
}
.map__summary {
  margin: 0;
  font-size: 12px;
  color: color-mix(in srgb, var(--ink) 90%, transparent);
}
.map--compact .map__summary {
  font-size: 11px;
}
.map__sections {
  margin: 0;
  padding: 0;
  list-style: none;
}
.map__section {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.map__section-icon {
  flex: none;
  width: 16px;
  padding-top: 2px;
  display: grid;
  place-items: center;
}
.map__section-body {
  flex: 1;
  min-width: 0;
}
.map__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
}
.map__section-title {
  font-size: 12px;
  font-weight: 600;
}
.map__status {
  font-size: 10px;
  font-weight: 500;
}
.map__expectation {
  margin: 1px 0 0;
  font-size: 10px;
  color: var(--muted);
}
.map__note {
  margin: 2px 0 0;
  font-size: 11px;
  color: color-mix(in srgb, var(--ink) 85%, transparent);
}
.map__go {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--accent);
}
.map__go:hover {
  background: var(--accent-softer);
}
.map__anchor {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 2px;
}
.map__statement {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.map__quote {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 11px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.map__quote:hover {
  color: var(--ink);
}
.map__movements {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.map__movement-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.map__movement {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.map__movement-number {
  flex: none;
  width: 18px;
  text-align: right;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.map__movement-label {
  flex: 1;
  font-size: 11px;
}
.map__pages {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.map__page-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.map__page {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--ink) 4%, transparent);
  font-size: 10px;
  font-weight: 500;
  color: color-mix(in srgb, var(--ink) 85%, transparent);
  text-align: left;
  min-width: 0;
}
.map__page > span:first-child {
  display: grid;
  place-items: center;
}
.map__page:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.map__page:disabled {
  opacity: 1;
}
.map__page-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
