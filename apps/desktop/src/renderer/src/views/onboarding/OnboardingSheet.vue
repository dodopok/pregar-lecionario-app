<script setup lang="ts">
/**
 * Primeira abertura: dois caminhos claros (assinar ou usar as próprias chaves) e "Decidir depois".
 * A Mesa mostra esta folha enquanto `settings.onboarding.completed` for falso; a escolha fica salva
 * em `settings.onboarding` e o evento `close` avisa quem a mostrou.
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { ArrowLeft, Check, CircleCheck, ExternalLink, KeyRound, Sparkles } from 'lucide-vue-next'
import { providerName, suggestedModel } from '@pregar/core/ai/providers'
import type { AIProvider } from '@pregar/core/ai/providers'
import Sheet from '@/components/Sheet.vue'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { formatBRL } from '../preferencias/format'

type Step = 'welcome' | 'estevao' | 'ai' | 'done'
type Path = 'pro' | 'byok' | 'later'

const emit = defineEmits<{ close: [path: Path] }>()

const ESTEVAO_SITE = 'https://estevao.caminhoanglicano.com.br'
const PROVIDERS: { id: AIProvider; note: string; url: string }[] = [
  { id: 'anthropic', note: 'Recomendado para a revisão.', url: 'https://platform.claude.com/settings/keys' },
  { id: 'openai', note: 'Também revisa bem.', url: 'https://platform.openai.com/api-keys' },
  { id: 'google', note: 'O mais barato.', url: 'https://aistudio.google.com/apikey' },
  { id: 'perplexity', note: 'Para pesquisar materiais.', url: 'https://www.perplexity.ai/account/api/keys' },
]

const app = useAppStore()
const step = ref<Step>('welcome')
const monthlyFrom = ref<number | null>(null)
const finishing = ref<Path | null>(null)
const body = ref<HTMLElement | null>(null)

const estevaoKey = ref('')
const estevaoBusy = ref(false)
const estevaoResult = ref<{ ok: boolean; text: string } | null>(null)

const provider = ref<AIProvider>('anthropic')
const aiKey = ref('')
const aiBusy = ref(false)
const aiResult = ref<{ ok: boolean; text: string } | null>(null)

const hasEstevao = computed(() => app.secrets?.estevao === true)
const hasAI = computed(() => PROVIDERS.some((item) => app.secrets?.[item.id] === true))
const savedAIProviders = computed(() => PROVIDERS.filter((item) => app.secrets?.[item.id] === true).map((item) => providerName(item.id)))
const currentProvider = computed(() => PROVIDERS.find((item) => item.id === provider.value) ?? PROVIDERS[0]!)

function openExternal(url: string): void {
  void invoke('app:openExternal', { url }).catch(() => undefined)
}

async function go(next: Step): Promise<void> {
  step.value = next
  await nextTick()
  body.value?.querySelector<HTMLElement>('h2')?.focus()
}

async function finish(path: Path): Promise<void> {
  finishing.value = path
  try {
    await app.updateSettings({ onboarding: { completed: true, path } })
    if (path === 'pro') await invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/conta' })
  } catch {
    // A escolha vale para esta sessão mesmo se a gravação falhar.
  } finally {
    finishing.value = null
    emit('close', path)
  }
}

async function saveEstevao(): Promise<void> {
  const value = estevaoKey.value.trim()
  if (!value && !hasEstevao.value) {
    estevaoResult.value = { ok: false, text: 'Cole a chave no campo acima.' }
    return
  }
  estevaoBusy.value = true
  estevaoResult.value = null
  try {
    if (value) {
      await invoke('secrets:set', { name: 'estevao', value })
      estevaoKey.value = ''
      await app.refreshSecrets()
    }
    await invoke('liturgy:prayerBooks')
    estevaoResult.value = { ok: true, text: 'Tudo certo: a Estêvão API respondeu.' }
  } catch (caught) {
    estevaoResult.value = { ok: false, text: errorMessage(caught) }
  } finally {
    estevaoBusy.value = false
  }
}

async function saveAI(): Promise<void> {
  const value = aiKey.value.trim()
  if (!value) {
    aiResult.value = { ok: false, text: 'Cole a chave no campo acima.' }
    return
  }
  aiBusy.value = true
  aiResult.value = null
  try {
    await invoke('secrets:set', { name: provider.value, value })
    aiKey.value = ''
    await app.refreshSecrets()
    const choice = { provider: provider.value, model: suggestedModel(provider.value) }
    await app.updateSettings({
      ai:
        provider.value === 'perplexity'
          ? { researchProvider: choice.provider, researchModel: choice.model }
          : { reviewProvider: choice.provider, reviewModel: choice.model },
    })
    aiResult.value = { ok: true, text: `Chave do ${providerName(provider.value)} salva neste computador.` }
  } catch (caught) {
    aiResult.value = { ok: false, text: errorMessage(caught) }
  } finally {
    aiBusy.value = false
  }
}

onMounted(async () => {
  try {
    const plans = await invoke('billing:plans')
    const monthly = plans.offers.find((offer) => offer.cycle === 'monthly')?.priceCents
    const yearly = plans.offers.find((offer) => offer.cycle === 'yearly')?.priceCents
    const values = [monthly, yearly ? Math.round(yearly / 12) : undefined].filter((value): value is number => typeof value === 'number' && value > 0)
    monthlyFrom.value = values.length ? Math.min(...values) : null
  } catch {
    monthlyFrom.value = null
  }
})
</script>

<template>
  <Sheet label="Boas-vindas ao Pregar" :width="680" :dismissible="false">
    <div ref="body" class="onboarding">
      <!-- Boas-vindas e escolha do caminho -->
      <template v-if="step === 'welcome'">
        <header class="onboarding__welcome">
          <div class="onboarding__mark" aria-hidden="true">P</div>
          <div>
            <h2 class="onboarding__title" tabindex="-1">Bem-vindo ao Pregar</h2>
            <p class="onboarding__lead">
              Prepare o sermão com o calendário litúrgico, as leituras do domingo, a sua biblioteca e uma revisão cuidadosa por IA.
            </p>
          </div>
        </header>

        <p class="onboarding__question">Para buscar as leituras e revisar o texto, o Pregar precisa se conectar. Como você prefere?</p>

        <div class="paths">
          <section class="path path--recommended" aria-labelledby="path-pro">
            <span class="path__badge">Recomendado</span>
            <div class="path__icon" aria-hidden="true"><Sparkles :size="18" /></div>
            <h3 id="path-pro" class="path__title">Assinar o Pregar</h3>
            <p class="path__text">O mais simples: não precisa configurar nada. Leituras, Bíblia e revisão por IA funcionam só com o seu email.</p>
            <ul class="path__list">
              <li><Check :size="13" aria-hidden="true" />Pagamento por Pix</li>
              <li><Check :size="13" aria-hidden="true" />Cancele quando quiser</li>
              <li v-if="monthlyFrom"><Check :size="13" aria-hidden="true" />A partir de {{ formatBRL(monthlyFrom) }} por mês</li>
            </ul>
            <PButton variant="primary" class="path__action" :busy="finishing === 'pro'" @click="finish('pro')">Assinar o Pregar</PButton>
            <span class="path__hint">Já assina? O mesmo botão leva ao login.</span>
          </section>

          <section class="path" aria-labelledby="path-byok">
            <div class="path__icon" aria-hidden="true"><KeyRound :size="18" /></div>
            <h3 id="path-byok" class="path__title">Usar minhas próprias chaves (grátis)</h3>
            <p class="path__text">
              Para quem já tem ou quer criar chaves de API. O Pregar é gratuito; você paga direto ao provedor de IA pelo que usar.
            </p>
            <ul class="path__list">
              <li><Check :size="13" aria-hidden="true" />Dois passos curtos, com links</li>
              <li><Check :size="13" aria-hidden="true" />O texto não passa pelo Pregar</li>
            </ul>
            <PButton class="path__action" @click="go('estevao')">Configurar minhas chaves</PButton>
          </section>
        </div>

        <footer class="onboarding__footer">
          <span class="onboarding__note">Você pode mudar isso a qualquer momento em Preferências.</span>
          <PButton variant="ghost" :busy="finishing === 'later'" @click="finish('later')">Decidir depois</PButton>
        </footer>
      </template>

      <!-- Passo 1: Estêvão API -->
      <template v-else-if="step === 'estevao'">
        <p class="onboarding__step">Passo 1 de 2</p>
        <h2 class="onboarding__title" tabindex="-1">Chave da Estêvão API</h2>
        <p class="onboarding__lead">A Estêvão API traz o calendário litúrgico, as leituras do domingo e os textos bíblicos.</p>
        <ol class="steps">
          <li>
            Abra o site da Estêvão API e peça a sua chave.
            <PButton variant="link" compact @click="openExternal(ESTEVAO_SITE)">Abrir o site <ExternalLink :size="11" aria-hidden="true" /></PButton>
          </li>
          <li>Copie a chave. Ela começa com <code>estevao_</code>.</li>
          <li>Cole aqui embaixo e clique em <strong>Salvar e testar</strong>.</li>
        </ol>
        <form class="key-form" @submit.prevent="saveEstevao">
          <label class="visually-hidden" for="onboarding-estevao">Chave da Estêvão API</label>
          <input
            id="onboarding-estevao"
            v-model="estevaoKey"
            class="field"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :placeholder="hasEstevao ? 'Chave salva; deixe vazio para mantê-la' : 'estevao_…'"
          />
          <PButton :variant="estevaoResult?.ok ? 'secondary' : 'primary'" type="submit" :busy="estevaoBusy">Salvar e testar</PButton>
        </form>
        <p v-if="estevaoResult" class="result" :class="{ 'result--ok': estevaoResult.ok }" :role="estevaoResult.ok ? 'status' : 'alert'">
          <CircleCheck v-if="estevaoResult.ok" :size="14" aria-hidden="true" />{{ estevaoResult.text }}
        </p>
        <footer class="onboarding__footer">
          <PButton variant="ghost" @click="go('welcome')"><ArrowLeft :size="13" aria-hidden="true" />Voltar</PButton>
          <span class="spacer" />
          <PButton v-if="hasEstevao" variant="primary" @click="go('ai')">Continuar</PButton>
          <PButton v-else variant="ghost" @click="go('ai')">Pular por enquanto</PButton>
        </footer>
      </template>

      <!-- Passo 2: chave de IA -->
      <template v-else-if="step === 'ai'">
        <p class="onboarding__step">Passo 2 de 2</p>
        <h2 class="onboarding__title" tabindex="-1">Chave de inteligência artificial</h2>
        <p class="onboarding__lead">
          A revisão do sermão usa um provedor de IA. Você paga a ele direto pelo uso; uma revisão costuma custar centavos. Basta uma chave.
        </p>
        <fieldset class="providers">
          <legend class="visually-hidden">Provedor de IA</legend>
          <label v-for="item in PROVIDERS" :key="item.id" class="provider" :class="{ 'provider--selected': provider === item.id }">
            <input v-model="provider" class="visually-hidden" type="radio" name="provider" :value="item.id" />
            <span class="provider__name">
              {{ providerName(item.id) }}
              <CircleCheck v-if="app.secrets?.[item.id]" :size="13" class="provider__saved" aria-label="chave salva" />
            </span>
            <span class="provider__note">{{ item.note }}</span>
          </label>
        </fieldset>
        <ol class="steps">
          <li>
            Crie uma conta no site do {{ providerName(provider) }} e gere uma chave de API.
            <PButton variant="link" compact @click="openExternal(currentProvider.url)">Abrir o site <ExternalLink :size="11" aria-hidden="true" /></PButton>
          </li>
          <li>Cole a chave aqui e clique em <strong>Salvar</strong>.</li>
        </ol>
        <form class="key-form" @submit.prevent="saveAI">
          <label class="visually-hidden" for="onboarding-ai">Chave de API do {{ providerName(provider) }}</label>
          <input id="onboarding-ai" v-model="aiKey" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="Cole a chave da API" />
          <PButton :variant="aiResult?.ok ? 'secondary' : 'primary'" type="submit" :busy="aiBusy">Salvar</PButton>
        </form>
        <p v-if="aiResult" class="result" :class="{ 'result--ok': aiResult.ok }" :role="aiResult.ok ? 'status' : 'alert'">
          <CircleCheck v-if="aiResult.ok" :size="14" aria-hidden="true" />{{ aiResult.text }}
        </p>
        <p class="onboarding__note">Sem chave de IA, o Pregar funciona normalmente; só a revisão fica desligada.</p>
        <footer class="onboarding__footer">
          <PButton variant="ghost" @click="go('estevao')"><ArrowLeft :size="13" aria-hidden="true" />Voltar</PButton>
          <span class="spacer" />
          <PButton v-if="hasAI" variant="primary" @click="go('done')">Continuar</PButton>
          <PButton v-else variant="ghost" @click="go('done')">Pular por enquanto</PButton>
        </footer>
      </template>

      <!-- Resumo -->
      <template v-else>
        <h2 class="onboarding__title" tabindex="-1">{{ hasEstevao ? 'Tudo pronto' : 'Quase lá' }}</h2>
        <ul class="summary">
          <li :class="{ 'summary__item--ok': hasEstevao }" class="summary__item">
            <CircleCheck :size="16" aria-hidden="true" />
            <span>
              <strong>Estêvão API:</strong>
              {{ hasEstevao ? 'chave salva. O calendário e as leituras já carregam.' : 'sem chave. O calendário e as leituras não carregam ainda.' }}
            </span>
          </li>
          <li :class="{ 'summary__item--ok': hasAI }" class="summary__item">
            <CircleCheck :size="16" aria-hidden="true" />
            <span>
              <strong>Inteligência artificial:</strong>
              {{ hasAI ? `chave do ${savedAIProviders.join(', ')} salva.` : 'sem chave. A revisão fica desligada.' }}
            </span>
          </li>
        </ul>
        <p class="onboarding__lead">Você pode completar ou trocar as chaves quando quiser em Preferências, ou assinar o Pregar e não usar chaves.</p>
        <footer class="onboarding__footer">
          <PButton variant="ghost" @click="go('ai')"><ArrowLeft :size="13" aria-hidden="true" />Voltar</PButton>
          <span class="spacer" />
          <PButton variant="primary" :busy="finishing === 'byok'" @click="finish('byok')">Começar</PButton>
        </footer>
      </template>
    </div>
  </Sheet>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.onboarding__welcome {
  display: flex;
  gap: 16px;
  align-items: center;
}
.onboarding__mark {
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--accent-contrast);
  background: var(--accent);
}
.onboarding__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  outline: none;
}
.onboarding__lead {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}
.onboarding__question {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
.onboarding__step {
  margin: 0 0 -10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}
.onboarding__note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.onboarding__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.paths {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
  gap: 14px;
}
.path {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line-strong);
  background: var(--surface);
}
.path--recommended {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  background: var(--accent-softer);
}
.path__badge {
  position: absolute;
  top: 14px;
  right: 14px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}
.path__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-button);
  color: var(--accent);
  background: var(--accent-soft);
}
.path__title {
  margin: 2px 0 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
}
.path__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.path__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.path__list li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.path__list svg {
  color: var(--accent);
}
.path__action {
  margin-top: auto;
  align-self: flex-start;
}
.path__hint {
  font-size: 11px;
  color: var(--muted);
}
.steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.5;
}
.steps code {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.key-form {
  display: flex;
  gap: 8px;
}
.key-form .field {
  flex: 1;
  max-width: 380px;
  height: 32px;
}
.result {
  margin: -6px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--danger);
}
.result--ok {
  color: var(--success);
}
.providers {
  border: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.provider {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-button);
  border: 1px solid var(--line-strong);
  background: var(--surface);
}
.provider:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.provider--selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  background: var(--accent-softer);
}
.provider__name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
}
.provider__saved {
  color: var(--success);
}
.provider__note {
  font-size: 11px;
  color: var(--muted);
}
.summary {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
}
.summary__item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: var(--muted);
}
.summary__item svg {
  flex: none;
  margin-top: 1px;
}
.summary__item--ok {
  color: var(--ink);
}
.summary__item--ok svg {
  color: var(--success);
}
@media (max-width: 640px) {
  .paths {
    grid-template-columns: 1fr;
  }
  .providers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
