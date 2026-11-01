<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import { getFindState } from '@pregar/editor'

const props = defineProps<{ editor: Editor; replaceMode: boolean; tick: number }>()
const emit = defineEmits<{ close: [] }>()
const query = ref('')
const replacement = ref('')
const matchCase = ref(false)
const input = ref<HTMLInputElement | null>(null)

type Commands = Record<string, (...args: unknown[]) => boolean>
const commands = () => props.editor.commands as unknown as Commands

const state = computed(() => {
  void props.tick
  return getFindState(props.editor.state)
})

watch([query, matchCase], () => commands().setFindQuery!(query.value, { matchCase: matchCase.value }))

onMounted(async () => {
  const { from, to } = props.editor.state.selection
  if (to > from && to - from < 120) query.value = props.editor.state.doc.textBetween(from, to)
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function close(): void {
  commands().clearFind!()
  emit('close')
  props.editor.commands.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) commands().findPrevious!()
    else commands().findNext!()
  }
}
</script>

<template>
  <div class="findbar" role="search" aria-label="Localizar no manuscrito" @keydown="onKeydown">
    <input ref="input" v-model="query" class="field findbar__input" placeholder="Localizar" aria-label="Localizar" />
    <span class="findbar__count" aria-live="polite">{{ state.matches.length === 0 ? (query ? 'nenhum' : '') : `${state.current + 1} de ${state.matches.length}` }}</span>
    <button type="button" class="findbar__btn" aria-label="Ocorrência anterior" title="Anterior (⇧Enter)" @click="commands().findPrevious!()"><ChevronUp :size="14" /></button>
    <button type="button" class="findbar__btn" aria-label="Próxima ocorrência" title="Próxima (Enter)" @click="commands().findNext!()"><ChevronDown :size="14" /></button>
    <label class="findbar__case"><input v-model="matchCase" type="checkbox" /> Aa</label>
    <template v-if="replaceMode">
      <input v-model="replacement" class="field findbar__input" placeholder="Substituir por" aria-label="Substituir por" />
      <button type="button" class="findbar__text" :disabled="state.matches.length === 0" @click="commands().replaceMatch!(replacement)">Substituir</button>
      <button type="button" class="findbar__text" :disabled="state.matches.length === 0" @click="commands().replaceAllMatches!(replacement)">Todas</button>
    </template>
    <button type="button" class="findbar__btn" aria-label="Fechar busca" @click="close"><X :size="14" /></button>
  </div>
</template>

<style scoped>
.findbar {
  position: absolute;
  top: 8px;
  right: 20px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
}
.findbar__input {
  width: 170px;
  height: 26px;
}
.findbar__count {
  min-width: 56px;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.findbar__btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: none;
  display: grid;
  place-items: center;
}
.findbar__btn:hover,
.findbar__text:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.findbar__case {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 3px;
}
.findbar__text {
  height: 26px;
  border: none;
  border-radius: 5px;
  background: none;
  font-size: 12px;
  color: var(--accent);
  padding: 0 6px;
}
.findbar__text:disabled {
  opacity: 0.4;
}
</style>
