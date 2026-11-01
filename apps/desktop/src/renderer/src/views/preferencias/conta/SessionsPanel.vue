<script setup lang="ts">
/** Computadores conectados à conta, com opção de encerrar os outros. */
import { onMounted, ref } from 'vue'
import { Laptop, Monitor } from 'lucide-vue-next'
import type { SessionView } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useToasts } from '@/stores/toasts'
import { formatDate, formatRelative } from '../format'

const toasts = useToasts()
const sessions = ref<SessionView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const revoking = ref<string | null>(null)

const PLATFORM_LABELS: Record<string, string> = { darwin: 'Mac', win32: 'Windows', linux: 'Linux', web: 'Navegador' }

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    sessions.value = await invoke('account:sessions')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function revoke(session: SessionView): Promise<void> {
  revoking.value = session.id
  try {
    sessions.value = await invoke('account:revokeSession', { id: session.id })
    toasts.show(`Acesso de “${session.deviceName}” encerrado.`, 'success')
  } catch (caught) {
    toasts.show(errorMessage(caught), 'error')
  } finally {
    revoking.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="sessions">
    <div v-if="loading && sessions.length === 0" class="sessions__state"><Spinner :size="14" /> Carregando…</div>
    <div v-else-if="error" class="sessions__state">
      {{ error }}
      <PButton compact @click="load">Tentar de novo</PButton>
    </div>
    <ul v-else class="sessions__list">
      <li v-for="session in sessions" :key="session.id" class="sessions__item">
        <component :is="session.platform === 'darwin' ? Laptop : Monitor" :size="18" class="sessions__icon" aria-hidden="true" />
        <div class="sessions__text">
          <span class="sessions__name">
            {{ session.deviceName }}
            <span v-if="session.current" class="sessions__current">Este computador</span>
          </span>
          <span class="sessions__meta">
            {{ PLATFORM_LABELS[session.platform ?? ''] ?? 'Computador' }} · último uso {{ formatRelative(session.lastUsedAt) }} · conectado em
            {{ formatDate(session.createdAt) }}
          </span>
        </div>
        <PButton v-if="!session.current" compact :busy="revoking === session.id" @click="revoke(session)">Encerrar</PButton>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sessions__state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 0;
  font-size: 12px;
  color: var(--muted);
}
.sessions__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.sessions__item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.sessions__item:last-child {
  border-bottom: none;
}
.sessions__icon {
  flex: none;
  color: var(--muted);
}
.sessions__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sessions__name {
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sessions__current {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.sessions__meta {
  font-size: 11px;
  color: var(--muted);
}
</style>
