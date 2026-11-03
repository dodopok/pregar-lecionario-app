<script setup lang="ts">
/** Google Drive: estado da conexão, conectar e desconectar, com a explicação da permissão drive.file. */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleCheck, Cloud, CloudOff, ExternalLink, ShieldCheck } from 'lucide-vue-next'
import type { DriveStatus } from '@shared/ipc-content'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke, on } from '@/lib/api'
import PrefGroup from './ui/PrefGroup.vue'
import Notice from './ui/Notice.vue'
import { openExternal } from './composables'
import { isNotImplemented } from './format'

const status = ref<DriveStatus | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const unavailable = ref(false)
let unsubscribe: (() => void) | null = null

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    status.value = await invoke('drive:status')
  } catch (caught) {
    if (isNotImplemented(caught)) unavailable.value = true
    else error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function connect(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    status.value = await invoke('drive:connect')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function disconnect(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    status.value = await invoke('drive:disconnect')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  unsubscribe = on('drive:status', (next) => (status.value = next))
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="section-stack">
    <p class="lead">
      Conecte o Google Drive para salvar o sermão como Google Doc, enviar a cópia do tablet e manter um documento de ideias. É opcional: sem o
      Drive, tudo fica neste computador.
    </p>

    <PrefGroup>
      <div class="drive">
        <div class="drive__icon" :class="{ 'drive__icon--on': status?.connected }" aria-hidden="true">
          <component :is="status?.connected ? Cloud : CloudOff" :size="20" />
        </div>
        <div class="drive__text">
          <span class="drive__title">
            <template v-if="loading">Verificando a conexão…</template>
            <template v-else-if="unavailable || (status && !status.available)">Google Drive indisponível nesta versão</template>
            <template v-else-if="status?.connected">Conectado ao Google Drive</template>
            <template v-else>Não conectado</template>
          </span>
          <span class="drive__message">
            <template v-if="unavailable">A conexão com o Google Drive chega numa próxima atualização do Proper.</template>
            <template v-else>{{ status?.message || (status?.available ? '' : 'O Google Drive não está configurado nesta instalação do Proper.') }}</template>
          </span>
          <PButton v-if="status?.ideasDocumentURL" variant="link" compact class="drive__link" @click="openExternal(status.ideasDocumentURL)">
            Abrir o documento de ideias <ExternalLink :size="11" aria-hidden="true" />
          </PButton>
        </div>
        <div class="drive__actions">
          <Spinner v-if="loading" :size="14" />
          <template v-else-if="status?.available">
            <PButton v-if="status.connected" :busy="busy" @click="disconnect">Desconectar</PButton>
            <PButton v-else variant="primary" :busy="busy" @click="connect">Conectar ao Google Drive</PButton>
          </template>
        </div>
      </div>
    </PrefGroup>

    <p v-if="busy && !status?.connected" class="help" role="status">
      O navegador vai abrir a página do Google. Escolha a sua conta, autorize o Proper e volte para cá.
    </p>
    <Notice v-if="error" tone="error">{{ error }}</Notice>

    <PrefGroup label="O que o Proper pode ver">
      <ul class="facts">
        <li><ShieldCheck :size="15" aria-hidden="true" />O Proper só vê os arquivos que ele mesmo criou no seu Drive (permissão “drive.file” do Google).</li>
        <li><ShieldCheck :size="15" aria-hidden="true" />Ele não lê, não lista e não apaga os outros arquivos do seu Drive.</li>
        <li><CircleCheck :size="15" aria-hidden="true" />Você pode desconectar quando quiser, aqui ou na sua Conta Google.</li>
      </ul>
    </PrefGroup>
  </div>
</template>

<style scoped>
.lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.drive {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
}
.drive__icon {
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.drive__icon--on {
  color: var(--accent);
  background: var(--accent-soft);
}
.drive__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.drive__title {
  font-size: 14px;
  font-weight: 600;
}
.drive__message {
  font-size: 12px;
  color: var(--muted);
}
.drive__link {
  margin-left: -6px;
}
.drive__actions {
  flex: none;
}
.facts {
  list-style: none;
  margin: 0;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}
.facts li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.facts svg {
  flex: none;
  margin-top: 1px;
  color: var(--accent);
}
.help {
  margin: -8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
