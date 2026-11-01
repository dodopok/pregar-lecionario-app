<script setup lang="ts">
import { computed, ref } from 'vue'
import { linkOpensNewTab, sectionId, sectionMatchesSearch, type PdfSectionLocation } from '@pregar/core/reader'
import SectionLabel from '@/components/SectionLabel.vue'
import Spinner from '@/components/Spinner.vue'
import { isMac } from '@/lib/api'

const props = defineProps<{
  title: string
  metadata: string
  sections: PdfSectionLocation[]
  loading: boolean
  activeSectionID: string | null
  printed: (page: number) => string | null
}>()

const emit = defineEmits<{
  go: [section: PdfSectionLocation]
  openInNewTab: [section: PdfSectionLocation, background: boolean]
  menu: [section: PdfSectionLocation, x: number, y: number]
}>()

const query = ref('')
const filtered = computed(() => props.sections.filter((section) => sectionMatchesSearch(section, query.value)))

/** Clique navega; botão do meio e ⌘clique abrem a seção em nova aba (⇧ seleciona). */
function onClick(event: MouseEvent, section: PdfSectionLocation): void {
  const gesture = linkOpensNewTab({ middleButton: false, commandKey: isMac() ? event.metaKey : event.ctrlKey, shiftKey: event.shiftKey })
  if (gesture === null) emit('go', section)
  else emit('openInNewTab', section, gesture)
}

function onAuxClick(event: MouseEvent, section: PdfSectionLocation): void {
  if (event.button !== 1) return
  event.preventDefault()
  emit('openInNewTab', section, !event.shiftKey)
}
</script>

<template>
  <aside class="sections" aria-label="Seções do PDF">
    <div class="sections__head">
      <h2 class="sections__title serif">{{ title }}</h2>
      <p class="sections__meta">{{ metadata }}</p>
    </div>
    <div class="sections__label">
      <SectionLabel title="Seções desta obra" />
      <Spinner v-if="loading" :size="12" label="Carregando seções" />
    </div>
    <input
      v-if="sections.length > 12"
      v-model="query"
      class="field sections__filter"
      type="search"
      placeholder="Filtrar seções"
      aria-label="Filtrar seções"
    />
    <ul class="sections__list scroll" role="list">
      <li v-for="section in filtered" :key="sectionId(section)">
        <button
          type="button"
          class="sections__item"
          :class="{ 'sections__item--active': sectionId(section) === activeSectionID }"
          :aria-current="sectionId(section) === activeSectionID ? 'location' : undefined"
          :title="section.context ? `${section.context} · ${section.title}` : section.title"
          @click="onClick($event, section)"
          @mousedown="$event.button === 1 && $event.preventDefault()"
          @auxclick="onAuxClick($event, section)"
          @contextmenu.prevent="emit('menu', section, $event.clientX, $event.clientY)"
        >
          <span class="sections__item-title">{{ section.title }}</span>
          <span class="sections__item-page">{{ printed(section.startPage) ?? section.startPage }}</span>
        </button>
      </li>
      <li v-if="!loading && sections.length === 0" class="sections__empty">Nenhuma seção encontrada neste PDF.</li>
      <li v-else-if="sections.length > 0 && filtered.length === 0" class="sections__empty">Nenhuma seção corresponde ao filtro.</li>
    </ul>
  </aside>
</template>

<style scoped>
.sections {
  flex: none;
  width: 230px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-lg) var(--space-sm) var(--space-sm) var(--space-lg);
  background: var(--paper);
  border-right: 1px solid var(--line);
}
.sections__head {
  padding-right: var(--space-sm);
}
.sections__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.sections__meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}
.sections__label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.sections__filter {
  margin-right: var(--space-sm);
  font-size: 12px;
}
.sections__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sections__item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: 12px;
  text-align: left;
  color: var(--ink);
}
.sections__item:hover {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}
.sections__item--active,
.sections__item--active:hover {
  font-weight: 600;
  background: var(--accent-soft);
}
.sections__item-title {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sections__item-page {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.sections__empty {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
}
</style>
