import type { PdfSectionLocation } from '../library/model'
import { parseSwiftInt } from '../library/text-utils'
import { longDatePt } from '../util/dates'
import { foldCaseAndDiacritics } from '../util/text'
import {
  READER_CLOSED_TAB_LIMIT,
  READER_WEB_POSITION_LIMIT,
  isTabIncludedForReview,
  isValidPdfPosition,
  isValidWebPosition,
  type ReaderArchive,
  type ReaderPdfPosition,
  type ReaderTab,
  type ReaderWebPosition,
} from './model'
import { isWebScheme, urlHost, urlWithoutFragment } from './web'

/**
 * Estado do Leitor como dado puro: conjuntos de abas por data do sermão, seleção por contexto,
 * histórico de abas fechadas e páginas lembradas por passagem. As funções deste módulo não
 * alteram o estado recebido; devolvem um novo (ou o mesmo objeto quando nada muda). Documentos,
 * visores e sessões web ficam com o app.
 */
export interface ReaderState {
  tabs: ReaderTab[]
  selectedID?: string
  /** Data do sermão em preparação; ausente em "Pesquisa geral". */
  activeSermonDateKey?: string
  activeReference?: string
  closedTabs: ReaderTab[]
  /** Última aba selecionada em cada contexto (data ou "general"). */
  selectedBySermon: Record<string, string>
  /** Página física lembrada por PDF e passagem (`reader.section-links.v1`). */
  rememberedPages: Record<string, number>
  /**
   * Conta trocas de contexto e seleções. Uma abertura de PDF que termina depois de uma troca
   * fica ao fundo (ver `beginPdfOpen`).
   */
  contextRevision: number
}

export interface ReaderOpenResult {
  state: ReaderState
  opened: boolean
  tabID?: string
}

export const GENERAL_RESEARCH_CONTEXT_KEY = 'general'
export const GENERAL_RESEARCH_LABEL = 'Pesquisa geral'

/** Identificador no formato do `UUID.uuidString` do Swift (maiúsculas). */
export function newReaderID(): string {
  return globalThis.crypto.randomUUID().toUpperCase()
}

function optional<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 1), pageCount)
}

export function createReaderState(): ReaderState {
  return { tabs: [], closedTabs: [], selectedBySermon: {}, rememberedPages: {}, contextRevision: 0 }
}

export function readerContextKey(date: string | null | undefined): string {
  return date ?? GENERAL_RESEARCH_CONTEXT_KEY
}

/** "1 de novembro de 2026", ou "Pesquisa geral" para abas sem data. */
export function readerContextLabel(date: string | null | undefined): string {
  if (date === null || date === undefined) return GENERAL_RESEARCH_LABEL
  const parts = date
    .split('-')
    .filter((part) => part !== '')
    .map(parseSwiftInt)
    .filter((part): part is number => part !== null)
  const [year, month, day] = parts
  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) return date
  const value = new Date(2000, 0, 1)
  value.setFullYear(year, month - 1, day)
  return longDatePt(value)
}

/** Título do menu de contexto do Leitor. */
export function readerContextTitle(date: string | null | undefined): string {
  return date === null || date === undefined
    ? GENERAL_RESEARCH_LABEL
    : `Pesquisa · ${readerContextLabel(date)}`
}

/** Chave das páginas lembradas: caminho e passagem sem acentos nem caixa. */
export function sectionLinkKey(path: string, reference: string): string {
  return `${path}|${foldCaseAndDiacritics(reference)}`
}

export function visibleReaderTabs(state: ReaderState): ReaderTab[] {
  return state.tabs.filter((tab) => tab.sermonDateKey === state.activeSermonDateKey)
}

export function selectedReaderTab(state: ReaderState): ReaderTab | undefined {
  return state.selectedID === undefined ? undefined : state.tabs.find((tab) => tab.id === state.selectedID)
}

export function canReopenClosedTab(state: ReaderState): boolean {
  return state.closedTabs.some((tab) => tab.sermonDateKey === state.activeSermonDateKey)
}

/** Datas com abas salvas, da mais recente para a mais antiga. */
export function savedSermonDates(state: ReaderState): string[] {
  const dates = new Set(
    state.tabs.flatMap((tab) => (tab.sermonDateKey === undefined ? [] : [tab.sermonDateKey])),
  )
  return [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

/** Algum PDF aberto neste caminho (para o app liberar documento e seções ao fechar o último). */
export function isPdfLocationOpen(state: ReaderState, location: string): boolean {
  return state.tabs.some((tab) => tab.kind === 'pdf' && tab.location === location)
}

/** Materiais marcados para revisão na data do sermão (padrão: o contexto ativo). */
export function materialsMarkedForReview(state: ReaderState, sermonDateKey?: string | null): ReaderTab[] {
  const date = sermonDateKey ?? state.activeSermonDateKey
  return state.tabs.filter((tab) => tab.sermonDateKey === date && isTabIncludedForReview(tab))
}

// Rascunho mutável: cópia rasa do estado e de cada aba, para portar o código imperativo do Swift.

function draft(state: ReaderState): ReaderState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    closedTabs: [...state.closedTabs],
    selectedBySermon: { ...state.selectedBySermon },
    rememberedPages: { ...state.rememberedPages },
  }
}

/** Efeito da gravação no Swift: a seleção atual fica registrada para o contexto ativo. */
function persist(state: ReaderState): void {
  if (state.selectedID !== undefined)
    state.selectedBySermon[readerContextKey(state.activeSermonDateKey)] = state.selectedID
}

function activate(state: ReaderState, date: string | undefined, reference: string | undefined): void {
  if (state.selectedID !== undefined)
    state.selectedBySermon[readerContextKey(state.activeSermonDateKey)] = state.selectedID
  if (state.activeSermonDateKey === date) {
    if (reference !== undefined) state.activeReference = reference
    return
  }
  state.contextRevision += 1
  state.activeSermonDateKey = date
  const visible = visibleReaderTabs(state)
  const remembered = state.selectedBySermon[readerContextKey(date)]
  state.selectedID =
    remembered !== undefined && visible.some((tab) => tab.id === remembered) ? remembered : visible.at(-1)?.id
  state.activeReference = reference ?? selectedReaderTab(state)?.reference
  persist(state)
}

function select(state: ReaderState, id: string): boolean {
  const tab = state.tabs.find((item) => item.id === id)
  if (!tab) return false
  state.contextRevision += 1
  if (tab.sermonDateKey !== state.activeSermonDateKey) activate(state, tab.sermonDateKey, tab.reference)
  state.selectedID = id
  state.selectedBySermon[readerContextKey(state.activeSermonDateKey)] = id
  persist(state)
  return true
}

function insert(state: ReaderState, tab: ReaderTab, afterID: string | null | undefined): void {
  const index =
    afterID === null || afterID === undefined ? -1 : state.tabs.findIndex((item) => item.id === afterID)
  if (index >= 0) state.tabs.splice(index + 1, 0, tab)
  else state.tabs.push(tab)
}

function isRestorable(tab: ReaderTab): boolean {
  return tab.kind === 'pdf' ? tab.location !== '' : isWebScheme(tab.location)
}

/**
 * Estado a partir do arquivo salvo: descarta abas web sem http(s) e PDFs sem caminho (PDFs
 * indisponíveis ficam), recupera o contexto pela aba selecionada em arquivos antigos e guarda
 * só as últimas 20 abas fechadas.
 */
export function readerStateFromArchive(
  archive: ReaderArchive | null | undefined,
  rememberedPages: Readonly<Record<string, number>> = {},
): ReaderState {
  const state = createReaderState()
  state.rememberedPages = { ...rememberedPages }
  if (archive) {
    state.tabs = archive.tabs.filter(isRestorable).map((tab) => ({ ...tab }))
    state.activeSermonDateKey =
      archive.activeSermonDateKey ?? state.tabs.find((tab) => tab.id === archive.selectedID)?.sermonDateKey
    state.selectedBySermon = { ...archive.selectedBySermon }
    state.closedTabs = (archive.closedTabs ?? []).slice(-READER_CLOSED_TAB_LIMIT)
    const selected = archive.selectedID
    if (selected !== undefined && visibleReaderTabs(state).some((tab) => tab.id === selected))
      state.selectedID = selected
  }
  if (state.selectedID === undefined) state.selectedID = visibleReaderTabs(state).at(-1)?.id
  state.activeReference = selectedReaderTab(state)?.reference
  return state
}

/** Arquivo para gravar (`reader.session.v1`). */
export function readerArchiveFromState(state: ReaderState): ReaderArchive {
  const selectedBySermon = { ...state.selectedBySermon }
  if (state.selectedID !== undefined)
    selectedBySermon[readerContextKey(state.activeSermonDateKey)] = state.selectedID
  const archive: ReaderArchive = {
    tabs: state.tabs.map((tab) => ({ ...tab })),
    selectedBySermon,
    closedTabs: state.closedTabs.map((tab) => ({ ...tab })),
  }
  if (state.selectedID !== undefined) archive.selectedID = state.selectedID
  if (state.activeSermonDateKey !== undefined) archive.activeSermonDateKey = state.activeSermonDateKey
  return archive
}

/** Troca a pesquisa visível (data do sermão ou `null` para "Pesquisa geral"). */
export function activateReaderSermon(
  state: ReaderState,
  date: string | null | undefined,
  reference?: string | null,
): ReaderState {
  const next = draft(state)
  activate(next, optional(date), optional(reference))
  return next
}

export function setReaderActiveReference(
  state: ReaderState,
  reference: string | null | undefined,
): ReaderState {
  const value = optional(reference)
  return state.activeReference === value ? state : { ...state, activeReference: value }
}

/** Seleciona a aba, trocando de pesquisa quando ela pertence a outro sermão. */
export function selectReaderTab(state: ReaderState, id: string): ReaderState {
  if (!state.tabs.some((tab) => tab.id === id)) return state
  const next = draft(state)
  select(next, id)
  return next
}

/** Ciclo pelas abas visíveis (Ctrl-Tab / Ctrl-Shift-Tab). */
export function selectRelativeReaderTab(state: ReaderState, delta: number): ReaderState {
  const visible = visibleReaderTabs(state)
  if (visible.length === 0) return state
  const current = visible.findIndex((tab) => tab.id === state.selectedID)
  const index = ((((current < 0 ? 0 : current) + delta) % visible.length) + visible.length) % visible.length
  const target = visible[index]
  return target ? selectReaderTab(state, target.id) : state
}

/**
 * Início de uma abertura de PDF. Aberturas em primeiro plano contam como troca de contexto; o
 * app guarda `revision`, carrega o documento e passa a revisão a `openPdfTab`.
 */
export function beginPdfOpen(
  state: ReaderState,
  options: { inBackground?: boolean } = {},
): { state: ReaderState; revision: number } {
  if (options.inBackground) return { state, revision: state.contextRevision }
  const next = { ...state, contextRevision: state.contextRevision + 1 }
  return { state: next, revision: next.contextRevision }
}

export interface OpenPdfTabOptions {
  title: string
  /** Caminho já normalizado pelo app. */
  location: string
  /** Páginas do documento carregado; 0 indica que o PDF não abriu. */
  pageCount: number
  page?: number
  reference?: string | null
  sermonDateKey?: string | null
  /** Voltar a um material já aberto para a mesma passagem e data mantém a página. */
  preservePositionIfOpen?: boolean
  inBackground?: boolean
  forceNewTab?: boolean
  afterTabID?: string | null
  /** Revisão de `beginPdfOpen`; se o contexto mudou durante o carregamento, a aba abre ao fundo. */
  revision?: number
}

/**
 * Abre (ou reaproveita) a aba do PDF no contexto da data. Sem `preservePositionIfOpen`, ou com
 * outra passagem, navega para a página pedida ou para a página lembrada da passagem.
 */
export function openPdfTab(state: ReaderState, options: OpenPdfTabOptions): ReaderOpenResult {
  if (!(options.pageCount > 0)) return { state, opened: false }
  const next = draft(state)
  const reference = optional(options.reference)
  const date = optional(options.sermonDateKey)
  const inBackground =
    options.inBackground === true ||
    (options.revision !== undefined && options.revision !== next.contextRevision)
  const remembered =
    reference === undefined ? undefined : next.rememberedPages[sectionLinkKey(options.location, reference)]
  const page = options.page ?? 1

  let openedID: string
  const existing = options.forceNewTab
    ? undefined
    : next.tabs.find(
        (tab) => tab.kind === 'pdf' && tab.location === options.location && tab.sermonDateKey === date,
      )
  if (existing) {
    const keepsPosition =
      options.preservePositionIfOpen === true &&
      existing.reference === reference &&
      existing.sermonDateKey === date
    const previousPage = existing.physicalPage
    existing.title = options.title
    existing.reference = reference
    existing.sermonDateKey = date
    existing.physicalPage = clampPage(keepsPosition ? previousPage : (remembered ?? page), options.pageCount)
    if (!keepsPosition) {
      existing.pdfPosition = undefined
      existing.navigationID = newReaderID()
    }
    openedID = existing.id
  } else {
    const tab: ReaderTab = {
      id: newReaderID(),
      title: options.title,
      kind: 'pdf',
      location: options.location,
      physicalPage: clampPage(remembered ?? page, options.pageCount),
      reference,
      sermonDateKey: date,
      includedInReview: false,
      reviewInclusionConfirmed: true,
    }
    insert(next, tab, options.afterTabID)
    openedID = tab.id
  }
  if (!inBackground) select(next, openedID)
  persist(next)
  return { state: next, opened: true, tabID: openedID }
}

export interface OpenWebTabOptions {
  title: string
  url: string
  reference?: string | null
  sermonDateKey?: string | null
  inBackground?: boolean
  forceNewTab?: boolean
  afterTabID?: string | null
}

/** Abre (ou reaproveita) a aba web do endereço no contexto da data; só http(s). */
export function openWebTab(state: ReaderState, options: OpenWebTabOptions): ReaderOpenResult {
  if (!isWebScheme(options.url)) return { state, opened: false }
  const next = draft(state)
  const reference = optional(options.reference)
  const date = optional(options.sermonDateKey)
  let openedID: string
  const existing = options.forceNewTab
    ? undefined
    : next.tabs.find(
        (tab) => tab.kind === 'web' && tab.location === options.url && tab.sermonDateKey === date,
      )
  if (existing) {
    existing.title = options.title
    existing.reference = reference
    existing.sermonDateKey = date
    openedID = existing.id
  } else {
    const tab: ReaderTab = {
      id: newReaderID(),
      title: options.title,
      kind: 'web',
      location: options.url,
      physicalPage: 1,
      reference,
      sermonDateKey: date,
      includedInReview: false,
      reviewInclusionConfirmed: true,
    }
    insert(next, tab, options.afterTabID)
    openedID = tab.id
  }
  if (!options.inBackground) select(next, openedID)
  persist(next)
  return { state: next, opened: true, tabID: openedID }
}

/** Link aberto a partir de uma aba: nova aba web logo depois dela, na mesma passagem e data. */
export function openLinkTab(
  state: ReaderState,
  fromID: string,
  url: string,
  options: { inBackground?: boolean } = {},
): ReaderOpenResult {
  const source = state.tabs.find((tab) => tab.id === fromID)
  if (!source || !isWebScheme(url)) return { state, opened: false }
  const next = draft(state)
  const child: ReaderTab = {
    id: newReaderID(),
    title: urlHost(url) ?? url,
    kind: 'web',
    location: url,
    physicalPage: 1,
    reference: source.reference,
    sermonDateKey: source.sermonDateKey,
    includedInReview: false,
    reviewInclusionConfirmed: true,
  }
  insert(next, child, fromID)
  if (!options.inBackground) select(next, child.id)
  persist(next)
  return { state: next, opened: true, tabID: child.id }
}

/** Seção ou link interno do PDF aberto em nova aba, desmarcada para revisão. */
export function openPdfPageInNewTab(
  state: ReaderState,
  fromID: string,
  options: { page: number; pageCount: number; position?: ReaderPdfPosition | null; inBackground?: boolean },
): ReaderOpenResult {
  const original = state.tabs.find((tab) => tab.id === fromID && tab.kind === 'pdf')
  if (!original || !(options.pageCount > 0)) return { state, opened: false }
  const next = draft(state)
  const position =
    options.position && isValidPdfPosition(options.position) ? { ...options.position } : undefined
  const copy: ReaderTab = {
    ...original,
    id: newReaderID(),
    physicalPage: Math.min(options.pageCount, Math.max(1, options.page)),
    pdfPosition: position,
    navigationID: undefined,
    includedInReview: false,
    reviewInclusionConfirmed: true,
  }
  insert(next, copy, fromID)
  if (!options.inBackground) select(next, copy.id)
  persist(next)
  return { state: next, opened: true, tabID: copy.id }
}

/** Fecha a aba, guardando-a no histórico (últimas 20) e selecionando a vizinha da direita. */
export function closeReaderTab(state: ReaderState, id: string): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return state
  const next = draft(state)
  const [closed] = next.tabs.splice(index, 1)
  if (closed) next.closedTabs = [...next.closedTabs, closed].slice(-READER_CLOSED_TAB_LIMIT)
  if (next.selectedID === id) {
    const remaining = visibleReaderTabs(next)
    next.selectedID = (remaining.find((tab) => next.tabs.indexOf(tab) >= index) ?? remaining.at(-1))?.id
  }
  next.selectedBySermon = Object.fromEntries(
    Object.entries(next.selectedBySermon).filter(([, value]) => value !== id),
  )
  persist(next)
  return next
}

/** Fecha as demais abas visíveis (ou só as à direita). */
export function closeOtherReaderTabs(
  state: ReaderState,
  keepingID: string,
  options: { toRightOnly?: boolean } = {},
): ReaderState {
  const visible = visibleReaderTabs(state)
  const index = visible.findIndex((tab) => tab.id === keepingID)
  if (index < 0) return state
  const ids = visible
    .filter((tab, offset) => (options.toRightOnly ? offset > index : tab.id !== keepingID))
    .map((tab) => tab.id)
  return ids.reduce(closeReaderTab, state)
}

/** Reabre a última aba fechada da pesquisa ativa, logo após a selecionada. */
export function reopenClosedReaderTab(state: ReaderState): ReaderState {
  const index = state.closedTabs.findLastIndex((tab) => tab.sermonDateKey === state.activeSermonDateKey)
  if (index < 0) return state
  const next = draft(state)
  const [removed] = next.closedTabs.splice(index, 1)
  if (!removed) return state
  const tab: ReaderTab = { ...removed }
  if (next.tabs.some((item) => item.id === tab.id)) tab.id = newReaderID()
  insert(next, tab, next.selectedID)
  select(next, tab.id)
  return next
}

/** Duplica a aba logo depois dela; a cópia começa desmarcada para revisão. */
export function duplicateReaderTab(
  state: ReaderState,
  id: string,
  options: { inBackground?: boolean } = {},
): ReaderOpenResult {
  const original = state.tabs.find((tab) => tab.id === id)
  if (!original) return { state, opened: false }
  const next = draft(state)
  const copy: ReaderTab = {
    ...original,
    id: newReaderID(),
    includedInReview: false,
    reviewInclusionConfirmed: true,
  }
  insert(next, copy, id)
  if (!options.inBackground) select(next, copy.id)
  persist(next)
  return { state: next, opened: true, tabID: copy.id }
}

/** Reordena dentro do mesmo sermão (arrastar antes ou depois da aba alvo). */
export function moveReaderTab(
  state: ReaderState,
  id: string,
  targetID: string,
  options: { after?: boolean } = {},
): ReaderState {
  if (id === targetID) return state
  const from = state.tabs.findIndex((tab) => tab.id === id)
  const destination = state.tabs.find((tab) => tab.id === targetID)
  const moving = state.tabs[from]
  if (!moving || !destination || moving.sermonDateKey !== destination.sermonDateKey) return state
  const next = draft(state)
  const [moved] = next.tabs.splice(from, 1)
  const to = next.tabs.findIndex((tab) => tab.id === targetID)
  if (moved && to >= 0) next.tabs.splice(to + (options.after ? 1 : 0), 0, moved)
  persist(next)
  return next
}

/** Navegação explícita para uma página: sempre salta, mesmo se a página já é a atual. */
export function setPdfTabPage(state: ReaderState, id: string, page: number, pageCount: number): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id && tab.kind === 'pdf')
  if (index < 0 || !(pageCount > 0)) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.physicalPage = clampPage(page, pageCount)
  tab.navigationID = newReaderID()
  tab.pdfPosition = undefined
  persist(next)
  return next
}

/** Posição publicada pelo visor ao rolar ou mudar o zoom. */
export function recordPdfTabPosition(
  state: ReaderState,
  id: string,
  position: ReaderPdfPosition,
): ReaderState {
  if (!isValidPdfPosition(position)) return state
  const index = state.tabs.findIndex((tab) => tab.id === id && tab.kind === 'pdf')
  if (index < 0) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.pdfPosition = { ...position }
  if (tab.physicalPage !== position.page) tab.physicalPage = position.page
  persist(next)
  return next
}

/** Página publicada pelo visor sem destino exato. */
export function recordPdfTabPage(state: ReaderState, id: string, page: number): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id && tab.kind === 'pdf')
  if (index < 0 || state.tabs[index]?.physicalPage === page) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.physicalPage = page
  persist(next)
  return next
}

/** Rolagem de uma página web, por endereço; guarda até 50 endereços por aba. */
export function recordWebTabPosition(
  state: ReaderState,
  id: string,
  url: string,
  position: ReaderWebPosition,
): ReaderState {
  if (!isValidWebPosition(position)) return state
  const index = state.tabs.findIndex((tab) => tab.id === id && tab.kind === 'web')
  const current = state.tabs[index]
  if (index < 0 || !current) return state
  const previous = current.webPositions?.[url]
  if (previous && previous.x === position.x && previous.y === position.y) return state
  const positions: Record<string, ReaderWebPosition> = {
    ...current.webPositions,
    [url]: { x: position.x, y: position.y },
  }
  if (Object.keys(positions).length > READER_WEB_POSITION_LIMIT) {
    const oldest = Object.keys(positions).find((key) => key !== url)
    if (oldest !== undefined) delete positions[oldest]
  }
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.webPositions = positions
  persist(next)
  return next
}

/** Novo endereço da aba web; mudar de página (não só de fragmento) revoga a marcação de revisão. */
export function updateWebTabLocation(state: ReaderState, id: string, location: string): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id && tab.kind === 'web')
  const current = state.tabs[index]
  if (index < 0 || !current || current.location === location) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  if (urlWithoutFragment(current.location) !== urlWithoutFragment(location)) tab.includedInReview = false
  tab.location = location
  persist(next)
  return next
}

/** Título informado pela página web carregada. */
export function updateWebTabTitle(state: ReaderState, id: string, title: string): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  const current = state.tabs[index]
  if (index < 0 || !current || title === '' || current.title === title) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.title = title
  persist(next)
  return next
}

export function setTabReviewInclusion(state: ReaderState, id: string, included: boolean): ReaderState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return state
  const next = draft(state)
  const tab = next.tabs[index]
  if (!tab) return state
  tab.includedInReview = included
  tab.reviewInclusionConfirmed = true
  persist(next)
  return next
}

/**
 * "Lembrar este vínculo" e correção de página inicial: guarda a página para o PDF e a passagem
 * da aba (ou o título da seção), usada nas próximas aberturas.
 */
export function rememberSectionLink(
  state: ReaderState,
  tab: Pick<ReaderTab, 'location' | 'reference' | 'physicalPage'>,
  options: {
    section?: Pick<PdfSectionLocation, 'title' | 'startPage'> | null
    startPage?: number | null
  } = {},
): ReaderState {
  const reference = tab.reference ?? options.section?.title
  if (reference === undefined) return state
  const page = options.startPage ?? options.section?.startPage ?? tab.physicalPage
  return {
    ...state,
    rememberedPages: { ...state.rememberedPages, [sectionLinkKey(tab.location, reference)]: page },
  }
}
