<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { BookOpen, LibraryBig, Plus } from 'lucide-vue-next'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  activeSectionForPage,
  printedPageLabel,
  sectionId,
  type PdfSectionLocation,
  type ReaderPdfPosition,
} from '@pregar/core/reader'
import { sectionsForDocument } from '@pregar/core/library'
import { readerShortcut, type ReaderShortcutCommand, type ReaderWebAction } from '@shared/ipc-reader'
import type { LibrarySectionRow } from '@shared/ipc-library'
import EmptyState from '@/components/EmptyState.vue'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke, on, platform } from '@/lib/api'
import ReaderTabBar from './ReaderTabBar.vue'
import ReaderContextBar from './ReaderContextBar.vue'
import PdfDocumentPane from './PdfDocumentPane.vue'
import PdfSectionsPanel from './PdfSectionsPanel.vue'
import ReaderInfoPanel from './ReaderInfoPanel.vue'
import WebDocumentPane from './WebDocumentPane.vue'
import NewTabSheet from './NewTabSheet.vue'
import PageCorrectionSheet from './PageCorrectionSheet.vue'
import { documentDetails, forgetPdfDocument, openPdfDocument, pdfTextSource } from './pdf'
import { invokeOptional, useReader } from './useReader'
import { sectionFromRow, type ReaderNotice } from './reader-ui'

// Avisos na barra da pesquisa (um por vez; somem sozinhos).
const notice = shallowRef<ReaderNotice | null>(null)
let noticeCounter = 0
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function notify(message: string, kind: ReaderNotice['kind'] = 'info', options: { action?: ReaderNotice['action']; timeout?: number } = {}): void {
  if (noticeTimer) clearTimeout(noticeTimer)
  notice.value = { id: (noticeCounter += 1), message, kind, action: options.action }
  const timeout = options.timeout ?? (kind === 'error' ? 8000 : 4000)
  noticeTimer = setTimeout(() => (notice.value = null), timeout)
}
function dismissNotice(): void {
  if (noticeTimer) clearTimeout(noticeTimer)
  notice.value = null
}

const reader = useReader((message) => notify(message, 'error'))
const tab = reader.selectedTab
const isPdf = computed(() => tab.value?.kind === 'pdf')
const isWeb = computed(() => tab.value?.kind === 'web')
const webState = reader.selectedWebState

// Preferências desta janela (painéis), guardadas só neste computador.
function storedFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}
function storeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // Armazenamento indisponível: vale só nesta sessão.
  }
}
const showSections = ref(storedFlag('pregar.leitor.sections', true))
const showInfo = ref(storedFlag('pregar.leitor.info', false))
watch(showSections, (value) => storeFlag('pregar.leitor.sections', value))
watch(showInfo, (value) => storeFlag('pregar.leitor.info', value))

const showNewTab = ref(false)
const correction = ref<{ tabID: string; title: string; page: number; pageCount: number } | null>(null)
const sheetOpen = computed(() => showNewTab.value || correction.value !== null)
const pdfPane = ref<InstanceType<typeof PdfDocumentPane> | null>(null)
const webPane = ref<InstanceType<typeof WebDocumentPane> | null>(null)

// Documento PDF da aba selecionada.

const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
const pdfDocumentLocation = ref<string | null>(null)
const pdfStatus = ref<'loading' | 'ready' | 'failed'>('loading')
const pdfDetails = shallowRef<{ author: string | null; labels: string[] | null }>({ author: null, labels: null })
let loadToken = 0

async function loadDocument(): Promise<void> {
  const current = tab.value
  const token = ++loadToken
  if (!current || current.kind !== 'pdf') return
  if (pdfDocumentLocation.value !== current.location) {
    pdfDocument.value = null
    pdfStatus.value = 'loading'
  }
  try {
    if (!current.pdfURL) throw new Error('PDF sem endereço')
    const document = await openPdfDocument(current.pdfURL)
    if (token !== loadToken) return
    pdfDocument.value = document
    pdfDocumentLocation.value = current.location
    pdfStatus.value = 'ready'
    void reader.command({ type: 'pdfLoaded', tabID: current.id, pageCount: document.numPages })
    const details = await documentDetails(document)
    if (token === loadToken) pdfDetails.value = details
  } catch (error) {
    if (token !== loadToken) return
    console.warn('[leitor] PDF indisponível', error)
    pdfDocument.value = null
    pdfDocumentLocation.value = null
    pdfStatus.value = 'failed'
  }
}

watch(() => (tab.value?.kind === 'pdf' ? `${tab.value.id}|${tab.value.pdfURL ?? ''}` : null), () => void loadDocument(), {
  immediate: true,
})

function retryDocument(): void {
  if (tab.value?.pdfURL) forgetPdfDocument(tab.value.pdfURL)
  pdfDocumentLocation.value = null
  void loadDocument()
}

// Página visível e posições: a janela publica a posição; a última fica aqui até a próxima navegação explícita.

const livePage = ref(1)
const localPositions = new Map<string, { navigationID: string | null; position: ReaderPdfPosition }>()
watch(
  () => tab.value?.id,
  () => {
    livePage.value = tab.value?.physicalPage ?? 1
  },
  { immediate: true },
)
const restorePosition = computed<ReaderPdfPosition | null>(() => {
  const current = tab.value
  if (!current || current.kind !== 'pdf') return null
  const local = localPositions.get(current.id)
  return local && local.navigationID === current.navigationID ? local.position : current.pdfPosition
})

function onPosition(tabID: string, position: ReaderPdfPosition): void {
  const owner = reader.tabs.value.find((item) => item.id === tabID)
  localPositions.set(tabID, { navigationID: owner?.navigationID ?? null, position })
  void reader.command({ type: 'pdfPosition', tabID, position })
}

// Seções: as indexadas pela Biblioteca; sem registro, calculadas do próprio PDF em segundo plano.

const sections = shallowRef<PdfSectionLocation[]>([])
const sectionsLoading = ref(false)
const computedSections = new Map<string, PdfSectionLocation[]>()
const indexedSections = shallowRef<{ location: string; sections: PdfSectionLocation[] | null } | null>(null)
let sectionsAbort: AbortController | null = null

watch(
  () => (tab.value?.kind === 'pdf' ? tab.value.location : null),
  async (location) => {
    sectionsAbort?.abort()
    indexedSections.value = null
    sections.value = []
    if (!location) return
    sectionsLoading.value = true
    let result: PdfSectionLocation[] | null
    try {
      const rows = await invokeOptional<LibrarySectionRow[] | null>('library:sectionsForPath', { path: location })
      // Sem registro (ou sem seções) na Biblioteca, as seções saem do próprio PDF.
      result = rows && rows.length > 0 ? rows.map(sectionFromRow) : null
    } catch {
      result = null
    }
    if (tab.value?.location !== location) return
    indexedSections.value = { location, sections: result }
  },
  { immediate: true },
)

watch([indexedSections, pdfDocument, pdfStatus], async ([indexed, document]) => {
  if (!indexed) return
  if (indexed.sections) {
    sections.value = indexed.sections
    sectionsLoading.value = false
    return
  }
  const cached = computedSections.get(indexed.location)
  if (cached) {
    sections.value = cached
    sectionsLoading.value = false
    return
  }
  if (!document || pdfDocumentLocation.value !== indexed.location) {
    if (pdfStatus.value === 'failed') sectionsLoading.value = false
    return
  }
  sectionsAbort?.abort()
  const abort = new AbortController()
  sectionsAbort = abort
  try {
    const found = await sectionsForDocument(pdfTextSource(document, abort.signal), { title: tab.value?.title ?? null })
    if (abort.signal.aborted) return
    computedSections.set(indexed.location, found)
    sections.value = found
  } catch (error) {
    if (!abort.signal.aborted) console.warn('[leitor] seções indisponíveis', error)
  } finally {
    if (!abort.signal.aborted) sectionsLoading.value = false
  }
})

const activeSection = computed(() => (isPdf.value ? (activeSectionForPage(sections.value, livePage.value) ?? null) : null))
const activeSectionID = computed(() => (activeSection.value ? sectionId(activeSection.value) : null))
const printed = (page: number): string | null => printedPageLabel(pdfDetails.value.labels?.[page - 1], page)
const pdfMetadata = computed(() => {
  const document = pdfDocument.value
  if (!document) return 'PDF local'
  return [pdfDetails.value.author, `${document.numPages} páginas físicas`].filter(Boolean).join(' · ')
})

// Navegação.

const canGoBack = computed(() => {
  if (!tab.value) return false
  return isWeb.value ? (webState.value?.canGoBack ?? false) : livePage.value > 1
})
const canGoForward = computed(() => {
  if (!tab.value) return false
  return isWeb.value ? (webState.value?.canGoForward ?? false) : livePage.value < (pdfDocument.value?.numPages ?? 1)
})

function setPage(page: number): void {
  if (tab.value) void reader.command({ type: 'setPage', tabID: tab.value.id, page })
}

function back(): void {
  if (!tab.value || !canGoBack.value) return
  if (isWeb.value) void reader.web(tab.value.id, 'back')
  else setPage(livePage.value - 1)
}

function forward(): void {
  if (!tab.value || !canGoForward.value) return
  if (isWeb.value) void reader.web(tab.value.id, 'forward')
  else setPage(livePage.value + 1)
}

function webAction(action: ReaderWebAction, url?: string): void {
  if (tab.value) void reader.web(tab.value.id, action, url)
}

function closeSelected(): boolean {
  if (!tab.value) return false
  void reader.command({ type: 'close', tabID: tab.value.id })
  return true
}

/** Executa o atalho; devolve `false` quando ele não se aplica à aba atual. */
function run(command: ReaderShortcutCommand): boolean {
  switch (command) {
    case 'newTab':
      showNewTab.value = true
      return true
    case 'closeTab':
      return closeSelected()
    case 'reopenClosedTab':
      void reader.command({ type: 'reopenClosed' })
      return true
    case 'nextTab':
    case 'previousTab':
      void reader.command({ type: 'selectRelative', delta: command === 'nextTab' ? 1 : -1 })
      return true
    case 'back':
      back()
      return Boolean(tab.value)
    case 'forward':
      forward()
      return Boolean(tab.value)
    case 'focusAddress':
      if (!isWeb.value) return false
      webPane.value?.focusAddress()
      return true
    case 'reload':
      if (!isWeb.value) return false
      webAction('reload')
      return true
    case 'zoomIn':
    case 'zoomOut':
      if (isPdf.value) pdfPane.value?.zoom(command === 'zoomIn' ? 1 : -1)
      else if (isWeb.value) webAction(command)
      return Boolean(tab.value)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (sheetOpen.value || event.defaultPrevented) return
  const command = readerShortcut(
    { key: event.key, code: event.code, meta: event.metaKey, control: event.ctrlKey, shift: event.shiftKey, alt: event.altKey },
    platform(),
  )
  if (command && run(command)) event.preventDefault()
}

// Abas e menus.

function openWeb(url: string): void {
  showNewTab.value = false
  void reader.command({ type: 'openWeb', url })
}

async function copyWithSource(): Promise<void> {
  const current = tab.value
  if (!current) return
  try {
    const text = current.kind === 'pdf' ? (pdfPane.value?.selectionText() ?? '') : undefined
    const copied = await invoke('reader:copyWithSource', { tabID: current.id, text })
    notify(copied ? 'Trecho copiado com a origem.' : 'Selecione um trecho para copiar com a origem.', copied ? 'success' : 'info')
  } catch (error) {
    notify(errorMessage(error), 'error')
  }
}

function openSection(section: PdfSectionLocation): void {
  livePage.value = section.startPage
  setPage(section.startPage)
}

function openSectionInNewTab(section: PdfSectionLocation, background: boolean): void {
  if (tab.value) void reader.command({ type: 'openPdfPage', fromID: tab.value.id, page: section.startPage, background })
}

function openPdfPage(page: number, position: ReaderPdfPosition | null, background: boolean): void {
  if (tab.value) void reader.command({ type: 'openPdfPage', fromID: tab.value.id, page, position, background })
}

function openLink(url: string, background: boolean): void {
  if (tab.value) void reader.command({ type: 'openLink', fromID: tab.value.id, url, background })
}

function startCorrection(): void {
  const current = tab.value
  const document = pdfDocument.value
  if (!current || !document) return
  correction.value = { tabID: current.id, title: current.title, page: activeSection.value?.startPage ?? livePage.value, pageCount: document.numPages }
}

function saveCorrection(page: number): void {
  const value = correction.value
  correction.value = null
  if (!value) return
  const section = activeSection.value
  void reader.command({ type: 'setPage', tabID: value.tabID, page })
  void reader.command({
    type: 'rememberLink',
    tabID: value.tabID,
    section: section ? { title: section.title, startPage: section.startPage } : null,
    startPage: page,
  })
}

function rememberLink(): void {
  const current = tab.value
  if (!current) return
  const section = activeSection.value
  void reader.command({
    type: 'rememberLink',
    tabID: current.id,
    section: section ? { title: section.title, startPage: section.startPage } : null,
  })
  notify('Vínculo lembrado para as próximas aberturas.', 'success')
}

function openLibrary(): void {
  void invoke('app:openWindow', { window: 'biblioteca' }).catch((error: unknown) => notify(errorMessage(error), 'error'))
}

// Título da janela acompanha a aba.
watch(
  () => tab.value?.title,
  (title) => void invoke('app:setTitle', { title: title ? `${title} · Leitor` : 'Leitor · Pregar' }).catch(() => undefined),
  { immediate: true },
)

// Painéis abrem e fecham: a página web acompanha a área reservada.
watch([showInfo, showSections], () => void nextTick(() => webPane.value?.sync()))

const stops: (() => void)[] = []
onMounted(() => {
  void reader.load()
  window.addEventListener('keydown', onKeydown, true)
  stops.push(
    on('reader:shortcut', ({ command }) => {
      if (!sheetOpen.value) run(command)
    }),
    on('reader:notice', ({ message, url }) => {
      notify(message, 'info', {
        timeout: 9000,
        action: url ? { label: 'Abrir no navegador', run: () => void invoke('app:openExternal', { url }).catch(() => undefined) } : undefined,
      })
    }),
    on('menu:command', ({ command }) => {
      if (sheetOpen.value) return
      if (command === 'zoomIn' || command === 'zoomOut') run(command)
      else if (command === 'zoomReset') {
        if (isPdf.value) pdfPane.value?.fit()
        else if (isWeb.value) webAction('zoomReset')
      } else if (command === 'find' && isPdf.value) pdfPane.value?.focusFind()
    }),
  )
})
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
  window.removeEventListener('keydown', onKeydown, true)
  stops.forEach((stop) => stop())
  sectionsAbort?.abort()
})
</script>

<template>
  <div class="reader">
    <ReaderTabBar
      :tabs="reader.tabs.value"
      :selected-i-d="reader.snapshot.value?.selectedID ?? null"
      :web-states="reader.webStates.value"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      @select="(id) => reader.command({ type: 'select', tabID: id })"
      @close="(id) => reader.command({ type: 'close', tabID: id })"
      @move="(id, targetID, after) => reader.command({ type: 'move', tabID: id, targetID, after })"
      @menu="(id, x, y) => reader.menu({ menu: 'tab', tabID: id, x, y })"
      @back="back"
      @forward="forward"
      @new-tab="showNewTab = true"
      @copy="copyWithSource"
    />
    <ReaderContextBar
      :context-title="reader.snapshot.value?.contextTitle ?? 'Pesquisa geral'"
      :reference="reader.snapshot.value?.activeReference ?? null"
      :show-sections-toggle="isPdf"
      :show-info-toggle="tab !== null"
      :sections-visible="showSections"
      :info-visible="showInfo"
      :notice="notice"
      @research-menu="(x, y) => reader.menu({ menu: 'research', x, y })"
      @all-tabs-menu="(x, y) => reader.menu({ menu: 'allTabs', x, y })"
      @toggle-sections="showSections = !showSections"
      @toggle-info="showInfo = !showInfo"
      @dismiss-notice="dismissNotice"
    />
    <main v-if="tab" class="reader__body">
      <PdfSectionsPanel
        v-if="isPdf && showSections"
        :title="tab.title"
        :metadata="pdfMetadata"
        :sections="sections"
        :loading="sectionsLoading"
        :active-section-i-d="activeSectionID"
        :printed="printed"
        @go="openSection"
        @open-in-new-tab="openSectionInNewTab"
        @menu="(section, x, y) => reader.menu({ menu: 'section', tabID: tab!.id, page: section.startPage, x, y })"
      />
      <PdfDocumentPane
        v-if="isPdf"
        ref="pdfPane"
        :tab="tab"
        :position="restorePosition"
        :document="pdfDocument"
        :status="pdfStatus"
        :labels="pdfDetails.labels"
        :active-section="activeSection"
        @page="livePage = $event"
        @position="onPosition"
        @set-page="setPage"
        @open-link="openLink"
        @open-page="openPdfPage"
        @retry="retryDocument"
      />
      <WebDocumentPane v-else-if="isWeb" ref="webPane" :tab="tab" :state="webState" :suspended="sheetOpen" @action="webAction" />
      <ReaderInfoPanel
        v-if="showInfo"
        :tab="tab"
        :active-section="activeSection"
        :current-u-r-l="webState?.url ?? null"
        :document-ready="pdfStatus === 'ready'"
        :printed="printed"
        @correct-page="startCorrection"
        @remember-link="rememberLink"
        @review="(included) => reader.setReviewInclusion(tab!.id, included)"
      />
    </main>
    <main v-else-if="reader.ready.value" class="reader__empty">
      <EmptyState :icon="BookOpen" title="Nenhuma aba aberta" message="Abra um PDF da Biblioteca ou adicione uma página web.">
        <PButton variant="primary" @click="showNewTab = true"><Plus :size="14" aria-hidden="true" /> Nova aba</PButton>
        <PButton @click="openLibrary"><LibraryBig :size="14" aria-hidden="true" /> Biblioteca de PDFs</PButton>
      </EmptyState>
    </main>
    <NewTabSheet v-if="showNewTab" @close="showNewTab = false" @open="openWeb" />
    <PageCorrectionSheet
      v-if="correction"
      :title="correction.title"
      :page="correction.page"
      :page-count="correction.pageCount"
      @close="correction = null"
      @save="saveCorrection"
    />
  </div>
</template>

<style scoped>
.reader {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.reader__body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.reader__empty {
  flex: 1;
  display: grid;
  place-items: center;
  background: var(--paper);
}
</style>
