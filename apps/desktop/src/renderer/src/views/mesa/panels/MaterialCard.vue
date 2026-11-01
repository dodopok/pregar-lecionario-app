<script setup lang="ts">
/**
 * Cartão único de material (seção de PDF, artigo, fonte para consultar ou resultado da pesquisa).
 * Clique abre no Leitor; botão do meio, ⌘clique (Ctrl+clique fora do Mac) abrem nova aba ao
 * fundo, e ⇧ seleciona a nova aba.
 */
import { ArrowUpRight, Check, FileText, Globe } from 'lucide-vue-next'
import { isMac } from '@/lib/api'
import { openModeFromEvent } from './materials'
import type { OpenMode } from './materials'

const props = withDefaults(
  defineProps<{
    icon: 'pdf' | 'web'
    title: string
    lines?: string[]
    note?: string
    matchLabel?: string
    matchTone?: 'accent' | 'warning' | 'muted'
    actionLabel?: string
    isOpen?: boolean
    busy?: boolean
    inReview?: boolean
    compactTitle?: boolean
  }>(),
  {
    lines: () => [],
    note: undefined,
    matchLabel: undefined,
    matchTone: 'accent',
    actionLabel: 'Abrir',
    isOpen: false,
    busy: false,
    inReview: false,
    compactTitle: false,
  },
)
const emit = defineEmits<{ open: [mode: OpenMode] }>()

const newTabHint = isMac() ? 'botão do meio ou ⌘clique' : 'botão do meio ou Ctrl+clique'

function onClick(event: MouseEvent): void {
  if (props.busy) return
  emit('open', openModeFromEvent(event, isMac()))
}

function onAuxClick(event: MouseEvent): void {
  if (event.button !== 1) return
  event.preventDefault()
  emit('open', { background: true, select: event.shiftKey })
}
</script>

<template>
  <article class="material" :aria-label="title" @auxclick="onAuxClick" @mousedown.middle.prevent>
    <div class="material__head">
      <span class="material__icon" aria-hidden="true">
        <FileText v-if="icon === 'pdf'" :size="13" />
        <Globe v-else :size="13" />
      </span>
      <div class="material__text">
        <p class="serif material__title" :class="{ 'material__title--compact': compactTitle }">{{ title }}</p>
        <p v-for="(line, index) in lines" :key="index" class="material__line" :class="{ 'material__line--first': index === 0 }">{{ line }}</p>
        <p v-if="matchLabel" class="material__match" :class="`material__match--${matchTone}`">{{ matchLabel }}</p>
        <p v-if="note" class="material__line">{{ note }}</p>
      </div>
    </div>
    <div class="material__actions">
      <button
        type="button"
        class="material__open"
        :class="{ 'material__open--open': isOpen }"
        :disabled="busy"
        :aria-busy="busy || undefined"
        :title="isOpen ? 'Este material já está aberto no Leitor' : `Abrir no Leitor · ${newTabHint} abre nova aba em segundo plano`"
        @click="onClick"
      >
        <Check v-if="isOpen" :size="12" aria-hidden="true" />
        <ArrowUpRight v-else :size="12" aria-hidden="true" />
        {{ actionLabel }}
      </button>
      <span v-if="inReview" class="material__review" title="Marcado no Leitor para entrar na revisão">na revisão</span>
    </div>
  </article>
</template>

<style scoped>
.material {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-button);
  background: color-mix(in srgb, var(--manuscript) 68%, transparent);
}
.material__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.material__icon {
  flex: none;
  width: 15px;
  padding-top: 3px;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.material__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.material__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.material__title--compact {
  font-size: 13px;
}
.material__line {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.material__line--first {
  font-size: 11px;
}
.material__match {
  margin: 0;
  font-size: 10px;
  font-weight: 500;
}
.material__match--accent {
  color: var(--accent);
}
.material__match--warning,
.material__match--muted {
  color: var(--warning);
}
.material__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 23px;
}
.material__open {
  height: var(--control-compact);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.material__open:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
.material__open:disabled {
  opacity: 0.6;
}
.material__open--open {
  border-color: transparent;
  color: var(--accent);
  background: var(--accent-soft);
}
.material__open--open:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}
.material__review {
  font-size: 10px;
  color: var(--muted);
}
</style>
