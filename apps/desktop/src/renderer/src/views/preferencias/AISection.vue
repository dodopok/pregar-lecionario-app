<script setup lang="ts">
/**
 * Inteligência artificial: os dois modos (assinatura ou chaves próprias), chaves dos quatro
 * provedores, provedor e modelo de revisão e de pesquisa, e o resumo de como a IA será chamada.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ExternalLink, KeyRound, RefreshCw, Sparkles, Trash2, UserRound } from 'lucide-vue-next'
import { AI_PROVIDERS, modelOptions, providerName, suggestedModel } from '@pregar/core/ai/providers'
import type { AIModelOption, AIProvider } from '@pregar/core/ai/providers'
import type { AIAccess } from '@shared/ipc-ai'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import Toggle from '@/components/Toggle.vue'
import { errorMessage, invoke, platform } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'
import Notice from './ui/Notice.vue'
import { openExternal } from './composables'
import { isNotImplemented } from './format'

const KEY_PAGES: Record<AIProvider, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  perplexity: 'https://www.perplexity.ai/account/api/keys',
}
const PROVIDER_NOTES: Record<AIProvider, string> = {
  openai: 'GPT-6. Bom para revisão.',
  anthropic: 'Recomendado para a revisão.',
  google: 'Gemini Flash, o mais barato.',
  perplexity: 'Recomendado para pesquisar materiais.',
}

const app = useAppStore()

const drafts = ref<Record<AIProvider, string>>({ openai: '', anthropic: '', google: '', perplexity: '' })
const busy = ref<AIProvider | null>(null)
const feedback = ref<Partial<Record<AIProvider, { tone: 'success' | 'error'; text: string }>>>({})
const claudeModels = ref<AIModelOption[]>([])
const claudeLoading = ref(false)
const claudeError = ref<string | null>(null)
const access = ref<{ review: AIAccess | null; research: AIAccess | null; unavailable: boolean }>({ review: null, research: null, unavailable: false })

const ai = computed(() => app.settings.ai)
const proAvailable = computed(() => app.account.loggedIn && Boolean(app.account.account?.features.aiProxy))
const usingSubscription = computed(() => proAvailable.value && !ai.value.preferOwnKeys)
const vaultMissing = computed(() => app.secrets !== null && !app.secrets.encryptionAvailable && platform() === 'linux')
const hasKey = (provider: AIProvider) => app.secrets?.[provider] === true
const anyKey = computed(() => AI_PROVIDERS.some(hasKey))
const reviewModels = computed(() => modelOptions(ai.value.reviewProvider, { claudeModels: claudeModels.value, selectedModel: ai.value.reviewModel }))
const researchModels = computed(() =>
  modelOptions(ai.value.researchProvider, { claudeModels: claudeModels.value, selectedModel: ai.value.researchModel }),
)

/** Resumo local, usado quando o canal ai:access ainda não existe. */
function localAccess(purpose: 'review' | 'research'): { label: string; message: string; mode: AIAccess['mode'] } {
  if (usingSubscription.value) return { mode: 'pro', label: 'Assinatura do Pregar', message: 'Sem chave: a assinatura cuida de tudo.' }
  const provider = purpose === 'review' ? ai.value.reviewProvider : ai.value.researchProvider
  const model = purpose === 'review' ? ai.value.reviewModel : ai.value.researchModel
  if (hasKey(provider)) return { mode: 'byok', label: `${providerName(provider)} · ${model}`, message: 'Com a sua chave, direto no provedor.' }
  return { mode: 'none', label: 'Indisponível', message: `Salve a chave do ${providerName(provider)} ou assine o Pregar.` }
}

const summary = computed(() =>
  (['review', 'research'] as const).map((purpose) => {
    const remote = access.value[purpose]
    const local = localAccess(purpose)
    return {
      purpose,
      title: purpose === 'review' ? 'Revisão e perguntas' : 'Pesquisa de materiais',
      mode: remote?.mode ?? local.mode,
      label: remote?.label ?? local.label,
      message: remote?.message ?? local.message,
    }
  }),
)

async function loadAccess(): Promise<void> {
  try {
    const [review, research] = await Promise.all([invoke('ai:access', { purpose: 'review' }), invoke('ai:access', { purpose: 'research' })])
    access.value = { review, research, unavailable: false }
  } catch {
    access.value = { review: null, research: null, unavailable: true }
  }
}

async function loadClaudeModels(): Promise<void> {
  if (!hasKey('anthropic')) {
    claudeError.value = null
    return
  }
  claudeLoading.value = true
  claudeError.value = null
  try {
    claudeModels.value = await invoke('ai:claudeModels')
  } catch (caught) {
    claudeError.value = isNotImplemented(caught)
      ? 'A consulta de modelos do Claude ainda não está disponível nesta versão. A lista padrão foi mantida.'
      : `${errorMessage(caught)} A última lista disponível foi mantida.`
  } finally {
    claudeLoading.value = false
  }
}

async function saveKey(provider: AIProvider): Promise<void> {
  const value = drafts.value[provider].trim()
  if (!value) return
  busy.value = provider
  try {
    await invoke('secrets:set', { name: provider, value })
    drafts.value[provider] = ''
    await app.refreshSecrets()
    feedback.value = { ...feedback.value, [provider]: { tone: 'success', text: 'Chave salva no cofre deste computador.' } }
    if (provider === 'anthropic') void loadClaudeModels()
    void loadAccess()
  } catch (caught) {
    feedback.value = { ...feedback.value, [provider]: { tone: 'error', text: errorMessage(caught) } }
  } finally {
    busy.value = null
  }
}

async function removeKey(provider: AIProvider): Promise<void> {
  busy.value = provider
  try {
    await invoke('secrets:delete', { name: provider })
    await app.refreshSecrets()
    feedback.value = { ...feedback.value, [provider]: { tone: 'success', text: 'Chave removida.' } }
    if (provider === 'anthropic') claudeModels.value = []
    void loadAccess()
  } catch (caught) {
    feedback.value = { ...feedback.value, [provider]: { tone: 'error', text: errorMessage(caught) } }
  } finally {
    busy.value = null
  }
}

function setProvider(purpose: 'review' | 'research', provider: AIProvider): void {
  const patch =
    purpose === 'review'
      ? { reviewProvider: provider, reviewModel: suggestedModel(provider) }
      : { researchProvider: provider, researchModel: suggestedModel(provider) }
  void app.updateSettings({ ai: patch }).then(loadAccess)
}

function setModel(purpose: 'review' | 'research', model: string): void {
  void app.updateSettings({ ai: purpose === 'review' ? { reviewModel: model } : { researchModel: model } }).then(loadAccess)
}

function setPreferOwnKeys(value: boolean): void {
  void app.updateSettings({ ai: { preferOwnKeys: value } }).then(loadAccess)
}

watch(() => app.account.account?.plan, () => void loadAccess())
onMounted(() => {
  void loadAccess()
  void loadClaudeModels()
})
</script>

<template>
  <div class="section-stack">
    <div class="modes">
      <section class="mode" :class="{ 'mode--active': usingSubscription }" aria-labelledby="mode-pro">
        <div class="mode__icon" aria-hidden="true"><Sparkles :size="16" /></div>
        <h3 id="mode-pro" class="mode__title">Com a assinatura</h3>
        <p class="mode__text">O Pregar cuida das chaves. O texto passa pelo servidor do Pregar só para a revisão e não fica guardado lá.</p>
        <span v-if="usingSubscription" class="mode__state">Em uso</span>
        <RouterLink v-else-if="!proAvailable" class="mode__link" to="/preferencias/conta" replace>Assinar o Pregar</RouterLink>
        <span v-else class="mode__state mode__state--off">Disponível na sua conta</span>
      </section>
      <section class="mode" :class="{ 'mode--active': !usingSubscription && anyKey }" aria-labelledby="mode-byok">
        <div class="mode__icon" aria-hidden="true"><UserRound :size="16" /></div>
        <h3 id="mode-byok" class="mode__title">Com suas chaves (grátis)</h3>
        <p class="mode__text">
          Você cria uma chave num provedor e paga a ele direto pelo uso. O texto vai do seu computador ao provedor, sem passar pelo Pregar.
        </p>
        <template v-if="!usingSubscription">
          <span v-if="anyKey" class="mode__state">Em uso</span>
          <span v-else class="mode__state mode__state--off">Falta salvar uma chave abaixo</span>
        </template>
      </section>
    </div>

    <Toggle
      v-if="proAvailable"
      class="prefer-own"
      :model-value="ai.preferOwnKeys"
      label="Usar minhas chaves mesmo com a assinatura"
      description="A revisão, a pesquisa e as leituras passam a usar as chaves salvas aqui e na seção Estêvão API, e não contam no uso da assinatura."
      @update:model-value="setPreferOwnKeys"
    />

    <PrefGroup label="Como a IA será chamada agora">
      <ul class="summary">
        <li v-for="item in summary" :key="item.purpose" class="summary__item">
          <span class="summary__title">{{ item.title }}</span>
          <span class="summary__label" :class="`summary__label--${item.mode}`">{{ item.label }}</span>
          <span class="summary__message">{{ item.message }}</span>
        </li>
      </ul>
    </PrefGroup>

    <PrefGroup label="Suas chaves de API">
      <div v-for="provider in AI_PROVIDERS" :key="provider" class="key-row">
        <div class="key-row__info">
          <span class="key-row__name">{{ providerName(provider) }}</span>
          <span class="key-row__status" :class="{ 'key-row__status--saved': hasKey(provider) }">
            <KeyRound :size="12" aria-hidden="true" />{{ hasKey(provider) ? 'Chave salva neste computador' : 'Sem chave' }}
          </span>
          <span class="key-row__note">{{ PROVIDER_NOTES[provider] }}</span>
        </div>
        <form class="key-row__form" @submit.prevent="saveKey(provider)">
          <input
            v-model="drafts[provider]"
            class="field"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :placeholder="hasKey(provider) ? 'Cole uma nova chave para trocar' : 'Cole a chave da API'"
            :aria-label="`Chave de API do ${providerName(provider)}`"
          />
          <PButton type="submit" compact :disabled="!drafts[provider].trim()" :busy="busy === provider && Boolean(drafts[provider])">Salvar</PButton>
          <PButton
            v-if="hasKey(provider)"
            variant="icon"
            compact
            :label="`Remover chave de ${providerName(provider)}`"
            :disabled="busy === provider"
            @click="removeKey(provider)"
          >
            <Trash2 :size="14" />
          </PButton>
        </form>
        <div class="key-row__meta">
          <PButton variant="link" compact @click="openExternal(KEY_PAGES[provider])">Criar chave <ExternalLink :size="11" aria-hidden="true" /></PButton>
          <span v-if="feedback[provider]" class="key-row__feedback" :class="`key-row__feedback--${feedback[provider]?.tone}`" role="status">
            {{ feedback[provider]?.text }}
          </span>
        </div>
      </div>
    </PrefGroup>
    <Notice v-if="vaultMissing" tone="warning" title="Cofre de senhas indisponível">
      O Pregar guarda chaves no cofre de senhas do sistema. Instale o gnome-keyring (ou o KWallet) e abra o Pregar de novo.
    </Notice>

    <PrefGroup label="Revisão e pesquisa">
      <PrefRow label="Provedor de revisão" for="review-provider">
        <select id="review-provider" class="field select" :value="ai.reviewProvider" @change="setProvider('review', ($event.target as HTMLSelectElement).value as AIProvider)">
          <option v-for="provider in AI_PROVIDERS" :key="provider" :value="provider">{{ providerName(provider) }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Modelo de revisão" for="review-model">
        <select id="review-model" class="field select select--wide" :value="ai.reviewModel" @change="setModel('review', ($event.target as HTMLSelectElement).value)">
          <option v-for="model in reviewModels" :key="model.id" :value="model.id">{{ model.displayName }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Pesquisa de materiais" for="research-provider">
        <select
          id="research-provider"
          class="field select"
          :value="ai.researchProvider"
          @change="setProvider('research', ($event.target as HTMLSelectElement).value as AIProvider)"
        >
          <option v-for="provider in AI_PROVIDERS" :key="provider" :value="provider">{{ providerName(provider) }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Modelo de pesquisa" for="research-model">
        <select id="research-model" class="field select select--wide" :value="ai.researchModel" @change="setModel('research', ($event.target as HTMLSelectElement).value)">
          <option v-for="model in researchModels" :key="model.id" :value="model.id">{{ model.displayName }}</option>
        </select>
      </PrefRow>
    </PrefGroup>
    <p v-if="usingSubscription" class="help">Com a assinatura, o servidor escolhe o modelo. Estas escolhas valem quando você usa as suas chaves.</p>

    <div class="claude">
      <div class="claude__head">
        <span class="claude__title">Modelos do Claude</span>
        <Spinner v-if="claudeLoading" :size="13" />
        <span class="spacer" />
        <PButton compact :disabled="!hasKey('anthropic') || claudeLoading" @click="loadClaudeModels">
          <RefreshCw :size="12" aria-hidden="true" />Atualizar modelos
        </PButton>
      </div>
      <p class="help" :class="{ 'help--warning': claudeError }">
        {{
          claudeError ??
          (hasKey('anthropic')
            ? 'A lista é consultada na sua conta ao abrir esta seção e ao salvar a chave. Novos modelos aparecem automaticamente.'
            : 'Salve a chave do Claude para consultar todos os modelos disponíveis na sua conta.')
        }}
      </p>
    </div>

    <p class="help">
      A revisão deve apontar problemas sem reescrever o sermão nem propor interpretações ou aplicações. A revisão Perplexity usa a Agent API com
      resposta estruturada. Sonar é o modelo; não é o endpoint. A pesquisa envia apenas passagem e ocasião, nunca o manuscrito.
    </p>
  </div>
</template>

<style scoped>
.modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.mode {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
}
.mode--active {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}
.mode__icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-button);
  color: var(--accent);
  background: var(--accent-soft);
}
.mode__title {
  margin: 4px 0 0;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}
.mode__text {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.mode__state {
  margin-top: auto;
  padding-top: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent);
}
.mode__state--off {
  color: var(--muted);
}
.mode__link {
  margin-top: auto;
  padding-top: 4px;
  font-size: 12px;
  font-weight: 600;
}
.prefer-own {
  padding: 12px 16px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
}
.summary {
  list-style: none;
  margin: 0;
  padding: 0;
}
.summary__item {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 20px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.summary__item:last-child {
  border-bottom: none;
}
.summary__title {
  grid-row: span 2;
  font-size: 13px;
  color: var(--muted);
}
.summary__label {
  font-size: 13px;
  font-weight: 600;
}
.summary__label--pro {
  color: var(--accent);
}
.summary__label--none {
  color: var(--warning);
}
.summary__message {
  font-size: 12px;
  color: var(--muted);
}
.key-row {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  grid-template-areas:
    'info form'
    'info meta';
  column-gap: 16px;
  row-gap: 2px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.key-row:last-child {
  border-bottom: none;
}
.key-row__info {
  grid-area: info;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.key-row__name {
  font-size: 14px;
  font-weight: 500;
}
.key-row__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
}
.key-row__status--saved {
  color: var(--accent);
}
.key-row__note {
  font-size: 11px;
  color: var(--muted);
}
.key-row__form {
  grid-area: form;
  display: flex;
  gap: 6px;
  align-items: center;
}
.key-row__form .field {
  flex: 1;
  min-width: 0;
}
.key-row__meta {
  grid-area: meta;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: -6px;
}
.key-row__feedback {
  font-size: 11px;
}
.key-row__feedback--success {
  color: var(--success);
}
.key-row__feedback--error {
  color: var(--danger);
}
.select {
  min-width: 220px;
  height: 30px;
}
.select--wide {
  min-width: 300px;
  max-width: 100%;
}
.claude {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.claude__head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.claude__title {
  font-size: 13px;
  font-weight: 500;
}
.help {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.help--warning {
  color: var(--warning);
}
@media (max-width: 760px) {
  .modes {
    grid-template-columns: 1fr;
  }
  .key-row {
    grid-template-columns: 1fr;
    grid-template-areas: 'info' 'form' 'meta';
    row-gap: 8px;
  }
}
</style>
