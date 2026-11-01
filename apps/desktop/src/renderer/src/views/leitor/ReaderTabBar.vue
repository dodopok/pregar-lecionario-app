<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, FileText, Globe, Plus, X } from 'lucide-vue-next'
import { readerTabWidth } from '@pregar/core/reader'
import type { ReaderTabView, ReaderWebState } from '@shared/ipc-reader'
import PButton from '@/components/PButton.vue'
import { shortcut } from '@/lib/api'
import { dropsAfter, scrollToReveal, tabTooltip } from './reader-ui'

const props = defineProps<{
  tabs: ReaderTabView[]
  selectedID: string | null
  webStates: Record<string, ReaderWebState>
  canGoBack: boolean
  canGoForward: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  move: [id: string, targetID: string, after: boolean]
  menu: [id: string, x: number, y: number]
  back: []
  forward: []
  newTab: []
  copy: []
}>()

const DRAG_TYPE = 'application/x-pregar-reader-tab'
const scroller = ref<HTMLElement | null>(null)
const available = ref(0)
const dragging = ref<string | null>(null)
const dropTarget = ref<{ id: string; after: boolean } | null>(null)
const width = computed(() => readerTabWidth(available.value, props.tabs.length))
let observer: ResizeObserver | null = null

onMounted(() => {
  if (!scroller.value) return
  observer = new ResizeObserver(([entry]) => {
    available.value = entry?.contentRect.width ?? 0
  })
  observer.observe(scroller.value)
  available.value = scroller.value.clientWidth
  void reveal()
})
onBeforeUnmount(() => observer?.disconnect())

/** A aba selecionada fica sempre visível na barra. */
async function reveal(): Promise<void> {
  await nextTick()
  const container = scroller.value
  const id = props.selectedID
  if (!container || !id) return
  const element = container.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
  if (!element) return
  const target = scrollToReveal(container.scrollLeft, container.clientWidth, element.offsetLeft, element.offsetWidth)
  if (target !== container.scrollLeft) container.scrollTo({ left: target, behavior: 'smooth' })
}

watch(
  () => [props.selectedID, props.tabs.length, width.value],
  () => void reveal(),
)

function onWheel(event: WheelEvent): void {
  const container = scroller.value
  if (!container || container.scrollWidth <= container.clientWidth) return
  if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    container.scrollLeft += event.deltaY
    event.preventDefault()
  }
}

function onMouseDown(event: MouseEvent): void {
  // Botão do meio: sem rolagem automática; a aba fecha ao soltar.
  if (event.button === 1) event.preventDefault()
}

function onAuxClick(event: MouseEvent, tab: ReaderTabView): void {
  if (event.button !== 1) return
  event.preventDefault()
  emit('close', tab.id)
}

function onContextMenu(event: MouseEvent, tab: ReaderTabView): void {
  emit('menu', tab.id, event.clientX, event.clientY)
}

function onDragStart(event: DragEvent, tab: ReaderTabView): void {
  if (!event.dataTransfer) return
  dragging.value = tab.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DRAG_TYPE, tab.id)
  event.dataTransfer.setData('text/plain', tab.title)
}

function onDragOver(event: DragEvent, tab: ReaderTabView): void {
  if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = tab.id === dragging.value ? null : { id: tab.id, after: dropsAfter(event.clientX - rect.left, rect.width) }
}

function onDrop(event: DragEvent, tab: ReaderTabView): void {
  const id = event.dataTransfer?.getData(DRAG_TYPE)
  const target = dropTarget.value
  dropTarget.value = null
  dragging.value = null
  if (!id || !target || id === tab.id) return
  event.preventDefault()
  emit('move', id, tab.id, target.after)
}

function onDragEnd(): void {
  dragging.value = null
  dropTarget.value = null
}

/** Setas movem o foco entre as abas; Enter ou espaço seleciona; Delete fecha. */
function onTabKeydown(event: KeyboardEvent, index: number): void {
  const buttons = scroller.value ? [...scroller.value.querySelectorAll<HTMLElement>('[role="tab"]')] : []
  let next = -1
  if (event.key === 'ArrowRight') next = Math.min(buttons.length - 1, index + 1)
  else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else if (event.key === 'Delete') {
    const tab = props.tabs[index]
    if (tab) emit('close', tab.id)
    event.preventDefault()
    return
  }
  if (next < 0) return
  event.preventDefault()
  buttons[next]?.focus()
}
</script>

<template>
  <header class="reader-tabbar drag-region">
    <PButton
      variant="icon"
      compact
      :disabled="!canGoBack"
      label="Voltar"
      :title="`Voltar (${shortcut('⌘[')})`"
      @click="emit('back')"
    >
      <ChevronLeft :size="16" aria-hidden="true" />
    </PButton>
    <PButton
      variant="icon"
      compact
      :disabled="!canGoForward"
      label="Avançar"
      :title="`Avançar (${shortcut('⌘]')})`"
      @click="emit('forward')"
    >
      <ChevronRight :size="16" aria-hidden="true" />
    </PButton>

    <div ref="scroller" class="reader-tabs no-drag" role="tablist" aria-label="Abas do Leitor" @wheel="onWheel">
      <div
        v-for="(tab, index) in tabs"
        :key="tab.id"
        class="reader-tab"
        :class="{
          'reader-tab--selected': tab.id === selectedID,
          'reader-tab--dragging': tab.id === dragging,
          'reader-tab--drop-before': dropTarget?.id === tab.id && !dropTarget.after,
          'reader-tab--drop-after': dropTarget?.id === tab.id && dropTarget.after,
        }"
        :style="{ width: `${width}px` }"
        :data-tab-id="tab.id"
        :title="tabTooltip(tab, webStates[tab.id]?.url)"
        draggable="true"
        @mousedown="onMouseDown"
        @auxclick="onAuxClick($event, tab)"
        @contextmenu.prevent="onContextMenu($event, tab)"
        @dragstart="onDragStart($event, tab)"
        @dragover="onDragOver($event, tab)"
        @dragleave="dropTarget = dropTarget?.id === tab.id ? null : dropTarget"
        @drop="onDrop($event, tab)"
        @dragend="onDragEnd"
      >
        <button
          type="button"
          role="tab"
          class="reader-tab__main"
          :aria-selected="tab.id === selectedID"
          :tabindex="tab.id === selectedID ? 0 : -1"
          @click="emit('select', tab.id)"
          @keydown="onTabKeydown($event, index)"
        >
          <span
            v-if="tab.kind === 'web' && webStates[tab.id]?.loading"
            class="reader-tab__spinner"
            role="progressbar"
            aria-label="Carregando"
          />
          <FileText v-else-if="tab.kind === 'pdf'" :size="13" aria-hidden="true" />
          <Globe v-else :size="13" aria-hidden="true" />
          <span class="reader-tab__title">{{ tab.title }}</span>
          <span v-if="tab.includedInReview" class="reader-tab__review" title="Marcado para a revisão" aria-label="marcado para a revisão" />
        </button>
        <button
          type="button"
          class="reader-tab__close"
          :aria-label="`Fechar ${tab.title}`"
          :title="`Fechar aba (${shortcut('⌘W')} ou botão do meio)`"
          tabindex="-1"
          @click.stop="emit('close', tab.id)"
        >
          <X :size="11" aria-hidden="true" />
        </button>
      </div>
    </div>

    <PButton variant="icon" compact label="Nova aba" :title="`Nova aba (${shortcut('⌘T')})`" @click="emit('newTab')">
      <Plus :size="16" aria-hidden="true" />
    </PButton>
    <PButton
      variant="icon"
      compact
      :disabled="selectedID === null"
      label="Copiar seleção com a origem"
      title="Copiar seleção com a origem"
      @click="emit('copy')"
    >
      <Copy :size="15" aria-hidden="true" />
    </PButton>
  </header>
</template>

<style scoped>
.reader-tabbar {
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-md) 0 calc(var(--space-md) + var(--window-controls-inset));
  background: var(--canvas);
}
.reader-tabs {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding: 0 2px;
}
.reader-tabs::-webkit-scrollbar {
  height: 4px;
}
.reader-tabs::-webkit-scrollbar-thumb {
  background: var(--line-strong);
  border-radius: 4px;
}
.reader-tab {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  height: 32px;
  border-radius: 7px;
  color: var(--muted);
  transition: background 0.12s var(--ease);
}
.reader-tab:hover {
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}
.reader-tab--selected,
.reader-tab--selected:hover {
  color: var(--ink);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line);
}
.reader-tab--dragging {
  opacity: 0.5;
}
.reader-tab--drop-before::before,
.reader-tab--drop-after::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.reader-tab--drop-before::before {
  left: -3px;
}
.reader-tab--drop-after::after {
  right: -3px;
}
.reader-tab__main {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 9px;
  border: none;
  background: none;
  color: inherit;
  font-size: 12px;
  text-align: left;
  border-radius: 7px;
}
.reader-tab--selected .reader-tab__main {
  font-weight: 600;
}
.reader-tab__main:focus-visible {
  outline-offset: -2px;
}
.reader-tab__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.reader-tab__review {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.reader-tab__spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: reader-spin 0.8s linear infinite;
}
.reader-tab__close {
  flex: none;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--muted);
  opacity: 0;
}
.reader-tab:hover .reader-tab__close,
.reader-tab--selected .reader-tab__close,
.reader-tab__close:focus-visible {
  opacity: 1;
}
.reader-tab__close:hover {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 9%, transparent);
}
@keyframes reader-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
