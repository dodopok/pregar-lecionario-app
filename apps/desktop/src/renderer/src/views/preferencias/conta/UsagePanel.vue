<script setup lang="ts">
/** Medidores de uso da assinatura no período, com avisos de limite diário e teto de custo. */
import { computed } from 'vue'
import { AI_OPERATION_LABELS } from '@pregar/core/plans/contract'
import type { UsageSummary } from '@pregar/core/plans/contract'
import Notice from '../ui/Notice.vue'
import { formatDate, usageNotices, usageRows } from '../format'

const props = defineProps<{ usage: UsageSummary }>()

const rows = computed(() => usageRows(props.usage, AI_OPERATION_LABELS))
const notices = computed(() => usageNotices(props.usage))
</script>

<template>
  <div class="usage">
    <div class="usage__head">
      <p class="usage__period">
        Período de {{ formatDate(usage.periodStart) }} a {{ formatDate(usage.periodEnd) }}. Os contadores voltam a zero em
        <strong>{{ formatDate(usage.periodEnd) }}</strong>.
      </p>
    </div>
    <ul class="usage__list">
      <li v-for="row in rows" :key="row.kind" class="usage__row" :class="`usage__row--${row.state}`">
        <div class="usage__labels">
          <span class="usage__label">{{ row.label }}</span>
          <span class="usage__count"><strong>{{ row.used }}</strong> de {{ row.limit }}</span>
        </div>
        <div
          class="usage__bar"
          role="meter"
          :aria-label="row.label"
          :aria-valuenow="row.used"
          aria-valuemin="0"
          :aria-valuemax="row.limit"
          :aria-valuetext="`${row.used} de ${row.limit} usados`"
        >
          <span class="usage__fill" :style="{ width: `${Math.round(row.ratio * 100)}%` }" />
        </div>
      </li>
    </ul>
    <p class="usage__today">Hoje: {{ usage.todayCalls }} de {{ usage.limits.dailyAICalls }} chamadas de IA. Uma revisão por vez.</p>
    <Notice v-for="notice in notices" :key="notice" tone="warning" compact>{{ notice }}</Notice>
  </div>
</template>

<style scoped>
.usage {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 0;
}
.usage__period {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.usage__period strong {
  color: var(--ink);
  font-weight: 600;
}
.usage__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 24px;
}
.usage__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.usage__labels {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.usage__count {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.usage__count strong {
  color: var(--ink);
}
.usage__bar {
  height: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ink) 9%, transparent);
  overflow: hidden;
}
.usage__fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.3s var(--ease);
}
.usage__row--near .usage__fill {
  background: var(--warning);
}
.usage__row--full .usage__fill {
  background: var(--danger);
}
.usage__row--full .usage__count strong {
  color: var(--danger);
}
.usage__today {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .usage__list {
    grid-template-columns: 1fr;
  }
}
</style>
