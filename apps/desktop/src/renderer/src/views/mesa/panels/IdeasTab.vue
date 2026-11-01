<script setup lang="ts">
/**
 * Aba Ideias: notas do Google Doc de ideias (anotado pelo celular). Atualiza ao entrar na aba;
 * cada nota pode ser inserida no cursor do manuscrito sem sair do documento de ideias.
 */
import { computed, watch } from 'vue'
import { Cloud, ExternalLink, FilePlus, Plus, RefreshCw } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke } from '@/lib/api'
import { activeEditor, insertTextAtCursor } from '@/lib/editorBridge'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import {
  driveStatus,
  driveStatusLoading,
  ensureDriveStatus,
  ideaNotes,
  ideasDocumentURL,
  ideasError,
  ideasLoading,
  ideasUpdatedAt,
  refreshIdeas,
} from './driveState'
import { shortTime } from './materials'

const mesa = useMesaStore()
const toasts = useToasts()

const visible = computed(() => mesa.contextTab === 'ideas')
const connected = computed(() => Boolean(driveStatus.value?.connected))
const hasDocument = computed(() => Boolean(ideasDocumentURL.value || driveStatus.value?.ideasDocumentURL))

// Atualiza ao entrar na aba, ao conectar e quando o documento passa a existir.
watch(
  () => [visible.value, connected.value, hasDocument.value] as const,
  ([isVisible, isConnected, exists]) => {
    if (isVisible) void ensureDriveStatus()
    if (isVisible && isConnected && exists) void refreshIdeas()
  },
  { immediate: true },
)

function insert(text: string): void {
  if (!activeEditor.value) {
    toasts.show('Abra o manuscrito para inserir a ideia.', 'error')
    return
  }
  insertTextAtCursor(text)
  toasts.show('Ideia inserida no manuscrito. O documento de ideias não muda.', 'success')
}

function openDocument(): void {
  const url = ideasDocumentURL.value ?? driveStatus.value?.ideasDocumentURL
  if (url) void invoke('app:openExternal', { url })
}
</script>

<template>
  <div class="ideas">
    <h2 class="serif ideas__title">Ideias do celular</h2>

    <p v-if="driveStatusLoading && !driveStatus" class="ideas__muted ideas__row" role="status">
      <Spinner :size="12" /> Verificando Google Drive…
    </p>

    <template v-else-if="driveStatus && !driveStatus.available">
      <p class="ideas__muted">{{ driveStatus.message }}</p>
    </template>

    <template v-else-if="!connected">
      <p class="ideas__muted">Conecte o Google Drive para usar seu documento separado de ideias.</p>
      <PButton variant="primary" compact class="ideas__start" @click="mesa.openSheet('drive')"
        ><Cloud :size="13" /> Conectar Google Drive</PButton
      >
    </template>

    <template v-else-if="!hasDocument">
      <p class="ideas__muted">Crie um Google Doc independente para continuar anotando pelo celular.</p>
      <div class="ideas__row">
        <PButton variant="primary" compact :busy="ideasLoading" @click="refreshIdeas({ create: true })"
          ><FilePlus :size="13" /> Criar documento de ideias</PButton
        >
      </div>
    </template>

    <template v-else>
      <div class="ideas__row">
        <PButton variant="link" compact title="Abre o documento de ideias no navegador" @click="openDocument"
          ><ExternalLink :size="13" /> Abrir no Google Docs</PButton
        >
        <PButton
          variant="icon"
          compact
          label="Atualizar ideias"
          title="Atualizar ideias do Google Drive"
          :disabled="ideasLoading"
          @click="refreshIdeas()"
        >
          <RefreshCw :size="13" />
        </PButton>
        <Spinner v-if="ideasLoading" :size="12" label="Atualizando ideias" />
      </div>
      <p class="ideas__meta">
        {{ ideasUpdatedAt ? `Atualizado ${shortTime(ideasUpdatedAt)}` : 'Documento de ideias' }}
      </p>
      <p v-if="ideaNotes.length === 0 && !ideasLoading" class="ideas__muted">Nenhuma ideia anotada ainda.</p>
      <ul v-else class="ideas__list" role="list" aria-label="Ideias anotadas">
        <li v-for="note in ideaNotes" :key="note.id" class="idea">
          <p class="idea__text selectable">{{ note.text }}</p>
          <div class="idea__actions">
            <PButton
              variant="link"
              compact
              title="Inserir esta ideia no manuscrito, na posição do cursor"
              @click="insert(note.text)"
            >
              <Plus :size="13" /> Inserir no manuscrito
            </PButton>
          </div>
        </li>
      </ul>
    </template>

    <p v-if="ideasError" class="ideas__warning" role="alert">{{ ideasError }}</p>
  </div>
</template>

<style scoped>
.ideas {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.ideas__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.ideas__muted {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.ideas__meta {
  margin: -6px 0 0;
  font-size: 10px;
  color: var(--muted);
}
.ideas__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.ideas__start {
  align-self: flex-start;
}
.ideas__warning {
  margin: 0;
  font-size: 11px;
  color: var(--warning);
}
.ideas__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.idea {
  padding: 10px 10px 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.idea__text {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
}
.idea__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
