<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  Ellipsis,
  FileDown,
  FolderOpen,
  LibraryBig,
  ListTree,
  Pencil,
  Plus,
  RotateCw,
  ScanText,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-vue-next'
import { OCR_CANCELLED_NOTICE } from '@pregar/core/library/indexer'
import type { PdfLibraryMetadataOverrides } from '@pregar/core/library/model'
import type { LibrarySectionRow, LibraryStatus, LibraryWork } from '@shared/ipc-library'
import EmptyState from '@/components/EmptyState.vue'
import PButton from '@/components/PButton.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import WindowHeader from '@/components/WindowHeader.vue'
import { errorMessage, invoke, on, platform } from '@/lib/api'
import { useToasts } from '@/stores/toasts'
import CoverImage from './CoverImage.vue'
import DriveImportSheet from './DriveImportSheet.vue'
import MetadataSheet from './MetadataSheet.vue'
import SectionList from './SectionList.vue'
import WorkMenu from './WorkMenu.vue'
import {
  MATCH_LABELS,
  SIDEBAR_FRACTION_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  DETAIL_MIN,
  filterSections,
  filterWorks,
  formatNumber,
  isReferenceQuery,
  libraryTotals,
  metadataLine,
  revealLabel,
  sidebarWidth,
  workSummaryLine,
  type WorkMenuItem,
} from './library-helpers'
import { renderCoverJPEG } from './pdf-render'

const toasts = useToasts()

// MARK: Estado

const works = ref<LibraryWork[]>([])
const loaded = ref(false)
const selectedId = ref<string | null>(readStored('pregar.library.selected'))
const sections = ref<LibrarySectionRow[]>([])
const sectionsFor = ref<string | null>(null)
const sectionsLoading = ref(false)
const sectionQuery = ref('')
const workQuery = ref('')
const status = ref<LibraryStatus>({ indexing: false, done: 0, total: 0, current: null, failures: [] })
const importing = ref(false)

const metadataWork = ref<LibraryWork | null>(null)
const savingMetadata = ref(false)
const removeWork = ref<LibraryWork | null>(null)
const showDriveImport = ref(false)

interface OcrState {
  workId: string
  phase: 'preparing' | 'downloading' | 'recognizing' | 'saving'
  done: number
  total: number
}
const ocr = ref<OcrState | null>(null)
/** Fora do estado reativo: métodos nativos não funcionam através do proxy do Vue. */
let ocrController: AbortController | null = null
const ocrNotices = ref<Record<string, string>>({})

const selected = computed(() => works.value.find((work) => work.id === selectedId.value) ?? null)
const visibleWorks = computed(() => filterWorks(works.value, workQuery.value))
/** Relações com a passagem digitada, vindas do índice do processo principal (rápido em centenas de seções). */
const referenceKinds = ref<Map<string, 'exact' | 'partial' | 'context'>>(new Map())
const filteredSections = computed(() => filterSections(sections.value, sectionQuery.value, referenceKinds.value))
const referenceMatches = computed(() => filteredSections.value.filter((item) => item.match !== null).length)
const totals = computed(() => (loaded.value ? libraryTotals(works.value) : ''))
const reveal = revealLabel(platform())

// MARK: Divisor

const body = ref<HTMLElement | null>(null)
const bodyWidth = ref(1200)
const fraction = ref(Number(readStored('pregar.library.sidebar')) || SIDEBAR_FRACTION_DEFAULT)
const listWidth = computed(() => sidebarWidth(fraction.value, bodyWidth.value))
const listMax = computed(() => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, bodyWidth.value - DETAIL_MIN)))
let bodyObserver: ResizeObserver | null = null

function setListWidth(width: number): void {
  fraction.value = width / Math.max(1, bodyWidth.value)
}
function commitListWidth(): void {
  writeStored('pregar.library.sidebar', String(fraction.value))
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Armazenamento indisponível: só não lembra.
  }
}

// MARK: Carregamento

async function loadWorks(): Promise<void> {
  try {
    works.value = await invoke('library:works')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
  loaded.value = true
  if (!selected.value) selectedId.value = works.value[0]?.id ?? null
  void loadSections()
  scheduleCovers()
}

async function loadSections(force = false): Promise<void> {
  const id = selectedId.value
  if (!id) {
    sections.value = []
    sectionsFor.value = null
    return
  }
  if (!force && sectionsFor.value === id) return
  sectionsLoading.value = sectionsFor.value !== id
  try {
    const rows = await invoke('library:sections', { id })
    if (selectedId.value === id) {
      sections.value = rows
      sectionsFor.value = id
    }
  } catch {
    if (selectedId.value === id) sections.value = []
  } finally {
    sectionsLoading.value = false
  }
}

let kindsSerial = 0
watch([sectionQuery, selectedId], async ([query, id]) => {
  const serial = ++kindsSerial
  if (!id || !isReferenceQuery(query)) {
    if (referenceKinds.value.size > 0) referenceKinds.value = new Map()
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 80))
  if (serial !== kindsSerial) return
  try {
    const matches = await invoke('library:matches', { reference: query.trim() })
    if (serial !== kindsSerial) return
    const path = works.value.find((work) => work.id === id)?.path
    referenceKinds.value = new Map(
      matches.filter((match) => match.path === path).map((match) => [`${match.section.title}|${match.section.startPage}`, match.kind]),
    )
  } catch {
    referenceKinds.value = new Map()
  }
})

watch(selectedId, (id) => {
  writeStored('pregar.library.selected', id)
  sectionQuery.value = ''
  void loadSections()
})

let reloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleReload(): void {
  if (reloadTimer) return
  reloadTimer = setTimeout(async () => {
    reloadTimer = null
    await loadWorks()
    await loadSections(true)
  }, 120)
}

// MARK: Capas (geradas aqui, uma por vez, e guardadas pelo processo principal)

const coverAttempts = new Set<string>()
let coverRunning = false

function scheduleCovers(): void {
  if (coverRunning) return
  const next = works.value.find((work) => !work.coverURL && work.available && !work.indexing && !coverAttempts.has(work.id))
  if (!next) return
  coverRunning = true
  coverAttempts.add(next.id)
  const run = async () => {
    try {
      const jpeg = await renderCoverJPEG(next.pdfURL)
      const { coverURL } = await invoke('library:saveCover', { id: next.id, jpeg })
      const work = works.value.find((item) => item.id === next.id)
      if (work) work.coverURL = coverURL
    } catch {
      // Sem capa: fica a tipográfica.
    } finally {
      coverRunning = false
      scheduleCovers()
    }
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => void run(), { timeout: 1500 })
  else setTimeout(() => void run(), 50)
}

// MARK: Ações

function showImportResult(result: { queued: number; alreadyInLibrary: number; skipped: { name: string; reason: string }[] }): void {
  const parts: string[] = []
  if (result.queued > 0) parts.push(`${result.queued} PDF(s) enviado(s) para indexação.`)
  if (result.alreadyInLibrary > 0) parts.push(`${result.alreadyInLibrary} já estava(m) na Biblioteca.`)
  if (result.skipped.length > 0) {
    parts.push(
      `Não importado(s): ${result.skipped
        .slice(0, 3)
        .map((item) => `${item.name} (${item.reason})`)
        .join('; ')}${result.skipped.length > 3 ? '…' : ''}`,
    )
  }
  if (parts.length > 0) toasts.show(parts.join(' '), result.skipped.length > 0 ? 'error' : 'success')
}

async function importPDFs(): Promise<void> {
  if (importing.value) return
  importing.value = true
  try {
    const result = await invoke('library:import')
    if (result) showImportResult(result)
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  } finally {
    importing.value = false
  }
}

async function reindexAll(): Promise<void> {
  try {
    await invoke('library:reindex', {})
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function openInReader(work: LibraryWork, page: number, options = { background: false, select: false }): Promise<void> {
  try {
    await invoke('reader:open', {
      kind: 'pdf',
      location: work.path,
      title: work.title,
      physicalPage: page,
      // Entra na pesquisa ativa do Leitor (o sermão em preparo) e vai direto à seção escolhida.
      // O título da seção não serve de passagem: a aba fica com a passagem do sermão.
      useActiveContext: true,
      preservePosition: false,
      ...(options.background ? { background: true } : {}),
      ...(options.select ? { select: true } : {}),
    })
  } catch (error) {
    toasts.show(errorMessage(error) || 'Este PDF não pôde ser aberto. Verifique se o arquivo ainda está disponível.', 'error')
  }
}

function openSection(row: LibrarySectionRow, options: { background: boolean; select: boolean }): void {
  if (!selected.value) return
  void openInReader(selected.value, row.startPage, options)
}

function readerModifiers(event: MouseEvent): { background: boolean; select: boolean } {
  return { background: event.button === 1 || event.metaKey || event.ctrlKey, select: event.shiftKey }
}

async function saveMetadata(metadata: PdfLibraryMetadataOverrides | null): Promise<void> {
  const work = metadataWork.value
  if (!work) return
  savingMetadata.value = true
  try {
    await invoke('library:saveMetadata', { id: work.id, metadata })
    metadataWork.value = null
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  } finally {
    savingMetadata.value = false
  }
}

async function resetMetadata(work: LibraryWork): Promise<void> {
  try {
    await invoke('library:saveMetadata', { id: work.id, metadata: null })
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function confirmRemove(): Promise<void> {
  const work = removeWork.value
  if (!work) return
  removeWork.value = null
  try {
    await invoke('library:remove', { id: work.id })
    if (selectedId.value === work.id) {
      const index = visibleWorks.value.findIndex((item) => item.id === work.id)
      const neighbour = visibleWorks.value[index + 1] ?? visibleWorks.value[index - 1]
      selectedId.value = neighbour?.id ?? null
    }
    toasts.show(`“${work.title}” saiu da Biblioteca. O arquivo continua no disco.`, 'success')
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

async function runOCR(work: LibraryWork): Promise<void> {
  if (ocr.value) return
  ocr.value = { workId: work.id, phase: 'preparing', done: 0, total: 0 }
  // O proxy reativo: as mudanças de fase e progresso aparecem na tela.
  const state = ocr.value
  const controller = new AbortController()
  ocrController = controller
  ocrNotices.value = { ...ocrNotices.value, [work.id]: '' }
  const { signal } = controller
  try {
    const candidates = await invoke('library:ocrCandidates', { id: work.id })
    let texts: Record<number, string> = {}
    if (candidates.pages.length > 0) {
      state.phase = 'downloading'
      const { langPath } = await invoke('library:ocrLanguages')
      if (signal.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' })
      state.phase = 'recognizing'
      state.total = candidates.pages.length
      const { recognizePages } = await import('./ocr')
      texts = await recognizePages({
        url: work.pdfURL,
        pages: candidates.pages,
        langPath,
        signal,
        onProgress: (done, total) => {
          state.done = done
          state.total = total
        },
      })
    }
    if (signal.aborted) throw Object.assign(new Error('cancelado'), { name: 'AbortError' })
    state.phase = 'saving'
    const outcome = await invoke('library:ocrApply', { id: work.id, texts })
    ocrNotices.value = { ...ocrNotices.value, [work.id]: outcome.notice }
  } catch (error) {
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError')
    const message = cancelled ? OCR_CANCELLED_NOTICE : errorMessage(error) || 'Não foi possível abrir o PDF para reconhecer o texto.'
    ocrNotices.value = { ...ocrNotices.value, [work.id]: message }
  } finally {
    if (ocr.value === state) ocr.value = null
    if (ocrController === controller) ocrController = null
  }
}

function cancelOCR(): void {
  ocrController?.abort()
}

const ocrDownload = ref<{ loaded: number; total: number } | null>(null)

const ocrLabel = computed(() => {
  const state = ocr.value
  if (!state) return ''
  switch (state.phase) {
    case 'preparing':
      return 'Preparando OCR…'
    case 'downloading':
      return ocrDownload.value && ocrDownload.value.total > 0 && ocrDownload.value.loaded < ocrDownload.value.total
        ? `Baixando idiomas do OCR… ${Math.round((ocrDownload.value.loaded / ocrDownload.value.total) * 100)}%`
        : 'Preparando OCR…'
    case 'recognizing':
      return state.total === 0 ? 'Preparando OCR…' : `OCR ${state.done}/${state.total}`
    case 'saving':
      return 'Atualizando o índice…'
  }
  return ''
})

function menuItems(work: LibraryWork): WorkMenuItem[] {
  return [
    { id: 'reindex', label: 'Reindexar', icon: RotateCw, disabled: !work.available || work.indexing },
    { id: 'ocr', label: 'OCR…', icon: ScanText, disabled: !work.available || work.indexing || ocr.value !== null },
    { id: 'metadata', label: 'Corrigir metadados', icon: Pencil },
    { id: 'reveal', label: reveal, icon: FolderOpen, disabled: !work.available },
    { id: 'remove', label: 'Remover da Biblioteca', icon: Trash2, danger: true, separatorBefore: true },
  ]
}

async function onMenu(work: LibraryWork, action: string): Promise<void> {
  try {
    if (action === 'reindex') await invoke('library:reindex', { id: work.id })
    else if (action === 'ocr') await runOCR(work)
    else if (action === 'metadata') metadataWork.value = work
    else if (action === 'reveal') await invoke('app:showItemInFolder', { path: work.path })
    else if (action === 'remove') removeWork.value = work
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  }
}

// MARK: Lista de obras (teclado e clique direito)

const workList = ref<HTMLElement | null>(null)
const rowMenu = ref<InstanceType<typeof WorkMenu> | null>(null)
const menuWork = ref<LibraryWork | null>(null)

function selectWork(work: LibraryWork): void {
  selectedId.value = work.id
}

async function onWorkKeydown(event: KeyboardEvent): Promise<void> {
  const list = visibleWorks.value
  if (list.length === 0) return
  const index = Math.max(0, list.findIndex((work) => work.id === selectedId.value))
  const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }
  const target = moves[event.key]
  if (target === undefined) return
  event.preventDefault()
  const work = list[Math.max(0, Math.min(list.length - 1, target))]
  if (!work) return
  selectedId.value = work.id
  await nextTick()
  const element = workList.value?.querySelector<HTMLElement>(`[data-work="${CSS.escape(work.id)}"]`)
  element?.focus()
  element?.scrollIntoView({ block: 'nearest' })
}

function onWorkContextMenu(work: LibraryWork, event: MouseEvent): void {
  event.preventDefault()
  selectedId.value = work.id
  menuWork.value = work
  void nextTick(() => rowMenu.value?.openAt(event.clientX, event.clientY))
}

// MARK: Atalhos e eventos

const sectionFilter = ref<HTMLInputElement | null>(null)

function onGlobalKeydown(event: KeyboardEvent): void {
  const modifier = platform() === 'darwin' ? event.metaKey : event.ctrlKey
  if (modifier && event.key.toLowerCase() === 'f' && sectionFilter.value) {
    event.preventDefault()
    sectionFilter.value.focus()
    sectionFilter.value.select()
  }
}

const unsubscribe: (() => void)[] = []
let previousIndexing = false

onMounted(async () => {
  if (body.value) {
    bodyWidth.value = body.value.clientWidth
    bodyObserver = new ResizeObserver(() => {
      if (body.value) bodyWidth.value = body.value.clientWidth
    })
    bodyObserver.observe(body.value)
  }
  window.addEventListener('keydown', onGlobalKeydown)
  unsubscribe.push(
    on('library:changed', scheduleReload),
    on('library:status', (next) => {
      status.value = next
      if (previousIndexing && !next.indexing && next.failures.length > 0) {
        toasts.show(
          `Não foi possível indexar: ${next.failures.map((failure) => `${failure.name} (${failure.reason})`).join('; ')}`,
          'error',
        )
      }
      previousIndexing = next.indexing
    }),
    on('library:ocrDownload', (progress) => (ocrDownload.value = progress)),
  )
  status.value = await invoke('library:status').catch(() => status.value)
  previousIndexing = status.value.indexing
  await loadWorks()
})

onBeforeUnmount(() => {
  bodyObserver?.disconnect()
  window.removeEventListener('keydown', onGlobalKeydown)
  for (const off of unsubscribe) off()
  if (reloadTimer) clearTimeout(reloadTimer)
  ocrController?.abort()
})

const statusLabel = computed(() => {
  const value = status.value
  if (!value.indexing) return ''
  const position = value.total > 1 ? `${Math.min(value.done + 1, value.total)} de ${value.total}` : ''
  return ['Indexando', position, value.current ? `· ${value.current}` : ''].filter(Boolean).join(' ')
})
</script>

<template>
  <div class="library">
    <WindowHeader title="Biblioteca" :subtitle="totals">
      <template #trailing>
        <span v-if="status.indexing" class="library__status" role="status" :title="statusLabel">
          <Spinner :size="12" label="Indexando" />
          <span>{{ statusLabel }}</span>
        </span>
        <PButton :disabled="status.indexing || works.length === 0" title="Reindexa todas as obras" @click="reindexAll">
          <RotateCw :size="14" aria-hidden="true" /> Reindexar
        </PButton>
        <PButton title="Importar PDFs de uma pasta pública do Google Drive" @click="showDriveImport = true">
          <FileDown :size="14" aria-hidden="true" /> Drive público…
        </PButton>
        <PButton :variant="works.length > 0 || !loaded ? 'primary' : 'secondary'" :busy="importing" @click="importPDFs">
          <Plus :size="14" aria-hidden="true" /> Importar PDF…
        </PButton>
      </template>
    </WindowHeader>

    <div ref="body" class="library__body">
      <aside class="works" :style="{ width: `${listWidth}px` }" aria-label="Obras">
        <div v-if="works.length > 8" class="works__filter">
          <input v-model="workQuery" class="field" type="search" placeholder="Filtrar obras" aria-label="Filtrar obras" />
        </div>
        <ul
          v-if="visibleWorks.length > 0"
          ref="workList"
          class="works__list scroll"
          role="listbox"
          aria-label="Obras da Biblioteca"
          @keydown="onWorkKeydown"
        >
          <li
            v-for="work in visibleWorks"
            :key="work.id"
            class="work"
            :class="{ 'work--selected': work.id === selectedId, 'work--missing': !work.available }"
            role="option"
            :aria-selected="work.id === selectedId"
            :data-work="work.id"
            :tabindex="work.id === (selectedId ?? visibleWorks[0]?.id) ? 0 : -1"
            @click="selectWork(work)"
            @contextmenu="onWorkContextMenu(work, $event)"
          >
            <CoverImage :title="work.title" :src="work.coverURL" :width="43" :height="59" />
            <div class="work__text">
              <span class="work__title serif">{{ work.title }}</span>
              <span class="work__meta">{{ [work.author, `${formatNumber(work.pageCount)} p.`].filter(Boolean).join(' · ') }}</span>
              <span class="work__summary">
                <Spinner v-if="work.indexing" :size="9" label="Indexando" />
                <TriangleAlert v-else-if="!work.available" :size="11" aria-hidden="true" />
                {{ work.available ? workSummaryLine(work) : 'arquivo não encontrado' }}
              </span>
            </div>
          </li>
        </ul>
        <EmptyState v-else-if="loaded && works.length > 0" title="Nenhuma obra encontrada" :message="`Nada corresponde a “${workQuery}”.`" />
        <WorkMenu
          v-if="menuWork"
          ref="rowMenu"
          class="works__row-menu"
          :items="menuItems(menuWork)"
          :label="`Ações de ${menuWork.title}`"
          @select="onMenu(menuWork!, $event)"
        />
      </aside>

      <ResizeHandle
        :width="listWidth"
        :min="SIDEBAR_MIN"
        :max="listMax"
        label="Divisor entre obras e detalhes"
        @update:width="setListWidth"
        @commit="commitListWidth"
      />

      <section class="detail" aria-label="Detalhes da obra">
        <template v-if="selected">
          <div class="detail__header">
            <CoverImage :title="selected.title" :src="selected.coverURL" :width="76" :height="104" />
            <div class="detail__heading">
              <h2 class="detail__title serif selectable">{{ selected.title }}</h2>
              <p class="detail__meta">{{ metadataLine(selected) }}</p>
              <p class="detail__count">{{ formatNumber(selected.sectionCount) }} seções encontradas</p>
              <p v-if="selected.ocrPageCount > 0" class="detail__ocr">OCR · {{ selected.ocrPageCount }} páginas examinadas</p>
            </div>
          </div>
          <p class="detail__path selectable" :title="selected.path">{{ selected.path }}</p>

          <p v-if="!selected.available" class="detail__warning" role="alert">
            <TriangleAlert :size="14" aria-hidden="true" />
            O arquivo não está mais no caminho original. Mova-o de volta ou remova a obra da Biblioteca.
          </p>

          <div class="detail__actions">
            <PButton @click="metadataWork = selected">
              <Pencil :size="14" aria-hidden="true" /> Corrigir metadados
            </PButton>
            <PButton v-if="selected.overrides" title="Descartar as correções e voltar aos metadados do arquivo" @click="resetMetadata(selected)">
              <Undo2 :size="14" aria-hidden="true" /> Usar dados do PDF
            </PButton>
            <PButton
              :disabled="!selected.available"
              title="Abrir no leitor (⌘/Ctrl-clique ou botão do meio: nova aba ao fundo)"
              @click="openInReader(selected, 1, readerModifiers($event))"
              @auxclick.prevent="$event.button === 1 && openInReader(selected, 1, readerModifiers($event))"
            >
              <BookOpen :size="14" aria-hidden="true" /> Abrir no leitor
            </PButton>
            <template v-if="ocr && ocr.workId === selected.id">
              <span class="detail__progress" role="status">
                <Spinner :size="13" label="OCR em andamento" />
                {{ ocrLabel }}
              </span>
              <PButton title="Interrompe o reconhecimento depois da página atual" @click="cancelOCR">
                <X :size="14" aria-hidden="true" /> Cancelar OCR
              </PButton>
            </template>
            <PButton
              v-else
              :disabled="!selected.available || selected.indexing || ocr !== null"
              title="Procura referências em páginas sem texto selecionável; o PDF original não é alterado."
              @click="runOCR(selected)"
            >
              <ScanText :size="14" aria-hidden="true" /> OCR…
            </PButton>
            <span v-if="selected.indexing" class="detail__progress" role="status">
              <Spinner :size="13" label="Indexando" /> Indexando…
            </span>
            <WorkMenu class="detail__menu" :items="menuItems(selected)" :label="`Mais ações de ${selected.title}`" @select="onMenu(selected!, $event)">
              <Ellipsis :size="15" aria-hidden="true" />
            </WorkMenu>
          </div>
          <p v-if="ocrNotices[selected.id]" class="detail__notice" role="status">{{ ocrNotices[selected.id] }}</p>

          <div class="detail__sections-label">
            <SectionLabel title="Seções encontradas" />
            <span class="detail__rule" />
            <span class="detail__sections-count">{{ formatNumber(selected.sectionCount) }}</span>
          </div>

          <template v-if="sections.length > 0">
            <div class="detail__filter">
              <input
                ref="sectionFilter"
                v-model="sectionQuery"
                class="field"
                type="search"
                placeholder="Filtrar seções ou passagens"
                aria-label="Filtrar seções ou passagens"
                spellcheck="false"
              />
              <span v-if="sectionQuery.trim()" class="detail__filter-count" role="status">
                {{ formatNumber(filteredSections.length) }} de {{ formatNumber(sections.length) }}
                <template v-if="referenceMatches > 0"> · {{ referenceMatches }} {{ referenceMatches === 1 ? MATCH_LABELS.exact : 'correspondências' }}</template>
              </span>
            </div>
            <SectionList
              v-if="filteredSections.length > 0"
              :items="filteredSections"
              :query="sectionQuery"
              :disabled="!selected.available"
              @open="openSection"
            />
            <EmptyState v-else :icon="ListTree" title="Nenhuma seção encontrada" :message="`Nada corresponde a “${sectionQuery.trim()}”.`" />
          </template>
          <div v-else-if="sectionsLoading" class="detail__loading"><Spinner label="Carregando seções" /></div>
          <EmptyState
            v-else
            :icon="ListTree"
            title="Passagens não encontradas"
            message="Este arquivo não tem um sumário legível nem cabeçalhos extraíveis. PDFs digitalizados podem precisar de OCR."
          />
        </template>
        <div v-else-if="loaded" class="detail__empty">
          <EmptyState :icon="LibraryBig" title="Biblioteca vazia" message="Importe os comentários em PDF que usa na preparação.">
            <PButton variant="primary" :busy="importing" @click="importPDFs">Importar PDF…</PButton>
          </EmptyState>
        </div>
        <div v-else class="detail__loading"><Spinner label="Carregando a Biblioteca" /></div>
      </section>
    </div>

    <MetadataSheet v-if="metadataWork" :work="metadataWork" :saving="savingMetadata" @close="metadataWork = null" @save="saveMetadata" />
    <DriveImportSheet v-if="showDriveImport" :status="status" @close="showDriveImport = false" />
    <Sheet v-if="removeWork" label="Remover da Biblioteca" :width="480" @close="removeWork = null">
      <div class="remove">
        <SheetHeader title="Remover da Biblioteca?" :subtitle="`“${removeWork.title}” sai da Biblioteca e do índice.`" :icon="Trash2" />
        <p class="remove__text">
          O arquivo PDF continua em <span class="remove__path">{{ removeWork.path }}</span>; nada é apagado do disco. Para voltar a usá-lo, basta
          importá-lo de novo.
        </p>
        <footer class="remove__footer">
          <PButton autofocus @click="removeWork = null">Cancelar</PButton>
          <PButton variant="danger" @click="confirmRemove">Remover</PButton>
        </footer>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.library {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.library__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  font-size: 11px;
  color: var(--muted);
}
.library__status span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* Obras */
.works {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}
.works__filter {
  padding: 10px 10px 4px;
}
.works__filter .field {
  width: 100%;
}
.works__list {
  flex: 1;
  margin: 0;
  padding: 7px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.works__row-menu {
  position: absolute;
  width: 0;
  height: 0;
  overflow: visible;
}
.works__row-menu :deep(.work-menu__trigger) {
  display: none;
}
.work {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px;
  border-radius: 9px;
  transition: background 0.1s;
}
.work:hover {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.work:focus-visible {
  outline-offset: -2px;
}
.work--selected,
.work--selected:hover {
  background: var(--accent-soft);
}
.work--missing .work__title,
.work--missing :deep(.cover) {
  opacity: 0.55;
}
.work__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.work__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.work__meta {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.work__summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
}
.work--missing .work__summary {
  color: var(--warning);
}

/* Detalhe */
.detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 28px 0;
  background: var(--paper);
  /* Em janelas baixas o detalhe inteiro rola, e a lista de seções mantém uma altura útil. */
  overflow-y: auto;
}
.detail__header {
  display: flex;
  align-items: flex-start;
  gap: 17px;
}
.detail__heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail__heading p {
  margin: 0;
}
.detail__title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}
.detail__meta {
  font-size: 13px;
  color: var(--muted);
}
.detail__count {
  font-size: 12px;
  color: var(--muted);
}
.detail__ocr {
  font-size: 12px;
  color: var(--accent);
}
.detail__path {
  margin: 14px 0 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: color-mix(in srgb, var(--muted) 72%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail__warning {
  margin: 12px 0 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--warning);
}
.detail__actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.detail__menu {
  margin-left: auto;
}
.detail__progress {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.detail__notice {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.detail__sections-label {
  margin-top: 22px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.detail__rule {
  flex: 1;
  height: 1px;
  background: var(--line);
}
.detail__sections-count {
  font-size: 12px;
  color: var(--muted);
}
.detail__filter {
  margin: 12px 0 6px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail__filter .field {
  width: 320px;
  max-width: 100%;
}
.detail__filter-count {
  font-size: 11px;
  color: var(--muted);
}
.detail__loading,
.detail__empty {
  flex: 1;
  display: grid;
  place-items: center;
}
.detail > :deep(.empty) {
  flex: 1;
  justify-content: center;
}

.field[type='search']::-webkit-search-cancel-button {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--muted);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 3l6 6M9 3l-6 6' stroke='black' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat;
}

/* Remoção */
.remove {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.remove__text {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.remove__path {
  font-family: var(--font-mono);
  font-size: 11px;
  word-break: break-all;
  color: var(--ink);
}
.remove__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
