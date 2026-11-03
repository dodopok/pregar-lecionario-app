<script setup lang="ts">
/**
 * Ensaio em tela cheia: o manuscrito em tipo grande, cronômetro, rolagem automática no ritmo
 * estimado, marcas por título e a medição do seu ritmo ao fim da leitura (Preferências › Ritmo).
 * Espaço inicia e pausa; Esc encerra.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { AArrowDown, AArrowUp, Flag, Pause, Play, RotateCcw, ScrollText, X } from 'lucide-vue-next'
import { countWords, measuredWordsPerMinute } from '@pregar/core/util/text'
import PButton from '@/components/PButton.vue'
import { activeEditor } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { currentManuscript, sermonTitle } from './panels/manuscript'
import {
  REHEARSAL_FONT,
  SCROLL_SPEEDS,
  Stopwatch,
  clampFontSize,
  elapsedLabel,
  estimatedMinutes,
  isOverTime,
  paceNote,
  rehearsalBlocks,
  rehearsalBlocksFromText,
  rehearsalSubtitle,
  targetBand,
  timeline,
  toggleLabel,
} from './sheets/rehearsal'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()
const toasts = useToasts()

const json = activeEditor.value?.getJSON() ?? null
const blocks = json ? rehearsalBlocks(json) : rehearsalBlocksFromText(currentManuscript(mesa))
const words = countWords(blocks.map((block) => block.text).join('\n'))
const title = sermonTitle(mesa, 'Ensaio')
const rhythm = computed(() => app.settings.rhythm)
const band = computed(() => targetBand(rhythm.value.targetMinutes))
const estimate = computed(() => estimatedMinutes(words, rhythm.value.wordsPerMinute))
const headings = blocks
  .map((block, index) => ({ block, index }))
  .filter((entry) => entry.block.kind === 'heading')

const stopwatch = new Stopwatch(() => performance.now())
const elapsed = ref(0)
const running = ref(false)
const finished = ref<{ wpm: number | null; saved: boolean } | null>(null)
const fontSize = ref(clampFontSize(app.settings.rehearsal.fontSize))
const autoScroll = ref(true)
const speedIndex = ref(2)
const text = ref<HTMLElement | null>(null)
let ticker: ReturnType<typeof setInterval> | null = null
let frame = 0
let lastFrame = 0

const line = computed(() => timeline(elapsed.value, estimate.value, band.value))
const label = computed(() => elapsedLabel(elapsed.value))
const note = computed(() => paceNote(elapsed.value, band.value))
const overTime = computed(() => isOverTime(elapsed.value, band.value))
const subtitle = computed(() => rehearsalSubtitle(words, band.value, rhythm.value.wordsPerMinute))
const speed = computed(() => SCROLL_SPEEDS[speedIndex.value] ?? 1)
const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`

function tick(): void {
  elapsed.value = stopwatch.elapsed()
}

function scrollStep(now: number): void {
  frame = 0
  if (!running.value || !autoScroll.value || !text.value) return
  const delta = lastFrame ? (now - lastFrame) / 1000 : 0
  lastFrame = now
  const element = text.value
  const distance = element.scrollHeight - element.clientHeight
  const seconds = Math.max(30, estimate.value * 60)
  if (distance > 0 && delta > 0) element.scrollTop += (distance / seconds) * speed.value * delta
  frame = requestAnimationFrame(scrollStep)
}

function startScroll(): void {
  lastFrame = 0
  if (!frame) frame = requestAnimationFrame(scrollStep)
}

function toggle(): void {
  if (blocks.length === 0) return
  finished.value = null
  stopwatch.toggle()
  running.value = stopwatch.running
  tick()
  if (ticker) clearInterval(ticker)
  ticker = running.value ? setInterval(tick, 500) : null
  if (running.value) startScroll()
}

function reset(): void {
  stopwatch.reset()
  running.value = false
  elapsed.value = 0
  finished.value = null
  if (ticker) clearInterval(ticker)
  ticker = null
  if (text.value) text.value.scrollTop = 0
}

/** Marca o fim da leitura: para o cronômetro e calcula o ritmo real desta leitura. */
async function finish(): Promise<void> {
  if (stopwatch.running) {
    stopwatch.toggle()
    running.value = false
    if (ticker) clearInterval(ticker)
    ticker = null
  }
  tick()
  const wpm = measuredWordsPerMinute(words, elapsed.value)
  let saved = false
  if (wpm !== null && rhythm.value.autoUpdate) {
    await app.updateSettings({ rhythm: { wordsPerMinute: wpm, measuredAt: new Date().toISOString() } })
    saved = true
  }
  finished.value = { wpm, saved }
}

async function adoptPace(): Promise<void> {
  if (!finished.value?.wpm) return
  await app.updateSettings({
    rhythm: { wordsPerMinute: finished.value.wpm, measuredAt: new Date().toISOString() },
  })
  finished.value = { ...finished.value, saved: true }
  toasts.show('As estimativas passam a usar o seu ritmo.', 'success')
}

function setFont(size: number): void {
  fontSize.value = clampFontSize(size)
  void app.updateSettings({ rehearsal: { fontSize: fontSize.value } })
}

function jump(index: number): void {
  document.getElementById(`rehearsal-block-${index}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== ' ' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault()
  toggle()
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown, true)
  await nextTick()
  text.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  if (ticker) clearInterval(ticker)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="rehearsal" role="dialog" aria-modal="true" aria-label="Ensaio">
    <header class="rehearsal__bar">
      <div class="rehearsal__title">
        <p class="eyebrow">Ensaio</p>
        <h1 class="serif rehearsal__name" :title="title">{{ title }}</h1>
        <p class="rehearsal__subtitle">{{ subtitle }}</p>
      </div>
      <span class="spacer" />
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
            :disabled="blocks.length === 0"
            :title="`${toggleLabel(running, elapsed)} (Espaço)`"
            @click="toggle"
          >
            <Pause v-if="running" :size="13" /><Play v-else :size="13" />{{ toggleLabel(running, elapsed) }}
          </PButton>
          <PButton :disabled="elapsed < 30" title="Marca o fim da leitura e mede o seu ritmo" @click="finish"
            ><Flag :size="13" /> Cheguei ao fim</PButton
          >
          <PButton :disabled="elapsed === 0 && !running" @click="reset"
            ><RotateCcw :size="13" /> Zerar</PButton
          >
        </div>
      </div>
      <PButton variant="ghost" title="Encerrar o ensaio (Esc)" @click="emit('close')"
        ><X :size="14" /> Encerrar</PButton
      >
    </header>

    <div
      class="timeline"
      role="progressbar"
      aria-label="Progresso do ensaio"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(line.scaleMinutes * 60)"
      :aria-valuenow="Math.round(elapsed)"
      :aria-valuetext="`${label} decorridos; meta de ${rhythm.targetMinutes} min`"
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
      <span :style="{ left: percent(line.bandStart) }">{{ band.lower }} min</span>
      <span :style="{ left: percent(line.bandEnd) }">{{ band.upper }} min</span>
    </div>

    <div class="rehearsal__body">
      <aside class="marks" aria-label="Marcas e ajustes">
        <p class="rehearsal__note" aria-live="polite">{{ note }}</p>
        <div v-if="finished" class="measured" role="status">
          <template v-if="finished.wpm">
            <strong>Seu ritmo nesta leitura: {{ finished.wpm }} palavras por minuto.</strong>
            <span v-if="finished.saved">As estimativas da Mesa já usam esse ritmo.</span>
            <PButton v-else compact variant="primary" @click="adoptPace"
              >Usar este ritmo nas estimativas</PButton
            >
          </template>
          <span v-else>Leitura curta demais para medir o ritmo (ao menos 80 palavras e 30 segundos).</span>
        </div>
        <section v-if="headings.length > 0" class="marks__list" aria-label="Títulos do manuscrito">
          <p class="eyebrow">Marcas</p>
          <button
            v-for="entry in headings"
            :key="entry.index"
            type="button"
            class="mark"
            :title="entry.block.text"
            @click="jump(entry.index)"
          >
            {{ entry.block.text }}
          </button>
        </section>
        <section class="marks__tools" aria-label="Ajustes">
          <label class="tool">
            <input v-model="autoScroll" type="checkbox" />
            <ScrollText :size="13" aria-hidden="true" /> Rolagem automática
          </label>
          <div class="tool tool--row" role="group" aria-label="Velocidade da rolagem">
            <span class="tool__label">Velocidade</span>
            <input
              v-model.number="speedIndex"
              type="range"
              min="0"
              :max="SCROLL_SPEEDS.length - 1"
              step="1"
              :disabled="!autoScroll"
              aria-label="Velocidade da rolagem"
            />
            <span class="tool__value">{{ speed.toLocaleString('pt-BR') }}×</span>
          </div>
          <div class="tool tool--row" role="group" aria-label="Tamanho do texto">
            <PButton
              variant="icon"
              compact
              label="Diminuir o tipo"
              :disabled="fontSize <= REHEARSAL_FONT.min"
              @click="setFont(fontSize - REHEARSAL_FONT.step)"
              ><AArrowDown :size="15"
            /></PButton>
            <span class="tool__value">{{ fontSize }} pt</span>
            <PButton
              variant="icon"
              compact
              label="Aumentar o tipo"
              :disabled="fontSize >= REHEARSAL_FONT.max"
              @click="setFont(fontSize + REHEARSAL_FONT.step)"
              ><AArrowUp :size="15"
            /></PButton>
          </div>
        </section>
        <p class="marks__tip">
          Não tenha pressa, mas não seja prolixo. As anotações só para você ficam de fora.
        </p>
      </aside>

      <div
        ref="text"
        class="scroll rehearsal__text selectable"
        tabindex="0"
        aria-label="Manuscrito para ensaio"
      >
        <div class="serif rehearsal__page" :style="{ fontSize: `${fontSize}pt`, lineHeight: 1.5 }">
          <p v-if="blocks.length === 0" class="muted">O manuscrito está vazio.</p>
          <template v-for="(block, index) in blocks" :key="index">
            <h2 v-if="block.kind === 'heading'" :id="`rehearsal-block-${index}`" class="rehearsal__heading">
              {{ block.text }}
            </h2>
            <blockquote
              v-else-if="block.kind === 'quote'"
              :id="`rehearsal-block-${index}`"
              class="rehearsal__quote"
            >
              {{ block.text }}
            </blockquote>
            <p v-else :id="`rehearsal-block-${index}`">{{ block.text }}</p>
          </template>
          <div class="rehearsal__end" aria-hidden="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rehearsal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
  animation: fade 0.16s var(--ease);
}
.rehearsal__bar {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: calc(14px + var(--window-controls-top, 0px)) 20px 10px calc(20px + var(--window-controls-inset));
}
.rehearsal__title {
  min-width: 0;
}
.rehearsal__name {
  margin: 2px 0 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 48vw;
}
.rehearsal__subtitle {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
}
.clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.clock__time {
  font-size: 38px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.clock__time--over {
  color: var(--warning-ink);
}
.clock__buttons {
  display: flex;
  gap: var(--space-sm);
}
.timeline {
  position: relative;
  height: 10px;
  margin: 0 20px;
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
  height: 16px;
  margin: 2px 20px 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.timeline__legend span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.rehearsal__body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
  padding: 6px 20px 20px;
}
.marks {
  flex: none;
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
}
.rehearsal__note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-soft);
}
.measured {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--accent-softer);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  font-size: var(--text-sm);
}
.marks__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mark {
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  text-align: left;
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.marks__tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
}
.tool input[type='checkbox'] {
  margin: 0;
  accent-color: var(--accent);
}
.tool input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
}
.tool__label {
  color: var(--muted);
}
.tool__value {
  min-width: 40px;
  text-align: center;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.marks__tip {
  margin: auto 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.rehearsal__text {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--manuscript);
  outline: none;
}
.rehearsal__page {
  max-width: 760px;
  margin: 0 auto;
  padding: 40px 56px;
}
.rehearsal__page p {
  margin: 0 0 0.8em;
}
.rehearsal__heading {
  margin: 1.2em 0 0.4em;
  font-size: 1.15em;
  font-weight: 600;
  color: var(--accent-ink);
}
.rehearsal__quote {
  margin: 0 0 0.8em;
  padding-left: 1em;
  border-left: 2px solid var(--accent);
  font-style: italic;
  color: var(--ink-soft);
}
.rehearsal__end {
  height: 40vh;
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
</style>
