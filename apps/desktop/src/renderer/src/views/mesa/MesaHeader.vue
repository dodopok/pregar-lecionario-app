<script setup lang="ts">
/**
 * Cabeçalho único da Mesa: botão de data (abre o calendário), nome do dia com Próprio, ciclo e
 * cor, chip do texto principal (troca por menu) e as ações da preparação. Os botões nunca
 * quebram linha: abaixo de 1100 px perdem o rótulo e mantêm título e aria-label.
 */
import { computed } from 'vue'
import {
  Calendar,
  Check,
  ChevronDown,
  Church,
  Clock,
  Ellipsis,
  Maximize2,
  Minimize2,
  Printer,
  Sparkles,
  Timer,
} from 'lucide-vue-next'
import {
  liturgicalProperDay,
  liturgicalYearLetter,
  properShortDesignation,
} from '@pregar/core/liturgy/calendar'
import { normalizeLiturgicalColor, readingLabel } from '@pregar/core/liturgy/types'
import { daysBetween, longDatePt, parseDateKey, weekdayNamePt } from '@pregar/core/util/dates'
import PopMenu from '@/components/PopMenu.vue'
import { shortcut } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { abbreviateReference, relativeDayLabel, shortDayLabel } from './mesa-layout'

const props = defineProps<{ labels: boolean; wide: boolean; calendarDocked: boolean }>()
const emit = defineEmits<{ toggleCalendar: []; print: []; toggleReadings: []; toggleMaterials: [] }>()
const app = useAppStore()
const mesa = useMesaStore()

const COLOR_NAMES: Record<string, string> = {
  green: 'Verde',
  purple: 'Roxo',
  red: 'Vermelho',
  rose: 'Rosa',
  black: 'Preto',
  white: 'Branco',
  gold: 'Dourado',
  blue: 'Azul',
}

const date = computed(() => parseDateKey(mesa.selectedDateKey))
const dayTitle = computed(() => {
  if (!date.value) return ''
  const weekday = weekdayNamePt(date.value.getDay())
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${longDatePt(date.value)}`
})
const relative = computed(() => (date.value ? relativeDayLabel(daysBetween(new Date(), date.value)) : ''))
const shortDay = computed(() => (date.value ? shortDayLabel(date.value) : mesa.selectedDateKey))
const proper = computed(() =>
  date.value ? liturgicalProperDay(mesa.occasion, date.value, mesa.isSunday) : null,
)
const yearLetter = computed(() => (date.value ? liturgicalYearLetter(date.value) : null))
const colorName = computed(() => {
  const normalized = normalizeLiturgicalColor(mesa.day?.color)
  return normalized ? COLOR_NAMES[normalized] : (mesa.day?.color ?? null)
})
const title = computed(() => mesa.occasion ?? dayTitle.value)
const meta = computed(() => {
  const parts: string[] = []
  if (mesa.occasion && props.wide && date.value) parts.push(longDatePt(date.value))
  if (proper.value) parts.push(properShortDesignation(proper.value))
  else if (yearLetter.value) parts.push(`Ano ${yearLetter.value}`)
  if (mesa.day?.season?.name && !mesa.occasion?.includes(mesa.day.season.name))
    parts.push(mesa.day.season.name)
  return parts
})
const readings = computed(() => mesa.day?.readings ?? [])
const mainChip = computed(() => {
  const reference = mesa.record?.mainReadingReference
  if (!reference) return null
  if (!props.labels) return abbreviateReference(reference)
  return props.wide ? `Texto principal: ${reference}` : reference
})
const reviewLabel = computed(() => (props.labels ? 'Revisar com IA' : ''))

function isMain(reference: string, slot: string): boolean {
  return mesa.record?.mainReadingReference === reference && mesa.record?.mainReadingSlot === slot
}
</script>

<template>
  <header class="head drag-region" :class="{ 'head--compact': !labels }">
    <button
      type="button"
      class="date"
      data-tour="date"
      :aria-pressed="calendarDocked ? undefined : mesa.calendarPopover"
      :aria-haspopup="calendarDocked ? undefined : 'dialog'"
      :title="`${calendarDocked ? 'Ocultar o calendário' : 'Abrir o calendário'} · ${dayTitle}, ${relative} (${shortcut('⇧⌥⌘1')})`"
      @click="emit('toggleCalendar')"
    >
      <Calendar :size="16" class="date__icon" aria-hidden="true" />
      <span class="date__text">
        <span class="date__day">{{ shortDay }}</span>
        <span v-if="labels" class="date__relative">{{ relative }}</span>
      </span>
      <ChevronDown :size="13" class="date__chevron" aria-hidden="true" />
    </button>

    <div class="title">
      <h1 class="serif title__name" :title="title">{{ title }}</h1>
      <span v-if="meta.length > 0 || colorName" class="title__meta">
        <template v-for="(part, index) in meta" :key="part">{{ index > 0 ? ' · ' : '' }}{{ part }}</template>
        <template v-if="colorName"
          ><span v-if="meta.length > 0"> · </span><span class="title__swatch" aria-hidden="true" />{{
            colorName
          }}</template
        >
      </span>
    </div>

    <PopMenu v-if="mesa.record && readings.length > 0" label="Texto principal do sermão" :width="300">
      <template #default="{ toggle, open }">
        <button
          type="button"
          class="main"
          :class="{ 'main--empty': !mainChip }"
          :aria-expanded="open"
          aria-haspopup="menu"
          :title="
            mainChip
              ? `Texto principal: ${mesa.record?.mainReadingReference}. Clique para trocar.`
              : 'Escolha a leitura que o sermão vai seguir'
          "
          @click="toggle"
        >
          <Check v-if="mainChip" :size="13" aria-hidden="true" />
          <span class="main__text">{{
            mainChip ?? (labels ? 'Escolher texto principal' : 'Texto principal')
          }}</span>
          <ChevronDown :size="13" aria-hidden="true" />
        </button>
      </template>
      <template #menu>
        <div class="menu__label">Texto principal do sermão</div>
        <button
          v-for="reading in readings"
          :key="`${reading.slot}:${reading.reference}`"
          type="button"
          role="menuitemradio"
          class="menu__item main__option"
          :class="{ 'menu__item--active': isMain(reading.reference, reading.slot) }"
          :aria-checked="isMain(reading.reference, reading.slot)"
          @click="mesa.chooseMainReading(reading)"
        >
          <span class="main__option-label">{{ readingLabel(reading) }}</span>
          <span class="serif main__option-reference">{{ reading.reference }}</span>
          <Check
            v-if="isMain(reading.reference, reading.slot)"
            :size="14"
            class="main__option-check"
            aria-hidden="true"
          />
        </button>
        <template v-if="mesa.record?.mainReadingReference">
          <div class="menu__separator" role="separator" />
          <button type="button" role="menuitem" class="menu__item" @click="mesa.clearMainReading()">
            Sem texto principal por enquanto
          </button>
        </template>
      </template>
    </PopMenu>

    <span class="spacer" />

    <nav class="actions" aria-label="Ações da preparação">
      <button
        type="button"
        class="action"
        :aria-label="labels ? undefined : 'Ensaio'"
        :title="`Ensaiar em tela cheia, com cronômetro e rolagem (${shortcut('⇧⌥⌘E')})`"
        @click="mesa.openFullscreen('rehearsal')"
      >
        <Timer :size="15" aria-hidden="true" /><span v-if="labels">Ensaio</span>
      </button>
      <button
        type="button"
        class="action"
        data-tour="pulpit"
        :aria-label="labels ? undefined : 'Levar para o púlpito'"
        :title="`Levar para o púlpito: imprimir, PDF, Google Doc ou texto simples (${shortcut('⇧⌘T')})`"
        @click="mesa.openSheet('pulpit')"
      >
        <Church :size="15" aria-hidden="true" /><span v-if="labels">{{
          wide ? 'Levar ao púlpito' : 'Púlpito'
        }}</span>
      </button>
      <button
        type="button"
        class="action"
        :class="{ 'action--pressed': mesa.focusMode }"
        :aria-pressed="mesa.focusMode"
        :aria-label="labels ? undefined : 'Foco'"
        :title="
          mesa.focusMode
            ? `Sair do foco (${shortcut('⇧⌘F')})`
            : `Foco: só o manuscrito na tela (${shortcut('⇧⌘F')})`
        "
        @click="mesa.focusMode = !mesa.focusMode"
      >
        <Minimize2 v-if="mesa.focusMode" :size="15" aria-hidden="true" /><Maximize2
          v-else
          :size="15"
          aria-hidden="true"
        /><span v-if="labels">Foco</span>
      </button>
      <span class="actions__divider" aria-hidden="true" />
      <button
        type="button"
        class="action action--primary"
        data-tour="review"
        :aria-label="reviewLabel ? undefined : 'Revisar com IA'"
        :title="`A revisão aponta e fundamenta; nunca reescreve o sermão (${shortcut('⇧⌥⌘R')})`"
        @click="mesa.requestReview()"
      >
        <Sparkles :size="14" aria-hidden="true" /><span v-if="reviewLabel">{{ reviewLabel }}</span>
      </button>
      <PopMenu label="Mais ações" align="right" :width="280">
        <template #default="{ toggle, open }">
          <button
            type="button"
            class="action action--icon"
            aria-label="Mais ações"
            title="Mais ações: histórico, Drive, perguntas, impressão"
            :aria-expanded="open"
            aria-haspopup="menu"
            @click="toggle"
          >
            <Ellipsis :size="17" aria-hidden="true" />
          </button>
        </template>
        <template #menu>
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('questions')">
            Perguntas para destravar…
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('history')">
            <Clock :size="14" aria-hidden="true" /> Histórico de versões<kbd class="menu__keys">{{
              shortcut('⇧⌥⌘H')
            }}</kbd>
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('drive')">
            Google Drive…
          </button>
          <div class="menu__separator" role="separator" />
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openFullscreen('readings')">
            Leituras em tela cheia<kbd class="menu__keys">{{ shortcut('⇧⌥⌘L') }}</kbd>
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="emit('toggleReadings')">
            {{ app.settings.panels.readingsOpen ? 'Ocultar leituras' : 'Mostrar leituras'
            }}<kbd class="menu__keys">{{ shortcut('⇧⌥⌘2') }}</kbd>
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="emit('toggleMaterials')">
            {{ app.settings.panels.materialsOpen ? 'Ocultar materiais' : 'Mostrar materiais'
            }}<kbd class="menu__keys">{{ shortcut('⇧⌥⌘3') }}</kbd>
          </button>
          <div class="menu__separator" role="separator" />
          <button type="button" role="menuitem" class="menu__item" @click="emit('print')">
            <Printer :size="14" aria-hidden="true" /> Imprimir direto<kbd class="menu__keys">{{
              shortcut('⌘P')
            }}</kbd>
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="mesa.flush()">
            Salvar agora<kbd class="menu__keys">{{ shortcut('⌘S') }}</kbd>
          </button>
          <div class="menu__separator" role="separator" />
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('commands')">
            Pesquisar comandos<kbd class="menu__keys">{{ shortcut('⌥/') }}</kbd>
          </button>
          <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('shortcuts')">
            Atalhos de teclado<kbd class="menu__keys">{{ shortcut('⌘/') }}</kbd>
          </button>
        </template>
      </PopMenu>
    </nav>
  </header>
</template>

<style scoped>
.head {
  position: relative;
  flex: none;
  height: var(--mesa-header-height);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
  box-shadow: inset 0 2px 0 var(--accent);
  min-width: 0;
}
.head--compact {
  gap: 6px;
  padding: 0 10px;
}
.date {
  flex: none;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: var(--paper);
  text-align: left;
  white-space: nowrap;
}
.date:hover,
.date[aria-pressed='true'] {
  border-color: var(--accent);
}
.date__icon {
  color: var(--accent);
}
.date__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.date__day {
  font-size: var(--text-sm);
  font-weight: 600;
}
.date__relative {
  font-size: var(--text-xs);
  color: var(--muted);
}
.date__chevron {
  color: var(--muted);
}
.title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 420px;
  flex: 0 1 auto;
}
.head--compact .title {
  max-width: 250px;
}
.title__name {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head--compact .title__name {
  font-size: 17px;
}
.title__meta {
  font-size: var(--text-sm);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title__swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
}
.main {
  flex: none;
  height: 30px;
  max-width: 320px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 15px;
  background: var(--accent-softer);
  color: var(--accent-ink);
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
}
.main:hover {
  background: var(--accent-soft);
}
.main--empty {
  border-style: dashed;
  background: none;
  color: var(--ink-soft);
  font-weight: 500;
}
.main__text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.main__option {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 8px;
  padding: 6px 10px;
  min-height: 0;
}
.main__option-label {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}
.main__option-reference {
  grid-column: 1;
  font-size: var(--text-lg);
  font-weight: 600;
}
.main__option-check {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  color: var(--accent);
}
.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}
.action {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-button);
  background: none;
  color: var(--ink-soft);
  font-size: var(--text-md);
  font-weight: 500;
  white-space: nowrap;
}
.head--compact .action {
  width: 32px;
  padding: 0;
  justify-content: center;
}
.action:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  color: var(--ink);
}
.action--pressed,
.action--pressed:hover {
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.action--icon {
  width: 32px;
  padding: 0;
  justify-content: center;
}
.action--primary,
.action--primary:hover {
  padding: 0 14px;
  color: var(--accent-contrast);
  background: var(--accent);
  font-weight: 600;
}
.head--compact .action--primary {
  width: auto;
  padding: 0 12px;
}
.action--primary:hover {
  background: color-mix(in srgb, var(--accent) 90%, var(--ink));
}
.actions__divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--line);
}
</style>
