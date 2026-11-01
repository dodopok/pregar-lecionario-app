<script setup lang="ts">
/** Botão "+ NAA" que abre o catálogo completo de traduções para acrescentar à comparação. */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import type { BibleVersion } from '@pregar/core/liturgy/types'
import Spinner from '@/components/Spinner.vue'

const props = defineProps<{ available: BibleVersion[]; loading: boolean; error: string | null; hasCatalog: boolean }>()
const emit = defineEmits<{ add: [code: string]; retry: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)

const nextCode = computed(() => props.available[0]?.code.toUpperCase() ?? 'Bíblia')

function items(): HTMLElement[] {
  return [...(list.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) {
    document.addEventListener('mousedown', onOutside)
    await nextTick()
    items()[0]?.focus()
  } else close(false)
}

function close(focusButton = true): void {
  open.value = false
  document.removeEventListener('mousedown', onOutside)
  if (focusButton) button.value?.focus()
}

function onOutside(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close(false)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const all = items()
  const index = all.indexOf(document.activeElement as HTMLElement)
  const next = all[(index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]
  next?.focus()
}

function choose(code: string): void {
  emit('add', code)
  close()
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="root" class="tmenu" @keydown="onKeydown">
    <button
      ref="button"
      type="button"
      class="tmenu__button"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="available[0] ? `Adicionar tradução ${available[0].code.toUpperCase()}` : 'Adicionar tradução'"
      title="Adicionar tradução à comparação"
      @click="toggle"
    >
      <Plus :size="12" aria-hidden="true" />{{ nextCode }}
    </button>
    <div v-if="open" ref="list" class="tmenu__popover" role="menu" aria-label="Adicionar tradução">
      <p v-if="loading" class="tmenu__state"><Spinner :size="12" /> Carregando traduções…</p>
      <template v-else-if="hasCatalog">
        <p v-if="available.length === 0" class="tmenu__state">Todas as traduções disponíveis já estão abertas.</p>
        <template v-else>
          <p class="tmenu__label">Adicionar tradução</p>
          <button v-for="version in available" :key="version.code" type="button" role="menuitem" class="tmenu__item" @click="choose(version.code)">
            <span class="tmenu__code">{{ version.name }}</span>
            <span class="tmenu__name">{{ version.fullName ?? version.description ?? '' }}<template v-if="version.language"> · {{ version.language }}</template></span>
          </button>
        </template>
      </template>
      <template v-else>
        <p class="tmenu__state">{{ error ?? 'Catálogo indisponível' }}</p>
        <button type="button" role="menuitem" class="tmenu__item tmenu__item--action" @click="emit('retry')">Tentar novamente</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tmenu {
  position: relative;
}
.tmenu__button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px dashed color-mix(in srgb, var(--muted) 55%, transparent);
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}
.tmenu__button:hover {
  color: var(--ink);
  border-color: var(--muted);
}
.tmenu__popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: 340px;
  max-height: 380px;
  overflow: auto;
  padding: 6px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow-pop);
}
.tmenu__label {
  margin: 4px 8px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.tmenu__state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px;
  font-size: 12px;
  color: var(--muted);
}
.tmenu__item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: none;
  text-align: left;
}
.tmenu__item:hover,
.tmenu__item:focus-visible {
  background: var(--accent-soft);
  outline: none;
}
.tmenu__item--action {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
}
.tmenu__code {
  font-size: 13px;
  font-weight: 600;
}
.tmenu__name {
  font-size: 11px;
  color: var(--muted);
}
</style>
