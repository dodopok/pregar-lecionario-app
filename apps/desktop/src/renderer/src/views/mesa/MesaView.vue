<script setup lang="ts">
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  Check,
  CircleUser,
  Clock,
  FileText,
  Maximize2,
  Minimize2,
  PanelLeftOpen,
  PanelRightOpen,
  Settings,
  Tablet,
  Timer,
} from 'lucide-vue-next'
import { liturgicalProperDay, liturgicalYearLetter, properShortDesignation } from '@pregar/core/liturgy/calendar'
import { normalizeLiturgicalColor } from '@pregar/core/liturgy/types'
import { estimatedPreachingMinutes } from '@pregar/core/util/text'
import { longDatePt, parseDateKey, weekdayNamePt } from '@pregar/core/util/dates'
import PButton from '@/components/PButton.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { invoke, on, shortcut } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import CalendarSidebar from './CalendarSidebar.vue'
import ScripturePanel from './ScripturePanel.vue'
import ManuscriptEditor from './editor/ManuscriptEditor.vue'

// Painel de materiais, folhas e boas-vindas vêm de módulos próprios; enquanto não existem, a Mesa segue sem eles.
const optional = import.meta.glob(['./panels/ResourcePanel.vue', './sheets/MesaSheets.vue', '../onboarding/OnboardingSheet.vue'])
const empty = { render: () => h('div') }
const lazy = (path: string) => defineAsyncComponent(() => (optional[path] ? (optional[path]!() as Promise<{ default: object }>) : Promise.resolve({ default: empty })))
const ResourcePanel = lazy('./panels/ResourcePanel.vue')
const MesaSheets = lazy('./sheets/MesaSheets.vue')
const OnboardingSheet = lazy('../onboarding/OnboardingSheet.vue')

const mesa = useMesaStore()
const app = useAppStore()
const panels = computed(() => app.settings.panels)
const widths = ref({ calendar: panels.value.calendarWidth, readings: panels.value.readingsWidth, materials: panels.value.materialsWidth })
const windowWidth = ref(window.innerWidth)

const showCalendar = computed(() => panels.value.calendarOpen && !mesa.focusMode)
const showReadings = computed(() => panels.value.readingsOpen && !mesa.focusMode)
const showMaterials = computed(() => panels.value.materialsOpen && !mesa.focusMode)

// O editor precisa de 420 px; o restante se divide entre leituras e materiais, como no Swift.
const layout = computed(() => {
  const calendar = showCalendar.value ? Math.min(320, Math.max(200, widths.value.calendar)) : 0
  const remaining = windowWidth.value - calendar - 420 - 18
  const readingsMax = Math.max(240, remaining - (showMaterials.value ? 280 : 0))
  const readings = showReadings.value ? Math.min(readingsMax, Math.max(240, widths.value.readings)) : 0
  const materialsMax = Math.max(280, remaining - readings)
  const materials = showMaterials.value ? Math.min(materialsMax, Math.max(280, widths.value.materials)) : 0
  return { calendar, readings, readingsMax, materials, materialsMax }
})

function togglePanel(panel: 'calendarOpen' | 'readingsOpen' | 'materialsOpen'): void {
  if (mesa.focusMode) mesa.focusMode = false
  void app.updateSettings({ panels: { [panel]: !panels.value[panel] } })
}

function commitWidth(panel: 'calendarWidth' | 'readingsWidth' | 'materialsWidth', value: number): void {
  void app.updateSettings({ panels: { [panel]: value } })
}

const date = computed(() => parseDateKey(mesa.selectedDateKey))
const proper = computed(() => (date.value ? liturgicalProperDay(mesa.occasion, date.value, mesa.isSunday) : null))
const yearLetter = computed(() => (date.value ? liturgicalYearLetter(date.value) : null))
const colorName = computed(() => {
  const names: Record<string, string> = { green: 'Verde', purple: 'Roxo', red: 'Vermelho', rose: 'Rosa', black: 'Preto', white: 'Branco', gold: 'Dourado', blue: 'Azul' }
  const normalized = normalizeLiturgicalColor(mesa.day?.color)
  return normalized ? names[normalized] : (mesa.day?.color ?? null)
})
const dayTitle = computed(() => {
  if (!date.value) return ''
  const weekday = weekdayNamePt(date.value.getDay())
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${longDatePt(date.value)}`
})
const toolbarTitle = computed(() => mesa.record?.mainReadingReference || 'Preparação do sermão')
const toolbarSubtitle = computed(() =>
  [dayTitle.value, proper.value ? properShortDesignation(proper.value) : mesa.day?.sundayName].filter(Boolean).join(' · '),
)

const pages = computed(() => mesa.wordCount / 720)
const minutes = computed(() => Math.round(estimatedPreachingMinutes(mesa.wordCount)))
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
  if (!drive?.documentId) return 'Drive · sem documento'
  if (drive.syncError) return drive.syncError.toLowerCase().includes('mudou fora') ? 'Drive · conflito' : 'Drive · erro'
  if (drive.syncedAt) return `Drive · atualizado ${new Date(drive.syncedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  return 'Drive · aguardando sincronização'
})
const accountLabel = computed(() => {
  if (!app.account.loggedIn) return 'Entrar'
  return app.account.account?.plan === 'pro' ? 'Assinatura' : 'Conta'
})

watch(toolbarTitle, (title) => void invoke('app:setTitle', { title: `${title} · Pregar` }), { immediate: true })

function onResize(): void {
  windowWidth.value = window.innerWidth
}

const offs: (() => void)[] = []
onMounted(() => {
  mesa.initialize()
  window.addEventListener('resize', onResize)
  offs.push(
    on('menu:command', ({ command }) => {
      const actions: Record<string, () => void> = {
        toggleCalendar: () => togglePanel('calendarOpen'),
        toggleReadings: () => togglePanel('readingsOpen'),
        toggleMaterials: () => togglePanel('materialsOpen'),
        focusMode: () => (mesa.focusMode = !mesa.focusMode),
        review: () => mesa.requestReview(),
        questions: () => mesa.openSheet('questions'),
        rehearsal: () => mesa.openSheet('rehearsal'),
        history: () => mesa.openSheet('history'),
        tablet: () => mesa.openSheet('tablet'),
        print: () => mesa.openSheet('tablet'),
        drive: () => mesa.openSheet('drive'),
        shortcuts: () => mesa.openSheet('shortcuts'),
        commandSearch: () => mesa.openSheet('commands'),
      }
      actions[command]?.()
    }),
    on('navigate', ({ route }) => {
      const requested = new URLSearchParams(route.split('?')[1] ?? '').get('date')
      if (requested) {
        mesa.focusMode = false
        void mesa.selectDate(requested)
      }
    }),
  )
  if (!app.settings.onboarding.completed) mesa.activeSheet = 'onboarding'
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  for (const off of offs) off()
})

function openBible(): void {
  const reference = mesa.record?.mainReadingReference
  void invoke('app:openWindow', { window: 'biblia', route: reference ? `/biblia?ref=${encodeURIComponent(reference)}` : '/biblia' })
}
</script>

<template>
  <div class="mesa" :class="{ 'mesa--focus': mesa.focusMode }">
    <template v-if="showCalendar">
      <div class="mesa__calendar" :style="{ width: `${layout.calendar}px` }">
        <CalendarSidebar @collapse="togglePanel('calendarOpen')" />
      </div>
      <ResizeHandle v-model:width="widths.calendar" :min="200" :max="320" label="Largura do calendário" @commit="commitWidth('calendarWidth', $event)" />
    </template>

    <div class="mesa__main">
      <header class="toolbar drag-region" :class="{ 'toolbar--inset': !showCalendar }">
        <PButton v-if="!showCalendar" variant="icon" :label="`Mostrar calendário (${shortcut('⇧⌥⌘1')})`" @click="togglePanel('calendarOpen')">
          <PanelLeftOpen :size="16" />
        </PButton>
        <div class="toolbar__title">
          <span class="toolbar__reference">{{ toolbarTitle }}</span>
          <span class="toolbar__subtitle">{{ toolbarSubtitle }}</span>
        </div>
        <span class="spacer" />
        <nav class="toolbar__actions" aria-label="Ferramentas da preparação">
          <PButton variant="ghost" :title="`Abrir a Bíblia com o texto principal (${shortcut('⌘1')})`" @click="openBible"><BookOpen :size="15" /> Bíblia</PButton>
          <PButton variant="ghost" :title="`Abrir o Leitor de PDFs e sites (${shortcut('⌘2')})`" @click="invoke('app:openWindow', { window: 'leitor' })"><FileText :size="15" /> Leitor</PButton>
          <PButton variant="ghost" :title="`Preparar a cópia para pregar (${shortcut('⇧⌘T')})`" @click="mesa.openSheet('tablet')"><Tablet :size="15" /> Tablet</PButton>
          <PButton variant="ghost" :title="`Ler em voz alta com cronômetro e tipo grande (${shortcut('⇧⌥⌘E')})`" @click="mesa.openSheet('rehearsal')"><Timer :size="15" /> Ensaio</PButton>
        </nav>
        <span class="toolbar__divider" />
        <PButton
          variant="ghost"
          :pressed="mesa.focusMode"
          :title="mesa.focusMode ? `Sair do modo de escrita (${shortcut('⇧⌘F')})` : `Modo de escrita: recolhe calendário, leituras e materiais (${shortcut('⇧⌘F')})`"
          @click="mesa.focusMode = !mesa.focusMode"
        >
          <Minimize2 v-if="mesa.focusMode" :size="15" /><Maximize2 v-else :size="15" /> Foco
        </PButton>
        <span class="toolbar__divider" />
        <PButton variant="primary" :title="`Solicitar uma revisão do manuscrito (${shortcut('⇧⌥⌘R')})`" @click="mesa.requestReview()"><Check :size="14" /> Revisar</PButton>
        <PButton variant="icon" :label="accountLabel" :title="app.account.loggedIn ? `${app.account.email} · ${accountLabel}` : 'Entrar ou assinar'" @click="invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/conta' })">
          <CircleUser :size="17" />
        </PButton>
        <PButton variant="icon" :label="`Preferências (${shortcut('⌘,')})`" @click="invoke('app:openWindow', { window: 'preferencias' })"><Settings :size="16" /></PButton>
      </header>

      <div v-if="!mesa.focusMode" class="day-header">
        <h1 class="serif day-header__title">{{ mesa.occasion ?? dayTitle }}</h1>
        <dl class="day-header__fields">
          <div v-if="mesa.occasion"><dt>Data</dt><dd>{{ dayTitle }}</dd></div>
          <div v-if="proper"><dt>Próprio</dt><dd>{{ proper.number }}</dd></div>
          <div v-if="yearLetter"><dt>Ciclo</dt><dd>Ano {{ yearLetter }}</dd></div>
          <div v-if="colorName"><dt>Cor</dt><dd><span class="swatch" aria-hidden="true" />{{ colorName }}</dd></div>
          <div v-if="mesa.day?.season?.name"><dt>Tempo</dt><dd>{{ mesa.day.season.name }}</dd></div>
        </dl>
      </div>

      <div class="mesa__content">
        <template v-if="showReadings">
          <div class="mesa__readings" :style="{ width: `${layout.readings}px` }">
            <ScripturePanel @collapse="togglePanel('readingsOpen')" />
          </div>
          <ResizeHandle v-model:width="widths.readings" :min="240" :max="layout.readingsMax" label="Largura das leituras" @commit="commitWidth('readingsWidth', $event)" />
        </template>
        <button v-else-if="!mesa.focusMode" type="button" class="rail" :title="`Mostrar painel de leituras (${shortcut('⇧⌥⌘2')})`" aria-label="Mostrar painel de leituras" @click="togglePanel('readingsOpen')">
          <PanelLeftOpen :size="14" /><span>Leituras</span>
        </button>

        <div class="mesa__editor">
          <ManuscriptEditor v-if="mesa.record" :key="mesa.selectedDateKey" />
          <div v-else class="mesa__placeholder"><span class="serif">Preparando o manuscrito</span></div>
        </div>

        <template v-if="showMaterials">
          <ResizeHandle v-model:width="widths.materials" :min="280" :max="layout.materialsMax" :grows-to-right="false" label="Largura dos materiais" @commit="commitWidth('materialsWidth', $event)" />
          <div class="mesa__materials" :style="{ width: `${layout.materials}px` }">
            <ResourcePanel @collapse="togglePanel('materialsOpen')" />
          </div>
        </template>
        <button v-else-if="!mesa.focusMode" type="button" class="rail rail--right" :title="`Mostrar painel de materiais (${shortcut('⇧⌥⌘3')})`" aria-label="Mostrar painel de materiais" @click="togglePanel('materialsOpen')">
          <PanelRightOpen :size="14" /><span>Materiais</span>
        </button>
      </div>

      <footer v-if="mesa.record" class="status">
        <span class="status__counts" title="Estimativa a partir do seu ritmo habitual: 3 páginas rendem 20–24 minutos">
          {{ mesa.wordCount.toLocaleString('pt-BR') }} palavras · ≈ {{ pages.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }} páginas · ≈ {{ minutes }} min
        </span>
        <span class="status__habit">seu habitual: 3 páginas ≈ 20–24 min</span>
        <span class="spacer" />
        <span class="status__save" :class="`status__save--${mesa.saveState}`" role="status">{{ saveLabel }}</span>
        <button v-if="mesa.saveState === 'error'" type="button" class="status__link" :title="mesa.saveError ?? ''" @click="mesa.flush()">Tentar de novo</button>
        <button type="button" class="status__link" :class="{ 'status__link--warn': mesa.record.drive.syncError }" @click="mesa.openSheet('drive')">{{ driveLabel }}</button>
        <button type="button" class="status__link status__link--accent" :title="`Abrir histórico recuperável deste sermão (${shortcut('⇧⌥⌘H')})`" @click="mesa.openSheet('history')">
          <Clock :size="12" /> v{{ mesa.currentVersion }} · histórico
        </button>
      </footer>
    </div>

    <MesaSheets v-if="mesa.activeSheet && mesa.activeSheet !== 'onboarding'" />
    <OnboardingSheet v-if="mesa.activeSheet === 'onboarding'" @close="mesa.activeSheet = null" />
  </div>
</template>

<style scoped>
.mesa {
  height: 100%;
  display: flex;
  background: var(--canvas);
  overflow: hidden;
}
.mesa__calendar,
.mesa__readings,
.mesa__materials {
  flex: none;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}
.mesa__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  position: relative;
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
}
.toolbar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
}
.toolbar--inset {
  padding-left: calc(10px + var(--window-controls-inset));
}
.toolbar__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-left: 4px;
}
.toolbar__reference {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toolbar__subtitle {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toolbar__actions {
  display: flex;
  gap: 2px;
}
.toolbar__actions :deep(.p-button) {
  color: var(--muted);
}
.toolbar__divider {
  width: 1px;
  height: 18px;
  background: var(--line);
}
.day-header {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 18px;
  padding: 10px 20px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--canvas);
  min-width: 0;
}
.day-header__title {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.day-header__fields {
  display: flex;
  gap: 18px;
  margin: 0;
  flex-wrap: wrap;
}
.day-header__fields div {
  display: flex;
  flex-direction: column;
}
.day-header__fields dt {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.day-header__fields dd {
  margin: 0;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
}
.mesa__content {
  flex: 1;
  min-height: 0;
  display: flex;
}
.mesa__editor {
  flex: 1;
  min-width: 420px;
  height: 100%;
}
.mesa__placeholder {
  height: 100%;
  display: grid;
  place-items: center;
  font-size: 18px;
  background: var(--editor-surface);
}
.rail {
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
  color: var(--accent);
  font-size: 11px;
}
.rail span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: var(--muted);
}
.rail--right {
  border-right: none;
  border-left: 1px solid var(--line);
}
.rail:hover {
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
  font-size: 11px;
  color: var(--muted);
}
.status__counts {
  font-variant-numeric: tabular-nums;
}
.status__habit {
  opacity: 0.72;
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
  font-size: 11px;
  color: var(--muted);
}
.status__link:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.status__link--accent {
  color: var(--accent);
}
.status__link--warn {
  color: var(--warning);
}
@media (max-width: 1180px) {
  .status__habit,
  .toolbar__actions :deep(.p-button) {
    font-size: 0;
    gap: 0;
  }
  .status__habit {
    display: none;
  }
}
</style>
