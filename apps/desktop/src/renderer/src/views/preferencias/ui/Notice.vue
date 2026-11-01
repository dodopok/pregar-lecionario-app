<script setup lang="ts">
/** Mensagem de estado em linha: sucesso, aviso, erro ou informação. Erros são anunciados na hora. */
import { computed } from 'vue'
import { CircleAlert, CircleCheck, Info, TriangleAlert, WifiOff } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ tone?: 'success' | 'warning' | 'error' | 'info' | 'offline'; title?: string; compact?: boolean }>(), {
  tone: 'info',
  title: undefined,
  compact: false,
})

const icon = computed(
  () => ({ success: CircleCheck, warning: TriangleAlert, error: CircleAlert, info: Info, offline: WifiOff })[props.tone],
)
</script>

<template>
  <div class="notice" :class="[`notice--${tone}`, { 'notice--compact': compact }]" :role="tone === 'error' ? 'alert' : 'status'">
    <component :is="icon" :size="compact ? 14 : 16" class="notice__icon" aria-hidden="true" />
    <div class="notice__body">
      <strong v-if="title" class="notice__title">{{ title }}</strong>
      <div class="notice__text"><slot /></div>
    </div>
    <div v-if="$slots.actions" class="notice__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.notice {
  --tone: var(--accent);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--tone) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--tone) 22%, transparent);
  font-size: 12px;
  line-height: 1.45;
}
.notice--compact {
  padding: 8px 10px;
  font-size: 12px;
}
.notice--success {
  --tone: var(--success);
}
.notice--warning,
.notice--offline {
  --tone: var(--warning);
}
.notice--error {
  --tone: var(--danger);
}
.notice__icon {
  flex: none;
  margin-top: 1px;
  color: var(--tone);
}
.notice__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.notice__title {
  font-size: 13px;
  font-weight: 600;
}
.notice__text {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.notice__actions {
  flex: none;
  display: flex;
  gap: 8px;
  align-self: center;
}
</style>
