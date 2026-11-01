<script setup lang="ts">
/**
 * Folha "Nova revisão" (porte de `ReviewRequestSheet`): critérios com a descrição do workshop,
 * o que será enviado e a quem, envio só pelo clique, progresso, cancelamento e o resultado com o
 * mapa do sermão e os apontamentos. A revisão aponta e fundamenta; nunca altera o manuscrito.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { CircleCheck, ListTree, ShieldAlert, ShieldCheck, TriangleAlert, BadgeCheck } from 'lucide-vue-next'
import { CRITERION_GUIDANCE, CRITERION_TITLES, SERMON_REVIEW_CRITERIA, providerName } from '@pregar/core/ai'
import type { SermonReviewCriterion, SermonReviewReport } from '@pregar/core/ai'
import type { UsageSummary } from '@pregar/core/plans/contract'
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
import FindingItem from '../panels/FindingItem.vue'
import StructureMap from '../panels/StructureMap.vue'
import { currentManuscript, sermonTitle } from '../panels/manuscript'
import { shortTime } from '../panels/materials'
import {
  isCanceledError,
  isQuotaError,
  newRequestId,
  operationForCriteria,
  quotaExhausted,
  reviewPayloadDescription,
  sortedCriteria,
  usageLine,
} from '../panels/review'
import { useAIAccess } from '../panels/useAIAccess'
import AccessLine from './AccessLine.vue'
import SourcesList from './SourcesList.vue'
import { useReviewSources } from './useReviewSources'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()
const toasts = useToasts()
const { access } = useAIAccess('review')

const selected = ref<Set<SermonReviewCriterion>>(new Set(sortedCriteria(mesa.reviewCriteriaPreset)))
const criteria = computed(() => sortedCriteria(selected.value))
const needsSources = computed(() => selected.value.has('fidelity'))
const reviewSources = useReviewSources(needsSources)
const { sources, bibleSources, materials, totalBytes, blockedReason, error: sourcesError } = reviewSources
const sourcesLoading = reviewSources.loading
const manuscriptEmpty = ref(currentManuscript(mesa).trim().length === 0)
const operation = computed(() => operationForCriteria(criteria.value))

const sending = ref(false)
const progress = ref<string | null>(null)
const failure = ref<{ message: string; quota: boolean } | null>(null)
const canceledNotice = ref(false)
const result = shallowRef<{ report: SermonReviewReport; usage: UsageSummary | null } | null>(null)
const doneButton = ref<InstanceType<typeof PButton> | null>(null)
let requestId: string | null = null
/** Cancelado antes de o pedido sair (durante o salvamento ou a conferência das fontes). */
let cancelRequested = false

const bibleMissing = computed(
  () => needsSources.value && !sourcesLoading.value && bibleSources.value.length === 0,
)
const quotaBlocked = computed(
  () => access.value?.mode === 'pro' && quotaExhausted(access.value.usage, operation.value),
)
const canSend = computed(
  () =>
    !sending.value &&
    !manuscriptEmpty.value &&
    criteria.value.length > 0 &&
    Boolean(access.value) &&
    access.value!.mode !== 'none' &&
    !quotaBlocked.value &&
    (!needsSources.value || (!sourcesLoading.value && bibleSources.value.length > 0 && !blockedReason.value)),
)
const payload = computed(() =>
  reviewPayloadDescription({
    mode: access.value?.mode ?? 'byok',
    providerName: providerName(access.value?.provider ?? 'anthropic'),
    includesSources: needsSources.value,
    hasMaterials: materials.value.length > 0,
  }),
)

function toggle(criterion: SermonReviewCriterion, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(criterion)
  else next.delete(criterion)
  selected.value = next
}

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
    const response = await invoke('ai:review', {
      requestId: id,
      dateKey: mesa.selectedDateKey,
      title: sermonTitle(mesa, ''),
      mainReference: mesa.mainReference,
      manuscript: currentManuscript(mesa),
      sourceIds: needsSources.value ? sources.value.map((source) => source.id) : [],
      criteria: criteria.value,
    })
    mesa.reviews = response.reports
    mesa.contextTab = 'review'
    result.value = { report: response.report, usage: response.usage }
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
  // A folha some antes, para o trecho selecionado ficar visível.
  setTimeout(() => {
    if (!selectQuote(quote))
      toasts.show('Este trecho não foi encontrado no manuscrito; o texto pode ter mudado.', 'info')
  }, 0)
}

function openPreferences(): void {
  void invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/ia' })
}

onMounted(() => {
  manuscriptEmpty.value = currentManuscript(mesa).trim().length === 0
})
onBeforeUnmount(() => {
  if (requestId) void invoke('ai:cancel', { requestId }).catch(() => undefined)
})
</script>

<template>
  <Sheet :width="result ? 640 : 560" label="Nova revisão" :dismissible="!sending" @close="emit('close')">
    <div v-if="result" class="review-sheet">
      <header class="result__header">
        <h2 class="serif result__title">Revisão</h2>
        <span class="result__provider"
          >{{ providerName(result.report.provider) }} · {{ result.report.model }}</span
        >
      </header>

      <EmptyState
        v-if="result.report.findings.length === 0 && !result.report.structure"
        :icon="result.report.validationNotice ? ShieldAlert : CircleCheck"
        :title="result.report.validationNotice ? 'Nenhuma observação verificável' : 'Nenhuma observação'"
        :message="
          result.report.validationNotice ??
          'Não encontrei apontamentos fundamentados nos critérios escolhidos.'
        "
      />
      <div v-else class="scroll result__body">
        <p v-if="result.report.validationNotice" class="result__notice">
          <ShieldCheck :size="12" aria-hidden="true" /> {{ result.report.validationNotice }}
        </p>
        <StructureMap v-if="result.report.structure" :structure="result.report.structure" @select="goTo" />
        <p v-if="result.report.findings.length === 0" class="muted result__row">
          <CircleCheck :size="13" aria-hidden="true" /> Nenhum apontamento além do mapa nos critérios
          escolhidos.
        </p>
        <template v-else>
          <SectionLabel title="Apontamentos" class="result__label" />
          <FindingItem
            v-for="finding in result.report.findings"
            :key="finding.id"
            :finding="finding"
            @select="goTo"
          />
        </template>
      </div>

      <footer class="sheet-footer">
        <span class="sheet-footer__note">
          Relatório salvo neste computador · {{ shortTime(result.report.createdAt) }}
          <template v-if="result.usage">
            · {{ usageLine(result.usage, [operationForCriteria(result.report.criteria)]) }}</template
          >
        </span>
        <PButton ref="doneButton" variant="primary" @click="emit('close')">Concluído</PButton>
      </footer>
    </div>

    <div v-else class="review-sheet">
      <SheetHeader
        title="Nova revisão"
        subtitle="Aponta e fundamenta. Não escreve, não completa, não sugere frases."
        :icon="BadgeCheck"
      />

      <fieldset class="card criteria">
        <legend class="visually-hidden">Critérios da revisão</legend>
        <label v-for="criterion in SERMON_REVIEW_CRITERIA" :key="criterion" class="criterion">
          <input
            type="checkbox"
            class="criterion__check"
            :checked="selected.has(criterion)"
            :disabled="sending"
            @change="toggle(criterion, ($event.target as HTMLInputElement).checked)"
          />
          <span class="criterion__text">
            <span class="criterion__title">{{ CRITERION_TITLES[criterion] }}</span>
            <span class="criterion__guidance">{{ CRITERION_GUIDANCE[criterion] }}</span>
          </span>
        </label>
        <p class="criteria__map">
          <ListTree :size="13" aria-hidden="true" />
          O mapa do sermão acompanha toda revisão: onde começam introdução, desenvolvimento e conclusão, a
          ideia dominante, os movimentos e onde a Boa Nova aparece.
        </p>
      </fieldset>

      <section class="card payload" aria-label="Para a revisão">
        <SectionLabel title="Para a revisão" />
        <p class="payload__text">{{ payload }}</p>
        <p v-if="!needsSources" class="payload__hint">
          Os materiais marcados só serão enviados quando Fidelidade estiver selecionada.
        </p>
        <template v-else>
          <p v-if="sourcesLoading" class="payload__hint payload__row" role="status">
            <Spinner :size="12" /> Conferindo as fontes…
          </p>
          <template v-else>
            <SourcesList v-if="sources.length > 0" :sources="sources" :total-bytes="totalBytes" />
            <p v-if="materials.length === 0" class="payload__hint">Nenhum material do Leitor está marcado.</p>
          </template>
        </template>
      </section>

      <AccessLine :access="access" :operation="operation" />

      <p v-if="manuscriptEmpty" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" /> Escreva no manuscrito antes de pedir uma revisão.
      </p>
      <p v-if="criteria.length === 0" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" /> Escolha ao menos um critério.
      </p>
      <p v-if="bibleMissing" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" />
        {{
          mesa.mainReference
            ? 'O texto bíblico ainda não foi carregado; Fidelidade ficará indisponível.'
            : 'Escolha o texto principal nas leituras para revisar a Fidelidade.'
        }}
      </p>
      <p v-if="needsSources && blockedReason" class="warning" role="alert">
        <TriangleAlert :size="13" aria-hidden="true" /> {{ blockedReason }}
      </p>
      <p v-if="needsSources && sourcesError" class="warning" role="alert">
        <TriangleAlert :size="13" aria-hidden="true" /> {{ sourcesError }}
      </p>
      <p v-if="quotaBlocked && !failure" class="warning">
        <TriangleAlert :size="13" aria-hidden="true" /> A cota desta operação na assinatura acabou neste
        período. É possível usar suas próprias chaves.
      </p>
      <div v-if="failure" class="failure" role="alert">
        <p class="failure__text">{{ failure.message }}</p>
        <PButton v-if="failure.quota" variant="link" compact @click="openPreferences"
          >Usar minhas chaves</PButton
        >
      </div>
      <p v-if="canceledNotice" class="muted progress">Revisão cancelada. Nada foi alterado.</p>
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
          {{ sending ? 'Revisando…' : 'Enviar revisão' }}
        </PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.review-sheet {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.criteria {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.criterion {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.criterion__check {
  flex: none;
  margin: 2px 0 0;
  accent-color: var(--accent);
}
.criterion__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.criterion__title {
  font-size: 12px;
  font-weight: 500;
}
.criterion__guidance {
  font-size: 11px;
  color: var(--muted);
}
.criteria__map {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}
.criteria__map svg {
  flex: none;
  margin-top: 1px;
  color: var(--accent);
}
.payload {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.payload__text {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.payload__hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.payload__row,
.progress,
.result__row {
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
.result__body {
  max-height: min(480px, calc(100vh - 260px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}
.result__notice {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.result__label {
  margin-top: 4px;
}
.result__row {
  margin: 0;
  font-size: 12px;
}
</style>
