<script setup lang="ts">
/**
 * Painel de contexto da Mesa (porte de `ResourceContextPanel`): abas Materiais, Ideias e Revisão,
 * com badges de ideias e de apontamentos abertos. Lê tudo das stores; a largura é do pai.
 * Não observa a digitação: o texto do manuscrito só é lido sob demanda.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { PanelRightClose } from 'lucide-vue-next'
import { openFindings } from '@pregar/core/ai'
import PButton from '@/components/PButton.vue'
import { isMac } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'
import IdeasTab from './IdeasTab.vue'
import MaterialsTab from './MaterialsTab.vue'
import ReviewTab from './ReviewTab.vue'
import { driveStatus, ensureDriveStatus, ideaNotes, refreshIdeas } from './driveState'
import { platformKeys } from '../sheets/commands'

type ContextTab = 'materials' | 'ideas' | 'review'

const emit = defineEmits<{ collapse: [] }>()
const mesa = useMesaStore()
const tabButtons = ref<Partial<Record<ContextTab, HTMLButtonElement>>>({})

const TABS: { id: ContextTab; label: string }[] = [
  { id: 'materials', label: 'Materiais' },
  { id: 'ideas', label: 'Ideias' },
  { id: 'review', label: 'Revisão' },
]

const openCount = computed(() => {
  const latest = mesa.reviews.at(-1)
  return latest ? openFindings(latest).length : 0
})
const badges = computed<Record<ContextTab, number>>(() => ({
  materials: 0,
  ideas: ideaNotes.value.length,
  review: openCount.value,
}))
const collapseLabel = `Ocultar painel de materiais (${platformKeys('⇧⌥⌘3', isMac())})`

function badgeLabel(tab: ContextTab): string {
  const count = badges.value[tab]
  if (tab === 'ideas') return `${count} ${count === 1 ? 'ideia' : 'ideias'}`
  return `${count} ${count === 1 ? 'apontamento aberto' : 'apontamentos abertos'}`
}

function select(tab: ContextTab): void {
  mesa.contextTab = tab
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const last = TABS.length - 1
  const next =
    event.key === 'ArrowRight'
      ? index === last
        ? 0
        : index + 1
      : event.key === 'ArrowLeft'
        ? index === 0
          ? last
          : index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (next === null) return
  event.preventDefault()
  const tab = TABS[next]!.id
  select(tab)
  void nextTick(() => tabButtons.value[tab]?.focus())
}

onMounted(async () => {
  // Uma leitura das ideias ao abrir a Mesa, para o badge; nunca cria o documento.
  await ensureDriveStatus()
  if (driveStatus.value?.connected && driveStatus.value.ideasDocumentURL && mesa.contextTab !== 'ideas')
    void refreshIdeas()
})
</script>

<template>
  <aside class="resource" aria-label="Materiais, ideias e revisão">
    <header class="resource__header">
      <div class="resource__tabs" role="tablist" aria-label="Painel de contexto">
        <button
          v-for="(tab, index) in TABS"
          :id="`resource-tab-${tab.id}`"
          :key="tab.id"
          :ref="(element) => (tabButtons[tab.id] = (element as HTMLButtonElement | null) ?? undefined)"
          type="button"
          role="tab"
          class="resource__tab"
          :class="{ 'resource__tab--active': mesa.contextTab === tab.id }"
          :aria-selected="mesa.contextTab === tab.id"
          :aria-controls="`resource-panel-${tab.id}`"
          :tabindex="mesa.contextTab === tab.id ? 0 : -1"
          @click="select(tab.id)"
          @keydown="onKeydown($event, index)"
        >
          {{ tab.label }}
          <span
            v-if="tab.id !== 'materials' && badges[tab.id] > 0"
            class="resource__badge"
            :class="`resource__badge--${tab.id}`"
            :aria-label="badgeLabel(tab.id)"
          >
            {{ badges[tab.id] }}
          </span>
        </button>
      </div>
      <PButton variant="icon" compact :label="collapseLabel" @click="emit('collapse')">
        <PanelRightClose :size="15" />
      </PButton>
    </header>

    <div
      :id="`resource-panel-${mesa.contextTab}`"
      class="scroll resource__body"
      role="tabpanel"
      :aria-labelledby="`resource-tab-${mesa.contextTab}`"
    >
      <KeepAlive>
        <MaterialsTab v-if="mesa.contextTab === 'materials'" />
        <IdeasTab v-else-if="mesa.contextTab === 'ideas'" />
        <ReviewTab v-else />
      </KeepAlive>
    </div>
  </aside>
</template>

<style scoped>
.resource {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.resource__header {
  flex: none;
  height: 45px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--line);
}
.resource__tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-button);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.resource__tab {
  flex: 1;
  min-width: 0;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: none;
  border-radius: 7px;
  background: none;
  font-size: 12px;
  font-weight: 500;
  color: color-mix(in srgb, var(--ink) 75%, transparent);
  white-space: nowrap;
}
.resource__tab:hover:not(.resource__tab--active) {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 5%, transparent);
}
.resource__tab--active {
  font-weight: 600;
  color: var(--ink);
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line);
}
.resource__badge {
  min-width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent-contrast);
  background: var(--accent);
}
.resource__badge--ideas {
  background: var(--warning);
}
.resource__body {
  flex: 1;
  min-height: 0;
  padding: 14px;
}
</style>
