<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import ToastHost from '@/components/ToastHost.vue'
import { useAppStore } from '@/stores/app'
import { on } from '@/lib/api'

const app = useAppStore()
const router = useRouter()

onMounted(() => {
  on('navigate', ({ route }) => void router.push(route))
})
</script>

<template>
  <RouterView v-if="app.ready" />
  <ToastHost />
</template>
