<script setup lang="ts">
/**
 * Calendário da Mesa: mês com os dias de pregar destacados, Hoje e Próximo domingo, as próximas
 * celebrações com cor e estado por extenso, e o cartão compacto do ritmo da semana (desligável
 * em Preferências › Ritmo e duração). Sem marca nem links: isso vive no trilho.
 */
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, PanelLeftClose, X } from 'lucide-vue-next'
import type { LiturgicalDay } from '@pregar/core/liturgy/types'
import { normalizeLiturgicalColor } from '@pregar/core/liturgy/types'
import { addDays, dateKey, longDatePt, parseDateKey, weekdayNamePt } from '@pregar/core/util/dates'
import { preachingDays } from '@shared/settings'
import { invoke, shortcut } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'
import { useAppStore } from '@/stores/app'
import { STATE_TITLES, WEEKDAY_INITIALS, monthCells, monthTitle, shiftDays, shiftMonth, weekRhythm } from './calendar'

withDefaults(defineProps<{ popover?: boolean }>(), { popover: false })
const emit = defineEmits<{ collapse: [] }>()
const mesa = useMesaStore()
const app = useAppStore()
const today = ref(dateKey(new Date()))
const days = ref<Record<string, LiturgicalDay>>({})

const weekdays = computed(() => preachingDays(app.settings.rhythm))
const cells = computed(() => monthCells(mesa.calendarMonth))
const rhythm = computed(() => {
  const next = weekRhythm(new Date(), 'empty', weekdays.value)
  return weekRhythm(new Date(), mesa.states[next.sunday] ?? 'empty', weekdays.value)
})
const nextLabel = computed(() => (weekdays.value.length === 1 && weekdays.value[0] === 0 ? 'Próximo domingo' : 'Próximo dia de pregar'))

/** Próximas celebrações: domingos e festas a partir de hoje, dentro do mês visível (e um pouco depois). */
const upcoming = computed(() => {
  const start = today.value < `${mesa.calendarMonth}-01` ? `${mesa.calendarMonth}-01` : today.value
  return Object.values(days.value)
    .filter((day) => day.date >= start && (day.sundayName || day.celebration || day.isHolyDay))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
})

async function loadMonth(): Promise<void> {
  const month = mesa.calendarMonth
  const from = `${month}-01`
  const to = shiftDays(from, 45)
  try {
    const loaded = await invoke('liturgy:calendar', { from, to })
    if (month !== mesa.calendarMonth) return
    days.value = Object.fromEntries(loaded.map((day) => [day.date, day]))
  } catch {
    days.value = {}
  }
}

watch(
  () => [mesa.calendarMonth, app.settings.liturgy.prayerBook, app.settings.liturgy.language, app.liturgyAccess.mode],
  () => {
    void loadMonth()
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

function longLabel(key: string): string {
  const date = parseDateKey(key)
  return date ? longDatePt(date) : key
}

function shortLabel(key: string): string {
  const date = parseDateKey(key)
  if (!date) return key
  const weekday = weekdayNamePt(date.getDay()).slice(0, 3)
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

function isPreachingDay(key: string): boolean {
  const date = parseDateKey(key)
  return date ? weekdays.value.includes(date.getDay()) : false
}

function hasFeast(key: string): boolean {
  const day = days.value[key]
  return Boolean(day && (day.celebration || day.isHolyDay))
}

function dayName(day: LiturgicalDay): string {
  return day.sundayName ?? day.celebration?.name ?? day.season?.name ?? longLabel(day.date)
}

function colorOf(day: LiturgicalDay): string | null {
  return normalizeLiturgicalColor(day.color) ?? null
}

function stateText(key: string): string | null {
  const state = mesa.states[key]
  return state && state !== 'empty' ? STATE_TITLES[state] : null
}

function onGridKeydown(event: KeyboardEvent): void {
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  const step = steps[event.key]
  if (!step) return
  event.preventDefault()
  select(shiftDays(mesa.selectedDateKey, step))
}

function goToday(): void {
  select(today.value)
}

function goNext(): void {
  const current = parseDateKey(mesa.selectedDateKey) ?? new Date()
  // A partir do dia aberto, o próximo dia de pregar depois dele.
  const next = weekRhythm(addDays(current, 1), 'empty', weekdays.value).sunday
  select(next)
}
</script>

<template>
  <aside class="calendar" :class="{ 'calendar--popover': popover }" aria-label="Calendário litúrgico">
    <header class="calendar__header" :class="{ 'drag-region': !popover }">
      <h2 class="eyebrow">Calendário</h2>
      <span class="spacer" />
      <button
        class="calendar__collapse no-drag"
        type="button"
        :title="popover ? 'Fechar calendário (Esc)' : `Ocultar calendário (${shortcut('⇧⌥⌘1')})`"
        :aria-label="popover ? 'Fechar calendário' : 'Ocultar calendário'"
        @click="emit('collapse')"
      >
        <X v-if="popover" :size="15" />
        <PanelLeftClose v-else :size="15" />
      </button>
    </header>

    <div class="scroll calendar__scroll">
      <section class="calendar__month card" aria-label="Mês">
        <header class="calendar__month-header">
          <h3 class="serif">{{ monthTitle(mesa.calendarMonth) }}</h3>
          <span class="spacer" />
          <button type="button" class="nav" aria-label="Mês anterior" @click="mesa.calendarMonth = shiftMonth(mesa.calendarMonth, -1)"><ChevronLeft :size="14" /></button>
          <button type="button" class="nav" aria-label="Próximo mês" @click="mesa.calendarMonth = shiftMonth(mesa.calendarMonth, 1)"><ChevronRight :size="14" /></button>
        </header>
        <div class="grid" role="grid" aria-label="Dias do mês" tabindex="0" @keydown="onGridKeydown">
          <span v-for="(label, index) in WEEKDAY_INITIALS" :key="`w${index}`" class="weekday" :class="{ 'weekday--preach': weekdays.includes(index) }" aria-hidden="true">{{ label }}</span>
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
                'cell--preach': isPreachingDay(cell),
                'cell--feast': hasFeast(cell),
              }"
              :aria-selected="cell === mesa.selectedDateKey"
              :aria-label="`${longLabel(cell)}${days[cell] ? ` · ${dayName(days[cell]!)}` : ''}${stateText(cell) ? ` · ${stateText(cell)}` : ''}`"
              :title="days[cell] ? `${dayName(days[cell]!)}${stateText(cell) ? ` · ${stateText(cell)}` : ''}` : longLabel(cell)"
              tabindex="-1"
              @click="select(cell)"
            >
              {{ dayNumber(cell) }}
              <span v-if="stateText(cell)" class="cell__dot" :class="`cell__dot--${mesa.states[cell]}`" aria-hidden="true" />
            </button>
          </template>
        </div>
        <div class="week-nav">
          <button type="button" class="week-nav__button" title="Abrir o dia de hoje" @click="goToday">Hoje</button>
          <button type="button" class="week-nav__button week-nav__button--accent" :title="`Abrir o ${nextLabel.toLowerCase()}`" @click="goNext">{{ nextLabel }}</button>
        </div>
      </section>

      <section v-if="upcoming.length > 0" class="upcoming" aria-label="Próximas celebrações">
        <p class="eyebrow upcoming__label">Próximas celebrações</p>
        <button
          v-for="day in upcoming"
          :key="day.date"
          type="button"
          class="feast"
          :class="{ 'feast--selected': day.date === mesa.selectedDateKey }"
          :data-color="colorOf(day) ?? undefined"
          :title="`${longLabel(day.date)} · ${dayName(day)}`"
          @click="select(day.date)"
        >
          <span class="feast__date">{{ shortLabel(day.date) }}</span>
          <span class="feast__swatch" aria-hidden="true" />
          <span class="feast__name">{{ dayName(day) }}</span>
          <span v-if="stateText(day.date)" class="feast__state" :class="`feast__state--${mesa.states[day.date]}`">
            <span class="feast__state-dot" aria-hidden="true" />{{ stateText(day.date) }}
          </span>
        </button>
      </section>
    </div>

    <button v-if="app.settings.rhythm.weekTips" type="button" class="rhythm" :title="`Abrir a preparação de ${longLabel(rhythm.sunday)}`" @click="select(rhythm.sunday)">
      <span class="rhythm__head">
        <span class="eyebrow">{{ nextLabel }}</span>
        <span class="rhythm__countdown">{{ rhythm.countdown }}</span>
      </span>
      <span class="serif rhythm__name">{{ days[rhythm.sunday] ? dayName(days[rhythm.sunday]!) : longLabel(rhythm.sunday) }}</span>
      <span class="rhythm__line">
        <span v-if="stateText(rhythm.sunday)" class="rhythm__state">{{ stateText(rhythm.sunday) }} · </span>{{ rhythm.guidance }}
      </span>
    </button>
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
.calendar--popover {
  border-right: none;
}
.calendar__header {
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 16px;
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
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.calendar__month {
  padding: 10px 9px 9px;
  background: var(--paper);
}
.calendar__month-header {
  display: flex;
  align-items: center;
  padding: 0 5px 8px;
}
.calendar__month-header h3 {
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
  height: 16px;
  font-size: var(--text-xs);
  font-weight: 500;
  text-align: center;
  color: var(--muted);
}
.weekday--preach {
  font-weight: 700;
  color: var(--accent-ink);
}
.cell {
  position: relative;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: var(--text-sm);
  color: var(--ink);
}
.cell:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.cell--preach {
  color: var(--accent-ink);
  font-weight: 600;
}
.cell--feast::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 5px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.7;
}
.cell--today {
  font-weight: 700;
  color: var(--accent-ink);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.cell--selected,
.cell--selected:hover {
  font-weight: 700;
  color: var(--accent-contrast);
  background: var(--accent);
}
.cell--selected::after {
  background: var(--accent-contrast);
}
.cell__dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}
.cell__dot--exported {
  opacity: 1;
}
.week-nav {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.week-nav__button {
  flex: none;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.week-nav__button:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--paper));
}
.week-nav__button--accent {
  flex: 1;
  min-width: 0;
  color: var(--accent-ink);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.upcoming {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.upcoming__label {
  padding: 0 6px 4px;
}
.feast {
  display: grid;
  grid-template-columns: 54px 8px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 7px;
  align-items: center;
  min-height: 34px;
  padding: 5px 6px;
  border: none;
  border-radius: 7px;
  background: none;
  text-align: left;
  font-size: var(--text-sm);
}
.feast:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.feast--selected {
  background: var(--accent-soft);
}
.feast__date {
  grid-row: 1 / span 2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--ink-soft);
}
.feast__swatch {
  grid-row: 1 / span 2;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line-strong);
}
.feast[data-color='green'] .feast__swatch { background: rgb(46 122 81); }
.feast[data-color='purple'] .feast__swatch { background: rgb(120 87 171); }
.feast[data-color='red'] .feast__swatch { background: rgb(194 64 59); }
.feast[data-color='rose'] .feast__swatch { background: rgb(212 110 145); }
.feast[data-color='white'] .feast__swatch,
.feast[data-color='gold'] .feast__swatch { background: rgb(184 150 71); }
.feast[data-color='blue'] .feast__swatch { background: rgb(52 104 176); }
.feast[data-color='black'] .feast__swatch { background: rgb(100 100 104); }
.feast__name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.feast__state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--muted);
}
.feast__state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.55;
}
.feast__state--exported .feast__state-dot {
  opacity: 1;
}
.rhythm {
  margin: 0 12px 12px;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
  text-align: left;
  min-width: 0;
  max-width: calc(100% - 24px);
}
.rhythm:hover {
  border-color: var(--accent);
}
.rhythm__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
}
.rhythm__countdown {
  margin-left: auto;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--accent-ink);
  white-space: nowrap;
}
.rhythm__name {
  font-size: 13px;
  font-weight: 600;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rhythm__line {
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: 1.4;
}
.rhythm__state {
  color: var(--ink-soft);
  font-weight: 500;
}
</style>
