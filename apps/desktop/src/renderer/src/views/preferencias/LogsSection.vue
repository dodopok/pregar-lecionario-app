<script setup lang="ts">
/** Registros: últimas linhas do registro das integrações, para copiar e mandar ao suporte. */
import { onMounted, ref } from 'vue'
import { Copy, FolderOpen, RefreshCw, Trash2 } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useToasts } from '@/stores/toasts'
import PrefGroup from './ui/PrefGroup.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import { copyText } from './composables'

const toasts = useToasts()
const path = ref('')
const text = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const viewer = ref<HTMLElement | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await invoke('logs:tail', { lines: 400 })
    path.value = result.path
    text.value = result.text.trimEnd()
    requestAnimationFrame(() => {
      if (viewer.value) viewer.value.scrollTop = viewer.value.scrollHeight
    })
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function copy(): Promise<void> {
  const ok = await copyText(text.value)
  toasts.show(ok ? 'Registro copiado. Cole numa mensagem para o suporte.' : 'Não foi possível copiar o registro.', ok ? 'success' : 'error')
}

async function clear(): Promise<void> {
  try {
    await invoke('logs:clear')
    text.value = ''
    toasts.show('Registro limpo.', 'info')
  } catch (caught) {
    toasts.show(errorMessage(caught), 'error')
  }
}

async function reveal(): Promise<void> {
  await invoke('logs:reveal').catch((caught: unknown) => toasts.show(errorMessage(caught), 'error'))
}

onMounted(refresh)
</script>

<template>
  <div class="section-stack">
    <PrefGroup>
      <div class="intro">
        <p class="intro__lead">
          Cada chamada à Estêvão API, aos provedores de IA, às fontes favoritas, ao Google Drive e ao servidor do Proper vira uma linha: OK ou
          ERRO, com código HTTP, duração e, nas falhas, a resposta do serviço.
        </p>
        <p class="intro__note">
          Chaves e tokens são removidos antes de gravar; o manuscrito nunca é gravado. O arquivo gira em 1 MB e a versão anterior fica ao lado.
        </p>
        <p v-if="path" class="intro__path selectable" :title="path">{{ path }}</p>
        <div class="intro__actions">
          <PButton title="Abre a pasta do arquivo de registro" @click="reveal"><FolderOpen :size="14" aria-hidden="true" />Mostrar na pasta</PButton>
          <PButton :disabled="!text" title="Copia as últimas linhas para colar numa mensagem" @click="copy">
            <Copy :size="14" aria-hidden="true" />Copiar registro
          </PButton>
          <PButton :busy="loading" @click="refresh"><RefreshCw :size="14" aria-hidden="true" />Atualizar</PButton>
          <span class="spacer" />
          <PButton variant="ghost" class="danger-text" :disabled="!text" @click="clear"><Trash2 :size="14" aria-hidden="true" />Limpar</PButton>
        </div>
      </div>
    </PrefGroup>

    <div class="tail">
      <SectionLabel title="Últimas linhas" />
      <pre
        ref="viewer"
        class="tail__view scroll selectable"
        :class="{ 'tail__view--empty': !text }"
        tabindex="0"
        aria-label="Últimas linhas do registro de integrações"
      >{{ error ?? (text || 'Nenhuma chamada registrada ainda.') }}</pre>
    </div>
  </div>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0;
}
.intro__lead {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.intro__note {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.intro__path {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.intro__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.danger-text {
  color: var(--danger);
}
.tail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tail__view {
  margin: 0;
  min-height: 280px;
  max-height: 460px;
  padding: 12px;
  border-radius: var(--radius-card);
  border: 1px solid var(--line);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: text;
}
.tail__view--empty {
  color: var(--muted);
}
</style>
