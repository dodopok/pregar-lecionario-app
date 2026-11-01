<script setup lang="ts">
/** Cartão de preferências (PreferenceGroup do Swift), com rótulo opcional acima. */
import SectionLabel from '@/components/SectionLabel.vue'

defineProps<{ label?: string; flush?: boolean }>()
</script>

<template>
  <section class="pref-group">
    <SectionLabel v-if="label" :title="label" class="pref-group__label" />
    <div class="pref-group__card" :class="{ 'pref-group__card--flush': flush }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.pref-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pref-group__label {
  padding-left: 2px;
}
.pref-group__card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: 4px 16px;
}
.pref-group__card--flush {
  padding: 0;
  overflow: hidden;
}
</style>
