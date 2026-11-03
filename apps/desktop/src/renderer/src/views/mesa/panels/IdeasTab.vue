<script setup lang="ts">
/**
 * Aba Ideias: caixa de captura rápida, ideias desta preparação e soltas, inserir no manuscrito,
 * marcar como usada e apagar. Tudo fica no banco local; o documento de ideias do Google Drive
 * é opcional e aparece recolhido no fim.
 */
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { Check, Cloud, ExternalLink, FilePlus, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-vue-next'
import type { Idea, IdeaSource } from '@shared/ipc-ideas'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
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
  refreshIdeas,
} from './driveState'
import { shortDate } from './materials'

type Filter = 'this' | 'all' | 'done'

const mesa = useMesaStore()
const toasts = useToasts()

const SOURCE_LABELS: Record<IdeaSource, string> = {
  local: 'anotada na Mesa',
  drive: 'do Google Drive',
  reading: 'de uma leitura',
  material: 'de um material',
  bible: 'da Bíblia',
  reader: 'do Leitor',
}
const FILTERS: { value: Filter; label: string; title: string }[] = [
  { value: 'this', label: 'Desta preparação', title: 'Ideias ligadas a este dia e as soltas' },
  { value: 'all', label: 'Todas', title: 'Todas as ideias guardadas, de qualquer dia' },
  { value: 'done', label: 'Usadas', title: 'Ideias já inseridas no manuscrito ou descartadas' },
]

const draft = ref('')
const filter = ref<Filter>('this')
const saving = ref(false)
const box = ref<HTMLTextAreaElement | null>(null)
const allIdeas = ref<Idea[]>([])
const allLoading = ref(false)
const driveOpen = ref(false)
const visible = computed(() => mesa.contextTab === 'ideas')

const list = computed<Idea[]>(() => {
  if (filter.value === 'this') return mesa.ideas.filter((idea) => !idea.done)
  if (filter.value === 'done')
    return [...mesa.ideas, ...allIdeas.value].filter(
      (idea, index, array) => idea.done && array.findIndex((item) => item.id === idea.id) === index,
    )
  return allIdeas.value.filter((idea) => !idea.done)
})
const count = computed(() => mesa.ideas.filter((idea) => !idea.done).length)
const connected = computed(() => Boolean(driveStatus.value?.connected))
const hasDocument = computed(() => Boolean(ideasDocumentURL.value || driveStatus.value?.ideasDocumentURL))

async function loadAll(): Promise<void> {
  allLoading.value = true
  try {
    allIdeas.value = await invoke('ideas:list', { includeDone: true })
  } catch {
    allIdeas.value = []
  } finally {
    allLoading.value = false
  }
}

watch(filter, (value) => {
  if (value !== 'this') void loadAll()
})

async function save(): Promise<void> {
  const text = draft.value.trim()
  if (!text || saving.value) return
  saving.value = true
  try {
    await mesa.addIdea({ text, source: 'local' })
    draft.value = ''
    if (filter.value !== 'this') void loadAll()
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  } finally {
    saving.value = false
  }
}

function onBoxKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void save()
  }
}

async function insert(idea: Idea): Promise<void> {
  if (!activeEditor.value) {
    toasts.show('Abra o manuscrito para inserir a ideia.', 'error')
    return
  }
  insertTextAtCursor(idea.text)
  await mesa.updateIdea(idea.id, { done: true }).catch(() => undefined)
  toasts.show('Ideia inserida no manuscrito e marcada como usada.', 'success')
}

async function toggleDone(idea: Idea): Promise<void> {
  try {
    await mesa.updateIdea(idea.id, { done: !idea.done })
    if (filter.value !== 'this') void loadAll()
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function remove(idea: Idea): Promise<void> {
  try {
    await mesa.deleteIdea(idea.id)
    allIdeas.value = allIdeas.value.filter((item) => item.id !== idea.id)
    toasts.show('Ideia apagada.', 'info')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function adopt(idea: Idea): Promise<void> {
  try {
    await mesa.updateIdea(idea.id, { dateKey: mesa.selectedDateKey })
    void mesa.loadIdeas()
    toasts.show('Ideia ligada a esta preparação.', 'success')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

function metaLine(idea: Idea): string {
  const parts = [SOURCE_LABELS[idea.source], shortDate(idea.createdAt)]
  if (idea.sourceTitle) parts.splice(1, 0, idea.sourceTitle)
  if (idea.reference) parts.splice(1, 0, idea.reference)
  if (filter.value !== 'this' && idea.dateKey && idea.dateKey !== mesa.selectedDateKey)
    parts.push(`preparação de ${shortDate(idea.dateKey)}`)
  if (!idea.dateKey) parts.push('solta')
  return parts.filter(Boolean).join(' · ')
}

/** Guarda as notas do Google Doc como ideias locais (sem repetir texto já guardado). */
async function importFromDrive(): Promise<void> {
  await refreshIdeas()
  const known = new Set([...mesa.ideas, ...allIdeas.value].map((idea) => idea.text.trim()))
  let added = 0
  for (const note of ideaNotes.value) {
    const text = note.text.trim()
    if (!text || known.has(text)) continue
    await mesa.addIdea({ text, source: 'drive', sourceTitle: 'Documento de ideias' }).catch(() => undefined)
    known.add(text)
    added += 1
  }
  toasts.show(
    added === 0
      ? 'Nenhuma ideia nova no documento do Drive.'
      : `${added} ${added === 1 ? 'ideia trazida' : 'ideias trazidas'} do Drive.`,
    'success',
  )
}

function openDocument(): void {
  const url = ideasDocumentURL.value ?? driveStatus.value?.ideasDocumentURL
  if (url) void invoke('app:openExternal', { url })
}

function focusBox(): void {
  void nextTick(() => box.value?.focus())
}

watch(() => mesa.ideaCaptureRequest, focusBox)
watch(visible, (value) => {
  if (value && driveOpen.value) void ensureDriveStatus()
})
watch(driveOpen, (value) => {
  if (value) void ensureDriveStatus()
})
onMounted(() => {
  if (mesa.ideas.length === 0) void mesa.loadIdeas()
})
onActivated(() => {
  if (mesa.ideaCaptureRequest > 0) focusBox()
})
</script>

<template>
  <div class="ideas">
    <header class="ideas__header">
      <h2 class="serif ideas__title">Ideias</h2>
      <span class="ideas__count">{{
        count === 0 ? 'nenhuma nesta preparação' : `${count} nesta preparação`
      }}</span>
    </header>

    <form class="capture" @submit.prevent="save">
      <label class="visually-hidden" for="idea-box">Nova ideia</label>
      <textarea
        id="idea-box"
        ref="box"
        v-model="draft"
        class="field capture__box"
        rows="2"
        placeholder="Uma frase, uma imagem, um verso que voltou… Enter guarda; Shift+Enter quebra a linha."
        @keydown="onBoxKeydown"
      />
      <div class="capture__row">
        <span class="capture__hint">Fica neste computador, ligada a {{ mesa.occasion ?? 'este dia' }}.</span>
        <span class="spacer" />
        <PButton variant="primary" compact type="submit" :busy="saving" :disabled="!draft.trim()"
          ><Plus :size="13" /> Guardar</PButton
        >
      </div>
    </form>

    <div class="ideas__filters" role="group" aria-label="Quais ideias mostrar">
      <button
        v-for="option in FILTERS"
        :key="option.value"
        type="button"
        class="chip"
        :class="{ 'chip--active': filter === option.value }"
        :aria-pressed="filter === option.value"
        :title="option.title"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <p
      v-if="(filter === 'this' && mesa.ideasLoading) || (filter !== 'this' && allLoading)"
      class="ideas__muted ideas__row"
      role="status"
    >
      <Spinner :size="12" /> Carregando ideias…
    </p>
    <p v-else-if="list.length === 0" class="ideas__muted">
      {{
        filter === 'this'
          ? 'Nenhuma ideia guardada para esta preparação. Anote a primeira acima.'
          : filter === 'done'
            ? 'Nenhuma ideia usada ainda.'
            : 'Nenhuma ideia guardada.'
      }}
    </p>
    <ul v-else class="ideas__list" role="list" aria-label="Ideias guardadas">
      <li v-for="idea in list" :key="idea.id" class="idea" :class="{ 'idea--done': idea.done }">
        <p class="idea__text selectable">{{ idea.text }}</p>
        <p class="idea__meta">{{ metaLine(idea) }}</p>
        <div class="idea__actions">
          <PButton
            v-if="!idea.done"
            variant="link"
            compact
            title="Inserir esta ideia no manuscrito, na posição do cursor"
            @click="insert(idea)"
            ><Plus :size="13" /> Inserir no manuscrito</PButton
          >
          <PButton
            v-if="!idea.done && idea.dateKey !== mesa.selectedDateKey"
            variant="link"
            compact
            title="Ligar esta ideia à preparação aberta"
            @click="adopt(idea)"
            >Trazer para este dia</PButton
          >
          <span class="spacer" />
          <PButton
            variant="icon"
            compact
            :label="idea.done ? 'Voltar para as ideias abertas' : 'Marcar como usada'"
            @click="toggleDone(idea)"
          >
            <RotateCcw v-if="idea.done" :size="13" /><Check v-else :size="13" />
          </PButton>
          <PButton variant="icon" compact label="Apagar ideia" @click="remove(idea)"
            ><Trash2 :size="13"
          /></PButton>
        </div>
      </li>
    </ul>

    <details class="drive" :open="driveOpen" @toggle="driveOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="drive__summary">
        <Cloud :size="13" aria-hidden="true" /> Ideias anotadas pelo celular (Google Drive)
      </summary>
      <div class="drive__body">
        <p v-if="driveStatusLoading && !driveStatus" class="ideas__muted ideas__row" role="status">
          <Spinner :size="12" /> Verificando Google Drive…
        </p>
        <p v-else-if="driveStatus && !driveStatus.available" class="ideas__muted">
          {{ driveStatus.message }}
        </p>
        <template v-else-if="!connected">
          <p class="ideas__muted">
            Conecte o Google Drive para anotar ideias pelo celular num documento separado e trazê-las para cá.
          </p>
          <PButton compact @click="mesa.openSheet('drive')"
            ><Cloud :size="13" /> Conectar Google Drive</PButton
          >
        </template>
        <template v-else-if="!hasDocument">
          <p class="ideas__muted">Crie um Google Doc independente para continuar anotando pelo celular.</p>
          <PButton compact :busy="ideasLoading" @click="refreshIdeas({ create: true })"
            ><FilePlus :size="13" /> Criar documento de ideias</PButton
          >
        </template>
        <template v-else>
          <div class="ideas__row">
            <PButton
              compact
              :busy="ideasLoading"
              title="Lê o documento e guarda como ideias locais o que ainda não estiver aqui"
              @click="importFromDrive"
              ><RefreshCw :size="13" /> Trazer do Drive</PButton
            >
            <PButton
              variant="link"
              compact
              title="Abre o documento de ideias no navegador"
              @click="openDocument"
              ><ExternalLink :size="13" /> Abrir no Google Docs</PButton
            >
          </div>
        </template>
        <p v-if="ideasError" class="ideas__warning" role="alert">{{ ideasError }}</p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.ideas {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.ideas__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ideas__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.ideas__count {
  font-size: var(--text-xs);
  color: var(--muted);
}
.capture {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.capture__box {
  width: 100%;
  min-height: 56px;
  font-size: var(--text-md);
  line-height: 1.45;
  resize: vertical;
}
.capture__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.capture__hint {
  font-size: var(--text-xs);
  color: var(--muted);
}
.ideas__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ideas__muted {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--muted);
}
.ideas__row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.ideas__warning {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--warning-ink);
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
  border-radius: var(--radius-button);
  background: var(--surface);
}
.idea--done {
  opacity: 0.7;
}
.idea--done .idea__text {
  text-decoration: line-through;
  text-decoration-color: var(--muted);
}
.idea__text {
  margin: 0;
  font-size: var(--text-md);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.idea__meta {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.idea__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 2px 0 0 -6px;
  flex-wrap: wrap;
}
.drive {
  margin-top: 4px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
.drive__summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--muted);
  list-style: none;
}
.drive__summary::-webkit-details-marker {
  display: none;
}
.drive__summary::before {
  content: '▸';
  font-size: var(--text-xs);
}
.drive[open] .drive__summary::before {
  content: '▾';
}
.drive__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0 0;
}
</style>
