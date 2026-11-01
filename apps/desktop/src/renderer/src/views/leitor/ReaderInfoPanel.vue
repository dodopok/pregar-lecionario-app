<script setup lang="ts">
import { computed } from 'vue'
import { Bookmark, Pencil } from 'lucide-vue-next'
import { confidenceLabel, findingMethodLabel, urlHost, type PdfSectionLocation } from '@pregar/core/reader'
import type { ReaderTabView } from '@shared/ipc-reader'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Toggle from '@/components/Toggle.vue'
import { confidenceTone, sectionPageRange } from './reader-ui'

const props = defineProps<{
  tab: ReaderTabView
  activeSection: PdfSectionLocation | null
  currentURL: string | null
  documentReady: boolean
  printed: (page: number) => string | null
}>()

const emit = defineEmits<{
  correctPage: []
  rememberLink: []
  review: [included: boolean]
}>()

const address = computed(() => props.currentURL ?? props.tab.location)
const tone = computed(() => (props.activeSection ? confidenceTone(props.activeSection) : 'unknown'))
const reviewHint = computed(() => {
  const section = props.activeSection
  if (section) return `Trecho da seção (física ${section.startPage}) até antes da próxima seção (física ${section.endPage + 1}).`
  return props.tab.kind === 'pdf' ? 'Selecione uma seção para delimitar o material.' : 'A página atual será usada como referência da fonte.'
})
</script>

<template>
  <aside class="info" aria-label="Informações do material">
    <div class="info__heading">
      <SectionLabel title="Onde está" tag="h2" />
      <span class="info__rule" aria-hidden="true" />
    </div>
    <template v-if="tab.kind === 'pdf'">
      <dl v-if="activeSection" class="info__rows">
        <div class="info__row">
          <dt>Páginas</dt>
          <dd class="selectable">{{ sectionPageRange(activeSection, printed) }}</dd>
        </div>
        <div class="info__row">
          <dt>Achado por</dt>
          <dd>{{ findingMethodLabel(activeSection) }}</dd>
        </div>
        <div class="info__row">
          <dt>Confiança</dt>
          <dd>
            <span class="badge" :class="`badge--${tone}`">{{ confidenceLabel(activeSection) }}</span>
          </dd>
        </div>
      </dl>
      <p v-else class="info__note">Nenhuma seção foi detectada neste ponto do PDF.</p>
      <div class="info__actions">
        <PButton :disabled="!documentReady" @click="emit('correctPage')"><Pencil :size="13" aria-hidden="true" /> Corrigir página inicial</PButton>
        <PButton @click="emit('rememberLink')"><Bookmark :size="13" aria-hidden="true" /> Lembrar este vínculo</PButton>
      </div>
    </template>
    <template v-else>
      <dl class="info__rows">
        <div class="info__row">
          <dt>Endereço</dt>
          <dd class="selectable info__url">{{ address }}</dd>
        </div>
        <div class="info__row">
          <dt>Site</dt>
          <dd class="selectable">{{ urlHost(address) ?? '' }}</dd>
        </div>
        <div v-if="tab.reference" class="info__row">
          <dt>Passagem</dt>
          <dd class="serif">{{ tab.reference }}</dd>
        </div>
      </dl>
      <div class="info__actions">
        <PButton @click="emit('rememberLink')"><Bookmark :size="13" aria-hidden="true" /> Lembrar este vínculo</PButton>
      </div>
    </template>

    <div class="info__heading info__heading--spaced">
      <SectionLabel title="Para a revisão" tag="h2" />
      <span class="info__rule" aria-hidden="true" />
    </div>
    <p class="info__note">{{ reviewHint }}</p>
    <Toggle :model-value="tab.includedInReview" label="Incluído" @update:model-value="emit('review', $event)" />
  </aside>
</template>

<style scoped>
.info {
  flex: none;
  width: 300px;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg);
  background: var(--paper);
  border-left: 1px solid var(--line);
}
.info__heading {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.info__heading--spaced {
  margin-top: var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px solid var(--line);
}
.info__rule {
  flex: 1;
  height: 1px;
  background: var(--line);
}
.info__rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info__row {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: var(--space-md);
  font-size: 12px;
}
.info__row dt {
  color: var(--muted);
}
.info__row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.info__url {
  font-size: 11px;
}
.info__note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.info__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.badge--high {
  color: var(--accent);
  background: var(--accent-soft);
}
.badge--medium {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}
.badge--low {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 13%, transparent);
}
.badge--unknown {
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
</style>
