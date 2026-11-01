<script lang="ts">
import { shallowRef } from 'vue'
import type { SermonAIQuestion } from '@pregar/core/ai'

/**
 * Últimas perguntas desta janela, só em memória: "Ir ao trecho" fecha a folha para mostrar o
 * manuscrito, e reabrir a folha mostra as mesmas perguntas. Nada é gravado.
 */
const lastQuestions = shallowRef<{
  dateKey: string
  questions: SermonAIQuestion[]
  validationNotice: string | null
  label: string
} | null>(null)
</script>

<script setup lang="ts">
/**
 * Perguntas de emergência (porte de `EmergencyQuestionsSheet`): até três perguntas sobre o que já
 * está escrito, cada uma ancorada em trechos literais do manuscrito. Sem ideias novas, sem
 * aplicação, sem redação; nada é salvo nem acrescentado ao manuscrito.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { CircleQuestionMark, MessageSquareText, ScanText, ShieldCheck, TriangleAlert } from 'lucide-vue-next'
import { providerName } from '@pregar/core/ai'
import EmptyState from '@/components/EmptyState.vue'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke, on } from '@/lib/api'
import { selectQuote } from '@/lib/editorBridge'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { currentManuscript, sermonTitle } from '../panels/manuscript'
import {
  isCanceledError,
  isQuotaError,
  newRequestId,
  questionsPayloadDescription,
  quotaExhausted,
} from '../panels/review'
import { useAIAccess } from '../panels/useAIAccess'
import AccessLine from './AccessLine.vue'
import SourcesList from './SourcesList.vue'
import { useReviewSources } from './useReviewSources'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()
const toasts = useToasts()
const { access } = useAIAccess('review')
const always = ref(true)
const reviewSources = useReviewSources(always)
const { sources, bibleSources, materials, totalBytes, blockedReason, error: sourcesError } = reviewSources
const sourcesLoading = reviewSources.loading

const manuscriptEmpty = currentManuscript(mesa).trim().length === 0
const sending = ref(false)
const progress = ref<string | null>(null)
const failure = ref<{ message: string; quota: boolean } | null>(null)
const canceledNotice = ref(false)
const showResult = ref(lastQuestions.value?.dateKey === mesa.selectedDateKey)
const result = computed(() =>
  showResult.value && lastQuestions.value?.dateKey === mesa.selectedDateKey ? lastQuestions.value : null,
)
const doneButton = ref<InstanceType<typeof PButton> | null>(null)
let requestId: string | null = null
/** Cancelado antes de o pedido sair (durante o salvamento ou a conferência das fontes). */
let cancelRequested = false

const quotaBlocked = computed(
  () => access.value?.mode === 'pro' && quotaExhausted(access.value.usage, 'questions'),
)
const canSend = computed(
  () =>
    !sending.value &&
    !manuscriptEmpty &&
    Boolean(access.value) &&
    access.value!.mode !== 'none' &&
    !quotaBlocked.value &&
    !sourcesLoading.value &&
    !blockedReason.value,
)
const payload = computed(() =>
  questionsPayloadDescription({
    mode: access.value?.mode ?? 'byok',
    providerName: providerName(access.value?.provider ?? 'anthropic'),
    hasReference: mesa.mainReference.length > 0,
    hasBible: bibleSources.value.length > 0,
    hasMaterials: materials.value.length > 0,
  }),
)

async function send(): Promise<void> {
  if (!canSend.value) return
  sending.value = true
  failure.value = null
  canceledNotice.value = false
  progress.value = 'Preparando o envio…'
  const id = (requestId = newRequestId())
  cancelRequested = false
  const stop = on('ai:progress', (event) => {
    if (event.requestId === id) progress.value = event.message
  })
  try {
    await mesa.flush()
    await reviewSources.ensureFresh()
    if (cancelRequested) throw Object.assign(new Error('Operação cancelada.'), { code: 'canceled' })
    const response = await invoke('ai:questions', {
      requestId: id,
      dateKey: mesa.selectedDateKey,
      title: sermonTitle(mesa, ''),
      mainReference: mesa.mainReference,
      manuscript: currentManuscript(mesa),
      sourceIds: sources.value.map((source) => source.id),
    })
    lastQuestions.value = {
      dateKey: mesa.selectedDateKey,
      questions: response.questions,
      validationNotice: response.validationNotice,
      label: access.value?.label ?? '',
    }
    showResult.value = true
    await nextTick()
    ;(doneButton.value?.$el as HTMLElement | undefined)?.focus()
  } catch (error) {
    if (isCanceledError(error)) canceledNotice.value = true
    else failure.value = { message: errorMessage(error), quota: isQuotaError(error) }
  } finally {
    stop()
    requestId = null
    sending.value = false
    progress.value = null
  }
}

function cancelOrClose(): void {
  if (requestId) {
    cancelRequested = true
    void invoke('ai:cancel', { requestId }).catch(() => undefined)
    return
  }
  emit('close')
}

function goTo(quote: string): void {
  emit('close')
  setTimeout(() => {
    if (!selectQuote(quote))
      toasts.show('Este trecho não foi encontrado no manuscrito; o texto pode ter mudado.', 'info')
  }, 0)
}

function sourceLine(item: { evidenceSourceTitle?: string; evidenceCitation?: string }): string {
  return [item.evidenceSourceTitle, item.evidenceCitation].filter(Boolean).join(' · ')
}

function openPreferences(): void {
  void invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/ia' })
}

onBeforeUnmount(() => {
  if (requestId) void invoke('ai:cancel', { requestId }).catch(() => undefined)
})
</script>

<template>
  <Sheet :width="560" label="Perguntas de emergência" :dismissible="!sending" @close="emit('close')">
    <div v-if="result" class="questions">
      <header class="result__header">
        <h2 class="serif result__title">Perguntas</h2>
        <span class="result__provider">{{ result.label }}</span>
      </header>
      <p v-if="result.validationNotice" class="result__notice">
        <ShieldCheck :size="12" aria-hidden="true" /> {{ result.validationNotice }}
      </p>
      <EmptyState
        v-if="result.questions.length === 0"
        :icon="MessageSquareText"
        title="Sem perguntas adicionais"
        message="Não encontrei uma pergunta neutra que respeitasse os limites definidos."
      />
      <ol v-else class="scroll result__list">
        <li v-for="item in result.questions" :key="item.id" class="question">
          <button
            type="button"
            class="question__quote"
            title="Selecionar este trecho no manuscrito"
            @click="goTo(item.manuscriptQuote)"
          >
            “{{ item.manuscriptQuote }}”
          </button>
          <p class="question__text selectable">{{ item.question }}</p>
          <div class="question__links">
            <PButton variant="link" compact @click="goTo(item.manuscriptQuote)"
              ><ScanText :size="13" /> Ir ao trecho</PButton
            >
            <PButton
              v-if="item.relatedManuscriptQuote"
              variant="link"
              compact
              @click="goTo(item.relatedManuscriptQuote)"
            >
              <ScanText :size="13" /> Ir ao outro trecho
            </PButton>
          </div>
          <template v-if="item.evidenceQuote">
            <p class="question__evidence selectable">“{{ item.evidenceQuote }}”</p>
            <p v-if="sourceLine(item)" class="question__source">{{ sourceLine(item) }}</p>
          </template>
        </li>
      </ol>
      <footer class="sheet-footer">
        <span class="sheet-footer__note">Perguntas temporárias · nada foi acrescentado ao manuscrito</span>
        <PButton @click="showResult = false">Pedir novas perguntas</PButton>
        <PButton ref="doneButton" variant="primary" @click="emit('close')">Concluído</PButton>
      </footer>
    </div>

    <div v-else class="questions">
      <SheetHeader
        title="Perguntas de emergência"
        subtitle="Perguntas sobre o que você já escreveu. Sem ideias novas, sem aplicação, sem redação."
        :icon="CircleQuestionMark"
      />
      <section class="card scope" aria-label="Escopo">
        <SectionLabel title="Escopo" />
        <p class="scope__text">{{ payload }}</p>
        <p v-if="sourcesLoading" class="scope__hint scope__row" role="status">
          <Spinner :size="12" /> Conferindo as fontes…
        </p>
        <SourcesList v-else-if="sources.length > 0" :sources="sources" :total-bytes="totalBytes" />
      </section>

      <AccessLine :access="access" operation="questions" />

      <p v-if="manuscriptEmpty" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" /> Escreva no manuscrito antes de pedir perguntas.
      </p>
      <p v-if="blockedReason" class="warning" role="alert">
        <TriangleAlert :size="13" aria-hidden="true" /> {{ blockedReason }}
      </p>
      <p v-if="sourcesError" class="warning" role="alert">
        <TriangleAlert :size="13" aria-hidden="true" /> {{ sourcesError }}
      </p>
      <p v-if="quotaBlocked && !failure" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" /> As perguntas da assinatura acabaram neste período. É
        possível usar suas próprias chaves.
      </p>
      <div v-if="failure" class="failure" role="alert">
        <p class="failure__text">{{ failure.message }}</p>
        <PButton v-if="failure.quota" variant="link" compact @click="openPreferences"
          >Usar minhas chaves</PButton
        >
      </div>
      <p v-if="canceledNotice" class="muted progress">Pedido cancelado. Nada foi alterado.</p>
      <p v-if="sending && progress" class="progress" role="status"><Spinner :size="12" /> {{ progress }}</p>

      <footer class="sheet-footer">
        <span class="spacer" />
        <PButton @click="cancelOrClose">Cancelar</PButton>
        <PButton
          variant="primary"
          :disabled="!canSend"
          :busy="sending"
          title="O manuscrito e as fontes listadas serão enviados somente ao clicar"
          @click="send"
        >
          {{ sending ? 'Pensando…' : 'Pedir perguntas' }}
        </PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.questions {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.scope {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.scope__text {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.scope__hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.scope__row,
.progress {
  display: flex;
  align-items: center;
  gap: 7px;
}
.progress {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--warning);
}
.warning svg {
  flex: none;
  margin-top: 1px;
}
.failure {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.failure__text {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}
.sheet-footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.sheet-footer__note {
  flex: 1;
  font-size: 10px;
  color: var(--muted);
}
.result__header {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
}
.result__title {
  flex: 1;
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.result__provider {
  font-size: 10px;
  color: var(--muted);
}
.result__notice {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.result__list {
  max-height: min(430px, calc(100vh - 260px));
  margin: 0;
  padding: 0 4px 0 0;
  list-style: none;
}
.question {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.question__quote {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
.question__quote:hover {
  color: var(--ink);
}
.question__text {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
.question__links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-left: -6px;
}
.question__evidence {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
}
.question__source {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
}
</style>
