<script setup lang="ts">
/** Linha rótulo + controle (PreferenceRow do Swift). `for` liga o rótulo ao campo. */
defineProps<{ label: string; for?: string; hint?: string; top?: boolean }>()
</script>

<template>
  <div class="pref-row" :class="{ 'pref-row--top': top }">
    <component :is="$props.for ? 'label' : 'span'" class="pref-row__label" :for="$props.for">{{ label }}</component>
    <div class="pref-row__control">
      <slot />
      <p v-if="hint" class="pref-row__hint">{{ hint }}</p>
    </div>
  </div>
</template>

<style scoped>
.pref-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 50px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.pref-row:last-child {
  border-bottom: none;
}
.pref-row--top {
  align-items: flex-start;
}
.pref-row--top .pref-row__label {
  padding-top: 6px;
}
.pref-row__label {
  flex: none;
  width: 150px;
  font-size: 13px;
  color: var(--muted);
}
.pref-row__control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.pref-row__hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .pref-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .pref-row__label {
    width: auto;
  }
}
</style>
