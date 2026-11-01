<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; description?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label class="toggle" :class="{ 'toggle--disabled': disabled }">
    <span class="toggle__text">
      <span class="toggle__label">{{ label }}</span>
      <span v-if="description" class="toggle__description">{{ description }}</span>
    </span>
    <input
      type="checkbox"
      role="switch"
      class="visually-hidden"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="toggle__track" :class="{ 'toggle__track--on': modelValue }" aria-hidden="true"><span class="toggle__thumb" /></span>
  </label>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.toggle--disabled {
  opacity: 0.5;
}
.toggle__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.toggle__label {
  font-weight: 500;
}
.toggle__description {
  font-size: 12px;
  color: var(--muted);
}
.toggle__track {
  flex: none;
  width: 34px;
  height: 20px;
  border-radius: 10px;
  background: var(--line-strong);
  position: relative;
  transition: background 0.15s;
}
.toggle__track--on {
  background: var(--accent);
}
.toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  transition: transform 0.15s var(--ease);
}
.toggle__track--on .toggle__thumb {
  transform: translateX(14px);
}
input:focus-visible + .toggle__track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
