<script setup lang="ts">
/**
 * Ritmo e duração: o dia em que prega, a meta de minutos, o ritmo de fala (medido no Ensaio ou
 * digitado), páginas na barra de estado e as dicas da semana no Calendário.
 */
import { computed } from 'vue'
import { PREACHING_WPM_RANGE, estimatedPreachingMinutes, formatMinutes } from '@pregar/core/util/text'
import { weekdayNamePt } from '@pregar/core/util/dates'
import type { RhythmSettings } from '@shared/settings'
import Toggle from '@/components/Toggle.vue'
import PButton from '@/components/PButton.vue'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'

const app = useAppStore()
const toasts = useToasts()
const rhythm = computed(() => app.settings.rhythm)
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ value: day, label: capitalize(weekdayNamePt(day)) }))
const SAMPLE_WORDS = 1800

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function update(patch: Partial<RhythmSettings>): void {
  void app.updateSettings({ rhythm: patch })
}

function setPreachingDay(value: number): void {
  update({ preachingDay: value, extraDays: rhythm.value.extraDays.filter((day) => day !== value) })
}

function toggleExtra(day: number): void {
  const extra = rhythm.value.extraDays.includes(day)
    ? rhythm.value.extraDays.filter((item) => item !== day)
    : [...rhythm.value.extraDays, day]
  update({ extraDays: extra.sort((a, b) => a - b) })
}

function setTarget(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) update({ targetMinutes: Math.min(90, Math.max(5, Math.round(value))) })
}

function setPace(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  update({
    wordsPerMinute: Math.min(PREACHING_WPM_RANGE.max, Math.max(PREACHING_WPM_RANGE.min, Math.round(value))),
    measuredAt: null,
  })
}

function resetPace(): void {
  update({ wordsPerMinute: 96, measuredAt: null })
  toasts.show('Ritmo padrão de 96 palavras por minuto restaurado.', 'info')
}

const measuredLabel = computed(() => {
  if (!rhythm.value.measuredAt) return 'Ritmo padrão, até você medir o seu no Ensaio.'
  const date = new Date(rhythm.value.measuredAt)
  return `Medido no Ensaio em ${date.toLocaleDateString('pt-BR')}.`
})
const sample = computed(() =>
  formatMinutes(estimatedPreachingMinutes(SAMPLE_WORDS, rhythm.value.wordsPerMinute)),
)
</script>

<template>
  <div class="section-stack">
    <PrefGroup label="Dia de pregar">
      <PrefRow
        label="Normalmente prego"
        for="rhythm-day"
        hint="A Mesa abre nesse dia e o Calendário conta os dias até ele."
      >
        <select
          id="rhythm-day"
          class="field select"
          :value="rhythm.preachingDay"
          @change="setPreachingDay(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="day in WEEKDAYS" :key="day.value" :value="day.value">{{ day.label }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Também prego" top hint="Outros dias habituais, como quarta ou sábado.">
        <div class="days" role="group" aria-label="Outros dias de pregação">
          <button
            v-for="day in WEEKDAYS"
            :key="day.value"
            type="button"
            class="chip"
            :class="{ 'chip--active': rhythm.extraDays.includes(day.value) }"
            :disabled="day.value === rhythm.preachingDay"
            :aria-pressed="rhythm.extraDays.includes(day.value)"
            @click="toggleExtra(day.value)"
          >
            {{ day.label.slice(0, 3) }}
          </button>
        </div>
      </PrefRow>
      <PrefRow label="Ao abrir">
        <select
          class="field select"
          :value="app.settings.mesa.openOn"
          aria-label="Dia que a Mesa abre"
          @change="
            app.updateSettings({
              mesa: {
                openOn: ($event.target as HTMLSelectElement).value as 'next-preaching-day' | 'last-open',
              },
            })
          "
        >
          <option value="next-preaching-day">Abrir no próximo dia de pregar</option>
          <option value="last-open">Voltar à última preparação aberta</option>
        </select>
      </PrefRow>
    </PrefGroup>

    <PrefGroup label="Duração">
      <PrefRow
        label="Meta do sermão"
        for="rhythm-target"
        hint="A Mesa compara a estimativa com esta meta; o Ensaio marca a faixa em volta dela."
      >
        <div class="inline">
          <input
            id="rhythm-target"
            class="field number"
            type="number"
            min="5"
            max="90"
            step="1"
            :value="rhythm.targetMinutes"
            @change="setTarget"
          />
          <span class="unit">minutos</span>
        </div>
      </PrefRow>
      <PrefRow label="Meu ritmo" for="rhythm-pace" :hint="measuredLabel">
        <div class="inline">
          <input
            id="rhythm-pace"
            class="field number"
            type="number"
            :min="PREACHING_WPM_RANGE.min"
            :max="PREACHING_WPM_RANGE.max"
            step="1"
            :value="rhythm.wordsPerMinute"
            @change="setPace"
          />
          <span class="unit">palavras por minuto</span>
          <PButton
            v-if="rhythm.wordsPerMinute !== 96 || rhythm.measuredAt"
            variant="link"
            compact
            @click="resetPace"
            >Usar o padrão</PButton
          >
        </div>
        <p class="sample">
          Com esse ritmo, {{ SAMPLE_WORDS.toLocaleString('pt-BR') }} palavras rendem ≈ {{ sample }}.
        </p>
      </PrefRow>
      <PrefRow label="Medir no Ensaio">
        <Toggle
          class="wide"
          :model-value="rhythm.autoUpdate"
          label="Atualizar o ritmo sozinho ao terminar uma leitura cronometrada"
          description="No Ensaio, “Cheguei ao fim” mede quantas palavras por minuto você leu de fato."
          @update:model-value="update({ autoUpdate: $event })"
        />
      </PrefRow>
    </PrefGroup>

    <PrefGroup label="Na Mesa">
      <PrefRow label="Páginas">
        <Toggle
          class="wide"
          :model-value="rhythm.showPages"
          label="Mostrar a estimativa em páginas ao lado dos minutos"
          description="Páginas da folha do púlpito, a 18 pt."
          @update:model-value="update({ showPages: $event })"
        />
      </PrefRow>
      <PrefRow label="Dicas da semana">
        <Toggle
          class="wide"
          :model-value="rhythm.weekTips"
          label="Cartão do ritmo da semana no Calendário"
          description="Quantos dias faltam e o que costuma caber em cada fase da preparação."
          @update:model-value="update({ weekTips: $event })"
        />
      </PrefRow>
    </PrefGroup>
  </div>
</template>

<style scoped>
.select {
  min-width: 260px;
  height: 30px;
}
.days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.number {
  width: 84px;
  height: 30px;
  text-align: right;
}
.unit {
  font-size: var(--text-sm);
  color: var(--muted);
}
.sample {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-soft);
}
.wide {
  width: 100%;
}
</style>
