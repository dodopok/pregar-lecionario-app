<script setup lang="ts">
/** Hierarquia de ações: primária (acento, uma por contexto), secundária, link e ícone. */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'link' | 'icon' | 'danger' | 'ghost'
    compact?: boolean
    disabled?: boolean
    busy?: boolean
    type?: 'button' | 'submit'
    pressed?: boolean
    label?: string
    title?: string
  }>(),
  { variant: 'secondary', compact: false, disabled: false, busy: false, type: 'button', pressed: undefined, label: undefined, title: undefined },
)
</script>

<template>
  <button
    :type="type"
    class="p-button"
    :class="[`p-button--${variant}`, { 'p-button--compact': compact, 'p-button--pressed': pressed }]"
    :disabled="disabled || busy"
    :aria-pressed="pressed"
    :aria-label="label"
    :aria-busy="busy || undefined"
    :title="title ?? label"
  >
    <span v-if="busy" class="p-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.p-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--control);
  padding: 0 12px;
  border-radius: var(--radius-button);
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  background: none;
  transition:
    background 0.12s var(--ease),
    opacity 0.12s,
    box-shadow 0.12s;
}
.p-button:disabled {
  opacity: 0.45;
}
.p-button--compact {
  height: var(--control-compact);
  padding: 0 10px;
  font-size: 11px;
}
.p-button--primary {
  height: 30px;
  padding: 0 14px;
  font-weight: 600;
  color: var(--accent-contrast);
  background: var(--accent);
}
.p-button--primary.p-button--compact {
  height: var(--control-compact);
}
.p-button--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 90%, transparent);
}
.p-button--primary:active:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 80%, transparent);
}
.p-button--danger {
  font-weight: 600;
  color: #fff;
  background: var(--danger);
}
.p-button--secondary {
  color: var(--ink);
  background: var(--surface);
  border-color: var(--line-strong);
}
.p-button--secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
.p-button--secondary:active:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 8%, var(--surface));
}
.p-button--link {
  height: 26px;
  padding: 0 6px;
  color: var(--accent);
}
.p-button--link:hover:not(:disabled) {
  background: var(--accent-softer);
}
.p-button--ghost {
  color: var(--ink);
}
.p-button--ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.p-button--icon {
  width: var(--icon-button);
  height: var(--icon-button);
  padding: 0;
  color: var(--ink);
}
.p-button--icon.p-button--compact {
  width: 28px;
  height: 28px;
}
.p-button--icon:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.p-button--icon:active:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 12%, transparent);
}
.p-button--pressed,
.p-button--icon.p-button--pressed {
  color: var(--accent);
  background: var(--accent-soft);
}
.p-button__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
