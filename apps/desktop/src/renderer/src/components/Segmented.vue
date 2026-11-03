<script setup lang="ts" generic="T extends string">
defineProps<{ options: { value: T; label: string; title?: string }[]; modelValue: T; label: string; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div class="segmented" :class="{ 'segmented--compact': compact }" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :title="option.title"
      class="segmented__option"
      :class="{ 'segmented__option--active': option.value === modelValue }"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--radius-button);
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.segmented__option {
  height: 24px;
  padding: 0 10px;
  flex: none;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.segmented--compact .segmented__option {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.segmented__option:hover {
  color: var(--ink);
}
.segmented__option--active {
  color: var(--ink);
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  font-weight: 600;
}
</style>
