<script setup lang="ts">
/**
 * Menu flutuante ancorado a um botão: abre ao clicar, fecha com Esc, clique fora ou ao escolher
 * um item. O conteúdo vem no slot `menu`; o gatilho, no slot padrão (recebe `open` e `toggle`).
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ align?: 'left' | 'right'; label: string; width?: number }>(), {
  align: 'left',
  width: undefined,
})
const emit = defineEmits<{ open: []; close: [] }>()
const open = ref(false)
const opensAbove = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

function close(): void {
  if (!open.value) return
  open.value = false
  emit('close')
}

function toggle(): void {
  if (open.value) {
    close()
    return
  }
  open.value = true
  emit('open')
  void nextTick(() => {
    updatePlacement()
    panel.value?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus()
  })
}

function updatePlacement(): void {
  const anchor = root.value?.getBoundingClientRect()
  const menu = panel.value
  if (!anchor || !menu) return
  const gap = 6
  const roomBelow = window.innerHeight - anchor.bottom - gap
  const roomAbove = anchor.top - gap
  opensAbove.value = menu.offsetHeight > roomBelow && roomAbove > roomBelow
}

function onDocumentPointer(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
    root.value?.querySelector<HTMLElement>('button')?.focus()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [...(panel.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])]
  if (items.length === 0) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next =
    event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
  items[next]?.focus()
}

function onMenuClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]')
  if (target && !target.hasAttribute('data-keep-open')) close()
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onDocumentPointer, true)
    window.addEventListener('resize', updatePlacement)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointer, true)
    window.removeEventListener('resize', updatePlacement)
    opensAbove.value = false
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  window.removeEventListener('resize', updatePlacement)
})

defineExpose({ close, toggle })
</script>

<template>
  <div ref="root" class="pop" @keydown="onKeydown">
    <slot :open="open" :toggle="toggle" />
    <div
      v-if="open"
      ref="panel"
      class="menu pop__panel"
      :class="[`pop__panel--${props.align}`, { 'pop__panel--above': opensAbove }]"
      role="menu"
      :aria-label="label"
      :style="props.width ? { width: `${props.width}px` } : undefined"
      @click="onMenuClick"
    >
      <slot name="menu" :close="close" />
    </div>
  </div>
</template>

<style scoped>
.pop {
  position: relative;
  display: inline-flex;
}
.pop__panel {
  position: absolute;
  top: calc(100% + 6px);
  z-index: 40;
  max-height: min(480px, calc(100vh - 120px));
  overflow: auto;
  animation: pop-rise 0.14s var(--ease);
}
.pop__panel--left {
  left: 0;
}
.pop__panel--right {
  right: 0;
}
.pop__panel--above {
  top: auto;
  bottom: calc(100% + 6px);
}
@keyframes pop-rise {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
</style>
