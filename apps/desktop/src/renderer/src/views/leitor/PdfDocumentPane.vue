<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BookOpenText, FileQuestion, MoveHorizontal, RotateCw, Search, ZoomIn, ZoomOut } from 'lucide-vue-next'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { linkOpensNewTab, printedPageLabel, type PdfSectionLocation, type ReaderPdfPosition } from '@pregar/core/reader'
import type { ReaderTabView } from '@shared/ipc-reader'
import PButton from '@/components/PButton.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import { isMac, shortcut } from '@/lib/api'
import { destinationPage, explicitDestination, loadPdfjs } from './pdf'
import {
  PDF_FIT_VALUE,
  PDF_MAX_SCALE,
  PDF_MIN_SCALE,
  clampPage,
  destinationFromHash,
  destinationPoint,
  isAutoScaleValue,
  nextZoomScale,
  parsePageField,
  positionFromLocation,
} from './reader-ui'

const props = defineProps<{
  tab: ReaderTabView
  /** Última posição conhecida da aba (a publicada nesta janela vale até a próxima navegação explícita). */
  position: ReaderPdfPosition | null
  document: PDFDocumentProxy | null
  status: 'loading' | 'ready' | 'failed'
  labels: string[] | null
  activeSection: PdfSectionLocation | null
}>()

const emit = defineEmits<{
  page: [page: number]
  position: [tabID: string, position: ReaderPdfPosition]
  setPage: [page: number]
  openLink: [url: string, background: boolean]
  openPage: [page: number, position: ReaderPdfPosition | null, background: boolean]
  retry: []
}>()

const container = ref<HTMLDivElement | null>(null)
const viewerElement = ref<HTMLDivElement | null>(null)
const findInput = ref<HTMLInputElement | null>(null)
const pageInput = ref<HTMLInputElement | null>(null)
const currentPage = ref(props.tab.physicalPage)
const pageField = ref(String(props.tab.physicalPage))
const pageFieldFocused = ref(false)
const pageCount = computed(() => props.document?.numPages ?? 0)
const printed = computed(() => printedPageLabel(props.labels?.[currentPage.value - 1], currentPage.value))
const findQuery = ref('')
const findResult = ref<{ current: number; total: number } | null>(null)
const findNotFound = ref(false)

let pdfViewer: PDFViewer | null = null
let eventBus: EventBus | null = null
let linkService: PDFLinkService | null = null
let findController: PDFFindController | null = null
let currentDocument: PDFDocumentProxy | null = null
let pagesReady = false
let suppress = false
let lastPublishedPage = props.tab.physicalPage
let publishTimer: ReturnType<typeof setTimeout> | null = null
let publishTabID: string | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0
let unmounted = false

function setCurrentPage(page: number): void {
  if (currentPage.value === page) return
  currentPage.value = page
  emit('page', page)
}

watch(currentPage, (page) => {
  if (!pageFieldFocused.value) pageField.value = String(page)
})

function releaseSuppression(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (suppress = false)))
}

/**
 * Leva o visor à página da aba. `restore` (troca de aba ou documento) recupera escala e ponto
 * salvos; a navegação explícita vai ao topo da página, mesmo que seja a atual.
 */
function navigate(restore: boolean): void {
  const viewer = pdfViewer
  // Antes de as páginas existirem, `pagesinit` faz a restauração.
  if (!viewer || !viewer.pdfDocument || !pagesReady || viewer.pagesCount === 0) return
  const tab = props.tab
  const target = clampPage(tab.physicalPage, viewer.pagesCount)
  const position = restore ? props.position : null
  suppress = true
  if (position && position.page === target) {
    if (position.autoScales) viewer.currentScaleValue = PDF_FIT_VALUE
    else viewer.currentScale = Math.min(PDF_MAX_SCALE, Math.max(PDF_MIN_SCALE, position.scale))
    viewer.scrollPageIntoView({
      pageNumber: target,
      destArray: [null, { name: 'XYZ' }, position.x, position.y, null],
      allowNegativeOffset: true,
      ignoreDestinationZoom: true,
    })
  } else {
    if (restore) viewer.currentScaleValue = PDF_FIT_VALUE
    viewer.scrollPageIntoView({ pageNumber: target })
  }
  lastPublishedPage = target
  setCurrentPage(target)
  releaseSuppression()
}

function publish(): void {
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = null
  const viewer = pdfViewer
  const tabID = publishTabID
  publishTabID = null
  if (!viewer || !tabID || !pagesReady) return
  const position = positionFromLocation(viewer._location, viewer.currentScale, isAutoScaleValue(viewer.currentScaleValue))
  if (!position) return
  lastPublishedPage = position.page
  emit('position', tabID, position)
}

function schedulePublish(): void {
  if (suppress || !pagesReady) return
  publishTabID = props.tab.id
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = setTimeout(publish, 150)
}

function setDocument(document: PDFDocumentProxy): void {
  if (!pdfViewer || !linkService) return
  currentDocument = document
  pagesReady = false
  findResult.value = null
  linkService.setDocument(document, null)
  pdfViewer.setDocument(document)
}

onMounted(async () => {
  const { pdfjs, viewer } = await loadPdfjs()
  if (unmounted || !container.value || !viewerElement.value) return
  eventBus = new viewer.EventBus()
  linkService = new viewer.PDFLinkService({ eventBus })
  findController = new viewer.PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true })
  pdfViewer = new viewer.PDFViewer({
    container: container.value,
    viewer: viewerElement.value,
    eventBus,
    linkService,
    findController,
    textLayerMode: 1,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    removePageBorders: false,
  })
  linkService.setViewer(pdfViewer)
  eventBus.on('pagesinit', () => {
    pagesReady = true
    // Documento novo na aba: recupera escala e ponto salvos.
    navigate(true)
  })
  eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
    if (!suppress) setCurrentPage(pageNumber)
  })
  eventBus.on('updateviewarea', ({ location }: { location: { pageNumber: number } }) => {
    if (suppress || !pagesReady) return
    setCurrentPage(location.pageNumber)
    schedulePublish()
  })
  eventBus.on('scalechanging', () => schedulePublish())
  eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
    findResult.value = matchesCount
  })
  eventBus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
    // 1 = FindState.NOT_FOUND.
    findNotFound.value = state === 1
    if (matchesCount) findResult.value = matchesCount
  })
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      const viewerInstance = pdfViewer
      if (!viewerInstance || !pagesReady) return
      // Ajuste automático acompanha a largura e mantém o ponto da leitura.
      const value = viewerInstance.currentScaleValue
      if (isAutoScaleValue(value)) viewerInstance.currentScaleValue = value
      else viewerInstance.update()
    })
  })
  resizeObserver.observe(container.value)
  if (props.document) setDocument(props.document)
})

onBeforeUnmount(() => {
  unmounted = true
  if (publishTimer) publish()
  resizeObserver?.disconnect()
  cancelAnimationFrame(resizeFrame)
  pdfViewer?.setDocument(null)
  pdfViewer = null
})

watch(
  () => ({ id: props.tab.id, navigation: props.tab.navigationID, page: props.tab.physicalPage, document: props.document }),
  (next, previous) => {
    if (previous && next.id !== previous.id && publishTimer) publish()
    // Outro documento a caminho: o visor ainda mostra o anterior e não publica posições pela aba nova.
    if (next.document !== currentDocument) pagesReady = false
    if (next.id !== previous?.id) {
      currentPage.value = next.page
      pageField.value = String(next.page)
      lastPublishedPage = next.page
    }
    if (!pdfViewer || !next.document) return
    if (next.document !== currentDocument) return setDocument(next.document)
    if (!previous || next.id !== previous.id) return navigate(true)
    if (next.navigation !== previous.navigation) return navigate(false)
    if (next.page !== previous.page && next.page !== lastPublishedPage) navigate(false)
  },
)

function commitPage(): void {
  const page = parsePageField(pageField.value, pageCount.value)
  if (page === null) {
    pageField.value = String(currentPage.value)
    return
  }
  pageField.value = String(page)
  emit('setPage', page)
}

// Zoom, ajuste e busca (também pelos atalhos da janela).

function zoom(direction: 1 | -1): void {
  if (!pdfViewer || !pagesReady) return
  pdfViewer.currentScale = nextZoomScale(pdfViewer.currentScale, direction)
}

function fit(): void {
  if (!pdfViewer || !pagesReady) return
  pdfViewer.currentScaleValue = PDF_FIT_VALUE
}

function runFind(type: '' | 'again', previous = false): void {
  if (!eventBus) return
  const query = findQuery.value
  if (query.trim() === '') {
    findResult.value = null
    findNotFound.value = false
    eventBus.dispatch('findbarclose', { source: null })
    return
  }
  eventBus.dispatch('find', {
    source: null,
    type,
    query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: previous,
    matchDiacritics: false,
  })
}

let findTimer: ReturnType<typeof setTimeout> | null = null
watch(findQuery, () => {
  if (findTimer) clearTimeout(findTimer)
  findTimer = setTimeout(() => runFind(''), 220)
})

function onFindKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    runFind('again', event.shiftKey)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    findQuery.value = ''
    container.value?.focus()
  }
}

const findStatus = computed(() => {
  if (findQuery.value.trim() === '') return ''
  if (findNotFound.value) return 'Nenhum resultado'
  const result = findResult.value
  if (!result || result.total === 0) return ''
  return `${Math.max(result.current, 1)} de ${result.total}`
})

// Links: externos abrem como nova aba do Leitor; botão do meio e ⌘clique abrem ao fundo.

function gestureFor(event: MouseEvent): boolean | null {
  return linkOpensNewTab({ middleButton: event.button === 1, commandKey: isMac() ? event.metaKey : event.ctrlKey, shiftKey: event.shiftKey })
}

async function openInternalInNewTab(href: string, background: boolean): Promise<void> {
  const document = currentDocument
  const destination = destinationFromHash(href)
  if (!document || !destination) return
  const dest = destination.kind === 'named' ? destination.name : destination.dest
  const page = await destinationPage(document, dest)
  if (page === null) return
  const explicit = await explicitDestination(document, dest)
  const point = explicit ? destinationPoint(explicit) : null
  const scale = pdfViewer?.currentScale ?? 1
  const position = point ? { page, x: point.x, y: point.y, scale, autoScales: isAutoScaleValue(pdfViewer?.currentScaleValue) } : null
  emit('openPage', page, position, background)
}

function linkFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target as Element | null
  return (target?.closest?.('.annotationLayer a[href]') as HTMLAnchorElement | null) ?? null
}

function handleLink(event: MouseEvent): void {
  const anchor = linkFromEvent(event)
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  const gesture = gestureFor(event)
  if (!href.startsWith('#') && /^https?:/i.test(anchor.href)) {
    event.preventDefault()
    event.stopPropagation()
    emit('openLink', anchor.href, gesture ?? false)
  } else if (href.startsWith('#') && gesture !== null) {
    event.preventDefault()
    event.stopPropagation()
    void openInternalInNewTab(href, gesture)
  } else if (!href.startsWith('#')) {
    // mailto:, file: e afins não saem do Leitor.
    event.preventDefault()
    event.stopPropagation()
  }
}

function onMouseDown(event: MouseEvent): void {
  if (event.button === 1 && linkFromEvent(event)) event.preventDefault()
}

function selectionText(): string {
  const selection = window.getSelection()
  if (!selection || !container.value || !selection.anchorNode || !container.value.contains(selection.anchorNode)) return ''
  return selection.toString()
}

function focusFind(): void {
  findInput.value?.focus()
  findInput.value?.select()
}

function focusPage(): void {
  pageInput.value?.focus()
  pageInput.value?.select()
}

defineExpose({ zoom, fit, focusFind, focusPage, selectionText })

const sectionLabel = computed(() => {
  const section = props.activeSection
  if (!section) return null
  return props.tab.reference ? `Mesma passagem · seção ${section.title}` : section.title
})
</script>

<template>
  <section class="pdf-pane" aria-label="PDF">
    <div class="pdf-toolbar">
      <label class="pdf-toolbar__label" for="reader-page-field">Página física</label>
      <input
        id="reader-page-field"
        ref="pageInput"
        v-model="pageField"
        class="field pdf-toolbar__page"
        inputmode="numeric"
        aria-label="Página física do PDF"
        title="Posição da página no arquivo. A numeração impressa pode ser diferente. Pressione Enter ou clique em Ir."
        :disabled="status !== 'ready'"
        @focus="pageFieldFocused = true"
        @blur="pageFieldFocused = false"
        @keydown.enter.prevent="commitPage"
        @keydown.esc.prevent="pageField = String(currentPage)"
      />
      <PButton compact :disabled="status !== 'ready'" title="Ir para a página física informada" @click="commitPage">Ir</PButton>
      <span class="pdf-toolbar__meta">de {{ pageCount || '—' }}</span>
      <span v-if="printed" class="pdf-toolbar__meta">impressa {{ printed }}</span>
      <span class="spacer" />
      <label class="pdf-find" :class="{ 'pdf-find--missing': findNotFound && findQuery.trim() !== '' }">
        <Search :size="13" aria-hidden="true" />
        <input
          ref="findInput"
          v-model="findQuery"
          type="search"
          placeholder="Buscar no PDF"
          aria-label="Buscar no PDF"
          :disabled="status !== 'ready'"
          @keydown="onFindKeydown"
        />
        <span v-if="findStatus" class="pdf-find__status" aria-live="polite">{{ findStatus }}</span>
      </label>
      <PButton variant="icon" compact label="Diminuir zoom" :title="`Diminuir zoom (${shortcut('⌘−')})`" :disabled="status !== 'ready'" @click="zoom(-1)">
        <ZoomOut :size="15" aria-hidden="true" />
      </PButton>
      <PButton variant="icon" compact label="Ajustar página à janela" title="Ajustar página à janela" :disabled="status !== 'ready'" @click="fit">
        <MoveHorizontal :size="15" aria-hidden="true" />
      </PButton>
      <PButton variant="icon" compact label="Aumentar zoom" :title="`Aumentar zoom (${shortcut('⌘+')})`" :disabled="status !== 'ready'" @click="zoom(1)">
        <ZoomIn :size="15" aria-hidden="true" />
      </PButton>
      <span v-if="sectionLabel" class="pdf-toolbar__section" :title="sectionLabel">
        <BookOpenText :size="13" aria-hidden="true" />
        <span>{{ sectionLabel }}</span>
      </span>
    </div>
    <div class="pdf-stage">
      <div
        ref="container"
        class="pdf-container"
        tabindex="0"
        aria-label="Páginas do PDF"
        @click.capture="handleLink"
        @auxclick.capture="handleLink"
        @mousedown="onMouseDown"
      >
        <div ref="viewerElement" class="pdfViewer" />
      </div>
      <div v-if="status === 'loading'" class="pdf-overlay" role="status">
        <Spinner :size="20" label="Abrindo PDF" />
        <span>Abrindo PDF…</span>
      </div>
      <div v-else-if="status === 'failed'" class="pdf-overlay pdf-overlay--failed">
        <EmptyState
          :icon="FileQuestion"
          title="PDF indisponível"
          :message="`O arquivo não pôde ser aberto. Confira se ele ainda está disponível ${isMac() ? 'neste Mac' : 'neste computador'}.`"
        >
          <PButton @click="emit('retry')"><RotateCw :size="13" aria-hidden="true" /> Tentar novamente</PButton>
        </EmptyState>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pdf-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
}
.pdf-toolbar {
  flex: none;
  height: 46px;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-md) 0 var(--space-lg);
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.pdf-toolbar__label,
.pdf-toolbar__meta {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.pdf-toolbar__page {
  width: 58px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pdf-toolbar__section {
  min-width: 0;
  max-width: 260px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: var(--space-xs);
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
}
.pdf-toolbar__section span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pdf-find {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control);
  width: 190px;
  min-width: 120px;
  flex-shrink: 1;
  padding: 0 8px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--muted);
}
.pdf-find:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.pdf-find--missing {
  border-color: var(--danger);
}
.pdf-find input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-size: 12px;
  color: var(--ink);
}
.pdf-find input::-webkit-search-cancel-button {
  display: none;
}
.pdf-find__status {
  flex: none;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* Com os dois painéis abertos numa janela estreita, a barra perde primeiro o que é secundário. */
@container (max-width: 700px) {
  .pdf-toolbar__section {
    display: none;
  }
}
@container (max-width: 540px) {
  .pdf-toolbar__label,
  .pdf-toolbar__meta + .pdf-toolbar__meta {
    display: none;
  }
  .pdf-find {
    width: 130px;
  }
}
@container (max-width: 430px) {
  .pdf-find {
    display: none;
  }
}
.pdf-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  /* Fundo neutro atrás das páginas, como o PDFKit. */
  background: color-mix(in srgb, var(--ink) 38%, var(--canvas));
}
.pdf-container {
  position: absolute;
  inset: 0;
  overflow: auto;
  outline: none;
}
.pdf-container :deep(.pdfViewer) {
  padding: 10px 0 24px;
}
.pdf-container :deep(.textLayer) {
  user-select: text;
}
.pdf-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--paper);
}
</style>
