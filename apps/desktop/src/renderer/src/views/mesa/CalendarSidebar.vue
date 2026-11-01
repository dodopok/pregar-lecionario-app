<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Cross, Library, ScrollText, PanelLeftClose } from 'lucide-vue-next'
import { dateKey, longDatePt, parseDateKey } from '@pregar/core/util/dates'
import SectionLabel from '@/components/SectionLabel.vue'
import { invoke, shortcut } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'
import { useAppStore } from '@/stores/app'
import { STATE_TITLES, WEEKDAY_INITIALS, monthCells, monthSundays, monthTitle, shiftDays, shiftMonth, weekRhythm } from './calendar'

const emit = defineEmits<{ collapse: [] }>()
const mesa = useMesaStore()
const app = useAppStore()
const today = ref(dateKey(new Date()))
const sundayNames = ref<Record<string, string>>({})

const cells = computed(() => monthCells(mesa.calendarMonth))
const sundays = computed(() => monthSundays(mesa.calendarMonth))
const rhythm = computed(() => weekRhythm(new Date(), mesa.states[weekRhythm(new Date(), 'empty').sunday] ?? 'empty'))

async function loadSundayNames(): Promise<void> {
  const month = mesa.calendarMonth
  const from = `${month}-01`
  const last = sundays.value.at(-1) ?? `${month}-28`
  try {
    const days = await invoke('liturgy:calendar', { from, to: last > `${month}-31` ? last : shiftDays(`${month}-01`, 40) })
    if (month !== mesa.calendarMonth) return
    sundayNames.value = Object.fromEntries(days.filter((day) => day.sundayName).map((day) => [day.date, day.sundayName!]))
  } catch {
    sundayNames.value = {}
  }
}

watch(
  () => [mesa.calendarMonth, app.settings.liturgy.prayerBook, app.settings.liturgy.language, app.liturgyAccess.mode],
  () => {
    void loadSundayNames()
    void mesa.loadStates()
  },
  { immediate: true },
)

function select(key: string): void {
  void mesa.selectDate(key)
}

function dayNumber(key: string): number {
  return parseDateKey(key)?.getDate() ?? 0
}

function shortSunday(key: string): string {
  const date = parseDateKey(key)
  return date ? `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}` : key
}

function longLabel(key: string): string {
  const date = parseDateKey(key)
  return date ? longDatePt(date) : key
}

function stateGlyph(key: string): string {
  const state = mesa.states[key] ?? 'empty'
  return state === 'exported' ? '●' : state === 'inProgress' ? '◐' : '○'
}

function onGridKeydown(event: KeyboardEvent): void {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  const step = steps[event.key]
  if (!step) return
  event.preventDefault()
  select(shiftDays(mesa.selectedDateKey, step))
}
</script>

<template>
  <aside class="calendar" aria-label="Calendário litúrgico">
    <div class="calendar__brand drag-region">
      <span class="calendar__mark" aria-hidden="true"><Cross :size="13" /></span>
      <span class="serif calendar__name">Pregar</span>
      <span class="spacer" />
      <button class="calendar__collapse no-drag" type="button" :title="`Ocultar calendário (${shortcut('⇧⌥⌘1')})`" aria-label="Ocultar calendário" @click="emit('collapse')">
        <PanelLeftClose :size="15" />
      </button>
    </div>

    <div class="scroll calendar__scroll">
      <section class="calendar__month card" aria-label="Mês">
        <header class="calendar__month-header">
          <h2 class="serif">{{ monthTitle(mesa.calendarMonth) }}</h2>
          <span class="spacer" />
          <button type="button" class="nav" aria-label="Mês anterior" @click="mesa.calendarMonth = shiftMonth(mesa.calendarMonth, -1)"><ChevronLeft :size="14" /></button>
          <button type="button" class="nav" aria-label="Próximo mês" @click="mesa.calendarMonth = shiftMonth(mesa.calendarMonth, 1)"><ChevronRight :size="14" /></button>
        </header>
        <div class="grid" role="grid" aria-label="Dias do mês" tabindex="0" @keydown="onGridKeydown">
          <span v-for="(label, index) in WEEKDAY_INITIALS" :key="`w${index}`" class="weekday" :class="{ 'weekday--sunday': index === 0 }" aria-hidden="true">{{ label }}</span>
          <template v-for="(cell, index) in cells" :key="index">
            <span v-if="!cell" class="cell cell--empty" />
            <button
              v-else
              type="button"
              class="cell"
              role="gridcell"
              :class="{
                'cell--selected': cell === mesa.selectedDateKey,
                'cell--today': cell === today,
                'cell--sunday': parseDateKey(cell)?.getDay() === 0,
              }"
              :aria-selected="cell === mesa.selectedDateKey"
              :aria-label="`${longLabel(cell)}${mesa.states[cell] ? ` · ${STATE_TITLES[mesa.states[cell]!]}` : ''}`"
              :title="longLabel(cell)"
              tabindex="-1"
              @click="select(cell)"
            >
              {{ dayNumber(cell) }}
              <span v-if="mesa.states[cell] && mesa.states[cell] !== 'empty'" class="cell__dot" aria-hidden="true" />
            </button>
          </template>
        </div>
      </section>

      <div class="week-nav">
        <button type="button" class="nav nav--boxed" aria-label="Semana anterior" @click="select(shiftDays(mesa.selectedDateKey, -7))"><ChevronLeft :size="14" /></button>
        <button type="button" class="today" title="Voltar para hoje" @click="select(today)">Hoje</button>
        <button type="button" class="nav nav--boxed" aria-label="Próxima semana" @click="select(shiftDays(mesa.selectedDateKey, 7))"><ChevronRight :size="14" /></button>
      </div>

      <section class="sundays" aria-label="Domingos do mês">
        <SectionLabel title="Domingos" />
        <button
          v-for="sunday in sundays"
          :key="sunday"
          type="button"
          class="sunday"
          :class="{ 'sunday--selected': sunday === mesa.selectedDateKey }"
          :title="`${sundayNames[sunday] ?? 'Domingo'} · ${STATE_TITLES[mesa.states[sunday] ?? 'empty']}`"
          @click="select(sunday)"
        >
          <span class="sunday__glyph" :class="`sunday__glyph--${mesa.states[sunday] ?? 'empty'}`" :aria-label="STATE_TITLES[mesa.states[sunday] ?? 'empty']">{{ stateGlyph(sunday) }}</span>
          <span class="sunday__date">{{ shortSunday(sunday) }}</span>
          <span class="sunday__name">{{ sundayNames[sunday] ?? 'Domingo' }}</span>
        </button>
      </section>
    </div>

    <button type="button" class="rhythm" title="Abrir a preparação do próximo domingo" @click="select(rhythm.sunday)">
      <span class="rhythm__head">
        <SectionLabel title="Próximo domingo" tag="span" />
        <span class="rhythm__countdown">{{ rhythm.countdown }}</span>
      </span>
      <span class="serif rhythm__name">{{ sundayNames[rhythm.sunday] ?? longLabel(rhythm.sunday) }}</span>
      <span class="rhythm__state">{{ STATE_TITLES[mesa.states[rhythm.sunday] ?? 'empty'] }}</span>
      <span class="rhythm__guidance">{{ rhythm.guidance }}</span>
    </button>

    <nav class="links" aria-label="Janelas">
      <button type="button" class="link" @click="invoke('app:openWindow', { window: 'arquivo' })"><ScrollText :size="14" /> Arquivo de sermões</button>
      <button type="button" class="link" @click="invoke('app:openWindow', { window: 'biblioteca' })"><Library :size="14" /> Biblioteca de PDFs</button>
    </nav>
  </aside>
</template>

<style scoped>
.calendar {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
  min-width: 0;
}
.calendar__brand {
  height: var(--header-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px 0 calc(14px + var(--window-controls-inset));
}
.calendar__mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--accent-contrast);
  background: var(--accent);
  transition: background 0.3s;
}
.calendar__name {
  font-size: 17px;
  font-weight: 600;
}
.calendar__collapse {
  border: none;
  background: none;
  color: var(--muted);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: grid;
  place-items: center;
}
.calendar__collapse:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.calendar__scroll {
  flex: 1;
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.calendar__month {
  padding: 10px 9px;
  background: var(--paper);
}
.calendar__month-header {
  display: flex;
  align-items: center;
  padding: 0 5px 8px;
}
.calendar__month-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.nav {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--ink);
  display: grid;
  place-items: center;
}
.nav:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.nav--boxed {
  width: 30px;
  height: 30px;
  border: 1px solid var(--line);
  background: var(--paper);
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  outline: none;
}
.grid:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-soft);
  border-radius: 6px;
}
.weekday {
  height: 13px;
  font-size: 9px;
  font-weight: 500;
  text-align: center;
  color: color-mix(in srgb, var(--muted) 75%, transparent);
}
.weekday--sunday {
  font-weight: 700;
  color: var(--accent);
}
.cell {
  position: relative;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: 12px;
  color: var(--ink);
}
.cell:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.cell--sunday {
  color: var(--accent);
}
.cell--today {
  font-weight: 700;
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.cell--selected,
.cell--selected:hover {
  font-weight: 700;
  color: var(--accent-contrast);
  background: var(--accent);
}
.cell__dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 3px;
  height: 3px;
  margin-left: -1.5px;
  border-radius: 50%;
  background: currentColor;
}
.week-nav {
  display: flex;
  gap: 6px;
}
.today {
  flex: 1;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  font-size: 12px;
  font-weight: 500;
}
.today:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--paper));
}
.sundays {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sundays > :first-child {
  padding: 0 6px 4px;
}
.sunday {
  display: grid;
  grid-template-columns: 14px 40px 1fr;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px 6px;
  border: none;
  border-radius: 7px;
  background: none;
  text-align: left;
  font-size: 12px;
}
.sunday:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.sunday--selected {
  background: var(--accent-soft);
  font-weight: 600;
}
.sunday__glyph {
  font-size: 9px;
  color: var(--accent);
}
.sunday__glyph--empty {
  opacity: 0.55;
}
.sunday__date {
  font-variant-numeric: tabular-nums;
}
.sunday__name {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rhythm {
  margin: 0 12px 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
  text-align: left;
}
.rhythm:hover {
  border-color: var(--accent);
}
.rhythm__head {
  width: 100%;
  display: flex;
  align-items: center;
}
.rhythm__countdown {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}
.rhythm__name {
  font-size: 13px;
  font-weight: 600;
}
.rhythm__state {
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
}
.rhythm__guidance {
  font-size: 10px;
  color: var(--muted);
}
.links {
  padding: 0 8px 10px;
  display: flex;
  flex-direction: column;
}
.link {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--muted);
  font-size: 12px;
}
.link:hover {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
</style>
