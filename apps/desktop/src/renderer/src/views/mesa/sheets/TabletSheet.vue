<script setup lang="ts">
/**
 * Folha "Preparar para pregar" (porte de `TabletPreparationSheet` e `TabletPDFExporter`): cópia
 * paginada em PDF A4 com a tipografia de leitura, ou o Google Doc do sermão no Drive, com
 * conflito tratado só por escolha explícita. O manuscrito original não muda.
 */
import { computed, onMounted, ref } from 'vue'
import {
  Cloud,
  ExternalLink,
  FileText,
  FolderOpen,
  Minus,
  Plus,
  Tablet,
  TriangleAlert,
} from 'lucide-vue-next'
import { googleDocURL } from '@pregar/core/drive/api'
import { parseDateKey, shortDatePt } from '@pregar/core/util/dates'
import { htmlForPrint } from '@pregar/editor'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Segmented from '@/components/Segmented.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke, isMac } from '@/lib/api'
import { editorRichDocument } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { driveStatus, ensureDriveStatus, setDriveStatus } from '../panels/driveState'
import { currentManuscript, sermonTitle } from '../panels/manuscript'
import { shortDateTime, shortTime } from '../panels/materials'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()
const toasts = useToasts()

const FONT_FAMILIES = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Trebuchet MS',
  'Palatino Linotype',
  'Garamond',
  'Calibri',
  'Cambria',
  'Helvetica',
]
const FONT_SIZE = { min: 8, max: 28 }

const tablet = computed(() => app.settings.tablet)
const fontFamilies = computed(() =>
  FONT_FAMILIES.includes(tablet.value.fontFamily)
    ? FONT_FAMILIES
    : [tablet.value.fontFamily, ...FONT_FAMILIES],
)
const previewText = ref('')
const suggestedFolder = ref<string | null>(null)
const exporting = ref(false)
const connecting = ref(false)
const failure = ref<string | null>(null)
const conflict = ref(false)

const record = computed(() => mesa.record)
const pdfPath = computed(() => record.value?.tabletPdfPath ?? null)
const documentId = computed(() => record.value?.drive.documentId ?? null)
const connected = computed(() => Boolean(driveStatus.value?.connected))
const empty = computed(() => previewText.value.trim().length === 0)
const previewParagraphs = computed(() => previewText.value.split(/\n+/).filter((line) => line.trim()))
const FORMAT_OPTIONS: { value: 'pdf' | 'gdoc'; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'gdoc', label: 'Google Doc' },
]
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const revealLabel = isMac() ? 'Mostrar no Finder' : 'Mostrar na pasta'

function update(patch: Partial<typeof app.settings.tablet>): void {
  void app.updateSettings({ tablet: patch })
}

function stepFont(delta: number): void {
  update({ fontSize: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, tablet.value.fontSize + delta)) })
}

function subtitle(): string {
  const date = parseDateKey(mesa.selectedDateKey)
  return [date ? shortDatePt(date) : mesa.selectedDateKey, mesa.occasion].filter(Boolean).join(' · ')
}

function reveal(path: string): void {
  void invoke('app:showItemInFolder', { path })
}

async function exportPdf(choosePath: boolean): Promise<void> {
  if (exporting.value || empty.value) return
  exporting.value = true
  failure.value = null
  try {
    await mesa.flush()
    const title = sermonTitle(mesa)
    const document = editorRichDocument(title)
    if (!document) throw new Error('Abra o manuscrito na Mesa para exportar.')
    const html = htmlForPrint(document, {
      title,
      occasion: subtitle(),
      fontFamily: tablet.value.fontFamily,
      fontSizePt: tablet.value.fontSize,
      includeFootnotes: tablet.value.includeNotes,
    })
    const result = await invoke('tablet:export', {
      dateKey: mesa.selectedDateKey,
      html,
      title: mesa.record?.mainReadingReference || title,
      choosePath,
    })
    if (!result) return
    if (mesa.record && mesa.record.dateKey === result.record.dateKey) {
      mesa.record = {
        ...mesa.record,
        tabletPdfPath: result.record.tabletPdfPath,
        tabletPdfUpdatedAt: result.record.tabletPdfUpdatedAt,
      }
    }
    toasts.show('Cópia em PDF salva para o tablet.', 'success', {
      action: { label: revealLabel, run: () => reveal(result.path) },
    })
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    exporting.value = false
  }
}

async function saveGoogleDoc(overwriteRemote = false): Promise<void> {
  if (exporting.value || empty.value) return
  exporting.value = true
  failure.value = null
  try {
    await mesa.flush()
    const document = editorRichDocument(sermonTitle(mesa))
    if (!document) throw new Error('Abra o manuscrito na Mesa para enviar ao Drive.')
    const wasLinked = Boolean(documentId.value)
    const result = await invoke('drive:saveSermon', {
      dateKey: mesa.selectedDateKey,
      document,
      ...(overwriteRemote ? { overwriteRemote: true } : {}),
    })
    if (mesa.record && mesa.record.dateKey === result.record.dateKey)
      mesa.record = { ...mesa.record, drive: result.record.drive }
    conflict.value = false
    const url = result.documentURL
    toasts.show(wasLinked ? 'Google Doc atualizado.' : 'Google Doc criado na pasta de sermões.', 'success', {
      action: url ? { label: 'Abrir', run: () => void invoke('app:openExternal', { url }) } : undefined,
    })
  } catch (error) {
    if ((error as { code?: string }).code === 'documentConflict') conflict.value = true
    else failure.value = errorMessage(error)
  } finally {
    exporting.value = false
  }
}

async function connectDrive(): Promise<void> {
  connecting.value = true
  failure.value = null
  try {
    setDriveStatus(await invoke('drive:connect'))
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    connecting.value = false
  }
}

function openDocument(): void {
  if (documentId.value) void invoke('app:openExternal', { url: googleDocURL(documentId.value) })
}

function primary(): void {
  if (tablet.value.format === 'gdoc') void saveGoogleDoc()
  else void exportPdf(!pdfPath.value)
}

const primaryLabel = computed(() => {
  if (tablet.value.format === 'gdoc') return documentId.value ? 'Atualizar Google Doc' : 'Criar Google Doc'
  return pdfPath.value ? 'Atualizar PDF' : 'Exportar PDF…'
})

onMounted(async () => {
  previewText.value = currentManuscript(mesa)
  void ensureDriveStatus()
  suggestedFolder.value = await invoke('tablet:suggestedFolder').catch(() => null)
})
</script>

<template>
  <Sheet :width="650" label="Preparar para pregar" :dismissible="!exporting" @close="emit('close')">
    <div class="tablet">
      <SheetHeader
        title="Preparar para pregar"
        subtitle="Uma cópia paginada para leitura no tablet. O manuscrito original não muda."
        :icon="Tablet"
      />

      <div class="tablet__options">
        <div class="tablet__option">
          <span class="tablet__label">Formato</span>
          <Segmented
            :model-value="tablet.format"
            label="Formato da cópia"
            :options="FORMAT_OPTIONS"
            @update:model-value="update({ format: $event })"
          />
        </div>
        <div v-if="tablet.format === 'pdf'" class="tablet__option">
          <label class="tablet__label" for="tablet-font">Fonte de leitura</label>
          <select
            id="tablet-font"
            class="field"
            :value="tablet.fontFamily"
            @change="update({ fontFamily: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="family in fontFamilies" :key="family" :value="family">{{ family }}</option>
          </select>
          <div class="stepper" role="group" aria-label="Tamanho da fonte de leitura">
            <PButton
              variant="icon"
              compact
              label="Diminuir a fonte"
              :disabled="tablet.fontSize <= FONT_SIZE.min"
              @click="stepFont(-1)"
              ><Minus :size="13"
            /></PButton>
            <span class="stepper__value" aria-live="polite">{{ tablet.fontSize }} pt</span>
            <PButton
              variant="icon"
              compact
              label="Aumentar a fonte"
              :disabled="tablet.fontSize >= FONT_SIZE.max"
              @click="stepFont(1)"
              ><Plus :size="13"
            /></PButton>
          </div>
        </div>
      </div>

      <label v-if="tablet.format === 'pdf'" class="check">
        <input
          type="checkbox"
          :checked="tablet.includeNotes"
          @change="update({ includeNotes: ($event.target as HTMLInputElement).checked })"
        />
        Notas de rodapé no fim
      </label>

      <section
        class="card status"
        :aria-label="tablet.format === 'pdf' ? 'Cópia PDF para o tablet' : 'Google Doc'"
      >
        <template v-if="tablet.format === 'pdf'">
          <SectionLabel title="Cópia PDF para o tablet" />
          <div v-if="pdfPath" class="file">
            <FileText :size="16" class="file__icon" aria-hidden="true" />
            <div class="file__text">
              <span class="file__name">{{ fileName(pdfPath) }}</span>
              <span class="file__meta">{{
                shortDateTime(record?.tabletPdfUpdatedAt) ?? 'PDF salvo neste computador'
              }}</span>
              <span class="file__folder" :title="folderOf(pdfPath)">{{ folderOf(pdfPath) }}</span>
            </div>
            <PButton variant="icon" compact :label="revealLabel" @click="reveal(pdfPath)"
              ><FolderOpen :size="14"
            /></PButton>
          </div>
          <template v-else>
            <p class="status__text">Nenhuma cópia em PDF exportada.</p>
            <p v-if="suggestedFolder && !tablet.lastExportFolder" class="status__hint">
              A pasta do Google Drive para computador foi encontrada e será sugerida: {{ suggestedFolder }}
            </p>
          </template>
        </template>
        <template v-else>
          <SectionLabel title="Google Doc" />
          <p v-if="!driveStatus" class="status__text status__row">
            <Spinner :size="12" /> Verificando conexão…
          </p>
          <p v-else-if="!driveStatus.available" class="status__text">{{ driveStatus.message }}</p>
          <template v-else-if="!connected">
            <p class="status__text status__row">
              <Cloud :size="14" aria-hidden="true" /> Google Drive não conectado.
            </p>
            <p class="status__hint">
              O Pregar só enxerga os documentos que ele mesmo cria no seu Drive (acesso drive.file).
            </p>
          </template>
          <p
            v-else-if="documentId && record?.drive.syncedAt"
            class="status__text status__row status__row--ok"
          >
            <Cloud :size="14" aria-hidden="true" /> Documento vinculado · atualizado
            {{ shortTime(record.drive.syncedAt) }}
          </p>
          <p v-else-if="documentId" class="status__text status__row">
            <Cloud :size="14" aria-hidden="true" /> Documento vinculado.
          </p>
          <p v-else class="status__text">O Google Doc será criado na pasta de sermões.</p>
          <p v-if="record?.drive.syncError" class="status__warning">{{ record.drive.syncError }}</p>
          <PButton v-if="documentId" variant="link" compact class="status__link" @click="openDocument"
            ><ExternalLink :size="13" /> Abrir no Google Docs</PButton
          >
        </template>
      </section>

      <section class="preview" aria-label="Prévia da leitura">
        <SectionLabel title="Prévia da leitura" />
        <div
          class="scroll preview__box selectable"
          tabindex="0"
          :style="
            tablet.format === 'pdf'
              ? { fontFamily: JSON.stringify(tablet.fontFamily), fontSize: `${tablet.fontSize}pt` }
              : undefined
          "
        >
          <p v-if="empty" class="muted">O manuscrito está vazio.</p>
          <template v-else>
            <p v-for="(paragraph, index) in previewParagraphs" :key="index">{{ paragraph }}</p>
          </template>
        </div>
      </section>

      <div v-if="conflict" class="conflict" role="alert">
        <p class="conflict__title">
          <TriangleAlert :size="14" aria-hidden="true" /> O Google Doc mudou desde a última sincronização.
        </p>
        <p class="conflict__text">
          A versão local foi preservada. Só substitua a cópia do Drive depois de comparar as alterações.
        </p>
        <div class="conflict__actions">
          <PButton v-if="documentId" variant="link" compact @click="openDocument"
            ><ExternalLink :size="13" /> Abrir Google Doc para comparar</PButton
          >
          <span class="spacer" />
          <PButton compact @click="conflict = false">Cancelar</PButton>
          <PButton variant="danger" compact :busy="exporting" @click="saveGoogleDoc(true)"
            >Substituir no Drive</PButton
          >
        </div>
      </div>

      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>

      <footer class="tablet__footer">
        <PButton
          v-if="tablet.format === 'gdoc' && driveStatus?.available && !connected"
          variant="link"
          :busy="connecting"
          @click="connectDrive"
        >
          <Cloud :size="14" /> Conectar Google Drive
        </PButton>
        <span class="spacer" />
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton
          v-if="tablet.format === 'pdf' && pdfPath"
          :disabled="exporting || empty"
          title="Escolher outro arquivo ou pasta"
          @click="exportPdf(true)"
          >Salvar como…</PButton
        >
        <PButton
          v-if="!conflict"
          variant="primary"
          :busy="exporting"
          :disabled="empty || (tablet.format === 'gdoc' && !connected)"
          :title="
            tablet.format === 'pdf'
              ? 'Salvar uma cópia paginada para leitura no tablet'
              : 'Criar ou atualizar o manuscrito no Google Drive'
          "
          @click="primary"
        >
          {{ primaryLabel }}
        </PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.tablet {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 12px;
}
.tablet__options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.tablet__option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.tablet__label {
  color: var(--muted);
}
.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
.stepper__value {
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.check input {
  accent-color: var(--accent);
  margin: 0;
}
.status {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.status__text {
  margin: 0;
  color: var(--muted);
}
.status__row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.status__row--ok {
  color: var(--accent);
}
.status__hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.status__warning {
  margin: 0;
  font-size: 11px;
  color: var(--warning);
}
.status__link {
  align-self: flex-start;
  margin-left: -6px;
}
.file {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file__icon {
  flex: none;
  color: var(--accent);
}
.file__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.file__name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file__meta {
  font-size: 10px;
  color: var(--muted);
}
.file__folder {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview__box {
  height: 160px;
  padding: var(--space-lg);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
  font-family: var(--font-ui);
  font-size: 12pt;
}
.preview__box p {
  margin: 0 0 0.6em;
}
.conflict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-md);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--warning) 8%, transparent);
}
.conflict__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-weight: 600;
}
.conflict__title svg {
  color: var(--warning);
}
.conflict__text {
  margin: 0;
  color: var(--muted);
}
.conflict__actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.failure {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}
.tablet__footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
