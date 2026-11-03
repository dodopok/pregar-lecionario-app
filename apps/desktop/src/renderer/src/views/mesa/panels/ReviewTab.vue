<script setup lang="ts">
/**
 * Aba Revisão: mapa do sermão no topo, aviso quando o texto mudou desde a revisão, apontamentos
 * abertos por critério (resolver/descartar) e os fechados recolhidos. A revisão só aponta e
 * fundamenta; cada trecho citado apenas seleciona o texto no manuscrito.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  ListTree,
  ShieldCheck,
} from 'lucide-vue-next'
import {
  closedFindings,
  isReportStaleForFingerprint,
  manuscriptFingerprint,
  openFindings,
  providerName,
  replaceReport,
  setFindingStatus,
} from '@pregar/core/ai'
import type { SermonReviewFinding, SermonReviewFindingStatus, SermonReviewReport } from '@pregar/core/ai'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke, isMac } from '@/lib/api'
import { selectQuote, applyLanguageCorrections, selectedSpellingFinding } from '@/lib/editorBridge'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import FindingItem from './FindingItem.vue'
import StructureMap from './StructureMap.vue'
import { currentManuscript } from './manuscript'
import { shortDateTime } from './materials'
import { closedSummary, criterionCounts, groupFindingsByCriterion, usageLine } from './review'
import { useAIAccess } from './useAIAccess'
import { platformKeys } from '../sheets/commands'

const mesa = useMesaStore()
const toasts = useToasts()
const { access } = useAIAccess('review')

const report = computed<SermonReviewReport | null>(
  () =>
    [...mesa.reviews].reverse().find((item) => item.criteria.some((criterion) => criterion !== 'spelling')) ??
    mesa.reviews.at(-1) ??
    null,
)
const spellingReport = computed(
  () => [...mesa.reviews].reverse().find((item) => item.criteria.includes('spelling')) ?? null,
)
const spelling = computed(() =>
  spellingReport.value
    ? openFindings(spellingReport.value).filter((item) => item.criterion === 'spelling')
    : [],
)
const applying = ref(false)
watch(
  selectedSpellingFinding,
  async (id) => {
    if (!id) return
    await nextTick()
    document.getElementById(`finding-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  },
  { immediate: true },
)
async function applySpelling(items: SermonReviewFinding[]): Promise<void> {
  const target = spellingReport.value
  if (!target || applying.value) return
  applying.value = true
  try {
    const ids = applyLanguageCorrections(
      items.map((item) => ({ id: item.id, quote: item.manuscriptQuote, correction: item.correction })),
    )
    for (const id of ids) {
      const finding = items.find((item) => item.id === id)!
      await changeStatus(target, finding, 'resolved')
    }
    const skipped = items.length - ids.length
    toasts.show(
      `${ids.length} correção(ões) aplicada(s).${skipped ? ` ${skipped} trecho(s) alterado(s), repetido(s) ou sobreposto(s): confira individualmente.` : ' Use Desfazer para restaurar o texto.'}`,
      'info',
    )
  } finally {
    applying.value = false
  }
}
const stale = ref(false)
const showClosed = ref(false)
const busyFindings = ref<Set<string>>(new Set())

const open = computed(() =>
  report.value ? openFindings(report.value).filter((item) => item.criterion !== 'spelling') : [],
)
const closed = computed(() => [
  ...new Map(
    [
      ...(report.value ? closedFindings(report.value) : []),
      ...(spellingReport.value
        ? closedFindings(spellingReport.value).filter((item) => item.criterion === 'spelling')
        : []),
    ].map((item) => [item.id, item]),
  ).values(),
])
const groups = computed(() => groupFindingsByCriterion(open.value))
const counts = computed(() => criterionCounts(report.value).filter((item) => item.criterion !== 'spelling'))
const usage = computed(() =>
  access.value?.mode === 'pro' && access.value.usage
    ? usageLine(access.value.usage, ['review', 'structure'])
    : null,
)
const reviewShortcut = platformKeys('⇧⌥⌘R', isMac())

// Texto alterado desde a revisão: lido do editor só depois de 1 s sem salvar, nunca a cada tecla.
let staleTimer: ReturnType<typeof setTimeout> | null = null
let staleCheck = 0

async function checkStale(): Promise<void> {
  const current = report.value
  const check = (staleCheck += 1)
  if (!current) {
    stale.value = false
    return
  }
  const fingerprint = await manuscriptFingerprint(currentManuscript(mesa))
  if (check !== staleCheck) return
  stale.value = isReportStaleForFingerprint(current, fingerprint, mesa.mainReference || null)
}

let staleCheckPending = false

function scheduleStaleCheck(): void {
  if (staleTimer) clearTimeout(staleTimer)
  // Com a aba escondida (mantida em cache), confere só quando ela voltar a aparecer.
  if (mesa.contextTab !== 'review') {
    staleCheckPending = true
    return
  }
  staleTimer = setTimeout(() => void checkStale(), 1000)
}

watch(() => mesa.record, scheduleStaleCheck)
watch([report, () => mesa.mainReference], () => void checkStale(), { immediate: true })
watch(
  () => mesa.contextTab === 'review',
  (visible) => {
    if (visible && staleCheckPending) {
      staleCheckPending = false
      void checkStale()
    }
  },
)
onBeforeUnmount(() => {
  if (staleTimer) clearTimeout(staleTimer)
})

function goTo(quote: string): void {
  if (!selectQuote(quote))
    toasts.show('Este trecho não foi encontrado no manuscrito; o texto pode ter mudado.', 'info')
}

async function changeStatus(
  target: SermonReviewReport,
  finding: SermonReviewFinding,
  status: SermonReviewFindingStatus,
): Promise<void> {
  target = mesa.reviews.find((item) => item.id === target.id) ?? target
  const previous = mesa.reviews
  if (mesa.selectedDateKey === target.dateKey)
    mesa.reviews = replaceReport(previous, setFindingStatus(target, finding.id, status))
  busyFindings.value = new Set([...busyFindings.value, finding.id])
  try {
    const updated = await invoke('reviews:setFindingStatus', {
      dateKey: target.dateKey,
      reportId: target.id,
      findingId: finding.id,
      status,
    })
    if (mesa.selectedDateKey === target.dateKey) mesa.reviews = updated
  } catch (error) {
    if (mesa.selectedDateKey === target.dateKey) mesa.reviews = previous
    toasts.show(errorMessage(error), 'error')
  } finally {
    const next = new Set(busyFindings.value)
    next.delete(finding.id)
    busyFindings.value = next
  }
}
</script>

<template>
  <div class="review">
    <h2 class="serif review__title">Revisões do manuscrito</h2>

    <template v-if="report">
      <p class="review__meta">
        {{ providerName(report.provider) }} · {{ shortDateTime(report.createdAt) }}
        <span v-if="stale" class="review__stale">· texto alterado desde então</span>
      </p>
      <p v-if="report.validationNotice" class="review__notice">
        <ShieldCheck :size="12" aria-hidden="true" /> {{ report.validationNotice }}
      </p>
    </template>
    <p v-else class="review__muted">Ainda não há observações para esta versão.</p>

    <section class="proofreading" aria-label="Ortografia e gramática">
      <h3 class="findings__heading">
        ORTOGRAFIA E GRAMÁTICA <span class="findings__count">{{ spelling.length }}</span>
      </h3>
      <p class="review__muted review__small">
        Correções locais. Os trechos encontrados ficam sublinhados no manuscrito; passe o mouse para ver a
        correção ou clique para abrir o apontamento.
      </p>
      <p v-if="spellingReport" class="review__meta">{{ shortDateTime(spellingReport.createdAt) }}</p>
      <div class="review__actions">
        <PButton compact @click="mesa.requestReview(['spelling'])">Revisar ortografia e gramática</PButton>
        <PButton v-if="spelling.length" compact :disabled="applying" @click="applySpelling(spelling)"
          >Aplicar todas ({{ spelling.length }})</PButton
        >
      </div>
      <p v-if="spellingReport && !spelling.length" class="review__muted review__small">
        Nenhuma correção pendente nesta revisão.
      </p>
      <FindingItem
        v-for="finding in spelling"
        :key="finding.id"
        :finding="finding"
        :show-criterion="false"
        show-status-actions
        can-apply
        :busy="applying || busyFindings.has(finding.id)"
        @select="goTo"
        @apply="applySpelling([finding])"
        @status="changeStatus(spellingReport!, finding, $event)"
      />
    </section>

    <StructureMap
      v-if="report?.structure"
      :structure="report.structure"
      :stale="stale"
      compact
      @select="goTo"
    />
    <section v-else class="placeholder" aria-label="Mapa do sermão">
      <p class="placeholder__title">
        <ListTree :size="13" aria-hidden="true" /> <span class="serif">Mapa do sermão</span>
      </p>
      <p class="placeholder__text">
        As revisões de conteúdo mostram onde começam introdução, desenvolvimento e conclusão, qual é a ideia
        dominante, os movimentos do texto e onde a Boa Nova aparece. “Checar estrutura” faz só essa leitura.
      </p>
    </section>

    <ul class="criteria" role="list" aria-label="Apontamentos abertos por critério">
      <li v-for="row in counts" :key="row.criterion" class="criteria__row" :title="row.guidance">
        <span>{{ row.title }}</span>
        <span class="criteria__count" :class="{ 'criteria__count--active': row.count > 0 }">{{
          row.count
        }}</span>
      </li>
    </ul>

    <template v-if="report">
      <p v-if="report.findings.length === 0" class="review__muted">
        Nenhuma observação fundamentada nos critérios escolhidos.
      </p>
      <template v-else>
        <p v-if="open.length === 0" class="review__muted review__row">
          <CircleCheck :size="13" aria-hidden="true" /> Todos os apontamentos de conteúdo foram resolvidos ou
          descartados.
        </p>
        <section
          v-for="group in groups"
          :key="group.criterion"
          class="findings"
          :aria-label="`${group.title}: ${group.findings.length} apontamento(s)`"
        >
          <h3 class="findings__heading">
            <span>{{ group.title.toUpperCase() }}</span>
            <span class="findings__count">{{ group.findings.length }}</span>
            <span class="findings__rule" aria-hidden="true" />
          </h3>
          <FindingItem
            v-for="finding in group.findings"
            :key="finding.id"
            :finding="finding"
            :show-criterion="false"
            show-status-actions
            :busy="busyFindings.has(finding.id)"
            @select="goTo"
            @status="changeStatus(report, finding, $event)"
          />
        </section>

        <section v-if="closed.length > 0" class="closed">
          <button
            type="button"
            class="closed__toggle"
            :aria-expanded="showClosed"
            @click="showClosed = !showClosed"
          >
            <ChevronDown v-if="showClosed" :size="12" aria-hidden="true" />
            <ChevronRight v-else :size="12" aria-hidden="true" />
            {{ closedSummary(closed) }}
          </button>
          <ul v-if="showClosed" class="closed__list" role="list">
            <li v-for="finding in closed" :key="finding.id" class="closed__item">
              <span
                :class="finding.status === 'resolved' ? 'tone--accent' : 'tone--muted'"
                :aria-label="finding.status === 'resolved' ? 'Resolvido' : 'Descartado'"
              >
                <Check v-if="finding.status === 'resolved'" :size="12" />
                <CircleX v-else :size="12" />
              </span>
              <div class="closed__body">
                <p class="closed__text">{{ finding.observation }}</p>
                <PButton
                  variant="link"
                  compact
                  :disabled="busyFindings.has(finding.id)"
                  @click="
                    changeStatus(
                      mesa.reviews.find((item) => item.findings.some((entry) => entry.id === finding.id)) ??
                        report,
                      finding,
                      'open',
                    )
                  "
                  >Reabrir</PButton
                >
              </div>
            </li>
          </ul>
        </section>
      </template>
    </template>

    <div class="review__actions">
      <PButton
        variant="primary"
        compact
        :title="`Revisão completa com os critérios que você escolher (${reviewShortcut})`"
        @click="mesa.requestReview()"
      >
        <Check :size="13" /> Nova revisão
      </PButton>
      <PButton
        compact
        title="Revisão rápida só de estrutura: partes, ideia dominante, movimentos e Boa Nova"
        @click="mesa.requestReview(['structure'])"
      >
        <ListTree :size="13" /> Checar estrutura
      </PButton>
    </div>
    <PButton
      variant="link"
      compact
      class="review__link"
      title="Perguntas sobre o que já está escrito; nunca são pedidas automaticamente"
      @click="mesa.openSheet('questions')"
    >
      <CircleQuestionMark :size="13" /> Perguntas de emergência
    </PButton>
    <p v-if="usage" class="review__usage">{{ usage }}</p>
    <p class="review__muted review__small">
      As revisões de conteúdo apontam e fundamentam. Correções de língua são aplicadas apenas pelo seu
      comando.
    </p>
  </div>
</template>

<style scoped>
.proofreading {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.proofreading :deep(.finding:target) {
  background: var(--surface);
}

.review {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.review__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.review__meta {
  margin: -4px 0 0;
  font-size: 10px;
  color: var(--muted);
}
.review__stale {
  color: var(--warning);
}
.review__notice {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 0;
  font-size: 10px;
  color: var(--muted);
}
.review__notice svg {
  flex: none;
  margin-top: 1px;
}
.review__muted {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.review__small {
  font-size: 11px;
}
.review__row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.placeholder {
  padding: var(--space-md);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.placeholder__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.placeholder__title svg {
  color: var(--accent);
}
.placeholder__text {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.criteria {
  margin: 0;
  padding: 0;
  list-style: none;
}
.criteria__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
.criteria__count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.criteria__count--active {
  color: var(--accent);
  font-weight: 600;
}
.findings {
  display: flex;
  flex-direction: column;
}
.findings__heading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 4px 0 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--accent);
}
.findings__count {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.findings__rule {
  flex: 1;
  height: 1px;
  background: var(--line);
}
.closed__toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: none;
  background: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
.closed__toggle:hover {
  color: var(--ink);
}
.closed__list {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.closed__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}
.closed__item > span {
  padding-top: 2px;
}
.closed__body {
  flex: 1;
  min-width: 0;
}
.closed__text {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.closed__body :deep(.p-button) {
  margin-left: -6px;
}
.tone--accent {
  color: var(--accent);
}
.tone--muted {
  color: var(--muted);
}
.review__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding-top: var(--space-xs);
}
.review__link {
  align-self: flex-start;
  margin: -6px 0 0 -6px;
}
.review__usage {
  margin: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
