<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LibrarySectionRow } from '@shared/ipc-library'
import {
  MATCH_LABELS,
  buildOffsets,
  highlightParts,
  pageRange,
  scrollToReveal,
  sectionRowHeight,
  visibleRange,
  type FilteredSection,
} from './library-helpers'

/**
 * Lista virtualizada das seções de uma obra (centenas de linhas): só as linhas visíveis são
 * montadas. Clique abre no Leitor; botão do meio ou ⌘/Ctrl-clique abre ao fundo; ⇧ seleciona.
 */
const props = defineProps<{ items: FilteredSection[]; query: string; disabled?: boolean }>()
const emit = defineEmits<{ open: [row: LibrarySectionRow, options: { background: boolean; select: boolean }] }>()

const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(400)
const activeIndex = ref(0)
let observer: ResizeObserver | null = null

const offsets = computed(() => buildOffsets(props.items.map((item) => sectionRowHeight(item.row))))
const totalHeight = computed(() => offsets.value[offsets.value.length - 1] ?? 0)
const range = computed(() => visibleRange(offsets.value, scrollTop.value, viewportHeight.value, 8))
const visible = computed(() =>
  props.items.slice(range.value.start, range.value.end).map((item, offset) => {
    const index = range.value.start + offset
    return { item, index, top: offsets.value[index] ?? 0, height: sectionRowHeight(item.row) }
  }),
)

watch(
  () => props.items,
  () => {
    activeIndex.value = 0
    if (viewport.value) viewport.value.scrollTop = 0
    scrollTop.value = 0
  },
)

let frame = 0
function onScroll(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    scrollTop.value = viewport.value?.scrollTop ?? 0
  })
}

onMounted(() => {
  if (!viewport.value) return
  viewportHeight.value = viewport.value.clientHeight
  observer = new ResizeObserver(() => {
    viewportHeight.value = viewport.value?.clientHeight ?? viewportHeight.value
  })
  observer.observe(viewport.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

function openOptions(event: MouseEvent | KeyboardEvent): { background: boolean; select: boolean } {
  const middle = event instanceof MouseEvent && event.button === 1
  return { background: middle || event.metaKey || event.ctrlKey, select: event.shiftKey }
}

function onClick(row: LibrarySectionRow, event: MouseEvent): void {
  if (props.disabled) return
  emit('open', row, openOptions(event))
}

function onAuxClick(row: LibrarySectionRow, event: MouseEvent): void {
  if (event.button !== 1 || props.disabled) return
  event.preventDefault()
  emit('open', row, openOptions(event))
}

async function focusIndex(index: number): Promise<void> {
  const count = props.items.length
  if (count === 0) return
  activeIndex.value = Math.max(0, Math.min(count - 1, index))
  const element = viewport.value
  if (element) {
    element.scrollTop = scrollToReveal(offsets.value, activeIndex.value, element.scrollTop, element.clientHeight)
    scrollTop.value = element.scrollTop
  }
  await nextTick()
  viewport.value?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)?.focus({ preventScroll: true })
}

function onKeydown(event: KeyboardEvent): void {
  const page = Math.max(1, Math.floor(viewportHeight.value / 40))
  const moves: Record<string, number> = {
    ArrowDown: activeIndex.value + 1,
    ArrowUp: activeIndex.value - 1,
    PageDown: activeIndex.value + page,
    PageUp: activeIndex.value - page,
    Home: 0,
    End: props.items.length - 1,
  }
  const target = moves[event.key]
  if (target === undefined) return
  event.preventDefault()
  void focusIndex(target)
}

function badgeTitle(row: LibrarySectionRow): string {
  return `${row.methodLabel} · confiança ${row.confidenceLabel}`
}

function methodShort(row: LibrarySectionRow): string {
  switch (row.method) {
    case 'bookmark':
      return 'bookmark'
    case 'textHeading':
      return 'cabeçalho'
    case 'ocrHeading':
      return 'OCR'
    default:
      return 'origem ?'
  }
}

/** Torna o primeiro item focável quando a lista ganha o foco pelo Tab. */
function onFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement
  const index = Number(target.dataset.index)
  if (Number.isInteger(index)) activeIndex.value = index
}

defineExpose({ focusFirst: () => focusIndex(0) })
</script>

<template>
  <div class="sections">
    <div class="sections__head" aria-hidden="true">
      <span>Passagem / seção</span>
      <span>Páginas físicas</span>
    </div>
    <div
      ref="viewport"
      class="sections__viewport scroll"
      role="list"
      aria-label="Seções encontradas"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
      @focusin="onFocusIn"
    >
      <div class="sections__spacer" :style="{ height: `${totalHeight}px` }">
        <div
          v-for="entry in visible"
          :key="entry.item.row.id"
          class="sections__row-wrap"
          role="listitem"
          :style="{ transform: `translateY(${entry.top}px)`, height: `${entry.height}px` }"
        >
          <button
            type="button"
            class="sections__row"
            :class="{ 'sections__row--match': entry.item.match === 'exact' }"
            :data-index="entry.index"
            :tabindex="entry.index === activeIndex ? 0 : -1"
            :disabled="disabled"
            :title="`Abrir no leitor na página física ${entry.item.row.startPage}`"
            :aria-label="`${entry.item.row.title}${entry.item.row.context ? `, ${entry.item.row.context}` : ''}, páginas físicas ${pageRange(entry.item.row)}${entry.item.match ? `, ${MATCH_LABELS[entry.item.match]}` : ''}, ${badgeTitle(entry.item.row)}`"
            @click="onClick(entry.item.row, $event)"
            @auxclick="onAuxClick(entry.item.row, $event)"
            @mousedown.middle.prevent
          >
            <span class="sections__text">
              <span class="sections__title" :class="{ 'sections__title--reference': entry.item.row.isReference }">
                <template v-for="(part, partIndex) in highlightParts(entry.item.row.title, query)" :key="partIndex">
                  <mark v-if="part.marked">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="entry.item.row.context" class="sections__context">
                <template v-for="(part, partIndex) in highlightParts(entry.item.row.context, query)" :key="partIndex">
                  <mark v-if="part.marked">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span v-if="entry.item.match" class="badge badge--match" :class="`badge--${entry.item.match}`">
              {{ MATCH_LABELS[entry.item.match] }}
            </span>
            <span class="badge" :class="`badge--${entry.item.row.confidence}`" :title="badgeTitle(entry.item.row)">
              {{ methodShort(entry.item.row) }}
            </span>
            <span class="sections__pages">{{ pageRange(entry.item.row) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sections {
  flex: 1;
  min-height: 280px;
  display: flex;
  flex-direction: column;
}
.sections__head {
  flex: none;
  display: flex;
  justify-content: space-between;
  height: 34px;
  align-items: center;
  padding: 0 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.sections__viewport {
  flex: 1;
  min-height: 120px;
  position: relative;
}
.sections__spacer {
  position: relative;
  width: 100%;
}
.sections__row-wrap {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.sections__row {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: none;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  text-align: left;
  transition: background 0.1s;
}
.sections__row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.sections__row:active:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.sections__row:focus-visible {
  outline-offset: -2px;
  border-radius: 6px;
}
.sections__row--match {
  background: var(--accent-softer);
}
.sections__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sections__title,
.sections__context {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sections__title {
  font-size: 12px;
  color: var(--ink);
}
.sections__title--reference {
  font-weight: 500;
}
.sections__context {
  font-size: 10px;
  color: var(--muted);
}
mark {
  color: inherit;
  background: var(--accent-soft);
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--accent-soft);
}
.sections__pages {
  flex: none;
  min-width: 52px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.badge {
  flex: none;
  height: 18px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.badge--high {
  color: var(--accent);
  background: var(--accent-softer);
}
.badge--low {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}
.badge--unverified {
  font-style: italic;
}
.badge--match {
  font-weight: 600;
}
.badge--exact {
  color: var(--accent-contrast);
  background: var(--accent);
}
.badge--partial {
  color: var(--accent);
  background: var(--accent-soft);
}
.badge--context {
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
</style>
