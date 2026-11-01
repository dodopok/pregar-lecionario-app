/**
 * Modelo persistido do Leitor (`reader.session.v1`). Os nomes dos campos seguem o JSON do app
 * Swift; opcionais ausentes ficam `undefined` e são omitidos ao gravar.
 */

export type ReaderTabKind = 'pdf' | 'web'

/** Posição dentro de um PDF: página física, destino na página, escala e ajuste automático. */
export interface ReaderPdfPosition {
  page: number
  x: number
  y: number
  scale: number
  autoScales: boolean
}

/** Rolagem de uma página web, guardada por endereço. */
export interface ReaderWebPosition {
  x: number
  y: number
}

export interface ReaderTab {
  id: string
  title: string
  kind: ReaderTabKind
  /** Caminho do PDF ou endereço http(s). */
  location: string
  /** Página física atual (1-based); sempre 1 nas abas web. */
  physicalPage: number
  /** Passagem da preparação associada à aba. */
  reference?: string
  /** Data do sermão (yyyy-MM-dd); ausente em "Pesquisa geral" e em abas antigas. */
  sermonDateKey?: string
  includedInReview: boolean
  /** Só abas confirmadas entram na revisão; abas antigas sem o campo ficam de fora. */
  reviewInclusionConfirmed?: boolean
  pdfPosition?: ReaderPdfPosition
  webPositions?: Record<string, ReaderWebPosition>
  /** Muda a cada navegação explícita, para o visor saltar mesmo se a página não mudou. */
  navigationID?: string
}

export interface ReaderArchive {
  tabs: ReaderTab[]
  selectedID?: string
  activeSermonDateKey?: string
  /** Aba selecionada por contexto (data do sermão ou "general"). */
  selectedBySermon?: Record<string, string>
  /** Histórico das últimas abas fechadas. */
  closedTabs?: ReaderTab[]
}

/** Abas fechadas guardadas para reabertura. */
export const READER_CLOSED_TAB_LIMIT = 20
/** Endereços com rolagem guardada por aba web. */
export const READER_WEB_POSITION_LIMIT = 50

export function isValidPdfPosition(position: ReaderPdfPosition): boolean {
  return (
    position.page > 0 &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Math.abs(position.x) < 1e7 &&
    Math.abs(position.y) < 1e7 &&
    Number.isFinite(position.scale) &&
    position.scale > 0 &&
    position.scale < 100
  )
}

export function isValidWebPosition(position: ReaderWebPosition): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    position.x >= 0 &&
    position.y >= 0 &&
    position.x < 1e8 &&
    position.y < 1e8
  )
}

/** Marcada para revisão e confirmada pelo usuário. */
export function isTabIncludedForReview(
  tab: Pick<ReaderTab, 'includedInReview' | 'reviewInclusionConfirmed'>,
): boolean {
  return tab.includedInReview && tab.reviewInclusionConfirmed === true
}

/** Materiais marcados para a revisão da passagem e da data exatas (contagem do Arquivo). */
export function countTabsMarkedForReview(
  tabs: readonly ReaderTab[],
  reference: string | null | undefined,
  sermonDateKey: string | null | undefined,
): number {
  if (reference === null || reference === undefined || sermonDateKey === null || sermonDateKey === undefined)
    return 0
  return tabs.filter(
    (tab) =>
      isTabIncludedForReview(tab) && tab.reference === reference && tab.sermonDateKey === sermonDateKey,
  ).length
}
