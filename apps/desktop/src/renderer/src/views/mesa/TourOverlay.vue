<script setup lang="ts">
/**
 * Tour da primeira abertura: quatro passos sobre as regiões reais da Mesa (dia, leituras,
 * manuscrito, materiais) e um último para conectar. Pular ou concluir grava `onboarding.tourDone`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PButton from '@/components/PButton.vue'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()

interface Step {
  target: string | null
  title: string
  text: string
}

const STEPS: Step[] = [
  {
    target: '[data-tour="date"]',
    title: 'O dia de pregar',
    text: 'A Mesa já abre no seu próximo domingo. Aqui você troca o dia, vê as festas do mês e quanto falta.',
  },
  {
    target: '[data-tour="readings"]',
    title: 'As leituras do dia, inteiras',
    text: 'Todas as leituras ficam abertas, sem precisar escolher uma. Marque a que o sermão vai seguir como texto principal.',
  },
  {
    target: '[data-tour="editor"]',
    title: 'O manuscrito',
    text: 'Escreva como num processador de texto. Anotações só para você ficam fora da contagem e da folha do púlpito.',
  },
  {
    target: '[data-tour="materials"]',
    title: 'Materiais, ideias e revisão',
    text: 'Comentários da sua biblioteca, artigos e sermões antigos sobre a mesma passagem. A revisão por IA aponta e fundamenta; nunca reescreve.',
  },
  {
    target: '[data-tour="connect"]',
    title: 'Comece bem',
    text: 'Em poucos minutos: conecte as leituras e a revisão, traga os sites e autores que você já lê, os comentários em PDF e os sermões antigos. Em degustação, as próximas semanas já aparecem.',
  },
]

const index = ref(0)
const rect = ref<DOMRect | null>(null)
const step = computed(() => STEPS[index.value]!)
const last = computed(() => index.value === STEPS.length - 1)

function measure(): void {
  const selector = step.value.target
  const element = selector ? document.querySelector<HTMLElement>(selector) : null
  rect.value = element ? element.getBoundingClientRect() : null
}

const spotlight = computed(() => {
  if (!rect.value) return null
  const pad = 6
  return {
    left: `${Math.max(0, rect.value.left - pad)}px`,
    top: `${Math.max(0, rect.value.top - pad)}px`,
    width: `${rect.value.width + pad * 2}px`,
    height: `${rect.value.height + pad * 2}px`,
  }
})

const cardStyle = computed(() => {
  const width = 360
  const height = 190
  if (!rect.value) return { left: `calc(50% - ${width / 2}px)`, top: `calc(50% - ${height / 2}px)` }
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  // Prefere abaixo do alvo; se não couber, acima; alinha à esquerda do alvo sem sair da janela.
  let top = rect.value.bottom + 14
  if (top + height > viewport.height - 16) top = Math.max(16, rect.value.top - height - 14)
  let left = rect.value.left
  if (rect.value.width > viewport.width * 0.5) left = rect.value.left + 24
  left = Math.min(Math.max(16, left), viewport.width - width - 16)
  return { left: `${left}px`, top: `${top}px` }
})

async function finish(connect: boolean): Promise<void> {
  try {
    await app.updateSettings({ onboarding: { tourDone: true } })
  } finally {
    emit('close')
    if (connect) mesa.openSheet('setup')
  }
}

function next(): void {
  if (last.value) void finish(false)
  else index.value += 1
}

function back(): void {
  if (index.value > 0) index.value -= 1
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    void finish(false)
  } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
    event.preventDefault()
    next()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    back()
  }
}

watch(index, () => void nextTick(measure))
let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  document.addEventListener('keydown', onKeydown, true)
  // A Mesa ainda carrega leituras e painéis no primeiro segundo; acompanha o alvo.
  interval = setInterval(measure, 500)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  document.removeEventListener('keydown', onKeydown, true)
  if (interval) clearInterval(interval)
})
</script>

<template>
  <div
    class="tour"
    role="dialog"
    aria-modal="true"
    :aria-label="`Tour da Mesa, passo ${index + 1} de ${STEPS.length}`"
  >
    <div v-if="spotlight" class="tour__spot" :style="spotlight" aria-hidden="true" />
    <div v-else class="tour__dim" aria-hidden="true" />
    <section class="tour__card" :style="cardStyle">
      <p class="eyebrow tour__step">Passo {{ index + 1 }} de {{ STEPS.length }}</p>
      <h2 class="serif tour__title">{{ step.title }}</h2>
      <p class="tour__text">{{ step.text }}</p>
      <footer class="tour__footer">
        <PButton variant="ghost" compact @click="finish(false)">{{
          last ? 'Explorar primeiro' : 'Pular tour'
        }}</PButton>
        <span class="spacer" />
        <PButton v-if="index > 0" compact @click="back">Voltar</PButton>
        <PButton v-if="last" variant="primary" compact autofocus @click="finish(true)"
          >Primeiros passos</PButton
        >
        <PButton v-else variant="primary" compact autofocus @click="next">Próximo</PButton>
      </footer>
      <div class="tour__dots" aria-hidden="true">
        <span
          v-for="(item, position) in STEPS"
          :key="item.title"
          class="tour__dot"
          :class="{ 'tour__dot--on': position === index }"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.tour__dim {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.42);
}
.tour__spot {
  position: absolute;
  border-radius: 12px;
  box-shadow:
    0 0 0 2px var(--accent),
    0 0 0 9999px rgb(0 0 0 / 0.42);
  transition:
    left 0.25s var(--ease),
    top 0.25s var(--ease),
    width 0.25s var(--ease),
    height 0.25s var(--ease);
  pointer-events: none;
}
.tour__card {
  position: absolute;
  width: 360px;
  padding: 18px 20px 14px;
  border-radius: var(--radius-sheet);
  background: var(--paper);
  box-shadow: var(--shadow-sheet);
  animation: rise 0.18s var(--ease);
}
.tour__step {
  color: var(--accent-ink);
}
.tour__title {
  margin: 4px 0 6px;
  font-size: 20px;
  font-weight: 600;
}
.tour__text {
  margin: 0;
  font-size: var(--text-lg);
  line-height: 1.5;
}
.tour__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}
.tour__dots {
  display: flex;
  gap: 5px;
  margin-top: 12px;
}
.tour__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line-strong);
}
.tour__dot--on {
  background: var(--accent);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
</style>
