<script setup lang="ts">
/**
 * Quem recebe o pedido de IA: assinatura do Proper (com a cota restante), chave própria
 * (provedor · modelo) ou nenhum acesso, com o caminho para as Preferências.
 */
import { computed } from 'vue'
import { KeyRound, Sparkles } from 'lucide-vue-next'
import type { AIOperationKind } from '@pregar/core/plans/contract'
import type { AIAccess } from '@shared/ipc-ai'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke } from '@/lib/api'
import { remainingLine } from '../panels/review'

const props = defineProps<{ access: AIAccess | null; operation: AIOperationKind }>()

const text = computed(() => {
  const access = props.access
  if (!access) return ''
  if (access.mode === 'pro')
    return access.usage ? `${access.label} · ${remainingLine(access.usage, props.operation)}` : access.label
  if (access.mode === 'byok') return `${access.label} · chave salva neste computador`
  return access.message
})

function openPreferences(): void {
  void invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/ia' })
}
</script>

<template>
  <div class="access" role="status">
    <Spinner v-if="!access" :size="12" label="Verificando o acesso à IA" />
    <Sparkles v-else-if="access.mode === 'pro'" :size="14" class="access__icon" aria-hidden="true" />
    <KeyRound
      v-else
      :size="14"
      class="access__icon"
      :class="{ 'access__icon--missing': access.mode === 'none' }"
      aria-hidden="true"
    />
    <span class="access__text">{{ access ? text : 'Verificando o acesso à IA…' }}</span>
    <PButton v-if="access?.mode === 'none'" compact @click="openPreferences">Abrir Preferências</PButton>
    <PButton
      v-else-if="access"
      variant="link"
      compact
      title="Preferências › Inteligência artificial"
      @click="openPreferences"
      >Configurar</PButton
    >
  </div>
</template>

<style scoped>
.access {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}
.access__icon {
  flex: none;
  color: var(--accent);
}
.access__icon--missing {
  color: var(--warning);
}
.access__text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
