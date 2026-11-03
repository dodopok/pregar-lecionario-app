<script setup lang="ts">
/** Sobre: versão, atualizações, privacidade e, em Avançado, o endereço da API do Pregar. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Download, ExternalLink, FolderOpen, RefreshCw } from 'lucide-vue-next'
import { PREGAR_API_DEFAULT_URL } from '@pregar/core/plans/contract'
import type { AppInfo } from '@shared/types'
import type { UpdateStatus } from '@shared/ipc'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import Toggle from '@/components/Toggle.vue'
import { errorMessage, invoke, on } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'
import Notice from './ui/Notice.vue'
import LogsSection from './LogsSection.vue'
import { openExternal } from './composables'
import { normalizeApiBaseURL, validateApiBaseURL } from './format'

const PLATFORM_NAMES: Record<AppInfo['platform'], string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

const app = useAppStore()
const toasts = useToasts()
const info = ref<AppInfo | null>(null)
const update = ref<UpdateStatus>({ state: 'idle' })
const checking = ref(false)
const apiDraft = ref(app.settings.apiBaseURL)
const apiError = ref<string | null>(null)
let unsubscribe: (() => void) | null = null

const legalBase = computed(() => (app.account.apiBaseURL || PREGAR_API_DEFAULT_URL).replace(/\/+$/, ''))
const apiChanged = computed(() => normalizeApiBaseURL(apiDraft.value) !== normalizeApiBaseURL(app.settings.apiBaseURL))
const updateText = computed(() => {
  const status = update.value
  switch (status.state) {
    case 'checking':
      return 'Procurando atualizações…'
    case 'available':
      return `A versão ${status.version ?? 'nova'} está disponível e já está sendo baixada.`
    case 'downloading':
      return `Baixando a atualização… ${status.progress ?? 0}%`
    case 'ready':
      return status.message ?? `A versão ${status.version ?? 'nova'} está pronta para instalar.`
    case 'none':
      return status.message ?? 'Você já tem a versão mais recente.'
    case 'error':
    case 'unsupported':
      return status.message ?? 'Não foi possível procurar atualizações.'
    default:
      return app.settings.updates.automatic
        ? 'O Pregar procura atualizações sozinho ao abrir.'
        : 'A busca automática está desligada. Clique para procurar uma versão nova.'
  }
})

async function check(): Promise<void> {
  checking.value = true
  try {
    update.value = await invoke('updates:check')
  } catch (caught) {
    update.value = { state: 'error', message: errorMessage(caught) }
  } finally {
    checking.value = false
  }
}

async function saveApi(): Promise<void> {
  apiError.value = validateApiBaseURL(apiDraft.value)
  if (apiError.value) return
  try {
    await app.updateSettings({ apiBaseURL: normalizeApiBaseURL(apiDraft.value) })
    apiDraft.value = app.settings.apiBaseURL
    toasts.show('Endereço da API salvo. Entre de novo na conta se o servidor for outro.', 'success')
  } catch (caught) {
    apiError.value = errorMessage(caught)
  }
}

async function resetApi(): Promise<void> {
  apiDraft.value = ''
  apiError.value = null
  await app.updateSettings({ apiBaseURL: '' })
  toasts.show('Voltou ao endereço padrão.', 'info')
}

onMounted(async () => {
  unsubscribe = on('updates:status', (status) => (update.value = status))
  info.value = await invoke('app:info').catch(() => null)
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="section-stack">
    <div class="identity">
      <div class="identity__mark" aria-hidden="true">P</div>
      <div>
        <h3 class="identity__name">Pregar</h3>
        <p class="identity__version selectable">
          Versão {{ info?.version ?? '—' }}
          <template v-if="info">· {{ PLATFORM_NAMES[info.platform] }} {{ info.arch }} · Electron {{ info.electron }}</template>
        </p>
        <p class="identity__tagline">Preparação de sermões com o calendário litúrgico. Caminho Anglicano.</p>
      </div>
    </div>

    <PrefGroup label="Atualizações">
      <div class="updates">
        <div class="updates__status" role="status">
          <Spinner v-if="update.state === 'checking' || update.state === 'downloading'" :size="14" />
          <span>{{ updateText }}</span>
        </div>
        <div
          v-if="update.state === 'downloading'"
          class="updates__bar"
          role="progressbar"
          :aria-valuenow="update.progress ?? 0"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Download da atualização"
        >
          <span :style="{ width: `${update.progress ?? 0}%` }" />
        </div>
        <div class="updates__actions">
          <PButton v-if="update.state === 'ready'" variant="primary" @click="invoke('updates:install')">
            <Download :size="14" aria-hidden="true" />Reiniciar e instalar
          </PButton>
          <PButton v-else :busy="checking" :disabled="update.state === 'unsupported'" @click="check">
            <RefreshCw :size="14" aria-hidden="true" />Procurar atualizações
          </PButton>
        </div>
      </div>
      <PrefRow label="Automático">
        <Toggle
          class="wide"
          :model-value="app.settings.updates.automatic"
          label="Procurar e baixar atualizações sozinho"
          description="A nova versão é instalada quando você fechar o Pregar."
          @update:model-value="app.updateSettings({ updates: { automatic: $event } })"
        />
      </PrefRow>
    </PrefGroup>

    <PrefGroup label="Privacidade">
      <div class="links">
        <p class="links__text">
          Seus sermões, a Biblioteca e as preferências ficam neste computador. Com as suas chaves, o texto vai direto ao provedor de IA; com a
          assinatura, passa pelo servidor do Pregar só para a revisão e não fica guardado.
        </p>
        <div class="links__row">
          <PButton variant="link" compact @click="openExternal(`${legalBase}/legal/privacidade`)">Política de privacidade <ExternalLink :size="11" aria-hidden="true" /></PButton>
          <PButton variant="link" compact @click="openExternal(`${legalBase}/legal/termos`)">Termos de uso <ExternalLink :size="11" aria-hidden="true" /></PButton>
          <PButton v-if="info" variant="link" compact @click="invoke('app:showItemInFolder', { path: info.userDataPath })">
            Pasta de dados do Pregar <FolderOpen :size="11" aria-hidden="true" />
          </PButton>
        </div>
      </div>
    </PrefGroup>

    <details class="advanced">
      <summary>Registros para o suporte</summary>
      <div class="advanced__body">
        <LogsSection />
      </div>
    </details>

    <details class="advanced">
      <summary>Avançado</summary>
      <div class="advanced__body">
        <Notice tone="warning" compact>Só mude o endereço se o suporte do Pregar pedir. A conta e a assinatura usam este servidor.</Notice>
        <form class="advanced__form" novalidate @submit.prevent="saveApi">
          <label for="api-base">Endereço da API do Pregar</label>
          <div class="advanced__inline">
            <input
              id="api-base"
              v-model="apiDraft"
              class="field mono"
              spellcheck="false"
              :placeholder="PREGAR_API_DEFAULT_URL"
              :aria-invalid="Boolean(apiError)"
              aria-describedby="api-base-help"
            />
            <PButton type="submit" :disabled="!apiChanged">Salvar</PButton>
            <PButton variant="ghost" :disabled="!app.settings.apiBaseURL" @click="resetApi">Usar o padrão</PButton>
          </div>
          <span v-if="apiError" id="api-base-help" class="advanced__error" role="alert">{{ apiError }}</span>
          <span v-else id="api-base-help" class="advanced__hint">Vazio usa {{ PREGAR_API_DEFAULT_URL }}. Precisa começar com https://.</span>
        </form>
      </div>
    </details>
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  gap: 16px;
  align-items: center;
}
.identity__mark {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
  font-size: 30px;
  font-weight: 600;
  color: var(--accent-contrast);
  background: var(--accent);
}
.identity__name {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
}
.identity__version {
  margin: 2px 0 0;
  font-size: 12px;
}
.identity__tagline {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.updates {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.updates__status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.updates__bar {
  height: 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ink) 9%, transparent);
  overflow: hidden;
}
.updates__bar span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.updates__actions {
  display: flex;
  gap: 8px;
}
.wide {
  width: 100%;
}
.links {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.links__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.links__row {
  display: flex;
  gap: 8px;
  margin-left: -6px;
  flex-wrap: wrap;
}
.advanced summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  padding: 4px 0;
}
.advanced[open] summary {
  margin-bottom: 10px;
}
.advanced__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.advanced__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.advanced__inline {
  display: flex;
  gap: 8px;
}
.advanced__inline .field {
  flex: 1;
  max-width: 380px;
}
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.advanced__error {
  color: var(--danger);
}
.advanced__hint {
  color: var(--muted);
}
</style>
