<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'

import type { WorkMenuItem } from './library-helpers'

/** Menu de ações de uma obra: abre por um botão (ou por clique direito, via `openAt`). */

defineProps<{ items: WorkMenuItem[]; label: string }>()
const emit = defineEmits<{ select: [id: string] }>()

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const position = ref<{ x: number; y: number } | null>(null)

function menuItems(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
}

async function show(at: { x: number; y: number } | null = null): Promise<void> {
  position.value = at
  open.value = true
  await nextTick()
  if (at && menu.value) {
    // Mantém o menu dentro da janela.
    const rect = menu.value.getBoundingClientRect()
    position.value = {
      x: Math.min(at.x, window.innerWidth - rect.width - 8),
      y: Math.min(at.y, window.innerHeight - rect.height - 8),
    }
  }
  menuItems()[0]?.focus()
  document.addEventListener('pointerdown', onOutside, true)
}

function close(returnFocus = true): void {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  if (returnFocus) trigger.value?.focus()
}

function onOutside(event: PointerEvent): void {
  const target = event.target as Node
  if (menu.value?.contains(target) || trigger.value?.contains(target)) return
  close(false)
}

function choose(item: WorkMenuItem): void {
  if (item.disabled) return
  close()
  emit('select', item.id)
}

function onKeydown(event: KeyboardEvent): void {
  const items = menuItems()
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    items[(index + 1) % items.length]?.focus()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    items[(index - 1 + items.length) % items.length]?.focus()
  } else if (event.key === 'Home') {
    event.preventDefault()
    items[0]?.focus()
  } else if (event.key === 'End') {
    event.preventDefault()
    items[items.length - 1]?.focus()
  } else if (event.key === 'Tab') {
    close(false)
  }
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

defineExpose({ openAt: (x: number, y: number) => void show({ x, y }) })
</script>

<template>
  <div class="work-menu">
    <button
      ref="trigger"
      type="button"
      class="work-menu__trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="label"
      :title="label"
      @click="open ? close() : show()"
    >
      <slot />
    </button>
    <div
      v-if="open"
      ref="menu"
      class="work-menu__list"
      :class="{ 'work-menu__list--floating': position }"
      :style="position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined"
      role="menu"
      :aria-label="label"
      @keydown="onKeydown"
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separatorBefore" class="work-menu__separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="work-menu__item"
          :class="{ 'work-menu__item--danger': item.danger }"
          :disabled="item.disabled"
          tabindex="-1"
          @click="choose(item)"
        >
          <component :is="item.icon" v-if="item.icon" :size="14" aria-hidden="true" />
          {{ item.label }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.work-menu {
  position: relative;
}
.work-menu__trigger {
  width: var(--control);
  height: var(--control);
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-button);
  background: var(--surface);
  color: var(--ink);
}
.work-menu__trigger:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
.work-menu__trigger[aria-expanded='true'] {
  background: var(--accent-soft);
  color: var(--accent);
}
.work-menu__list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 50;
  min-width: 230px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-pop);
}
.work-menu__list--floating {
  position: fixed;
  right: auto;
}
.work-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}
.work-menu__item:hover:not(:disabled),
.work-menu__item:focus-visible {
  outline: none;
  background: var(--accent-soft);
}
.work-menu__item:disabled {
  opacity: 0.45;
}
.work-menu__item--danger {
  color: var(--danger);
}
.work-menu__separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--line);
}
</style>
