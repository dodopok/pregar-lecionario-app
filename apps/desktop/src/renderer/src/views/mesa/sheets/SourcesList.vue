<script setup lang="ts">
/** Fontes que seguirão com o pedido, cada uma com o tamanho; total comparado ao limite. */
import { BookOpen, FileText, Globe } from 'lucide-vue-next'
import { MAXIMUM_INPUT_BYTES } from '@pregar/core/ai'
import type { ReviewSourceSummary } from '@shared/ipc-ai'
import { formatBytes } from '../panels/review'

defineProps<{ sources: ReviewSourceSummary[]; totalBytes: number }>()
</script>

<template>
  <ul class="sources" role="list" aria-label="Fontes incluídas">
    <li v-for="source in sources" :key="source.id" class="sources__item">
      <span class="sources__icon" aria-hidden="true">
        <BookOpen v-if="source.kind === 'bible'" :size="13" />
        <FileText v-else-if="source.kind === 'pdf'" :size="13" />
        <Globe v-else :size="13" />
      </span>
      <span class="sources__text">
        <span class="sources__title">{{ source.title }}</span>
        <span v-if="source.citation" class="sources__citation">{{ source.citation }}</span>
      </span>
      <span class="sources__size">{{ formatBytes(source.bytes) }}</span>
    </li>
  </ul>
  <p v-if="sources.length > 1" class="sources__total">
    Total: {{ formatBytes(totalBytes) }} de {{ formatBytes(MAXIMUM_INPUT_BYTES) }} permitidos
  </p>
</template>

<style scoped>
.sources {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sources__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11px;
}
.sources__icon {
  flex: none;
  padding-top: 1px;
  color: var(--muted);
}
.sources__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sources__title {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sources__citation {
  font-size: 10px;
  color: var(--muted);
}
.sources__size {
  flex: none;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.sources__total {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--muted);
}
</style>
