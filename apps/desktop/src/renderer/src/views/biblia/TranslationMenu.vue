<script setup lang="ts">
/** Botão "+ NAA" que abre o catálogo completo de traduções para acrescentar à comparação. */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import type { BibleVersion } from '@pregar/core/liturgy/types'
import Spinner from '@/components/Spinner.vue'

const props = defineProps<{
  available: BibleVersion[]
  loading: boolean
  error: string | null
  hasCatalog: boolean
}>()
const emit = defineEmits<{ add: [code: string]; retry: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const query = ref('')

const nextCode = computed(() => props.available[0]?.code.toUpperCase() ?? 'Bíblia')

/** Sem acentos e em minúsculas, para a busca aceitar "biblia" e "Bíblia" igual. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Traduções que batem com o que foi digitado, pela sigla ou pelo nome; sigla exata vem primeiro. */
const filtered = computed(() => {
  const needle = fold(query.value)
  if (!needle) return props.available
  const matches = props.available.filter((version) =>
    [version.code, version.name, version.fullName ?? '', version.description ?? '', version.language ?? '']
      .map(fold)
      .some((text) => text.includes(needle)),
  )
  return matches.sort((a, b) => Number(fold(b.code) === needle) - Number(fold(a.code) === needle))
})

function items(): HTMLElement[] {
  return [...(list.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) {
    query.value = ''
    document.addEventListener('mousedown', onOutside)
    await nextTick()
    ;(field.value ?? items()[0])?.focus()
  } else close(false)
}

/** Enter no campo adiciona a primeira tradução que bate com o texto. */
function submitQuery(): void {
  const first = filtered.value[0]
  if (first) choose(first.code)
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
  // Do campo, a seta desce para a lista; da primeira linha, a seta para cima volta ao campo.
  if (index === -1) {
    all[event.key === 'ArrowDown' ? 0 : all.length - 1]?.focus()
    return
  }
  if (index === 0 && event.key === 'ArrowUp' && field.value) {
    field.value.focus()
    return
  }
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
      :aria-label="
        available[0] ? `Adicionar tradução ${available[0].code.toUpperCase()}` : 'Adicionar tradução'
      "
      title="Adicionar tradução à comparação"
      @click="toggle"
    >
      <Plus :size="12" aria-hidden="true" />{{ nextCode }}
    </button>
    <div v-if="open" ref="list" class="tmenu__popover" role="menu" aria-label="Adicionar tradução">
      <p v-if="loading" class="tmenu__state"><Spinner :size="12" /> Carregando traduções…</p>
      <template v-else-if="hasCatalog">
        <p v-if="available.length === 0" class="tmenu__state">
          Todas as traduções disponíveis já estão abertas.
        </p>
        <template v-else>
          <p class="tmenu__label">Adicionar tradução</p>
          <input
            ref="field"
            v-model="query"
            class="tmenu__field"
            type="text"
            placeholder="Sigla ou nome, ex. NVI"
            aria-label="Sigla ou nome da tradução"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter.prevent="submitQuery"
          />
          <p v-if="filtered.length === 0" class="tmenu__state">Nenhuma tradução do catálogo com esse nome.</p>
          <button
            v-for="version in filtered"
            :key="version.code"
            type="button"
            role="menuitem"
            class="tmenu__item"
            @click="choose(version.code)"
          >
            <span class="tmenu__code">{{ version.name }}</span>
            <span class="tmenu__name"
              >{{ version.fullName ?? version.description ?? ''
              }}<template v-if="version.language"> · {{ version.language }}</template></span
            >
          </button>
        </template>
      </template>
      <template v-else>
        <p class="tmenu__state">{{ error ?? 'Catálogo indisponível' }}</p>
        <button type="button" role="menuitem" class="tmenu__item tmenu__item--action" @click="emit('retry')">
          Tentar novamente
        </button>
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
.tmenu__field {
  width: calc(100% - 8px);
  margin: 0 4px 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--line-strong);
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
}
.tmenu__field:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-color: transparent;
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
