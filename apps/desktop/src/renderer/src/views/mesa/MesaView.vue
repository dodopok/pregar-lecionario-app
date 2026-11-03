<script setup lang="ts">
/**
 * Mesa: trilho, cabeçalho único, calendário (atracado ou em popover), leituras, manuscrito e
 * materiais, com o layout decidido por `layoutFor` a partir da largura da janela. Folhas, tela
 * cheia (leituras e ensaio) e o tour da primeira abertura ficam por cima.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Clock, PanelLeftOpen, PanelRightOpen } from 'lucide-vue-next'
import { estimatedPreachingMinutes, estimatedPulpitPages, formatMinutes } from '@pregar/core/util/text'
import { isSermonKey } from '@pregar/core/util/dates'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { errorMessage, invoke, on, shortcut } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import AppRail from './AppRail.vue'
import CalendarSidebar from './CalendarSidebar.vue'
import MesaHeader from './MesaHeader.vue'
import ScripturePanel from './ScripturePanel.vue'
import ManuscriptEditor from './editor/ManuscriptEditor.vue'
import { PANEL_LIMITS, layoutFor } from './mesa-layout'
import { printPulpitSheet } from './pulpit'

const ResourcePanel = defineAsyncComponent(() => import('./panels/ResourcePanel.vue'))
const MesaSheets = defineAsyncComponent(() => import('./sheets/MesaSheets.vue'))
const ReadingView = defineAsyncComponent(() => import('./ReadingView.vue'))
const RehearsalView = defineAsyncComponent(() => import('./RehearsalView.vue'))
const TourOverlay = defineAsyncComponent(() => import('./TourOverlay.vue'))

const mesa = useMesaStore()
const app = useAppStore()
const toasts = useToasts()
const panels = computed(() => app.settings.panels)
const widths = ref({
  calendar: panels.value.calendarWidth,
  readings: panels.value.readingsWidth,
  materials: panels.value.materialsWidth,
})
const windowWidth = ref(window.innerWidth)
const mainRegion = ref<HTMLElement | null>(null)

const layout = computed(() =>
  layoutFor({
    width: windowWidth.value,
    focus: mesa.focusMode,
    calendarOpen: panels.value.calendarOpen,
    readingsOpen: panels.value.readingsOpen,
    materialsOpen: panels.value.materialsOpen,
    widths: widths.value,
  }),
)
const calendarDocked = computed(() => layout.value.calendar === 'docked')
const showCalendarPopover = computed(() => layout.value.calendar === 'popover' && mesa.calendarPopover)
const showReadings = computed(() => layout.value.readings > 0)
const showMaterials = computed(() => layout.value.materials !== 'hidden')
const materialsDrawer = computed(() => layout.value.materials === 'drawer')

function togglePanel(panel: 'calendarOpen' | 'readingsOpen' | 'materialsOpen'): void {
  if (mesa.focusMode) mesa.focusMode = false
  void app.updateSettings({ panels: { [panel]: !panels.value[panel] } })
}

/** O botão de data atraca o calendário quando cabe; senão abre o popover. */
function toggleCalendar(): void {
  if (mesa.focusMode) mesa.focusMode = false
  if (
    layout.value.calendar === 'docked' ||
    (layout.value.calendar === 'hidden' && windowWidth.value >= 1280)
  ) {
    togglePanel('calendarOpen')
    return
  }
  if (windowWidth.value >= 1280 && !panels.value.calendarOpen) {
    togglePanel('calendarOpen')
    return
  }
  mesa.calendarPopover = !mesa.calendarPopover
}

function commitWidth(panel: 'calendarWidth' | 'readingsWidth' | 'materialsWidth', value: number): void {
  void app.updateSettings({ panels: { [panel]: value } })
}

const rhythm = computed(() => app.settings.rhythm)
const minutes = computed(() => estimatedPreachingMinutes(mesa.wordCount, rhythm.value.wordsPerMinute))
const pages = computed(() => estimatedPulpitPages(mesa.wordCount))
const durationLabel = computed(() => {
  if (mesa.wordCount === 0) return 'Sem texto ainda'
  const parts = [`${mesa.wordCount.toLocaleString('pt-BR')} palavras`, `≈ ${formatMinutes(minutes.value)}`]
  if (rhythm.value.showPages)
    parts.push(`${pages.value} ${pages.value === 1 ? 'página' : 'páginas'} no púlpito`)
  return parts.join(' · ')
})
const targetLabel = computed(() => {
  const target = rhythm.value.targetMinutes
  if (mesa.wordCount === 0) return `meta: ${target} min`
  const delta = Math.round(minutes.value - target)
  if (Math.abs(delta) <= 2) return `na meta de ${target} min`
  return delta > 0
    ? `${delta} min acima da meta de ${target}`
    : `${Math.abs(delta)} min abaixo da meta de ${target}`
})
const targetTone = computed(() => {
  if (mesa.wordCount === 0) return 'muted'
  const delta = minutes.value - rhythm.value.targetMinutes
  return delta > 5 ? 'warn' : 'muted'
})
const rhythmTitle = computed(() =>
  rhythm.value.measuredAt
    ? `Estimativa com o seu ritmo medido no Ensaio (${rhythm.value.wordsPerMinute} palavras por minuto)`
    : `Estimativa com o ritmo padrão de ${rhythm.value.wordsPerMinute} palavras por minuto. Meça o seu no Ensaio.`,
)
const saveLabel = computed(() => {
  switch (mesa.saveState) {
    case 'pending':
      return 'Alterações pendentes'
    case 'saving':
      return 'Salvando…'
    case 'error':
      return 'Não foi possível salvar'
    default:
      return 'Salvo neste computador'
  }
})
const driveLabel = computed(() => {
  const drive = mesa.record?.drive
  if (!drive?.documentId) return null
  if (drive.syncError)
    return drive.syncError.toLowerCase().includes('mudou fora') ? 'Drive · conflito' : 'Drive · erro'
  if (drive.syncedAt)
    return `Drive · atualizado ${new Date(drive.syncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  return 'Drive · aguardando sincronização'
})
const windowTitle = computed(
  () => mesa.record?.mainReadingReference || mesa.occasion || 'Preparação do sermão',
)
watch(windowTitle, (title) => void invoke('app:setTitle', { title: `${title} · Pregar` }), {
  immediate: true,
})

async function printDirect(): Promise<void> {
  try {
    const result = await printPulpitSheet(mesa, app)
    if (result.message) toasts.show(result.message, 'error')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

function onResize(): void {
  windowWidth.value = window.innerWidth
}

function onDocumentPointer(event: PointerEvent): void {
  if (!mesa.calendarPopover) return
  const target = event.target as HTMLElement
  if (target.closest('.calendar-popover') || target.closest('[data-tour="date"]')) return
  mesa.calendarPopover = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && mesa.calendarPopover) mesa.calendarPopover = false
}

const offs: (() => void)[] = []
onMounted(() => {
  mesa.initialize()
  window.addEventListener('resize', onResize)
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onKeydown)
  offs.push(
    on('menu:command', ({ command }) => {
      const actions: Record<string, () => void> = {
        toggleCalendar,
        toggleReadings: () => togglePanel('readingsOpen'),
        toggleMaterials: () => togglePanel('materialsOpen'),
        focusMode: () => (mesa.focusMode = !mesa.focusMode),
        readingsFullscreen: () =>
          mesa.fullscreen === 'readings' ? (mesa.fullscreen = null) : mesa.openFullscreen('readings'),
        review: () => mesa.requestReview(),
        questions: () => mesa.openSheet('questions'),
        rehearsal: () => mesa.openFullscreen('rehearsal'),
        history: () => mesa.openSheet('history'),
        pulpit: () => mesa.openSheet('pulpit'),
        tablet: () => mesa.openSheet('pulpit'),
        print: () => void printDirect(),
        drive: () => mesa.openSheet('drive'),
        shortcuts: () => mesa.openSheet('shortcuts'),
        commandSearch: () => mesa.openSheet('commands'),
        captureIdea: () => mesa.requestIdeaCapture(),
        tour: () => (mesa.tourOpen = true),
      }
      actions[command]?.()
    }),
    on('navigate', ({ route }) => {
      const requested = new URLSearchParams(route.split('?')[1] ?? '').get('date')
      if (requested && isSermonKey(requested)) {
        mesa.focusMode = false
        void mesa.selectDate(requested)
      }
    }),
  )
  if (!app.settings.onboarding.tourDone) mesa.tourOpen = true
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onKeydown)
  for (const off of offs) off()
})
</script>

<template>
  <div class="mesa" :class="{ 'mesa--focus': mesa.focusMode }">
    <AppRail :compact="layout.rail === 'compact'" />

    <div ref="mainRegion" class="mesa__main">
      <MesaHeader
        :labels="layout.labels"
        :wide="windowWidth >= 1280"
        :calendar-docked="calendarDocked"
        @toggle-calendar="toggleCalendar"
        @toggle-readings="togglePanel('readingsOpen')"
        @toggle-materials="togglePanel('materialsOpen')"
        @print="printDirect"
      />

      <div class="mesa__content">
        <template v-if="calendarDocked">
          <div class="mesa__calendar" :style="{ width: `${layout.calendarWidth}px` }" data-tour="calendar">
            <CalendarSidebar @collapse="togglePanel('calendarOpen')" />
          </div>
          <ResizeHandle
            v-model:width="widths.calendar"
            :min="PANEL_LIMITS.calendar.min"
            :max="PANEL_LIMITS.calendar.max"
            label="Largura do calendário"
            @commit="commitWidth('calendarWidth', $event)"
          />
        </template>

        <template v-if="showReadings">
          <div class="mesa__readings" :style="{ width: `${layout.readings}px` }" data-tour="readings">
            <ScripturePanel @collapse="togglePanel('readingsOpen')" />
          </div>
          <ResizeHandle
            v-model:width="widths.readings"
            :min="PANEL_LIMITS.readings.min"
            :max="layout.readingsMax"
            label="Largura das leituras"
            @commit="commitWidth('readingsWidth', $event)"
          />
        </template>
        <button
          v-else-if="!mesa.focusMode"
          type="button"
          class="strip"
          data-tour="readings"
          :title="`Mostrar as leituras do dia (${shortcut('⇧⌥⌘2')})`"
          aria-label="Mostrar as leituras do dia"
          @click="togglePanel('readingsOpen')"
        >
          <PanelLeftOpen :size="14" /><span>Leituras</span>
        </button>

        <div class="mesa__editor" data-tour="editor">
          <ManuscriptEditor v-if="mesa.record" :key="mesa.selectedDateKey" />
          <div v-else class="mesa__placeholder"><span class="serif">Preparando o manuscrito</span></div>
        </div>

        <template v-if="showMaterials && !materialsDrawer">
          <ResizeHandle
            v-model:width="widths.materials"
            :min="PANEL_LIMITS.materials.min"
            :max="layout.materialsMax"
            :grows-to-right="false"
            label="Largura dos materiais"
            @commit="commitWidth('materialsWidth', $event)"
          />
          <div class="mesa__materials" :style="{ width: `${layout.materialsWidth}px` }" data-tour="materials">
            <ResourcePanel @collapse="togglePanel('materialsOpen')" />
          </div>
        </template>
        <button
          v-else-if="!mesa.focusMode && !showMaterials"
          type="button"
          class="strip strip--right"
          data-tour="materials"
          :title="`Mostrar materiais, ideias e revisão (${shortcut('⇧⌥⌘3')})`"
          aria-label="Mostrar materiais, ideias e revisão"
          @click="togglePanel('materialsOpen')"
        >
          <PanelRightOpen :size="14" /><span>Materiais</span>
        </button>

        <!-- Em janelas estreitas os materiais abrem como gaveta sobre o manuscrito. -->
        <div
          v-if="showMaterials && materialsDrawer"
          class="mesa__drawer"
          :style="{ width: `${layout.materialsWidth}px` }"
          data-tour="materials"
        >
          <ResourcePanel @collapse="togglePanel('materialsOpen')" />
        </div>

        <div v-if="showCalendarPopover" class="calendar-popover" role="dialog" aria-label="Calendário">
          <CalendarSidebar popover @collapse="mesa.calendarPopover = false" />
        </div>
      </div>

      <footer v-if="mesa.record" class="status">
        <span class="status__counts" :title="rhythmTitle">{{ durationLabel }}</span>
        <span class="status__target" :class="`status__target--${targetTone}`">{{ targetLabel }}</span>
        <span class="spacer" />
        <span class="status__save" :class="`status__save--${mesa.saveState}`" role="status">{{
          saveLabel
        }}</span>
        <button
          v-if="mesa.saveState === 'error'"
          type="button"
          class="status__link"
          :title="mesa.saveError ?? ''"
          @click="mesa.flush()"
        >
          Tentar de novo
        </button>
        <button
          v-if="driveLabel"
          type="button"
          class="status__link"
          :class="{ 'status__link--warn': mesa.record.drive.syncError }"
          @click="mesa.openSheet('drive')"
        >
          {{ driveLabel }}
        </button>
        <button
          type="button"
          class="status__link status__link--accent"
          :title="`Abrir histórico recuperável deste sermão (${shortcut('⇧⌥⌘H')})`"
          @click="mesa.openSheet('history')"
        >
          <Clock :size="12" /> v{{ mesa.currentVersion }} · histórico
        </button>
      </footer>
    </div>

    <MesaSheets v-if="mesa.activeSheet" />
    <ReadingView v-if="mesa.fullscreen === 'readings'" @close="mesa.fullscreen = null" />
    <RehearsalView v-if="mesa.fullscreen === 'rehearsal'" @close="mesa.fullscreen = null" />
    <TourOverlay v-if="mesa.tourOpen" @close="mesa.tourOpen = false" />
  </div>
</template>

<style scoped>
.mesa {
  height: 100%;
  display: flex;
  background: var(--canvas);
  overflow: hidden;
}
.mesa__main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mesa__content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.mesa__calendar,
.mesa__readings,
.mesa__materials {
  flex: none;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}
.mesa__editor {
  flex: 1;
  min-width: 0;
  height: 100%;
}
.mesa__placeholder {
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 18px;
  background: var(--editor-surface);
}
.mesa__drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  background: var(--paper);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-sheet);
  animation: slide-in 0.18s var(--ease);
}
.calendar-popover {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 30;
  width: 300px;
  height: min(640px, calc(100% - 16px));
  border: 1px solid var(--line);
  border-radius: var(--radius-sheet);
  background: var(--sidebar);
  box-shadow: var(--shadow-sheet);
  overflow: hidden;
  animation: pop-rise 0.14s var(--ease);
}
.strip {
  flex: none;
  width: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border: none;
  border-right: 1px solid var(--line);
  background: var(--paper);
  color: var(--accent-ink);
  font-size: var(--text-xs);
}
.strip span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: var(--muted);
}
.strip--right {
  border-right: none;
  border-left: 1px solid var(--line);
}
.strip:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--paper));
}
.status {
  flex: none;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-top: 1px solid var(--line);
  background: var(--canvas);
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
}
.status__counts {
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status__target--warn {
  color: var(--warning-ink);
  font-weight: 600;
}
.status__save--error {
  color: var(--danger);
  font-weight: 600;
}
.status__save--pending,
.status__save--saving {
  font-style: italic;
}
.status__link {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: none;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}
.status__link:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.status__link--accent {
  color: var(--accent-ink);
}
.status__link--warn {
  color: var(--warning-ink);
}
@keyframes slide-in {
  from {
    transform: translateX(16px);
    opacity: 0;
  }
}
@keyframes pop-rise {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@media (max-width: 1180px) {
  .status__target {
    display: none;
  }
}
</style>
