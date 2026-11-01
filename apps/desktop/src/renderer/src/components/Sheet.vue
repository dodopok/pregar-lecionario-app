<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/** Folha modal: prende o foco, fecha com Esc e devolve o foco ao elemento anterior. */
const props = withDefaults(defineProps<{ width?: number; label: string; dismissible?: boolean }>(), { width: 640, dismissible: true })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
let previous: Element | null = null

function focusables(): HTMLElement[] {
  if (!panel.value) return []
  return [
    ...panel.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    ),
  ].filter((element) => element.offsetParent !== null)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.dismissible) {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previous = document.activeElement
  await nextTick()
  const autofocus = panel.value?.querySelector<HTMLElement>('[autofocus]')
  ;(autofocus ?? focusables()[0] ?? panel.value)?.focus()
})
onBeforeUnmount(() => {
  if (previous instanceof HTMLElement) previous.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @mousedown.self="dismissible && emit('close')">
      <div
        ref="panel"
        class="sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        :style="{ width: `min(${width}px, calc(100vw - 48px))` }"
        @keydown="onKeydown"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px 24px;
  background: rgb(0 0 0 / 0.28);
  animation: fade 0.14s var(--ease);
}
.sheet {
  max-height: calc(100vh - 72px);
  overflow: auto;
  background: var(--paper);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
  padding: var(--space-xxl);
  outline: none;
  animation: rise 0.18s var(--ease);
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.99);
  }
}
</style>
