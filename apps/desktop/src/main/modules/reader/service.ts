import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  activateReaderSermon,
  beginPdfOpen,
  closeOtherReaderTabs,
  closeReaderTab,
  decodeReaderArchive,
  duplicateReaderTab,
  encodeReaderArchive,
  isWebScheme,
  moveReaderTab,
  openLinkTab,
  openPdfPageInNewTab,
  openPdfTab,
  openWebTab,
  readerArchiveFromState,
  readerStateFromArchive,
  recordPdfTabPage,
  recordPdfTabPosition,
  recordWebTabPosition,
  rememberSectionLink,
  reopenClosedReaderTab,
  selectReaderTab,
  selectRelativeReaderTab,
  setPdfTabPage,
  setReaderActiveReference,
  setTabReviewInclusion,
  updateWebTabLocation,
  updateWebTabTitle,
  urlHost,
  type ReaderArchive,
  type ReaderState,
  type ReaderTab,
  type ReaderWebPosition,
} from '@pregar/core/reader'
import type { ReaderCommand, ReaderOpenRequest, ReaderSnapshot } from '@shared/ipc-reader'
import type { MainContext } from '../../context'
import type { KeyValueStore } from '../../storage/db'
import { UserFacingError } from '../../ipc/router'
import { UNKNOWN_PAGE_COUNT, makeSnapshot } from './helpers'

/** Chave do arquivo do Leitor em `kv('reader')` (JSON de `encodeReaderArchive`). */
export const READER_SESSION_KEY = 'session'

/**
 * Tipo de mudança: estrutura (abas, seleção, marcações) grava logo e avisa todas as janelas;
 * página grava após uma pausa e atualiza só o Leitor; posição só grava após uma pausa.
 */
export type ReaderChange = 'structure' | 'page' | 'position'

const POSITION_PERSIST_DELAY = 350
const STRUCTURE_PERSIST_DELAY = 60

/**
 * Estado do Leitor no processo principal. Toda mudança passa pelos redutores puros de
 * `@pregar/core/reader`; a janela recebe o estado por `reader:stateChanged`.
 */
export class ReaderService {
  state: ReaderState
  revision = 0
  /** Páginas dos PDFs já abertos pelo visor (limita páginas pedidas pela Mesa). */
  readonly pageCounts = new Map<string, number>()
  /** Chamado depois de cada mudança (o gerenciador web fecha visores de abas fechadas). */
  onApplied: ((previous: ReaderState, next: ReaderState) => void) | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private emitWindow = false
  private emitAll = false
  private emitScheduled = false

  constructor(
    private readonly context: MainContext,
    private readonly store: KeyValueStore,
  ) {
    this.state = this.load()
  }

  private load(): ReaderState {
    let archive: ReaderArchive | null = null
    try {
      archive = decodeReaderArchive(this.store.get<unknown>(READER_SESSION_KEY))
    } catch (error) {
      console.error('[leitor] arquivo ilegível; começando sem abas', error)
    }
    return readerStateFromArchive(archive, this.sectionLinks())
  }

  /** Páginas lembradas por PDF e passagem (guardadas pela Biblioteca). */
  sectionLinks(): Record<string, number> {
    try {
      return this.context.modules.library?.exportSectionLinks() ?? this.state?.rememberedPages ?? {}
    } catch {
      return this.state?.rememberedPages ?? {}
    }
  }

  pdfURL = (path: string): string | null => {
    try {
      return this.context.modules.library?.pdfURL(path) ?? null
    } catch {
      return null
    }
  }

  snapshot(): ReaderSnapshot {
    return makeSnapshot(this.state, this.revision, this.pdfURL)
  }

  tab(id: string): ReaderTab | undefined {
    return this.state.tabs.find((tab) => tab.id === id)
  }

  update(next: ReaderState, change: ReaderChange): void {
    const previous = this.state
    if (next === previous) return
    this.state = next
    this.revision += 1
    this.onApplied?.(previous, next)
    if (change === 'position') {
      this.schedulePersist(POSITION_PERSIST_DELAY)
      return
    }
    this.schedulePersist(change === 'page' ? POSITION_PERSIST_DELAY : STRUCTURE_PERSIST_DELAY)
    this.scheduleEmit(change === 'structure')
  }

  /** Substitui o arquivo inteiro (restauração de backup). */
  replace(archive: ReaderArchive | null): void {
    const previous = this.state
    this.state = readerStateFromArchive(archive, this.sectionLinks())
    this.pageCounts.clear()
    this.revision += 1
    this.onApplied?.(previous, this.state)
    this.flush()
    this.scheduleEmit(true)
  }

  exportArchive(): object {
    return encodeReaderArchive(readerArchiveFromState(this.state))
  }

  private schedulePersist(delay: number): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, delay)
  }

  /** Grava agora (fechamento da janela, saída do app, restauração). */
  flush(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    this.persistNow()
  }

  private persistNow(): void {
    try {
      this.store.set(READER_SESSION_KEY, this.exportArchive())
    } catch (error) {
      // Banco já fechado na saída do app: nada a fazer.
      if (!/closed|not open/i.test(String(error))) console.error('[leitor] não foi possível gravar a sessão', error)
    }
  }

  private scheduleEmit(all: boolean): void {
    this.emitWindow = true
    this.emitAll ||= all
    if (this.emitScheduled) return
    this.emitScheduled = true
    setImmediate(() => {
      this.emitScheduled = false
      const window = this.context.windows.get('leitor')
      if (this.emitWindow && window) this.context.windows.send(window, 'reader:stateChanged', this.snapshot())
      if (this.emitAll) {
        this.context.windows.broadcast('reader:changed', {
          revision: this.revision,
          selectedID: this.state.selectedID ?? null,
          activeSermonDateKey: this.state.activeSermonDateKey ?? null,
        })
      }
      this.emitWindow = false
      this.emitAll = false
    })
  }

  // Aberturas vindas da Mesa, Biblioteca e Arquivo.

  /** Devolve se a aba ficou selecionada (aberturas ao fundo não trazem a janela à frente). */
  async open(request: ReaderOpenRequest): Promise<{ opened: boolean; selected: boolean }> {
    const forceNewTab = request.background === true
    const inBackground = request.background === true && request.select !== true
    const useActive = request.useActiveContext === true
    const sermonDateKey = request.sermonDateKey ?? (useActive ? this.state.activeSermonDateKey : undefined)
    const reference = request.reference ?? (useActive ? this.state.activeReference : undefined)
    const title = request.title.trim() === '' ? (request.kind === 'web' ? (urlHost(request.location) ?? request.location) : request.location) : request.title

    if (request.kind === 'web') {
      if (!isWebScheme(request.location)) throw new UserFacingError('Informe um endereço http ou https válido.')
      const result = openWebTab(this.state, { title, url: request.location, reference, sermonDateKey, inBackground, forceNewTab })
      this.update(result.state, 'structure')
      return { opened: result.opened, selected: result.opened && !inBackground }
    }

    if (request.location.trim() === '') throw new UserFacingError('O PDF não tem caminho.')
    const location = resolve(request.location)
    const begun = beginPdfOpen(this.state, { inBackground })
    this.state = begun.state
    try {
      await access(location)
    } catch {
      throw new UserFacingError(`Não foi possível abrir “${title}”. Confira se o arquivo ainda está disponível neste computador.`)
    }
    const preservePositionIfOpen = request.preservePosition ?? (!forceNewTab && request.sermonDateKey !== undefined)
    const result = openPdfTab(
      { ...this.state, rememberedPages: this.sectionLinks() },
      {
        title,
        location,
        pageCount: this.pageCounts.get(location) ?? UNKNOWN_PAGE_COUNT,
        page: request.physicalPage ?? 1,
        reference,
        sermonDateKey,
        preservePositionIfOpen,
        inBackground,
        forceNewTab,
        revision: begun.revision,
      },
    )
    this.update(result.state, 'structure')
    const selected = result.opened && this.state.selectedID === result.tabID
    return { opened: result.opened, selected }
  }

  activateSermon(dateKey: string | null, reference?: string | null): void {
    let next = activateReaderSermon(this.state, dateKey, reference)
    if (reference !== undefined) next = setReaderActiveReference(next, reference)
    // Sem mudança visível, o redutor ainda devolve uma cópia: guarda sem avisar as janelas.
    if (
      next.activeSermonDateKey === this.state.activeSermonDateKey &&
      next.selectedID === this.state.selectedID &&
      next.activeReference === this.state.activeReference
    ) {
      this.state = next
      return
    }
    this.update(next, 'structure')
  }

  setReviewInclusion(tabID: string, included: boolean): void {
    this.update(setTabReviewInclusion(this.state, tabID, included), 'structure')
  }

  openLinkFrom(fromID: string, url: string, background: boolean): void {
    if (!isWebScheme(url)) return
    this.update(openLinkTab(this.state, fromID, url, { inBackground: background }).state, 'structure')
  }

  updateWebLocation(tabID: string, url: string): void {
    this.update(updateWebTabLocation(this.state, tabID, url), 'structure')
  }

  updateWebTitle(tabID: string, title: string): void {
    this.update(updateWebTabTitle(this.state, tabID, title), 'page')
  }

  recordWebPosition(tabID: string, url: string, position: ReaderWebPosition): void {
    this.update(recordWebTabPosition(this.state, tabID, url, position), 'position')
  }

  /** Comandos da janela do Leitor. */
  command(command: ReaderCommand): void {
    const state = this.state
    switch (command.type) {
      case 'select':
        return this.update(selectReaderTab(state, command.tabID), 'structure')
      case 'selectRelative':
        return this.update(selectRelativeReaderTab(state, command.delta), 'structure')
      case 'close':
        return this.update(closeReaderTab(state, command.tabID), 'structure')
      case 'closeOthers':
        return this.update(closeOtherReaderTabs(state, command.tabID, { toRightOnly: command.toRightOnly }), 'structure')
      case 'duplicate':
        return this.update(duplicateReaderTab(state, command.tabID, { inBackground: command.background }).state, 'structure')
      case 'move':
        return this.update(moveReaderTab(state, command.tabID, command.targetID, { after: command.after }), 'structure')
      case 'reopenClosed':
        return this.update(reopenClosedReaderTab(state), 'structure')
      case 'openWeb': {
        if (!isWebScheme(command.url)) throw new UserFacingError('Informe um endereço http ou https válido.')
        const title = command.title?.trim() || urlHost(command.url) || command.url
        const result = openWebTab(state, {
          title,
          url: command.url,
          reference: state.activeReference,
          sermonDateKey: state.activeSermonDateKey,
        })
        return this.update(result.state, 'structure')
      }
      case 'openLink':
        return this.openLinkFrom(command.fromID, command.url, command.background)
      case 'openPdfPage': {
        const tab = this.tab(command.fromID)
        const pageCount = tab ? (this.pageCounts.get(tab.location) ?? UNKNOWN_PAGE_COUNT) : 0
        const result = openPdfPageInNewTab(state, command.fromID, {
          page: command.page,
          pageCount,
          position: command.position ?? null,
          inBackground: command.background,
        })
        return this.update(result.state, 'structure')
      }
      case 'setPage': {
        const tab = this.tab(command.tabID)
        if (!tab) return
        return this.update(setPdfTabPage(state, command.tabID, command.page, this.pageCounts.get(tab.location) ?? UNKNOWN_PAGE_COUNT), 'page')
      }
      case 'pdfLoaded': {
        const tab = this.tab(command.tabID)
        if (!tab || tab.kind !== 'pdf' || !(command.pageCount > 0)) return
        this.pageCounts.set(tab.location, command.pageCount)
        // Páginas pedidas antes de o documento abrir ficam dentro do arquivo.
        if (tab.physicalPage > command.pageCount) this.update(recordPdfTabPage(state, tab.id, command.pageCount), 'page')
        return
      }
      case 'pdfPosition': {
        const previous = this.tab(command.tabID)
        const next = recordPdfTabPosition(state, command.tabID, command.position)
        const pageChanged = previous !== undefined && previous.physicalPage !== command.position.page
        return this.update(next, pageChanged ? 'page' : 'position')
      }
      case 'rememberLink': {
        const tab = this.tab(command.tabID)
        if (!tab) return
        const next = rememberSectionLink({ ...state, rememberedPages: this.sectionLinks() }, tab, {
          section: command.section ?? null,
          startPage: command.startPage ?? null,
        })
        try {
          this.context.modules.library?.replaceSectionLinks(next.rememberedPages)
        } catch (error) {
          console.error('[leitor] não foi possível lembrar o vínculo', error)
        }
        return this.update(next, 'position')
      }
    }
  }
}
