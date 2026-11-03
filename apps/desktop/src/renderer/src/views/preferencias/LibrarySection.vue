<script setup lang="ts">
/** Biblioteca: backup completo, restauração com confirmação e importação do Pregar para Mac. */
import { ref } from 'vue'
import { ArchiveRestore, HardDriveDownload, HardDriveUpload, Laptop } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import PrefGroup from './ui/PrefGroup.vue'
import Notice from './ui/Notice.vue'
import ConfirmSheet from './ui/ConfirmSheet.vue'
import { isNotImplemented } from './format'

type Busy = 'create' | 'restore' | 'legacy' | null

const busy = ref<Busy>(null)
const message = ref<{ tone: 'success' | 'error' | 'info'; text: string; path?: string } | null>(null)
const confirmingRestore = ref(false)

function failure(caught: unknown): void {
  message.value = isNotImplemented(caught)
    ? { tone: 'info', text: 'Esta função chega numa próxima atualização do Proper.' }
    : { tone: 'error', text: errorMessage(caught) }
}

async function createBackup(): Promise<void> {
  busy.value = 'create'
  message.value = null
  try {
    const result = await invoke('backup:create')
    if (result) message.value = { tone: 'success', text: `Backup criado em ${result.path}.`, path: result.path }
  } catch (caught) {
    failure(caught)
  } finally {
    busy.value = null
  }
}

async function restore(): Promise<void> {
  confirmingRestore.value = false
  busy.value = 'restore'
  message.value = null
  try {
    const result = await invoke('backup:restore')
    if (result.message) message.value = { tone: result.restored ? 'success' : 'info', text: result.message }
  } catch (caught) {
    failure(caught)
  } finally {
    busy.value = null
  }
}

async function importLegacy(): Promise<void> {
  busy.value = 'legacy'
  message.value = null
  try {
    const result = await invoke('backup:importLegacy')
    if (result.message) message.value = { tone: result.imported ? 'success' : 'info', text: result.message }
  } catch (caught) {
    failure(caught)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="section-stack">
    <PrefGroup label="Dados locais">
      <div class="block">
        <p class="block__lead">Backup completo inclui sermões, versões, PDFs, favoritos e preferências.</p>
        <p class="block__note">Chaves da Estêvão API e de IA, a sessão da sua conta e o acesso ao Google Drive não entram no backup.</p>
        <p class="block__note">A pasta não é criptografada; escolha um local privado para seus sermões e PDFs.</p>
        <div class="block__actions">
          <PButton variant="primary" :busy="busy === 'create'" :disabled="busy !== null && busy !== 'create'" @click="createBackup">
            <HardDriveDownload :size="14" aria-hidden="true" />Criar backup…
          </PButton>
          <PButton :busy="busy === 'restore'" :disabled="busy !== null && busy !== 'restore'" @click="confirmingRestore = true">
            <HardDriveUpload :size="14" aria-hidden="true" />Restaurar…
          </PButton>
        </div>
      </div>
    </PrefGroup>

    <Notice v-if="message" :tone="message.tone">
      {{ message.text }}
      <template v-if="message.path" #actions>
        <PButton compact @click="invoke('app:showItemInFolder', { path: message.path })">Mostrar na pasta</PButton>
      </template>
    </Notice>

    <PrefGroup label="Vindo do Mac">
      <div class="block block--row">
        <Laptop :size="22" class="block__icon" aria-hidden="true" />
        <div class="block__text">
          <p class="block__lead">Importar do Pregar para Mac</p>
          <p class="block__note">
            No app antigo, abra Preferências › Biblioteca › Criar backup… e escolha aqui a pasta criada. Os manuscritos, o histórico de
            versões, a Biblioteca, as abas do Leitor e os favoritos são trazidos para cá. As chaves precisam ser salvas de novo.
          </p>
        </div>
        <PButton :busy="busy === 'legacy'" :disabled="busy !== null && busy !== 'legacy'" @click="importLegacy">Importar…</PButton>
      </div>
    </PrefGroup>

    <ConfirmSheet
      v-if="confirmingRestore"
      title="Substituir os dados locais?"
      message="Os sermões, o histórico, a Biblioteca, as abas do Leitor e as preferências deste computador serão substituídos pelo conteúdo do backup que você escolher. As chaves continuam neste computador e nada será enviado ao Drive."
      confirm-label="Escolher backup e restaurar"
      :icon="ArchiveRestore"
      @confirm="restore"
      @cancel="confirmingRestore = false"
    />
  </div>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 0;
}
.block--row {
  flex-direction: row;
  align-items: center;
  gap: 14px;
}
.block__icon {
  flex: none;
  color: var(--accent);
}
.block__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.block__lead {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}
.block__note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.block__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
