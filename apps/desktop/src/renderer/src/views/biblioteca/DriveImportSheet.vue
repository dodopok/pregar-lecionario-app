<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { CircleCheck, FileDown, TriangleAlert } from 'lucide-vue-next'
import type { LibraryStatus } from '@shared/ipc-library'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import Toggle from '@/components/Toggle.vue'
import { errorMessage, invoke, on } from '@/lib/api'

/** Importação de PDFs de uma pasta pública do Google Drive ("Qualquer pessoa com o link"). */
const props = defineProps<{ status: LibraryStatus }>()
const emit = defineEmits<{ close: [] }>()

const link = ref('')
const includeSubfolders = ref(true)
const importing = ref(false)
const progress = ref<{ done: number; total: number; current: string } | null>(null)
const result = ref<{ imported: number; failed: { name: string; message: string }[] } | null>(null)
const error = ref<string | null>(null)

const off = on('drive:importProgress', (payload) => {
  if (importing.value) progress.value = payload
})
onBeforeUnmount(off)

const canImport = computed(() => !importing.value && !props.status.indexing && link.value.trim() !== '')
const progressValue = computed(() => (progress.value && progress.value.total > 0 ? progress.value.done / progress.value.total : null))

async function importFolder(): Promise<void> {
  if (!canImport.value) return
  importing.value = true
  error.value = null
  result.value = null
  progress.value = null
  try {
    result.value = await invoke('drive:importFolder', { link: link.value.trim(), includeSubfolders: includeSubfolders.value })
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    importing.value = false
    progress.value = null
  }
}
</script>

<template>
  <Sheet label="Importar PDFs do Drive" :width="590" :dismissible="!importing" @close="emit('close')">
    <form class="drive" @submit.prevent="importFolder">
      <SheetHeader
        title="Importar PDFs do Drive"
        subtitle="Use o link de uma pasta compartilhada como “Qualquer pessoa com o link”."
        :icon="FileDown"
      />
      <div class="drive__form">
        <label class="drive__label" for="drive-link">Link público da pasta</label>
        <input
          id="drive-link"
          v-model="link"
          class="field"
          type="url"
          inputmode="url"
          spellcheck="false"
          autocomplete="off"
          placeholder="https://drive.google.com/drive/folders/…"
          autofocus
          :disabled="importing"
        />
        <Toggle v-model="includeSubfolders" label="Incluir subpastas" :disabled="importing" />
      </div>
      <p class="drive__note">
        Os PDFs são copiados para a pasta de suporte local do Pregar e indexados na Biblioteca; os originais compartilhados não são
        alterados. Importar de novo atualiza os mesmos arquivos, sem cópias duplicadas.
      </p>

      <div v-if="importing" class="drive__progress" role="status" aria-live="polite">
        <progress v-if="progressValue !== null" :value="progressValue" max="1" />
        <Spinner v-else :size="14" label="Importando" />
        <span>{{ progress ? `${progress.done} de ${progress.total} · ${progress.current}` : 'Listando os PDFs da pasta…' }}</span>
      </div>
      <div v-else-if="result" class="drive__result" role="status">
        <p class="drive__success">
          <CircleCheck :size="15" aria-hidden="true" />
          {{ result.imported }} PDF(s) importado(s); indexação iniciada.
        </p>
        <p v-if="result.failed.length" class="drive__warning">{{ result.failed.length }} arquivo(s) não foram baixados.</p>
        <ul v-if="result.failed.length" class="drive__failures">
          <li v-for="failure in result.failed" :key="failure.name">
            <strong>{{ failure.name }}</strong>: {{ failure.message }}
          </li>
        </ul>
        <p v-if="status.indexing" class="drive__indexing">
          <Spinner :size="12" label="Indexando" /> Indexando PDFs na Biblioteca…
        </p>
      </div>
      <p v-if="error" class="drive__error" role="alert">
        <TriangleAlert :size="14" aria-hidden="true" />
        {{ error }}
      </p>

      <footer class="drive__footer">
        <PButton :disabled="importing" @click="emit('close')">Fechar</PButton>
        <PButton variant="primary" type="submit" :disabled="!canImport" :busy="importing">
          <FileDown :size="14" aria-hidden="true" />
          {{ result === null ? 'Importar PDFs' : 'Importar novamente' }}
        </PButton>
      </footer>
    </form>
  </Sheet>
</template>

<style scoped>
.drive {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.drive__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.drive__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.drive__form .field {
  width: 100%;
}
.drive__note {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.drive__progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
}
.drive__progress progress {
  flex: 1;
  accent-color: var(--accent);
}
.drive__progress span {
  flex: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.drive__result p {
  margin: 0 0 6px;
}
.drive__success {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}
.drive__warning {
  font-size: 11px;
  color: var(--warning);
}
.drive__failures {
  margin: 0 0 6px;
  padding-left: 18px;
  max-height: 96px;
  overflow: auto;
  font-size: 11px;
  color: var(--muted);
}
.drive__indexing {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--muted);
}
.drive__error {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  color: var(--danger);
}
.drive__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: 4px;
}
</style>
