<script setup lang="ts">
/**
 * Assinar: escolher mensal ou anual, informar nome e CPF/CNPJ, pagar o Pix. Enquanto o QR está na
 * tela, consulta a assinatura a cada 5 s (só com a janela visível) até ela ficar ativa.
 */
import { computed, ref, watch } from 'vue'
import { ArrowLeft, Repeat, ShieldCheck } from 'lucide-vue-next'
import { AI_OPERATION_LABELS, isValidCpfCnpj } from '@pregar/core/plans/contract'
import type { BillingCycle, PlansView, SubscriptionView } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import Notice from '../ui/Notice.vue'
import PixChargeCard from './PixChargeCard.vue'
import { openExternal, usePolling } from '../composables'
import { cpfCnpjKind, cycleLabel, formatBRL, formatCpfCnpj, onlyDigits, yearlySavings } from '../format'

const POLL_INTERVAL_MS = 5000

const props = defineProps<{
  plans: PlansView | null
  plansLoading: boolean
  plansError: string | null
  subscription: SubscriptionView | null
  defaultName: string
  legalBase: string
}>()
const emit = defineEmits<{ update: [subscription: SubscriptionView | null]; activated: [subscription: SubscriptionView]; retryPlans: [] }>()

const app = useAppStore()

const cycle = ref<BillingCycle>('monthly')
const name = ref(props.defaultName)
const taxId = ref('')
const nameError = ref<string | null>(null)
const documentError = ref<string | null>(null)
const submitError = ref<string | null>(null)
const busy = ref(false)
const chargeExpired = ref(false)
const pending = ref<SubscriptionView | null>(isPayable(props.subscription) ? props.subscription : null)
const polling = ref(pending.value !== null)

const step = computed<'choose' | 'paying'>(() => (pending.value ? 'paying' : 'choose'))
const offers = computed(() => props.plans?.offers ?? [])
const savings = computed(() => yearlySavings(offers.value))
const selectedOffer = computed(() => offers.value.find((offer) => offer.cycle === cycle.value) ?? offers.value[0] ?? null)
const automatic = computed(() => (props.plans?.method ?? pending.value?.method) === 'pix_automatico')
const limitsSummary = computed(() => {
  const limits = props.plans?.limits.monthly
  if (!limits) return null
  return [
    `${limits.review} ${AI_OPERATION_LABELS.review.toLowerCase()}`,
    `${limits.structure} ${AI_OPERATION_LABELS.structure.toLowerCase()}`,
    `${limits.questions} ${AI_OPERATION_LABELS.questions.toLowerCase()}`,
    `${limits.research} ${AI_OPERATION_LABELS.research.toLowerCase()}`,
  ]
})
const statusNotice = computed(() => {
  const status = props.subscription?.status
  if (!status || pending.value) return null
  if (status === 'refused' || status === 'expired' || status === 'canceled' || (status === 'pending' && !props.subscription?.pendingCharge)) {
    return props.subscription?.statusMessage ?? null
  }
  return null
})

function isPayable(subscription: SubscriptionView | null): boolean {
  return subscription?.status === 'pending' && Boolean(subscription.pendingCharge)
}

watch(
  () => props.subscription,
  (next) => {
    if (isPayable(next) && !pending.value) {
      pending.value = next
      chargeExpired.value = false
      polling.value = true
    }
  },
)
watch(
  () => props.defaultName,
  (value) => {
    if (!name.value) name.value = value
  },
)

function onDocumentInput(event: Event): void {
  const target = event.target as HTMLInputElement
  taxId.value = formatCpfCnpj(target.value)
  target.value = taxId.value
  if (documentError.value && isValidCpfCnpj(taxId.value)) documentError.value = null
}

function validateDocument(): boolean {
  const digits = onlyDigits(taxId.value)
  if (!digits) documentError.value = 'Informe o CPF (11 números) ou o CNPJ (14 números).'
  else if (digits.length !== 11 && digits.length !== 14) documentError.value = 'O CPF tem 11 números e o CNPJ tem 14. Confira o que falta.'
  else if (!isValidCpfCnpj(digits)) documentError.value = `Este ${cpfCnpjKind(digits) ?? 'documento'} não é válido. Confira os números.`
  else documentError.value = null
  return !documentError.value
}

function validate(): boolean {
  nameError.value = name.value.trim().length < 3 ? 'Informe o nome completo, como no banco.' : null
  const documentOk = validateDocument()
  return !nameError.value && documentOk
}

async function checkout(): Promise<void> {
  submitError.value = null
  if (!validate()) return
  busy.value = true
  try {
    const subscription = await invoke('billing:checkout', { cycle: cycle.value, name: name.value.trim(), cpfCnpj: onlyDigits(taxId.value) })
    emit('update', subscription)
    if (subscription.status === 'active') {
      emit('activated', subscription)
      return
    }
    pending.value = subscription
    chargeExpired.value = false
    polling.value = Boolean(subscription.pendingCharge)
    if (!subscription.pendingCharge) submitError.value = subscription.statusMessage
  } catch (caught) {
    const code = (caught as { code?: string }).code
    if (code === 'already_subscribed') {
      app.account = await invoke('account:get', { refresh: true }).catch(() => app.account)
    }
    submitError.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

usePolling(
  async () => {
    const subscription = await invoke('billing:subscription')
    emit('update', subscription)
    if (!subscription) return false
    if (subscription.status === 'active') {
      polling.value = false
      emit('activated', subscription)
      return true
    }
    if (subscription.status === 'refused' || subscription.status === 'expired' || subscription.status === 'canceled') {
      pending.value = null
      submitError.value = subscription.statusMessage
      return true
    }
    if (subscription.pendingCharge) pending.value = subscription
    else chargeExpired.value = true
    return chargeExpired.value
  },
  POLL_INTERVAL_MS,
  polling,
)

function onExpired(): void {
  chargeExpired.value = true
  polling.value = false
}

function startOver(): void {
  pending.value = null
  polling.value = false
  chargeExpired.value = false
  submitError.value = null
}

async function regenerate(): Promise<void> {
  if (pending.value) cycle.value = pending.value.cycle
  if (onlyDigits(taxId.value).length === 0) {
    // O CPF não fica guardado; volta ao formulário com o ciclo escolhido.
    startOver()
    return
  }
  pending.value = null
  await checkout()
}
</script>

<template>
  <div class="subscribe">
    <template v-if="step === 'choose'">
      <Notice v-if="statusNotice" tone="warning" compact>{{ statusNotice }}</Notice>

      <div v-if="plansLoading && !plans" class="subscribe__loading"><Spinner :size="14" /> Carregando os planos…</div>
      <Notice v-else-if="!plans" tone="error" title="Não foi possível carregar os planos">
        {{ plansError ?? 'Tente de novo em instantes.' }}
        <template #actions><PButton compact @click="emit('retryPlans')">Tentar de novo</PButton></template>
      </Notice>

      <form v-else class="subscribe__form" novalidate @submit.prevent="checkout">
        <fieldset class="subscribe__offers">
          <legend class="subscribe__legend">Escolha o plano</legend>
          <label v-for="offer in offers" :key="offer.cycle" class="offer" :class="{ 'offer--selected': cycle === offer.cycle }">
            <input v-model="cycle" class="visually-hidden" type="radio" name="cycle" :value="offer.cycle" />
            <span class="offer__radio" aria-hidden="true" />
            <span class="offer__body">
              <span class="offer__top">
                <span class="offer__label">{{ offer.label }}</span>
                <span v-if="offer.cycle === 'yearly' && savings && savings.percent > 0" class="offer__tag">economize {{ savings.percent }}%</span>
              </span>
              <span class="offer__price">{{ formatBRL(offer.priceCents) }} <small>{{ cycleLabel(offer.cycle) }}</small></span>
              <span v-if="offer.cycle === 'yearly' && savings" class="offer__note">Equivale a {{ formatBRL(savings.monthlyEquivalentCents) }} por mês</span>
              <span class="offer__description">{{ offer.description }}</span>
            </span>
          </label>
        </fieldset>

        <div class="subscribe__method">
          <Repeat :size="15" aria-hidden="true" />
          <p>{{ plans.methodDescription }}</p>
        </div>
        <p v-if="limitsSummary" class="subscribe__limits">Inclui por mês: {{ limitsSummary.join(', ') }}.</p>

        <div class="subscribe__fields">
          <div class="subscribe__field">
            <label for="sub-name">Nome completo</label>
            <input
              id="sub-name"
              v-model="name"
              class="field"
              autocomplete="name"
              maxlength="120"
              :aria-invalid="Boolean(nameError)"
              :aria-describedby="nameError ? 'sub-name-error' : undefined"
            />
            <span v-if="nameError" id="sub-name-error" class="subscribe__error" role="alert">{{ nameError }}</span>
          </div>
          <div class="subscribe__field">
            <label for="sub-document">CPF ou CNPJ</label>
            <input
              id="sub-document"
              :value="taxId"
              class="field subscribe__document"
              inputmode="numeric"
              autocomplete="off"
              placeholder="000.000.000-00"
              :aria-invalid="Boolean(documentError)"
              aria-describedby="sub-document-hint"
              @input="onDocumentInput"
              @blur="taxId && validateDocument()"
            />
            <span v-if="documentError" class="subscribe__error" role="alert">{{ documentError }}</span>
            <span v-else id="sub-document-hint" class="subscribe__hint">Exigido para emitir a cobrança Pix. Não aparece para mais ninguém.</span>
          </div>
        </div>

        <p v-if="submitError" class="subscribe__error subscribe__error--block" role="alert">{{ submitError }}</p>

        <div class="subscribe__actions">
          <PButton variant="primary" type="submit" :busy="busy">
            {{ selectedOffer ? `Gerar Pix de ${formatBRL(selectedOffer.priceCents)}` : 'Gerar Pix' }}
          </PButton>
          <span class="subscribe__safe"><ShieldCheck :size="14" aria-hidden="true" /> Sem fidelidade. Cancele quando quiser.</span>
        </div>
        <p class="subscribe__legal">
          Ao assinar, você concorda com os
          <a href="#" @click.prevent="openExternal(`${legalBase}/legal/termos`)">Termos de uso</a> e a
          <a href="#" @click.prevent="openExternal(`${legalBase}/legal/privacidade`)">Política de privacidade</a>.
        </p>
      </form>
    </template>

    <template v-else-if="pending?.pendingCharge">
      <div class="subscribe__paying-head">
        <div>
          <h3 class="subscribe__title">Pague com Pix para ativar</h3>
          <p class="subscribe__lead">
            {{ pending.statusMessage }}
            {{ automatic ? 'Depois disso, o Pix Automático cuida das renovações.' : '' }}
          </p>
        </div>
        <PButton variant="link" compact @click="startOver"><ArrowLeft :size="13" aria-hidden="true" />Trocar plano</PButton>
      </div>
      <PixChargeCard :charge="pending.pendingCharge" :method="pending.method" :waiting="polling" @expired="onExpired" />
      <Notice v-if="chargeExpired" tone="warning" title="O código Pix expirou">
        Se você já pagou, aguarde alguns minutos: a confirmação chega mesmo assim. Se não pagou, gere um novo código.
        <template #actions><PButton variant="primary" compact :busy="busy" @click="regenerate">Gerar novo código</PButton></template>
      </Notice>
      <p v-if="submitError" class="subscribe__error subscribe__error--block" role="alert">{{ submitError }}</p>
    </template>
  </div>
</template>

<style scoped>
.subscribe {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 0;
}
.subscribe__loading {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.subscribe__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.subscribe__offers {
  border: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.subscribe__legend {
  padding: 0;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
}
.offer {
  display: flex;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  transition:
    border-color 0.12s,
    background 0.12s;
}
.offer:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line-strong));
}
.offer--selected {
  border-color: var(--accent);
  background: var(--accent-softer);
  box-shadow: 0 0 0 1px var(--accent);
}
.offer:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.offer__radio {
  flex: none;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
}
.offer--selected .offer__radio {
  border: 5px solid var(--accent);
}
.offer__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.offer__top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.offer__label {
  font-size: 13px;
  font-weight: 600;
}
.offer__tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.offer__price {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
}
.offer__price small {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.offer__note {
  font-size: 12px;
  color: var(--ink);
}
.offer__description {
  font-size: 12px;
  color: var(--muted);
}
.subscribe__method {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: var(--accent);
}
.subscribe__method p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
}
.subscribe__limits {
  margin: -6px 0 0 25px;
  font-size: 12px;
  color: var(--muted);
}
.subscribe__fields {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 12px;
}
.subscribe__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
}
.subscribe__field label {
  font-weight: 500;
}
.subscribe__field .field {
  height: 32px;
  font-size: 13px;
}
.subscribe__document {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.subscribe__hint {
  font-size: 11px;
  color: var(--muted);
}
.subscribe__error {
  font-size: 12px;
  color: var(--danger);
}
.subscribe__error--block {
  margin: 0;
}
.subscribe__actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.subscribe__safe {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.subscribe__legal {
  margin: -6px 0 0;
  font-size: 11px;
  color: var(--muted);
}
.subscribe__paying-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.subscribe__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
}
.subscribe__lead {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .subscribe__offers,
  .subscribe__fields {
    grid-template-columns: 1fr;
  }
}
</style>
