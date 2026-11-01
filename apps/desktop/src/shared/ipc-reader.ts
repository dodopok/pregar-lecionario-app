import type { ReaderPdfPosition, ReaderTab, ReaderTabKind } from '@pregar/core/reader'

/** Pedido de abertura de material no Leitor (vindo da Mesa, Biblioteca ou Arquivo). */
export interface ReaderOpenRequest {
  kind: 'pdf' | 'web'
  /** Caminho do PDF (registrado na Biblioteca) ou endereço https. */
  location: string
  title: string
  reference?: string
  sermonDateKey?: string
  physicalPage?: number
  /** Abre ao fundo, sem trocar a aba selecionada (botão do meio ou ⌘clique). */
  background?: boolean
  /** Seleciona a nova aba mesmo ao fundo (⇧). */
  select?: boolean
  /**
   * PDF já aberto para a mesma passagem e data mantém a página ("Ir para a aba" na Mesa).
   * Padrão: sim quando há `sermonDateKey` e não é nova aba; a Biblioteca passa `false` para
   * navegar até a seção escolhida.
   */
  preservePosition?: boolean
  /** Sem data/passagem no pedido, usa a pesquisa ativa do Leitor (aberturas da Biblioteca). */
  useActiveContext?: boolean
}

/** Aba como a janela do Leitor a vê (sem as posições web guardadas). */
export interface ReaderTabView {
  id: string
  title: string
  kind: ReaderTabKind
  location: string
  physicalPage: number
  reference: string | null
  sermonDateKey: string | null
  /** Marcada e confirmada para a revisão. */
  includedInReview: boolean
  pdfPosition: ReaderPdfPosition | null
  /** Muda a cada navegação explícita (seção, campo de página, Ir), mesmo para a página atual. */
  navigationID: string | null
  /** Endereço pregar-pdf:// do arquivo (somente PDFs). */
  pdfURL: string | null
}

/** Pesquisa (conjunto de abas) que o menu do Leitor oferece. */
export interface ReaderContextOption {
  /** Data do sermão; `null` é a Pesquisa geral. */
  dateKey: string | null
  label: string
}

/** Estado do Leitor para a janela: abas visíveis da pesquisa ativa e seleção. */
export interface ReaderSnapshot {
  revision: number
  tabs: ReaderTabView[]
  selectedID: string | null
  activeSermonDateKey: string | null
  activeReference: string | null
  /** "Pesquisa geral" ou "Pesquisa · 1 de novembro de 2026". */
  contextTitle: string
  contexts: ReaderContextOption[]
  canReopenClosedTab: boolean
}

/** Estado vivo de uma aba web (WebContentsView no processo principal). */
export interface ReaderWebState {
  tabID: string
  url: string
  title: string
  loading: boolean
  /** 0 a 1; estimado pelas etapas do carregamento. */
  progress: number
  canGoBack: boolean
  canGoForward: boolean
  /** Mensagem de falha do carregamento, em português. */
  error: string | null
}

export interface ReaderRect {
  x: number
  y: number
  width: number
  height: number
}

/** Comandos de teclado do Leitor (README › Pesquisa: PDFs e sites). */
export type ReaderShortcutCommand =
  | 'newTab'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'nextTab'
  | 'previousTab'
  | 'back'
  | 'forward'
  | 'focusAddress'
  | 'reload'
  | 'zoomIn'
  | 'zoomOut'

/** Comandos de estado vindos da janela do Leitor. Todos passam pelos redutores de `@pregar/core/reader`. */
export type ReaderCommand =
  | { type: 'select'; tabID: string }
  | { type: 'selectRelative'; delta: 1 | -1 }
  | { type: 'close'; tabID: string }
  | { type: 'closeOthers'; tabID: string; toRightOnly?: boolean }
  | { type: 'duplicate'; tabID: string; background?: boolean }
  | { type: 'move'; tabID: string; targetID: string; after: boolean }
  | { type: 'reopenClosed' }
  /** Nova aba web na pesquisa ativa (folha "Nova aba"). */
  | { type: 'openWeb'; url: string; title?: string }
  /** Link de uma aba (web ou PDF) em nova aba logo depois dela. */
  | { type: 'openLink'; fromID: string; url: string; background: boolean }
  /** Seção ou destino interno do PDF em nova aba. */
  | { type: 'openPdfPage'; fromID: string; page: number; position?: ReaderPdfPosition | null; background: boolean }
  /** Navegação explícita: salta mesmo se a página já for a atual. */
  | { type: 'setPage'; tabID: string; page: number }
  /** O visor abriu o documento; o processo principal passa a limitar as páginas. */
  | { type: 'pdfLoaded'; tabID: string; pageCount: number }
  /** Posição publicada pelo visor ao rolar ou mudar o zoom (gravação adiada). */
  | { type: 'pdfPosition'; tabID: string; position: ReaderPdfPosition }
  /** "Lembrar este vínculo" e correção da página inicial. */
  | { type: 'rememberLink'; tabID: string; section?: { title: string; startPage: number } | null; startPage?: number | null }

export type ReaderWebAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'load'
  | 'openExternal'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

export type ReaderMenuRequest =
  | { menu: 'tab'; tabID: string; x: number; y: number }
  | { menu: 'allTabs'; x: number; y: number }
  | { menu: 'research'; x: number; y: number }
  | { menu: 'section'; tabID: string; page: number; x: number; y: number }

/** Canais do Leitor. */
export interface ReaderInvokeChannels {
  'reader:open': { req: ReaderOpenRequest; res: void }
  /** Abas da preparação (para a Mesa marcar "aberto" e listar materiais da revisão). */
  'reader:tabsForSermon': { req: { dateKey: string }; res: ReaderTab[] }
  /** A Mesa acompanha o sermão em preparação; o menu de pesquisa do Leitor troca de conjunto. */
  'reader:activateSermon': { req: { dateKey: string | null; reference?: string | null }; res: void }
  /** Marca ou desmarca o material para a revisão (confirma a marcação). */
  'reader:setReviewInclusion': { req: { tabID: string; included: boolean }; res: void }
  'reader:state': { req: void; res: ReaderSnapshot }
  'reader:command': { req: ReaderCommand; res: void }
  /** Estado vivo das abas web já criadas nesta sessão. */
  'reader:webStates': { req: void; res: ReaderWebState[] }
  'reader:web': { req: { tabID: string; action: ReaderWebAction; url?: string }; res: void }
  /** Área (em px CSS da janela) onde a aba web selecionada aparece; `null` oculta todas. */
  'reader:webViewport': { req: { tabID: string | null; bounds: ReaderRect | null }; res: void }
  /** Menus nativos (ficam acima das páginas web). Coordenadas em px CSS da janela. */
  'reader:menu': { req: ReaderMenuRequest; res: void }
  /** Copia a seleção com a origem; em abas web a seleção é lida da página. */
  'reader:copyWithSource': { req: { tabID: string; text?: string }; res: boolean }
}

export interface ReaderEventChannels {
  /** Para a janela do Leitor. */
  'reader:stateChanged': ReaderSnapshot
  'reader:webChanged': ReaderWebState
  /** Atalho digitado com o foco numa página web, encaminhado à janela. */
  'reader:shortcut': { command: ReaderShortcutCommand }
  /** Aviso da página web (download bloqueado), com endereço para abrir no navegador. */
  'reader:notice': { message: string; url?: string }
  /** Para todas as janelas: abas, seleção ou marcações mudaram (a Mesa consulta `reader:tabsForSermon`). */
  'reader:changed': { revision: number; selectedID: string | null; activeSermonDateKey: string | null }
}

/** Tecla pressionada, no formato comum ao `KeyboardEvent` e ao `Input` do Electron. */
export interface ReaderKeyInput {
  key: string
  code?: string
  meta: boolean
  control: boolean
  shift: boolean
  alt: boolean
}

/**
 * Atalho do Leitor para a tecla, ou `null`. ⌘ no macOS e Ctrl nos demais sistemas; ⌃Tab é Ctrl
 * em todos. Usado pela janela e pelas páginas web (antes de a página receber a tecla).
 */
export function readerShortcut(input: ReaderKeyInput, platform: string): ReaderShortcutCommand | null {
  const mac = platform === 'darwin'
  if (input.alt) return null
  if (input.key === 'Tab' && input.control && !input.meta) return input.shift ? 'previousTab' : 'nextTab'
  const primary = mac ? input.meta && !input.control : input.control && !input.meta
  if (!primary) return null
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  const code = input.code ?? ''
  // Letras pela tecla; em teclados não latinos, pela posição física.
  const latin = /^[a-z]$/.test(key)
  const letter = (value: string) => key === value || (!latin && code === `Key${value.toUpperCase()}`)
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 'zoomIn'
  if (key === '-' || code === 'NumpadSubtract') return 'zoomOut'
  if (input.shift) return letter('t') ? 'reopenClosedTab' : null
  if (key === '[' || code === 'BracketLeft') return 'back'
  if (key === ']' || code === 'BracketRight') return 'forward'
  if (letter('t')) return 'newTab'
  if (letter('w')) return 'closeTab'
  if (letter('l')) return 'focusAddress'
  if (letter('r')) return 'reload'
  return null
}
