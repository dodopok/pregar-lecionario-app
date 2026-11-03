<script setup lang="ts">
/**
 * Levar para o púlpito: a folha de pregar impressa direto, em PDF paginado, no Google Doc do
 * Drive ou como texto simples. O manuscrito original não muda e as anotações do pregador ficam
 * de fora. A duração estimada aparece contra a meta pessoal (Preferências › Ritmo).
 */
import { computed, onMounted, ref } from 'vue'
import {
  Church,
  Cloud,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Minus,
  Plus,
  Printer,
  TriangleAlert,
} from 'lucide-vue-next'
import { googleDocURL } from '@pregar/core/drive/api'
import {
  countWords,
  estimatedPreachingMinutes,
  estimatedPulpitPages,
  formatMinutes,
} from '@pregar/core/util/text'
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
import { buildPulpitHtml, printPulpitSheet } from '../pulpit'

type Format = 'print' | 'pdf' | 'gdoc' | 'text'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()
const toasts = useToasts()

/** As duas primeiras vêm embutidas no app (também na impressão); as demais dependem do computador. */
const FONT_FAMILIES = [
  'Source Serif 4',
  'Source Sans 3',
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
const FORMAT_OPTIONS: { value: Format; label: string; title: string }[] = [
  { value: 'print', label: 'Imprimir', title: 'Abre o diálogo de impressão do sistema' },
  { value: 'pdf', label: 'PDF', title: 'Salva uma cópia paginada para o tablet' },
  { value: 'gdoc', label: 'Google Doc', title: 'Cria ou atualiza o documento na pasta de sermões do Drive' },
  { value: 'text', label: 'Texto simples', title: 'Copia ou salva o texto sem formatação' },
]

const tablet = computed(() => app.settings.tablet)
const format = ref<Format>(tablet.value.format === 'gdoc' ? 'gdoc' : 'print')
const fontFamilies = computed(() =>
  FONT_FAMILIES.includes(tablet.value.fontFamily)
    ? FONT_FAMILIES
    : [tablet.value.fontFamily, ...FONT_FAMILIES],
)
const previewText = ref('')
const suggestedFolder = ref<string | null>(null)
const busy = ref(false)
const connecting = ref(false)
const failure = ref<string | null>(null)
const conflict = ref(false)

const record = computed(() => mesa.record)
const pdfPath = computed(() => record.value?.tabletPdfPath ?? null)
const documentId = computed(() => record.value?.drive.documentId ?? null)
const connected = computed(() => Boolean(driveStatus.value?.connected))
const empty = computed(() => previewText.value.trim().length === 0)
const previewParagraphs = computed(() => previewText.value.split(/\n+/).filter((line) => line.trim()))
const words = computed(() => countWords(previewText.value))
const rhythm = computed(() => app.settings.rhythm)
const minutes = computed(() => estimatedPreachingMinutes(words.value, rhythm.value.wordsPerMinute))
const pages = computed(() => estimatedPulpitPages(words.value))
const durationLine = computed(() => {
  if (empty.value) return 'O manuscrito está vazio.'
  const delta = Math.round(minutes.value - rhythm.value.targetMinutes)
  const against =
    Math.abs(delta) <= 2
      ? 'na meta'
      : delta > 0
        ? `${delta} min acima da meta`
        : `${Math.abs(delta)} min abaixo da meta`
  return `≈ ${formatMinutes(minutes.value)} no seu ritmo · ${against} de ${rhythm.value.targetMinutes} min · ${pages.value} ${pages.value === 1 ? 'página' : 'páginas'}`
})
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const revealLabel = isMac() ? 'Mostrar no Finder' : 'Mostrar na pasta'
const showsTypography = computed(() => format.value === 'print' || format.value === 'pdf')

function update(patch: Partial<typeof app.settings.tablet>): void {
  void app.updateSettings({ tablet: patch })
}

function chooseFormat(value: Format): void {
  format.value = value
  if (value === 'pdf' || value === 'gdoc') update({ format: value })
}

function stepFont(delta: number): void {
  update({ fontSize: Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, tablet.value.fontSize + delta)) })
}

function reveal(path: string): void {
  void invoke('app:showItemInFolder', { path })
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value || empty.value) return
  busy.value = true
  failure.value = null
  try {
    await mesa.flush()
    await action()
  } catch (error) {
    if ((error as { code?: string }).code === 'documentConflict') conflict.value = true
    else failure.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}

const print = () =>
  run(async () => {
    const result = await printPulpitSheet(mesa, app)
    if (result.message) failure.value = result.message
    else if (result.printed) toasts.show('Folha enviada para a impressora.', 'success')
  })

const exportPdf = (choosePath: boolean) =>
  run(async () => {
    const built = buildPulpitHtml(mesa, app)
    if (!built) throw new Error('Abra o manuscrito na Mesa para exportar.')
    const result = await invoke('tablet:export', {
      dateKey: mesa.selectedDateKey,
      html: built.html,
      title: built.title,
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
    toasts.show('Folha em PDF salva.', 'success', {
      action: { label: revealLabel, run: () => reveal(result.path) },
    })
  })

const saveGoogleDoc = (overwriteRemote = false) =>
  run(async () => {
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
  })

const copyText = () =>
  run(async () => {
    await navigator.clipboard.writeText(previewText.value)
    toasts.show('Texto copiado. Cole onde quiser.', 'success')
  })

const saveText = () =>
  run(async () => {
    const result = await invoke('tablet:saveText', {
      dateKey: mesa.selectedDateKey,
      text: previewText.value,
      title: sermonTitle(mesa),
    })
    if (result)
      toasts.show('Texto salvo.', 'success', {
        action: { label: revealLabel, run: () => reveal(result.path) },
      })
  })

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
  if (format.value === 'print') void print()
  else if (format.value === 'pdf') void exportPdf(!pdfPath.value)
  else if (format.value === 'gdoc') void saveGoogleDoc()
  else void copyText()
}

const primaryLabel = computed(() => {
  switch (format.value) {
    case 'print':
      return 'Imprimir…'
    case 'pdf':
      return pdfPath.value ? 'Atualizar PDF' : 'Salvar PDF…'
    case 'gdoc':
      return documentId.value ? 'Atualizar Google Doc' : 'Criar Google Doc'
    default:
      return 'Copiar texto'
  }
})

onMounted(async () => {
  previewText.value = currentManuscript(mesa)
  void ensureDriveStatus()
  suggestedFolder.value = await invoke('tablet:suggestedFolder').catch(() => null)
})
</script>

<template>
  <Sheet :width="680" label="Levar para o púlpito" :dismissible="!busy" @close="emit('close')">
    <div class="pulpit">
      <SheetHeader
        title="Levar para o púlpito"
        subtitle="Uma folha para pregar: impressa, no tablet, no Drive ou como texto. O manuscrito não muda e as anotações só para você ficam de fora."
        :icon="Church"
      />

      <p class="pulpit__duration" :class="{ 'pulpit__duration--empty': empty }">{{ durationLine }}</p>

      <Segmented
        :model-value="format"
        label="Como levar"
        :options="FORMAT_OPTIONS"
        @update:model-value="chooseFormat"
      />

      <div v-if="showsTypography" class="pulpit__options">
        <div class="pulpit__option">
          <label class="pulpit__label" for="pulpit-font">Fonte de leitura</label>
          <select
            id="pulpit-font"
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
        <label class="check">
          <input
            type="checkbox"
            :checked="tablet.includeNotes"
            @change="update({ includeNotes: ($event.target as HTMLInputElement).checked })"
          />
          Notas de rodapé no fim
        </label>
      </div>

      <section v-if="format === 'pdf'" class="card status" aria-label="Folha em PDF">
        <SectionLabel title="Folha em PDF" />
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
          <p class="status__text">Nenhuma folha em PDF salva ainda.</p>
          <p v-if="suggestedFolder && !tablet.lastExportFolder" class="status__hint">
            A pasta do Google Drive para computador foi encontrada e será sugerida: {{ suggestedFolder }}
          </p>
        </template>
      </section>

      <section v-else-if="format === 'gdoc'" class="card status" aria-label="Google Doc">
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
        <p v-else-if="documentId && record?.drive.syncedAt" class="status__text status__row status__row--ok">
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
      </section>

      <section v-else-if="format === 'text'" class="card status" aria-label="Texto simples">
        <SectionLabel title="Texto simples" />
        <p class="status__text">
          Sem formatação, títulos como linhas e notas no fim: serve para colar no celular, num e-mail ou
          noutro programa.
        </p>
        <div class="status__actions">
          <PButton compact :disabled="busy || empty" @click="saveText"
            ><FileText :size="13" /> Salvar como .txt…</PButton
          >
        </div>
      </section>

      <section class="preview" aria-label="Prévia da folha">
        <SectionLabel title="Prévia" />
        <div
          class="scroll preview__box selectable"
          tabindex="0"
          :style="
            showsTypography
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
          <PButton variant="danger" compact :busy="busy" @click="saveGoogleDoc(true)"
            >Substituir no Drive</PButton
          >
        </div>
      </div>

      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>

      <footer class="pulpit__footer">
        <PButton
          v-if="format === 'gdoc' && driveStatus?.available && !connected"
          variant="link"
          :busy="connecting"
          @click="connectDrive"
        >
          <Cloud :size="14" /> Conectar Google Drive
        </PButton>
        <span class="spacer" />
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton
          v-if="format === 'pdf' && pdfPath"
          :disabled="busy || empty"
          title="Escolher outro arquivo ou pasta"
          @click="exportPdf(true)"
          >Salvar como…</PButton
        >
        <PButton
          v-if="!conflict"
          variant="primary"
          :busy="busy"
          :disabled="empty || (format === 'gdoc' && !connected)"
          @click="primary"
        >
          <Printer v-if="format === 'print'" :size="14" /><Copy v-else-if="format === 'text'" :size="14" />{{
            primaryLabel
          }}
        </PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.pulpit {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--text-sm);
}
.pulpit__duration {
  margin: -4px 0 0;
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--accent-ink);
}
.pulpit__duration--empty {
  color: var(--muted);
  font-weight: 400;
}
.pulpit__options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md) var(--space-xl);
}
.pulpit__option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.pulpit__label {
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
  color: var(--accent-ink);
}
.status__hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.status__warning {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--warning-ink);
}
.status__link {
  align-self: flex-start;
  margin-left: -6px;
}
.status__actions {
  display: flex;
  gap: 8px;
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
.file__meta,
.file__folder {
  font-size: var(--text-xs);
  color: var(--muted);
}
.file__folder {
  font-family: var(--font-mono);
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
  height: 200px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--manuscript);
  line-height: 1.5;
}
.preview__box p {
  margin: 0 0 0.7em;
}
.conflict {
  padding: 12px 14px;
  border-radius: var(--radius-card);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
}
.conflict__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--warning-ink);
}
.conflict__text {
  margin: 4px 0 8px;
}
.conflict__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.failure {
  margin: 0;
  color: var(--danger);
}
.pulpit__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
</style>
