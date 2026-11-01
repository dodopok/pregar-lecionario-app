<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useToasts } from '@/stores/toasts'

const toasts = useToasts()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts.items" :key="toast.id" class="toast" :class="`toast--${toast.kind}`" role="status">
        <span class="toast__message">{{ toast.message }}</span>
        <button v-if="toast.action" class="toast__action" type="button" @click="toast.action.run(); toasts.dismiss(toast.id)">
          {{ toast.action.label }}
        </button>
        <button class="toast__close" type="button" aria-label="Fechar aviso" @click="toasts.dismiss(toast.id)"><X :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  font-size: 12px;
}
.toast--error {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}
.toast--success {
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
}
.toast__message {
  flex: 1;
}
.toast__action {
  border: none;
  background: none;
  color: var(--accent);
  font-weight: 600;
}
.toast__close {
  border: none;
  background: none;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
