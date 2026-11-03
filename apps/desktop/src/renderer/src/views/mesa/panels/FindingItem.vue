<script setup lang="ts">
/**
 * Um apontamento da revisão: trecho citado (clique seleciona no manuscrito), observação, grafia
 * correta só na ortografia, evidência literal com a fonte e, no painel, resolver/descartar.
 */
import { Check, ScanText, X } from 'lucide-vue-next'
import { CRITERION_TITLES } from '@pregar/core/ai'
import type { SermonReviewFinding, SermonReviewFindingStatus } from '@pregar/core/ai'
import PButton from '@/components/PButton.vue'
import { FINDING_STATUS_TEXT } from './review'

withDefaults(
  defineProps<{
    finding: SermonReviewFinding
    showCriterion?: boolean
    showStatusActions?: boolean
    busy?: boolean
    canApply?: boolean
  }>(),
  {
    showCriterion: true,
    showStatusActions: false,
    busy: false,
  },
)
const emit = defineEmits<{
  select: [quote: string]
  status: [status: SermonReviewFindingStatus]
  apply: []
}>()

function sourceLine(finding: SermonReviewFinding): string {
  return [finding.evidenceSourceTitle, finding.evidenceCitation].filter(Boolean).join(' · ')
}
</script>

<template>
  <article
    :id="`finding-${finding.id}`"
    class="finding"
    :aria-label="`Apontamento de ${CRITERION_TITLES[finding.criterion]}`"
  >
    <div class="finding__head">
      <span v-if="showCriterion" class="finding__criterion">{{
        CRITERION_TITLES[finding.criterion].toUpperCase()
      }}</span>
      <span v-if="finding.severity === 'attention'" class="finding__severity finding__severity--attention"
        >verificar</span
      >
      <span v-else-if="!showStatusActions" class="finding__severity">nota</span>
      <span class="spacer" />
      <template v-if="showStatusActions">
        <button
          type="button"
          class="finding__status"
          :disabled="busy"
          :title="FINDING_STATUS_TEXT.resolved"
          :aria-label="FINDING_STATUS_TEXT.resolved"
          @click="emit('status', 'resolved')"
        >
          <Check :size="12" />
        </button>
        <button
          type="button"
          class="finding__status"
          :disabled="busy"
          :title="FINDING_STATUS_TEXT.dismissed"
          :aria-label="FINDING_STATUS_TEXT.dismissed"
          @click="emit('status', 'dismissed')"
        >
          <X :size="12" />
        </button>
      </template>
    </div>
    <button
      v-if="finding.manuscriptQuote"
      type="button"
      class="finding__quote"
      title="Selecionar este trecho no manuscrito"
      @click="emit('select', finding.manuscriptQuote)"
    >
      “{{ finding.manuscriptQuote }}”
    </button>
    <p class="finding__observation selectable">{{ finding.observation }}</p>
    <p v-if="finding.correction" class="finding__correction">Correção: {{ finding.correction }}</p>
    <PButton
      v-if="canApply && finding.criterion === 'spelling' && finding.correction"
      compact
      :disabled="busy"
      @click="emit('apply')"
    >
      <Check :size="13" /> Aplicar correção
    </PButton>
    <template v-if="finding.evidenceQuote">
      <p class="finding__evidence selectable">“{{ finding.evidenceQuote }}”</p>
      <p v-if="sourceLine(finding)" class="finding__source">{{ sourceLine(finding) }}</p>
    </template>
    <PButton
      v-if="finding.manuscriptQuote"
      variant="link"
      compact
      class="finding__go"
      title="Selecionar este trecho no manuscrito"
      @click="emit('select', finding.manuscriptQuote)"
    >
      <ScanText :size="13" /> Ir ao trecho
    </PButton>
  </article>
</template>

<style scoped>
.finding {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.finding__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
}
.finding__criterion {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
}
.finding__severity {
  font-size: 10px;
  color: var(--muted);
}
.finding__severity--attention {
  color: var(--warning);
}
.finding__status {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--muted);
}
.finding__status:hover:not(:disabled) {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.finding__quote {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.finding__quote:hover {
  color: var(--accent);
}
.finding__observation {
  margin: 0;
  font-size: 11px;
}
.finding__correction {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
}
.finding__evidence {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.finding__source {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
}
.finding__go {
  align-self: flex-start;
  margin-left: -6px;
}
</style>
