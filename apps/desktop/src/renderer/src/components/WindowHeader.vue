<script setup lang="ts">
/** Barra superior arrastável; no macOS deixa espaço para os controles da janela. */
defineProps<{ title?: string; subtitle?: string }>()
</script>

<template>
  <header class="window-header drag-region">
    <div class="window-header__leading"><slot name="leading" /></div>
    <div v-if="title" class="window-header__title">
      <h1 class="serif">{{ title }}</h1>
      <span v-if="subtitle" class="muted">{{ subtitle }}</span>
    </div>
    <div class="window-header__center"><slot /></div>
    <div class="window-header__trailing"><slot name="trailing" /></div>
  </header>
</template>

<style scoped>
.window-header {
  flex: none;
  height: var(--header-height);
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 0 var(--space-lg) 0 calc(var(--space-lg) + var(--window-controls-inset));
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.window-header__title {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  min-width: 0;
}
.window-header__title h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
}
.window-header__title span {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.window-header__center {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}
.window-header__leading,
.window-header__trailing {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
</style>
