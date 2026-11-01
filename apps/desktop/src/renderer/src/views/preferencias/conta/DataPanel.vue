<script setup lang="ts">
/** LGPD: baixar uma cópia dos dados da conta e apagar a conta (digitando APAGAR). */
import { ref } from 'vue'
import { Download, Trash2, UserX } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import ConfirmSheet from '../ui/ConfirmSheet.vue'

const app = useAppStore()
const toasts = useToasts()
const exporting = ref(false)
const confirming = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

async function exportData(): Promise<void> {
  exporting.value = true
  try {
    const result = await invoke('account:export')
    if (result) {
      toasts.show(`Dados da conta salvos em ${result.path}.`, 'success', {
        timeout: 8000,
        action: { label: 'Mostrar', run: () => void invoke('app:showItemInFolder', { path: result.path }) },
      })
    }
  } catch (caught) {
    toasts.show(errorMessage(caught), 'error')
  } finally {
    exporting.value = false
  }
}

async function deleteAccount(): Promise<void> {
  deleting.value = true
  deleteError.value = null
  try {
    app.account = await invoke('account:delete', { confirm: 'APAGAR' })
    confirming.value = false
    toasts.show('Sua conta foi apagada. Os sermões e a biblioteca continuam neste computador.', 'info', { timeout: 8000 })
  } catch (caught) {
    deleteError.value = errorMessage(caught)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="data">
    <div class="data__row">
      <div class="data__text">
        <span class="data__title">Baixar meus dados</span>
        <span class="data__detail">Uma cópia em JSON do que o servidor guarda: conta, sessões, assinatura, pagamentos e uso. Seus sermões não estão lá.</span>
      </div>
      <PButton :busy="exporting" @click="exportData"><Download :size="14" aria-hidden="true" />Baixar…</PButton>
    </div>
    <div class="data__row">
      <div class="data__text">
        <span class="data__title">Apagar conta</span>
        <span class="data__detail">Cancela a assinatura e apaga a conta do servidor. Não dá para desfazer.</span>
      </div>
      <PButton variant="ghost" class="data__danger" @click="confirming = true"><Trash2 :size="14" aria-hidden="true" />Apagar conta…</PButton>
    </div>

    <ConfirmSheet
      v-if="confirming"
      title="Apagar a conta?"
      message="A assinatura é cancelada e o email, as sessões e o histórico de pagamentos são apagados do servidor do Pregar. Seus sermões, a biblioteca e as preferências continuam neste computador."
      confirm-label="Apagar conta"
      require-text="APAGAR"
      :icon="UserX"
      :busy="deleting"
      :error="deleteError"
      @confirm="deleteAccount"
      @cancel="confirming = false"
    />
  </div>
</template>

<style scoped>
.data__row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 58px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.data__row:last-of-type {
  border-bottom: none;
}
.data__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.data__title {
  font-size: 13px;
  font-weight: 500;
}
.data__detail {
  font-size: 12px;
  color: var(--muted);
}
.data__danger {
  color: var(--danger);
}
</style>
