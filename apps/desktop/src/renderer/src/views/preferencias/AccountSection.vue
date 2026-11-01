<script setup lang="ts">
/** Conta e assinatura: login, plano, assinatura por Pix, uso, pagamentos, sessões e dados (LGPD). */
import { computed, onMounted, ref, watch } from 'vue'
import { Check } from 'lucide-vue-next'
import { PREGAR_API_DEFAULT_URL } from '@pregar/core/plans/contract'
import type { PlansView, SubscriptionView } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import PrefGroup from './ui/PrefGroup.vue'
import Notice from './ui/Notice.vue'
import LoginPanel from './conta/LoginPanel.vue'
import AccountCard from './conta/AccountCard.vue'
import SubscribePanel from './conta/SubscribePanel.vue'
import SubscriptionPanel from './conta/SubscriptionPanel.vue'
import UsagePanel from './conta/UsagePanel.vue'
import PaymentsPanel from './conta/PaymentsPanel.vue'
import SessionsPanel from './conta/SessionsPanel.vue'
import DataPanel from './conta/DataPanel.vue'
import { openExternal } from './composables'
import { formatBRL } from './format'

const app = useAppStore()

const loggedIn = computed(() => app.account.loggedIn)
const account = computed(() => app.account.account)
const isPro = computed(() => loggedIn.value && account.value?.plan === 'pro')
const legalBase = computed(() => (app.account.apiBaseURL || PREGAR_API_DEFAULT_URL).replace(/\/+$/, ''))

const plans = ref<PlansView | null>(null)
const plansLoading = ref(false)
const plansError = ref<string | null>(null)
const subscription = ref<SubscriptionView | null>(account.value?.subscription ?? null)
const justActivated = ref(false)
const resubscribing = ref(false)
const refreshing = ref(false)
const paymentsKey = ref('')

const cheapestMonthly = computed(() => {
  const offers = plans.value?.offers ?? []
  const monthly = offers.find((offer) => offer.cycle === 'monthly')
  const yearly = offers.find((offer) => offer.cycle === 'yearly')
  const candidates = [monthly?.priceCents, yearly ? Math.round(yearly.priceCents / 12) : undefined].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  )
  return candidates.length ? Math.min(...candidates) : null
})
const hasLiveSubscription = computed(() => {
  const status = subscription.value?.status
  return status === 'active' || status === 'past_due' || (isPro.value && Boolean(subscription.value))
})
const showSubscribe = computed(() => loggedIn.value && (!hasLiveSubscription.value || resubscribing.value))

async function loadPlans(): Promise<void> {
  plansLoading.value = true
  plansError.value = null
  try {
    plans.value = await invoke('billing:plans')
  } catch (caught) {
    plansError.value = errorMessage(caught)
  } finally {
    plansLoading.value = false
  }
}

async function refresh(): Promise<void> {
  if (!app.account.loggedIn) return
  refreshing.value = true
  try {
    app.account = await invoke('account:get', { refresh: true })
    if (app.account.loggedIn && !app.account.offline) subscription.value = await invoke('billing:subscription')
  } catch {
    // Sem rede: fica com o que está em cache; o aviso de conexão cobre o caso.
  } finally {
    refreshing.value = false
  }
  if (!plans.value) void loadPlans()
}

async function onActivated(next: SubscriptionView): Promise<void> {
  subscription.value = next
  justActivated.value = true
  resubscribing.value = false
  paymentsKey.value = String(Date.now())
  try {
    app.account = await invoke('account:get', { refresh: true })
  } catch {
    // O plano será atualizado na próxima consulta.
  }
}

function onSubscriptionUpdate(next: SubscriptionView | null): void {
  subscription.value = next
}

watch(
  () => app.account.account?.subscription,
  (next) => {
    if (next !== undefined) subscription.value = next
  },
)
watch(loggedIn, (value) => {
  justActivated.value = false
  if (value) void refresh()
  else subscription.value = null
})

onMounted(() => {
  void loadPlans()
  void refresh()
})
</script>

<template>
  <div class="account-section">
    <Notice v-if="app.account.offline" tone="offline" title="Sem conexão com o servidor do Pregar">
      {{
        loggedIn
          ? 'Mostrando os dados salvos da última vez. A assinatura continua valendo; confira a internet.'
          : 'Confira a internet para entrar ou assinar. Enquanto isso, o Pregar funciona com as suas próprias chaves.'
      }}
      <template #actions><PButton compact :busy="refreshing" @click="refresh">Tentar de novo</PButton></template>
    </Notice>

    <template v-if="!loggedIn">
      <section class="hero" aria-labelledby="hero-title">
        <h3 id="hero-title" class="hero__title">Assine o Pregar</h3>
        <p class="hero__lead">O jeito mais simples de usar o Pregar: você só entra com o email, sem chaves para configurar.</p>
        <ul class="hero__list">
          <li><Check :size="15" aria-hidden="true" />Revisão por IA, perguntas de emergência e pesquisa de materiais.</li>
          <li><Check :size="15" aria-hidden="true" />Calendário litúrgico, leituras e Bíblia sem chave da Estêvão API.</li>
          <li><Check :size="15" aria-hidden="true" />Pagamento por Pix. Sem fidelidade: cancele quando quiser.</li>
        </ul>
        <p v-if="cheapestMonthly" class="hero__price">A partir de <strong>{{ formatBRL(cheapestMonthly) }}</strong> por mês.</p>
      </section>

      <PrefGroup label="Entrar">
        <LoginPanel />
      </PrefGroup>

      <p class="account-section__aside">
        Prefere não assinar? O Pregar também funciona de graça com as suas próprias chaves. Configure em
        <RouterLink to="/preferencias/estevao" replace>Estêvão API</RouterLink> e
        <RouterLink to="/preferencias/ia" replace>Inteligência artificial</RouterLink>.
      </p>
    </template>

    <template v-else>
      <Notice v-if="justActivated" tone="success" title="Assinatura ativa. Está tudo pronto!">
        A revisão por IA, o calendário e as leituras já funcionam sem chaves. Pode voltar à Mesa e preparar o sermão.
        <template #actions>
          <PButton variant="primary" compact @click="invoke('app:openWindow', { window: 'mesa' })">Abrir a Mesa</PButton>
        </template>
      </Notice>

      <PrefGroup>
        <AccountCard />
      </PrefGroup>

      <PrefGroup v-if="hasLiveSubscription && subscription" label="Assinatura">
        <SubscriptionPanel :subscription="subscription" @update="onSubscriptionUpdate" @resubscribe="resubscribing = true" />
      </PrefGroup>

      <PrefGroup v-if="showSubscribe" :label="resubscribing ? 'Assinar de novo' : 'Assinar'">
        <SubscribePanel
          :plans="plans"
          :plans-loading="plansLoading"
          :plans-error="plansError"
          :subscription="resubscribing ? null : subscription"
          :default-name="account?.user.name ?? ''"
          :legal-base="legalBase"
          @update="onSubscriptionUpdate"
          @activated="onActivated"
          @retry-plans="loadPlans"
        />
      </PrefGroup>

      <PrefGroup v-if="account?.usage" label="Uso da assinatura">
        <UsagePanel :usage="account.usage" />
      </PrefGroup>

      <PrefGroup v-if="subscription && subscription.status !== 'pending'" label="Pagamentos">
        <PaymentsPanel :refresh-key="paymentsKey" />
      </PrefGroup>

      <PrefGroup label="Computadores conectados">
        <SessionsPanel />
      </PrefGroup>

      <PrefGroup label="Seus dados">
        <DataPanel />
      </PrefGroup>
    </template>

    <nav class="account-section__legal" aria-label="Documentos legais">
      <PButton variant="link" compact @click="openExternal(`${legalBase}/legal/privacidade`)">Política de privacidade</PButton>
      <span aria-hidden="true">·</span>
      <PButton variant="link" compact @click="openExternal(`${legalBase}/legal/termos`)">Termos de uso</PButton>
    </nav>
  </div>
</template>

<style scoped>
.account-section {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.hero {
  padding: 20px 22px;
  border-radius: var(--radius-card);
  background: var(--accent-softer);
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
}
.hero__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
}
.hero__lead {
  margin: 6px 0 12px;
  font-size: 13px;
}
.hero__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.hero__list li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.hero__list svg {
  flex: none;
  margin-top: 2px;
  color: var(--accent);
}
.hero__price {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.hero__price strong {
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--ink);
}
.account-section__aside {
  margin: -6px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.account-section__legal {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: -6px;
  font-size: 11px;
  color: var(--muted);
}
</style>
