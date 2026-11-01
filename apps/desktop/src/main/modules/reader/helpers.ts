/**
 * Funções puras do Leitor no processo principal (sem Electron), testadas em test/unit/reader-main.test.ts.
 */
import {
  GENERAL_RESEARCH_LABEL,
  canReopenClosedTab,
  isTabIncludedForReview,
  readerContextLabel,
  readerContextTitle,
  savedSermonDates,
  visibleReaderTabs,
  type ReaderState,
  type ReaderTab,
} from '@pregar/core/reader'
import { webReviewCitation } from '@pregar/core/library'
import type { ReaderContextOption, ReaderRect, ReaderSnapshot, ReaderTabView } from '@shared/ipc-reader'

export function tabView(tab: ReaderTab, pdfURL: (path: string) => string | null): ReaderTabView {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    location: tab.location,
    physicalPage: tab.physicalPage,
    reference: tab.reference ?? null,
    sermonDateKey: tab.sermonDateKey ?? null,
    includedInReview: isTabIncludedForReview(tab),
    pdfPosition: tab.pdfPosition ? { ...tab.pdfPosition } : null,
    navigationID: tab.navigationID ?? null,
    pdfURL: tab.kind === 'pdf' ? pdfURL(tab.location) : null,
  }
}

/** Pesquisa geral, as datas com abas salvas e a pesquisa ativa (mesmo sem abas). */
export function contextOptions(state: ReaderState): ReaderContextOption[] {
  const dates = savedSermonDates(state)
  const active = state.activeSermonDateKey
  if (active !== undefined && !dates.includes(active)) {
    dates.push(active)
    dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }
  return [{ dateKey: null, label: GENERAL_RESEARCH_LABEL }, ...dates.map((date) => ({ dateKey: date, label: readerContextLabel(date) }))]
}

export function makeSnapshot(state: ReaderState, revision: number, pdfURL: (path: string) => string | null): ReaderSnapshot {
  return {
    revision,
    tabs: visibleReaderTabs(state).map((tab) => tabView(tab, pdfURL)),
    selectedID: state.selectedID ?? null,
    activeSermonDateKey: state.activeSermonDateKey ?? null,
    activeReference: state.activeReference ?? null,
    contextTitle: readerContextTitle(state.activeSermonDateKey),
    contexts: contextOptions(state),
    canReopenClosedTab: canReopenClosedTab(state),
  }
}

/** Lista resumida dos materiais marcados (`ReviewMaterialsProvider.marked`). */
export function markedMaterial(tab: ReaderTab): { id: string; kind: 'pdf' | 'web'; title: string; citation: string } {
  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.title,
    citation: tab.kind === 'web' ? webReviewCitation(tab.location) : `página física ${tab.physicalPage}`,
  }
}

/**
 * Retângulo da área da página web em DIP da janela. A janela informa px CSS; com zoom da
 * janela, 1 px CSS = `zoomFactor` DIP. Arredonda bordas (não larguras) para não deixar frestas.
 */
export function viewportToWindowBounds(rect: ReaderRect, zoomFactor: number): ReaderRect | null {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every(Number.isFinite)) return null
  const left = Math.round(rect.x * zoom)
  const top = Math.round(rect.y * zoom)
  const right = Math.round((rect.x + rect.width) * zoom)
  const bottom = Math.round((rect.y + rect.height) * zoom)
  if (right - left < 1 || bottom - top < 1) return null
  return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top) }
}

/** Remove "Electron/x" e o nome do app do agente de usuário: alguns sites bloqueiam navegadores desconhecidos. */
export function cleanUserAgent(userAgent: string, appTokens: readonly string[] = []): string {
  let result = userAgent.replace(/\sElectron\/\S+/g, '')
  for (const token of appTokens) {
    if (token === '') continue
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`\\s${escaped}\\/\\S+`, 'gi'), '')
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Pedido de nova janela de uma página web: `true` abre ao fundo, `false` seleciona a nova aba.
 * ⌘clique e botão do meio chegam como `background-tab`; com ⇧, `foreground-tab`; links com
 * `target=_blank` e `window.open` abrem a nova aba selecionada.
 */
export function windowOpenInBackground(disposition: string): boolean {
  return disposition === 'background-tab'
}

/** Endereço que uma aba web pode abrir no quadro principal. */
export function isAllowedTopLevelURL(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || url === 'about:blank'
  } catch {
    return false
  }
}

/** Mensagem em português para falhas do carregamento (códigos de rede do Chromium). */
export function webLoadErrorMessage(code: number, description: string): string {
  switch (code) {
    case -105:
    case -137:
      return 'O endereço do site não foi encontrado. Confira se está escrito corretamente.'
    case -106:
      return 'Sem conexão com a internet.'
    case -102:
      return 'O site recusou a conexão.'
    case -7:
    case -118:
      return 'O site demorou demais para responder.'
    case -21:
      return 'A conexão de rede mudou durante o carregamento.'
    case -101:
    case -100:
      return 'A conexão com o site foi interrompida.'
    case -109:
      return 'O site não pôde ser alcançado.'
    case -300:
      return 'O endereço não é válido.'
    case -310:
      return 'O site redirecionou vezes demais.'
    default:
      if (code <= -200 && code > -300) return 'O certificado de segurança do site não é válido. A página não foi aberta.'
      return description ? `Não foi possível abrir a página (${description}).` : 'Não foi possível abrir a página.'
  }
}

/** Erros que não são falhas: navegação cancelada ou substituída por outra. */
export function isIgnorableLoadError(code: number): boolean {
  return code === -3 || code === 0
}

/** Texto copiado com a origem, como no Swift: trecho, linha em branco e "— origem". */
export function textWithSource(text: string, source: string): string | null {
  const passage = text.trim()
  if (passage === '') return null
  return `${passage}\n\n— ${source}`
}

/** Origem citada ao copiar de uma aba. */
export function copySource(tab: Pick<ReaderTab, 'kind' | 'title' | 'location' | 'physicalPage'>, currentURL?: string | null): string {
  return tab.kind === 'web' ? (currentURL ?? tab.location) : `${tab.title}, página física ${tab.physicalPage}`
}

/** PDFs sem contagem de páginas conhecida ainda: o visor limita a página quando abrir o documento. */
export const UNKNOWN_PAGE_COUNT = 1_000_000
