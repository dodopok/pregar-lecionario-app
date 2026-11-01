<script setup lang="ts">
/**
 * Assinatura em vigor: situação, plano, forma de pagamento, renovação, mensalidade em aberto (Pix
 * mensal) e cancelamento com confirmação.
 */
import { computed, ref, watch } from 'vue'
import { CalendarX } from 'lucide-vue-next'
import type { SubscriptionView } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import ConfirmSheet from '../ui/ConfirmSheet.vue'
import PixChargeCard from './PixChargeCard.vue'
import { usePolling } from '../composables'
import { cycleLabel, formatBRL, formatLongDate, subscriptionStatusLabel } from '../format'

const props = defineProps<{ subscription: SubscriptionView }>()
const emit = defineEmits<{ update: [subscription: SubscriptionView | null]; resubscribe: [] }>()

const app = useAppStore()
const toasts = useToasts()

const confirming = ref(false)
const canceling = ref(false)
const cancelError = ref<string | null>(null)

const sub = computed(() => props.subscription)
const tone = computed(() => {
  if (sub.value.cancelAtPeriodEnd || sub.value.status === 'canceled') return 'muted'
  if (sub.value.status === 'past_due' || sub.value.pendingCharge) return 'warning'
  return sub.value.status === 'active' ? 'success' : 'muted'
})
const statusText = computed(() => (sub.value.cancelAtPeriodEnd && sub.value.status === 'active' ? 'Cancelada' : subscriptionStatusLabel(sub.value.status)))
const methodText = computed(() => (sub.value.method === 'pix_automatico' ? 'Pix Automático (débito autorizado no banco)' : 'Pix mensal (um código por cobrança)'))
const canCancel = computed(() => (sub.value.status === 'active' || sub.value.status === 'past_due') && !sub.value.cancelAtPeriodEnd)
const endDate = computed(() => formatLongDate(sub.value.currentPeriodEnd))
const monthlyCharge = computed(() => (sub.value.status !== 'pending' ? sub.value.pendingCharge : null))

const polling = ref(Boolean(monthlyCharge.value))
watch(monthlyCharge, (charge) => (polling.value = Boolean(charge)))

usePolling(
  async () => {
    const next = await invoke('billing:subscription')
    emit('update', next)
    if (!next?.pendingCharge) {
      toasts.show('Pagamento confirmado. Obrigado!', 'success')
      return true
    }
    return false
  },
  5000,
  polling,
)

async function cancel(): Promise<void> {
  canceling.value = true
  cancelError.value = null
  try {
    const next = await invoke('billing:cancel')
    emit('update', next)
    confirming.value = false
    toasts.show(next?.statusMessage ?? 'Assinatura cancelada.', 'info', { timeout: 6000 })
    app.account = await invoke('account:get', { refresh: true }).catch(() => app.account)
  } catch (caught) {
    cancelError.value = errorMessage(caught)
  } finally {
    canceling.value = false
  }
}
</script>

<template>
  <div class="subscription">
    <div class="subscription__head">
      <div>
        <h3 class="subscription__title">Assinatura do Pregar</h3>
        <p class="subscription__message">{{ sub.statusMessage }}</p>
      </div>
      <span class="status-badge" :class="`status-badge--${tone}`">{{ statusText }}</span>
    </div>

    <dl class="subscription__facts">
      <div>
        <dt>Plano</dt>
        <dd>{{ sub.cycle === 'yearly' ? 'Anual' : 'Mensal' }} · {{ formatBRL(sub.priceCents) }} {{ cycleLabel(sub.cycle) }}</dd>
      </div>
      <div>
        <dt>Pagamento</dt>
        <dd>{{ methodText }}</dd>
      </div>
      <div v-if="sub.currentPeriodEnd">
        <dt>{{ sub.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima renovação' }}</dt>
        <dd>{{ endDate }}</dd>
      </div>
    </dl>

    <div v-if="monthlyCharge" class="subscription__charge">
      <h4 class="subscription__subtitle">Mensalidade em aberto</h4>
      <PixChargeCard :charge="monthlyCharge" :method="sub.method" :first-charge="false" :waiting="polling" />
    </div>

    <div class="subscription__actions">
      <PButton v-if="canCancel" variant="ghost" compact class="subscription__cancel" @click="confirming = true">Cancelar assinatura</PButton>
      <template v-else-if="sub.cancelAtPeriodEnd">
        <span class="subscription__hint">Mudou de ideia? Você pode assinar de novo a qualquer momento.</span>
        <PButton compact @click="emit('resubscribe')">Assinar de novo</PButton>
      </template>
    </div>

    <ConfirmSheet
      v-if="confirming"
      title="Cancelar a assinatura?"
      :message="
        sub.currentPeriodEnd
          ? `Você continua com acesso até ${endDate}. Depois disso, o Pregar volta ao modo gratuito: as leituras e a revisão por IA passam a usar as suas próprias chaves, se você as salvar. Nenhuma nova cobrança será feita.`
          : 'Nenhuma nova cobrança será feita. O Pregar volta ao modo gratuito, com as suas próprias chaves.'
      "
      confirm-label="Cancelar assinatura"
      cancel-label="Manter assinatura"
      :icon="CalendarX"
      :busy="canceling"
      :error="cancelError"
      @confirm="cancel"
      @cancel="confirming = false"
    />
  </div>
</template>

<style scoped>
.subscription {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0 12px;
}
.subscription__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.subscription__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
}
.subscription__message {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.status-badge {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
}
.status-badge--success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}
.status-badge--warning {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}
.status-badge--muted {
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.subscription__facts {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.subscription__facts dt {
  font-size: 11px;
  color: var(--muted);
}
.subscription__facts dd {
  margin: 2px 0 0;
  font-size: 13px;
}
.subscription__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
}
.subscription__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.subscription__cancel {
  color: var(--danger);
  margin-left: -10px;
}
.subscription__hint {
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .subscription__facts {
    grid-template-columns: 1fr;
  }
}
</style>
