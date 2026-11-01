<script setup lang="ts">
/** Histórico de cobranças da assinatura. */
import { onMounted, ref, watch } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import type { PaymentView } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { openExternal } from '../composables'
import { formatBRL, formatDate, paymentStatusLabel } from '../format'

const props = defineProps<{ refreshKey?: string }>()

const payments = ref<PaymentView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    payments.value = await invoke('billing:payments')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.refreshKey, load)
</script>

<template>
  <div class="payments">
    <div v-if="loading && payments.length === 0" class="payments__state"><Spinner :size="14" /> Carregando pagamentos…</div>
    <div v-else-if="error" class="payments__state">
      {{ error }}
      <PButton compact @click="load">Tentar de novo</PButton>
    </div>
    <p v-else-if="payments.length === 0" class="payments__state">Nenhum pagamento ainda.</p>
    <table v-else class="payments__table">
      <thead>
        <tr>
          <th scope="col">Vencimento</th>
          <th scope="col">Valor</th>
          <th scope="col">Situação</th>
          <th scope="col">Pago em</th>
          <th scope="col"><span class="visually-hidden">Recibo</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="payment in payments" :key="payment.id">
          <td>{{ formatDate(payment.dueDate) }}</td>
          <td class="payments__value">{{ formatBRL(payment.valueCents) }}</td>
          <td>
            <span class="payments__status" :class="`payments__status--${paymentStatusLabel(payment.status).tone}`">
              {{ paymentStatusLabel(payment.status).label }}
            </span>
          </td>
          <td>{{ payment.paidAt ? formatDate(payment.paidAt) : '—' }}</td>
          <td class="payments__link">
            <PButton v-if="payment.invoiceUrl" variant="link" compact @click="openExternal(payment.invoiceUrl)">
              Recibo <ExternalLink :size="12" aria-hidden="true" />
            </PButton>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.payments {
  padding: 6px 0;
}
.payments__state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 0;
  font-size: 12px;
  color: var(--muted);
}
.payments__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.payments__table th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  font-size: 11px;
  padding: 8px 8px 6px 0;
  border-bottom: 1px solid var(--line);
}
.payments__table td {
  padding: 8px 8px 8px 0;
  border-bottom: 1px solid var(--line);
}
.payments__table tr:last-child td {
  border-bottom: none;
}
.payments__value {
  font-variant-numeric: tabular-nums;
}
.payments__link {
  text-align: right;
}
.payments__status {
  font-weight: 600;
}
.payments__status--success {
  color: var(--success);
}
.payments__status--warning {
  color: var(--warning);
}
.payments__status--danger {
  color: var(--danger);
}
.payments__status--muted {
  color: var(--muted);
}
</style>
