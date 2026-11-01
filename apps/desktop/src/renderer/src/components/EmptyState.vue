<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ title: string; message?: string; icon?: Component }>()
</script>

<template>
  <div class="empty" role="status">
    <component :is="icon" v-if="icon" :size="28" class="empty__icon" aria-hidden="true" />
    <p class="empty__title">{{ title }}</p>
    <p v-if="message" class="empty__message">{{ message }}</p>
    <div v-if="$slots.default" class="empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 32px 20px;
  color: var(--muted);
}
.empty__icon {
  color: var(--muted);
  opacity: 0.7;
  margin-bottom: 4px;
}
.empty__title {
  margin: 0;
  font-weight: 600;
  color: var(--ink);
}
.empty__message {
  margin: 0;
  max-width: 340px;
  font-size: 12px;
}
.empty__actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
</style>
