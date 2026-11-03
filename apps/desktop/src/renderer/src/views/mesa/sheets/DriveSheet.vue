<script setup lang="ts">
/**
 * Conexão com o Google Drive (porte de `GoogleDriveConnectionSheet`): estado, conectar pelo
 * navegador, desconectar, o que o acesso drive.file permite e o vínculo do sermão aberto.
 */
import { computed, onMounted, ref } from 'vue'
import {
  Cloud,
  CloudCheck,
  CloudOff,
  ExternalLink,
  ShieldCheck,
  Tablet,
  TriangleAlert,
} from 'lucide-vue-next'
import { googleDocURL } from '@pregar/core/drive/api'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { driveStatus, ensureDriveStatus, refreshIdeas, setDriveStatus } from '../panels/driveState'
import { shortDateTime } from '../panels/materials'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()
const toasts = useToasts()

const connecting = ref(false)
const disconnecting = ref(false)
const failure = ref<string | null>(null)

const connected = computed(() => Boolean(driveStatus.value?.connected))
const available = computed(() => driveStatus.value?.available ?? true)
const link = computed(() => mesa.record?.drive ?? null)
const subtitle = computed(() =>
  connected.value
    ? 'Conectado neste computador. A cópia do sermão e o documento de ideias ficam na sua conta.'
    : 'Mantém uma cópia do sermão no Drive e lê o documento de ideias anotado pelo celular.',
)

async function connect(): Promise<void> {
  connecting.value = true
  failure.value = null
  try {
    const status = await invoke('drive:connect')
    setDriveStatus(status)
    if (status.connected) {
      toasts.show('Google Drive conectado.', 'success')
      if (status.ideasDocumentURL) void refreshIdeas()
      emit('close')
    } else if (status.message) {
      failure.value = status.message
    }
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    connecting.value = false
  }
}

async function disconnect(): Promise<void> {
  disconnecting.value = true
  failure.value = null
  try {
    setDriveStatus(await invoke('drive:disconnect'))
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    disconnecting.value = false
  }
}

function openDocument(): void {
  if (link.value?.documentId) void invoke('app:openExternal', { url: googleDocURL(link.value.documentId) })
}

function openTablet(): void {
  void app.updateSettings({ tablet: { format: 'gdoc' } })
  mesa.openSheet('pulpit')
}

onMounted(() => void ensureDriveStatus())
</script>

<template>
  <Sheet :width="560" label="Google Drive" :dismissible="!connecting" @close="emit('close')">
    <div class="drive">
      <SheetHeader title="Google Drive" :subtitle="subtitle" :icon="connected ? CloudCheck : Cloud" />

      <p v-if="!driveStatus" class="drive__muted drive__row" role="status">
        <Spinner :size="12" /> Verificando conexão…
      </p>

      <template v-else-if="!available">
        <p class="drive__muted drive__row">
          <CloudOff :size="14" aria-hidden="true" /> {{ driveStatus.message }}
        </p>
      </template>

      <template v-else-if="connected">
        <div class="card drive__account">
          <CloudCheck :size="16" class="drive__ok" aria-hidden="true" />
          <span class="drive__account-text">Google Drive conectado</span>
          <PButton class="drive__disconnect" :busy="disconnecting" @click="disconnect">Desconectar</PButton>
        </div>
        <p class="drive__muted">
          Os documentos ligados continuam identificados nos sermões deste computador. Ao reconectar, use a
          mesma conta Google.
        </p>
      </template>

      <template v-else>
        <p class="drive__muted">
          A autorização abre no navegador padrão e retorna para o Pregar. O token de renovação fica no cofre
          de senhas do sistema.
        </p>
      </template>

      <section v-if="driveStatus && available" class="card drive__scope" aria-label="O que o Pregar acessa">
        <SectionLabel title="O que o Pregar acessa" />
        <p class="drive__scope-text">
          <ShieldCheck :size="14" aria-hidden="true" />
          <span>
            Só o acesso <strong>drive.file</strong>: o Pregar enxerga apenas os documentos que ele mesmo cria
            — a cópia de cada sermão e o documento de ideias. Seus outros arquivos do Drive ficam fora do
            alcance do app.
          </span>
        </p>
      </section>

      <section v-if="connected && mesa.record" class="drive__sermon" aria-label="Este sermão">
        <SectionLabel title="Este sermão" />
        <template v-if="link?.documentId">
          <p class="drive__row drive__muted">
            <CloudCheck :size="14" class="drive__ok" aria-hidden="true" />
            {{
              link.syncedAt
                ? `Ligado a um Google Doc · sincronizado ${shortDateTime(link.syncedAt)}`
                : 'Ligado a um Google Doc.'
            }}
          </p>
          <p v-if="link.syncError" class="drive__warning">
            <TriangleAlert :size="13" aria-hidden="true" /> {{ link.syncError }}
          </p>
          <PButton variant="link" compact class="drive__link" @click="openDocument"
            ><ExternalLink :size="13" /> Abrir no Google Docs</PButton
          >
        </template>
        <template v-else>
          <p class="drive__muted">
            Este sermão ainda não tem cópia no Drive. Depois de criada, ela é atualizada sozinha quando o
            manuscrito muda.
          </p>
          <PButton variant="link" compact class="drive__link" @click="openTablet"
            ><Tablet :size="13" /> Criar o Google Doc pela cópia para o tablet</PButton
          >
        </template>
      </section>

      <p v-if="failure" class="drive__warning" role="alert">
        <TriangleAlert :size="13" aria-hidden="true" /> {{ failure }}
      </p>

      <footer class="drive__footer">
        <span class="spacer" />
        <PButton @click="emit('close')">Fechar</PButton>
        <PButton
          v-if="driveStatus && available && !connected"
          variant="primary"
          :busy="connecting"
          @click="connect"
        >
          <Cloud :size="14" /> Conectar
        </PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.drive {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.drive__muted {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.drive__row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.drive__account {
  display: flex;
  align-items: center;
  gap: 10px;
}
.drive__account-text {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}
.drive__ok {
  flex: none;
  color: var(--accent);
}
.drive__account .drive__disconnect {
  color: var(--danger);
}
.drive__scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.drive__scope-text {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.drive__scope-text svg {
  flex: none;
  margin-top: 1px;
  color: var(--accent);
}
.drive__scope-text strong {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--ink);
}
.drive__sermon {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.drive__link {
  align-self: flex-start;
  margin-left: -6px;
}
.drive__warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--warning);
}
.drive__warning svg {
  flex: none;
  margin-top: 2px;
}
.drive__footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
