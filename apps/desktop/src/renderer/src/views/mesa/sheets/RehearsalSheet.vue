<script setup lang="ts">
/**
 * Modo ensaio (porte de `RehearsalSheet`): o manuscrito em tipo serifado grande, cronômetro com
 * Iniciar/Pausar/Zerar (Espaço alterna), linha do tempo com a faixa de 18 a 25 minutos e a marca
 * da estimativa por palavras, e uma nota de ritmo que muda com o tempo decorrido.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { AArrowDown, AArrowUp, Pause, Play, RotateCcw, Timer } from 'lucide-vue-next'
import { countWords } from '@pregar/core/util/text'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { currentManuscript, sermonTitle } from '../panels/manuscript'
import {
  REHEARSAL_FONT,
  Stopwatch,
  TARGET_MINUTES,
  clampFontSize,
  elapsedLabel,
  estimatedMinutes,
  isOverTime,
  paceNote,
  rehearsalSubtitle,
  timeline,
  toggleLabel,
} from './rehearsal'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()

const text = currentManuscript(mesa)
const paragraphs = text.split(/\n+/).filter((line) => line.trim())
const words = countWords(text)
const estimate = estimatedMinutes(words)
const title = sermonTitle(mesa, 'Ensaio')

const stopwatch = new Stopwatch(() => performance.now())
const elapsed = ref(0)
const running = ref(false)
const fontSize = ref(clampFontSize(app.settings.rehearsal.fontSize))
let ticker: ReturnType<typeof setInterval> | null = null

const line = computed(() => timeline(elapsed.value, estimate))
const label = computed(() => elapsedLabel(elapsed.value))
const note = computed(() => paceNote(elapsed.value))
const overTime = computed(() => isOverTime(elapsed.value))
const valueText = computed(
  () =>
    `${label.value} decorridos; estimativa de ${Math.round(estimate)} min; faixa de ${TARGET_MINUTES.lower} a ${TARGET_MINUTES.upper} min`,
)

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`

function tick(): void {
  elapsed.value = stopwatch.elapsed()
}

function toggle(): void {
  if (paragraphs.length === 0) return
  stopwatch.toggle()
  running.value = stopwatch.running
  tick()
  if (ticker) clearInterval(ticker)
  ticker = running.value ? setInterval(tick, 500) : null
}

function reset(): void {
  stopwatch.reset()
  running.value = false
  elapsed.value = 0
  if (ticker) clearInterval(ticker)
  ticker = null
}

function setFont(size: number): void {
  fontSize.value = clampFontSize(size)
  void app.updateSettings({ rehearsal: { fontSize: fontSize.value } })
}

/** Espaço inicia e pausa em qualquer lugar da folha, menos em campos de texto. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  toggle()
}

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <Sheet :width="980" label="Ensaio" @close="emit('close')">
    <div class="rehearsal" @keydown="onKeydown">
      <header class="rehearsal__header">
        <SheetHeader :title="title" :subtitle="rehearsalSubtitle(words)" :icon="Timer" />
        <div class="clock">
          <span
            class="clock__time"
            :class="{ 'clock__time--over': overTime }"
            role="timer"
            :aria-label="`Tempo decorrido ${label}`"
            >{{ label }}</span
          >
          <div class="clock__buttons">
            <PButton
              variant="primary"
              autofocus
              :disabled="paragraphs.length === 0"
              :title="`${toggleLabel(running, elapsed)} (Espaço)`"
              @click="toggle"
            >
              <Pause v-if="running" :size="13" />
              <Play v-else :size="13" />
              {{ toggleLabel(running, elapsed) }}
            </PButton>
            <PButton :disabled="elapsed === 0 && !running" @click="reset"
              ><RotateCcw :size="13" /> Zerar</PButton
            >
          </div>
        </div>
      </header>

      <div
        class="timeline"
        role="progressbar"
        aria-label="Progresso do ensaio"
        :aria-valuemin="0"
        :aria-valuemax="Math.round(line.scaleMinutes * 60)"
        :aria-valuenow="Math.round(elapsed)"
        :aria-valuetext="valueText"
      >
        <div
          class="timeline__band"
          :style="{ left: percent(line.bandStart), width: percent(line.bandEnd - line.bandStart) }"
        />
        <div class="timeline__fill" :style="{ width: `max(6px, ${percent(line.elapsed)})` }" />
        <div
          v-if="line.estimate !== null"
          class="timeline__estimate"
          :style="{ left: percent(line.estimate) }"
          title="Estimativa pela contagem de palavras"
        />
      </div>
      <div class="timeline__legend" aria-hidden="true">
        <span :style="{ left: percent(line.bandStart) }">{{ TARGET_MINUTES.lower }} min</span>
        <span :style="{ left: percent(line.bandEnd) }">{{ TARGET_MINUTES.upper }} min</span>
      </div>

      <div class="rehearsal__row">
        <p class="rehearsal__note" aria-live="polite">{{ note }}</p>
        <div class="font" role="group" aria-label="Tamanho do texto">
          <PButton
            variant="icon"
            compact
            label="Diminuir o tipo"
            :disabled="fontSize <= REHEARSAL_FONT.min"
            @click="setFont(fontSize - REHEARSAL_FONT.step)"
          >
            <AArrowDown :size="15" />
          </PButton>
          <span class="font__value">{{ fontSize }} pt</span>
          <PButton
            variant="icon"
            compact
            label="Aumentar o tipo"
            :disabled="fontSize >= REHEARSAL_FONT.max"
            @click="setFont(fontSize + REHEARSAL_FONT.step)"
          >
            <AArrowUp :size="15" />
          </PButton>
        </div>
      </div>

      <div class="scroll rehearsal__text selectable" tabindex="0" aria-label="Manuscrito para ensaio">
        <div
          v-memo="[fontSize]"
          class="serif rehearsal__page"
          :style="{ fontSize: `${fontSize}pt`, lineHeight: 1.45 }"
        >
          <p v-if="paragraphs.length === 0" class="muted">O manuscrito está vazio.</p>
          <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
        </div>
      </div>

      <footer class="rehearsal__footer">
        <p class="rehearsal__tip">
          Dica do workshop: não tenha pressa, mas não seja prolixo. 18, 20, 25 minutos: tá tudo bem.
        </p>
        <PButton @click="emit('close')">Encerrar ensaio</PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.rehearsal {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.rehearsal__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}
.rehearsal__header > :first-child {
  flex: 1;
  min-width: 0;
}
.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.clock__time {
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.clock__time--over {
  color: var(--warning);
}
.clock__buttons {
  display: flex;
  gap: var(--space-sm);
}
.timeline {
  position: relative;
  height: 10px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  overflow: hidden;
}
.timeline__band {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--accent-soft);
}
.timeline__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 5px;
  background: var(--accent);
  transition: width 0.4s linear;
}
.timeline__estimate {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: color-mix(in srgb, var(--ink) 50%, transparent);
}
.timeline__legend {
  position: relative;
  height: 12px;
  margin-top: -8px;
  font-size: 10px;
  color: var(--muted);
}
.timeline__legend span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.rehearsal__row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.rehearsal__note {
  flex: 1;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.font {
  display: flex;
  align-items: center;
  gap: 2px;
}
.font__value {
  width: 40px;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.rehearsal__text {
  height: min(560px, calc(100vh - 340px));
  min-height: 200px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--manuscript);
}
.rehearsal__page {
  max-width: 720px;
  margin: 0 auto;
  padding: 36px 48px;
}
.rehearsal__page p {
  margin: 0 0 0.8em;
}
.rehearsal__footer {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.rehearsal__tip {
  flex: 1;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
