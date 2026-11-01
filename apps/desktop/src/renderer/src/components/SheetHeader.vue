<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ title: string; subtitle?: string; icon?: Component }>()
</script>

<template>
  <header class="sheet-header">
    <div v-if="icon" class="sheet-header__icon" aria-hidden="true">
      <component :is="icon" :size="18" />
    </div>
    <div class="sheet-header__text">
      <h2 class="sheet-header__title serif">{{ title }}</h2>
      <p v-if="subtitle" class="sheet-header__subtitle">{{ subtitle }}</p>
    </div>
    <slot />
  </header>
</template>

<style scoped>
.sheet-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}
.sheet-header__icon {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius-card);
}
.sheet-header__text {
  flex: 1;
  min-width: 0;
}
.sheet-header__title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}
.sheet-header__subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
