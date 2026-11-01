<script setup lang="ts">
import WindowHeader from '@/components/WindowHeader.vue'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
</script>

<template>
  <div class="window">
    <WindowHeader title="Pregar" :subtitle="app.liturgyAccess.message" />
  </div>
</template>
