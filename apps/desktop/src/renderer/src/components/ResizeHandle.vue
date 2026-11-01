<script setup lang="ts">
/** Alça vertical entre painéis; arraste ou setas do teclado (±20 px). */
const props = withDefaults(
  defineProps<{ width: number; min: number; max: number; growsToRight?: boolean; label?: string }>(),
  { growsToRight: true, label: 'Divisor de painéis' },
)
const emit = defineEmits<{ 'update:width': [value: number]; commit: [value: number] }>()

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, Math.round(value)))
}

function onPointerDown(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const start = event.clientX
  const initial = props.width
  let last = initial
  const move = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - start
    last = clamp(initial + (props.growsToRight ? delta : -delta))
    emit('update:width', last)
  }
  const up = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    emit('commit', last)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}

function onKeydown(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0
  if (!step) return
  event.preventDefault()
  const next = clamp(props.width + (props.growsToRight ? step : -step))
  emit('update:width', next)
  emit('commit', next)
}
</script>

<template>
  <div
    class="resize-handle"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.resize-handle {
  flex: none;
  width: 9px;
  margin: 0 -4px;
  position: relative;
  z-index: 2;
  cursor: col-resize;
}
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: var(--line);
  transition: background 0.12s;
}
.resize-handle:hover::after,
.resize-handle:focus-visible::after {
  background: var(--accent);
  width: 2px;
  left: 3.5px;
}
</style>
