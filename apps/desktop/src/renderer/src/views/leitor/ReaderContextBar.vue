<script setup lang="ts">
import { ChevronDown, LibraryBig, List, PanelLeft, PanelRight, X } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import type { ReaderNotice } from './reader-ui'

defineProps<{
  contextTitle: string
  reference: string | null
  showSectionsToggle: boolean
  showInfoToggle: boolean
  sectionsVisible: boolean
  infoVisible: boolean
  /** Avisos do Leitor ficam nesta barra: as páginas web nativas cobririam um aviso flutuante. */
  notice: ReaderNotice | null
}>()

const emit = defineEmits<{
  researchMenu: [x: number, y: number]
  allTabsMenu: [x: number, y: number]
  toggleSections: []
  toggleInfo: []
  dismissNotice: []
}>()

/** Menus nativos abrem logo abaixo do botão. */
function below(event: MouseEvent): [number, number] {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return [rect.left, rect.bottom + 2]
}
</script>

<template>
  <div class="reader-contextbar">
    <button
      type="button"
      class="reader-contextbar__research"
      aria-haspopup="menu"
      title="Pesquisas salvas por sermão"
      @click="emit('researchMenu', ...below($event))"
    >
      <LibraryBig :size="14" aria-hidden="true" />
      <span>{{ contextTitle }}</span>
      <ChevronDown :size="12" aria-hidden="true" />
    </button>
    <span v-if="reference" class="reader-contextbar__reference serif">{{ reference }}</span>
    <span class="spacer" />
    <div class="reader-notice-region" role="status" aria-live="polite">
      <div v-if="notice" :key="notice.id" class="reader-notice" :class="`reader-notice--${notice.kind}`">
        <span class="reader-notice__text" :title="notice.message">{{ notice.message }}</span>
        <button v-if="notice.action" type="button" class="reader-notice__action" @click="notice.action.run()">
          {{ notice.action.label }}
        </button>
        <button type="button" class="reader-notice__close" aria-label="Fechar aviso" @click="emit('dismissNotice')">
          <X :size="12" aria-hidden="true" />
        </button>
      </div>
    </div>
    <PButton
      v-if="showSectionsToggle"
      variant="icon"
      compact
      :pressed="sectionsVisible"
      label="Alternar painel de seções"
      :title="sectionsVisible ? 'Ocultar seções do PDF' : 'Mostrar seções do PDF'"
      @click="emit('toggleSections')"
    >
      <PanelLeft :size="15" aria-hidden="true" />
    </PButton>
    <PButton
      v-if="showInfoToggle"
      variant="icon"
      compact
      :pressed="infoVisible"
      label="Alternar informações do material"
      :title="infoVisible ? 'Ocultar informações do material' : 'Mostrar informações e opções de revisão'"
      @click="emit('toggleInfo')"
    >
      <PanelRight :size="15" aria-hidden="true" />
    </PButton>
    <PButton
      variant="icon"
      compact
      label="Todas as abas"
      title="Todas as abas desta pesquisa · reabrir aba fechada"
      aria-haspopup="menu"
      @click="emit('allTabsMenu', ...below($event))"
    >
      <List :size="15" aria-hidden="true" />
    </PButton>
  </div>
</template>

<style scoped>
.reader-contextbar {
  flex: none;
  height: 36px;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-md) 0 var(--space-lg);
  background: var(--canvas);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.reader-contextbar__research {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  margin-left: -8px;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.reader-contextbar__research:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.reader-contextbar__reference {
  min-width: 0;
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reader-notice-region {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
}
.reader-notice {
  min-width: 0;
  max-width: 520px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 4px 0 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  animation: reader-notice-in 0.16s var(--ease);
}
.reader-notice--success {
  background: var(--accent-soft);
}
.reader-notice--error {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.reader-notice__text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.reader-notice__action {
  flex: none;
  border: none;
  background: none;
  padding: 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.reader-notice__close {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--muted);
}
.reader-notice__close:hover {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
@keyframes reader-notice-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
}
</style>
