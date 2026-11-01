<script setup lang="ts">
/**
 * Histórico deste sermão (porte de `SermonHistorySheet` e da comparação lado a lado). Restaurar
 * guarda antes a edição em curso e cria uma versão nova; nada se perde.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { ArrowLeft, ArrowLeftRight, History, PencilLine, Undo2 } from 'lucide-vue-next'
import {
  HISTORY_TEXT,
  comparisonColumns,
  createRevisionSnapshot,
  currentVersionNumber,
  historyMessages,
  previousRevisions,
  versionLabel,
  wordCountLabel,
} from '@pregar/core/history'
import type { SermonRevision } from '@pregar/core/history'
import EmptyState from '@/components/EmptyState.vue'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { currentManuscript } from '../panels/manuscript'
import { shortDateTime } from '../panels/materials'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()
const toasts = useToasts()

const revisions = shallowRef<SermonRevision[]>(mesa.revisions)
const loading = ref(true)
const failure = ref<string | null>(null)
const comparing = shallowRef<SermonRevision | null>(null)
const restoringId = ref<string | null>(null)
const currentText = ref('')

const current = computed(() =>
  createRevisionSnapshot({
    title: mesa.record?.title ?? '',
    mainReadingReference: mesa.record?.mainReadingReference ?? null,
    mainReadingSlot: mesa.record?.mainReadingSlot ?? null,
    content: mesa.record?.doc ? { format: 'tiptap-json', data: mesa.record.doc } : null,
    plainText: currentText.value,
  }),
)
const currentVersion = computed(() => currentVersionNumber(revisions.value, current.value))
const previous = computed(() => previousRevisions(revisions.value, current.value))
const columns = computed(() =>
  comparing.value ? comparisonColumns(current.value, currentVersion.value, comparing.value) : null,
)

async function load(): Promise<void> {
  loading.value = true
  try {
    await mesa.flush()
    currentText.value = currentManuscript(mesa)
    const list = await invoke('history:list', { dateKey: mesa.selectedDateKey })
    revisions.value = list
    mesa.revisions = list
  } catch (error) {
    failure.value = historyMessages.openFailed(error)
  } finally {
    loading.value = false
  }
}

async function restore(revision: SermonRevision): Promise<void> {
  if (restoringId.value) return
  restoringId.value = revision.id
  failure.value = null
  try {
    // A edição em curso vai junto e é guardada como "Antes da restauração".
    await mesa.flush()
    const record = mesa.record
    const snapshot = mesa.snapshotInput() ?? {
      title: record?.title ?? '',
      mainReadingReference: record?.mainReadingReference ?? null,
      mainReadingSlot: record?.mainReadingSlot ?? null,
      doc: '',
      plainText: '',
    }
    const result = await invoke('history:restore', {
      dateKey: mesa.selectedDateKey,
      revisionId: revision.id,
      current: snapshot,
    })
    revisions.value = result.revisions
    mesa.revisions = result.revisions
    mesa.historyDirty = false
    const docChanged = mesa.record?.doc !== result.record.doc
    mesa.record = result.record
    mesa.wordCount = result.record.wordCount
    if (docChanged) mesa.documentRevision += 1
    currentText.value = result.record.plainText
    comparing.value = null
    toasts.show(
      `Versão ${versionLabel(revision.version)} restaurada. A edição anterior ficou guardada no histórico.`,
      'success',
    )
  } catch (error) {
    failure.value = historyMessages.restoreFailed(error)
  } finally {
    restoringId.value = null
  }
}

onMounted(load)
</script>

<template>
  <Sheet
    :width="comparing ? 960 : 720"
    :label="comparing ? HISTORY_TEXT.compareTitle : HISTORY_TEXT.sheetTitle"
    :dismissible="!restoringId"
    @close="emit('close')"
  >
    <div v-if="comparing && columns" class="history">
      <header class="history__header">
        <PButton variant="icon" compact label="Voltar ao histórico" @click="comparing = null"
          ><ArrowLeft :size="15"
        /></PButton>
        <h2 class="serif compare__title">{{ HISTORY_TEXT.compareTitle }}</h2>
        <span class="spacer" />
        <PButton :busy="restoringId === comparing.id" @click="restore(comparing)"
          ><Undo2 :size="13" /> Restaurar {{ versionLabel(comparing.version) }}</PButton
        >
      </header>
      <div class="compare">
        <section
          v-for="(column, index) in columns"
          :key="index"
          class="compare__column"
          :aria-label="column.title"
        >
          <h3 class="compare__heading">{{ column.title }}</h3>
          <div class="scroll compare__text selectable" tabindex="0" :class="{ muted: column.isEmpty }">
            {{ column.text }}
          </div>
        </section>
      </div>
      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
    </div>

    <div v-else class="history">
      <header class="history__header">
        <SheetHeader
          :title="HISTORY_TEXT.sheetTitle"
          :subtitle="HISTORY_TEXT.sheetSubtitle"
          :icon="History"
        />
        <PButton @click="emit('close')">Fechar</PButton>
      </header>

      <div v-if="loading" class="history__loading" role="status"><Spinner /> Abrindo o histórico…</div>
      <ol v-else class="scroll versions" aria-label="Versões deste sermão">
        <li class="version version--current">
          <div class="version__text">
            <p class="version__title">
              <span class="serif version__number">{{ versionLabel(currentVersion) }}</span>
              <span class="version__current">{{ HISTORY_TEXT.currentEdit }}</span>
            </p>
            <p class="version__meta">agora · {{ wordCountLabel(current.wordCount) }}</p>
          </div>
          <PencilLine :size="16" class="version__icon" aria-hidden="true" />
        </li>
        <li v-for="revision in previous" :key="revision.id" class="version">
          <div class="version__text">
            <p class="version__title">
              <span class="serif version__number">{{ versionLabel(revision.version) }}</span>
              <span class="version__summary">{{ revision.summary }}</span>
            </p>
            <p class="version__meta">
              {{ shortDateTime(revision.createdAt) }} · {{ wordCountLabel(revision.wordCount) }}
            </p>
          </div>
          <PButton :disabled="Boolean(restoringId)" @click="comparing = revision"
            ><ArrowLeftRight :size="13" /> {{ HISTORY_TEXT.compare }}</PButton
          >
          <PButton
            :busy="restoringId === revision.id"
            :disabled="Boolean(restoringId) && restoringId !== revision.id"
            @click="restore(revision)"
          >
            <Undo2 :size="13" /> {{ HISTORY_TEXT.restore }}
          </PButton>
        </li>
      </ol>
      <EmptyState
        v-if="!loading && previous.length === 0"
        title="Ainda não há versões anteriores"
        message="Uma versão é guardada depois de alguns segundos sem edição. Restaurar sempre preserva a edição em curso."
      />
      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
    </div>
  </Sheet>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.history__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding-bottom: var(--space-lg);
  border-bottom: 1px solid var(--line);
}
.history__header > :first-child:not(button) {
  flex: 1;
}
.history__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 200px;
  color: var(--muted);
}
.versions {
  max-height: min(520px, calc(100vh - 260px));
  margin: 0;
  padding: 0;
  list-style: none;
}
.version {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.version--current {
  padding: 16px 0;
}
.version__text {
  flex: 1;
  min-width: 0;
}
.version__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  min-width: 0;
}
.version__number {
  font-size: 17px;
  font-weight: 600;
}
.version__current {
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
}
.version__summary {
  min-width: 0;
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.version__meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.version__icon {
  color: var(--accent);
}
.compare__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  align-self: center;
}
.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--surface);
}
.compare__column + .compare__column {
  border-left: 1px solid var(--line);
}
.compare__heading {
  margin: 0;
  padding: 14px 18px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}
.compare__text {
  height: min(520px, calc(100vh - 300px));
  padding: 18px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.failure {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}
</style>
