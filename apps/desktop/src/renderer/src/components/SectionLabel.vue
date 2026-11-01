<script setup lang="ts">
defineProps<{ title: string; tag?: string }>()
</script>

<template>
  <component :is="tag ?? 'h3'" class="section-label">{{ title }}</component>
</template>

<style scoped>
.section-label {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
</style>
