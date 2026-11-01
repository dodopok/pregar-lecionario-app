import { Menu, WebContentsView, app, clipboard, session, shell, webContents as allWebContents } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, Session, WebContents } from 'electron'
import { isValidWebPosition, isWebScheme, type ReaderTab } from '@pregar/core/reader'
import { SermonReviewMaterialError, makeWebReviewSource, type ReviewMaterialSource } from '@pregar/core/library'
import { readerShortcut, type ReaderRect, type ReaderShortcutCommand, type ReaderWebAction, type ReaderWebState } from '@shared/ipc-reader'
import type { ReaderService } from './service'
import {
  cleanUserAgent,
  isAllowedTopLevelURL,
  isIgnorableLoadError,
  viewportToWindowBounds,
  webLoadErrorMessage,
  windowOpenInBackground,
} from './helpers'

/** Sessão persistente e separada das janelas do app: cookies e logins dos sites ficam só aqui. */
export const READER_PARTITION = 'persist:leitor'
/** Mundo isolado para ler e restaurar a rolagem sem tocar nos scripts da página. */
const ISOLATED_WORLD = 1207
const POLL_INTERVAL = 2500
const HIDDEN_LOAD_TIMEOUT = 25_000
const CRASHED_MESSAGE = 'A página foi interrompida. Recarregue para continuar a leitura.'

const CAPTURE_SCRIPT = `({ url: location.href, x: scrollX, y: scrollY, restoring: window.__pregarRestoring === true })`
const SELECTION_SCRIPT = `String(window.getSelection ? window.getSelection() : '')`
const REVIEW_TEXT_SCRIPT = `(() => {
  const article = document.querySelector('article') || document.querySelector('main');
  return { title: document.title || '', text: (article || document.body)?.innerText || '', url: location.href };
})()`

/** Igual ao Swift: reaplica a rolagem enquanto a página cresce, por até 1,5 s ou até o leitor interagir. */
function restoreScript(x: number, y: number): string {
  return `(() => {
  const x = ${JSON.stringify(x)}, y = ${JSON.stringify(y)};
  window.__pregarCancelRestore?.();
  window.__pregarRestoring = true;
  const controller = new AbortController();
  let timer, observer, finished = false;
  const finish = () => {
    if (finished) return; finished = true;
    clearTimeout(timer); observer?.disconnect(); controller.abort();
    window.__pregarRestoring = false;
  };
  window.__pregarCancelRestore = finish;
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((type) => addEventListener(type, finish, { once: true, passive: true, signal: controller.signal }));
  const apply = () => { if (!finished) scrollTo(x, y); };
  try { observer = new ResizeObserver(apply); observer.observe(document.documentElement); } catch {}
  timer = setTimeout(finish, 1500);
  apply();
  requestAnimationFrame(apply);
  return true;
})()`
}

interface WebRuntime {
  tabID: string
  view: WebContentsView
  state: ReaderWebState
  /** Carregamento só para extrair texto da revisão; não altera o estado das abas. */
  hidden: boolean
  window: BrowserWindow | null
  visible: boolean
  restoringUntil: number
}

export interface ReaderWebHooks {
  window(): BrowserWindow | undefined
  send(state: ReaderWebState): void
  shortcut(command: ReaderShortcutCommand): void
  notice(message: string, url?: string): void
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

type ReaderWebContents = WebContents & { pregarReaderTab?: boolean }

/**
 * Uma WebContentsView por aba web, presa à janela do Leitor e posicionada sobre a área que a
 * janela reserva. Criadas sob demanda, destruídas ao fechar a aba. Sem preload, sem Node, em
 * sandbox, sem permissões e sem downloads.
 */
export class ReaderWebManager {
  private readonly runtimes = new Map<string, WebRuntime>()
  private requested: { tabID: string | null; bounds: ReaderRect | null } = { tabID: null, bounds: null }
  private sessionReady = false
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly service: ReaderService,
    private readonly hooks: ReaderWebHooks,
  ) {}

  private session(): Session {
    const target = session.fromPartition(READER_PARTITION)
    if (this.sessionReady) return target
    this.sessionReady = true
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    target.setPermissionCheckHandler(() => false)
    target.setDevicePermissionHandler(() => false)
    target.setSpellCheckerEnabled(false)
    target.setUserAgent(cleanUserAgent(target.getUserAgent(), [app.getName(), 'pregar', '@pregar/desktop']))
    target.on('will-download', (event, item) => {
      const url = item.getURL()
      event.preventDefault()
      this.hooks.notice('O Leitor não baixa arquivos. Abra o endereço no navegador para salvar.', isWebScheme(url) ? url : undefined)
    })
    return target
  }

  states(): ReaderWebState[] {
    return [...this.runtimes.values()].filter((runtime) => !runtime.hidden).map((runtime) => ({ ...runtime.state }))
  }

  /** Cria a vista sem os manipuladores globais das janelas do app (ver security.ts). */
  private createView(): WebContentsView {
    const preferences = {
      partition: READER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      safeDialogs: true,
      autoplayPolicy: 'document-user-activation-required' as const,
    }
    // `web-contents-created` dispara dentro do construtor; a marca no protótipo vale só para ele.
    const sample = allWebContents.getAllWebContents()[0]
    const prototype = sample ? (Object.getPrototypeOf(sample) as { pregarReaderTab?: boolean }) : null
    let view: WebContentsView
    try {
      if (prototype) prototype.pregarReaderTab = true
      view = new WebContentsView({ webPreferences: preferences })
    } finally {
      if (prototype) delete prototype.pregarReaderTab
    }
    const contents = view.webContents as ReaderWebContents
    contents.pregarReaderTab = true
    // Sem amostra para o protótipo, as regras das janelas do app podem ter sido instaladas.
    if (contents.listenerCount('will-navigate') > 0) contents.removeAllListeners('will-navigate')
    view.setBackgroundColor('#ffffff')
    return view
  }

  private runtimeFor(tab: ReaderTab, hidden = false): WebRuntime {
    this.session()
    const view = this.createView()
    const runtime: WebRuntime = {
      tabID: tab.id,
      view,
      hidden,
      window: null,
      visible: false,
      restoringUntil: 0,
      state: {
        tabID: tab.id,
        url: tab.location,
        title: tab.title,
        loading: true,
        progress: 0.05,
        canGoBack: false,
        canGoForward: false,
        error: null,
      },
    }
    this.install(runtime)
    void view.webContents.loadURL(tab.location).catch(() => undefined)
    return runtime
  }

  private patch(runtime: WebRuntime, patch: Partial<ReaderWebState>): void {
    const contents = runtime.view.webContents
    const navigation = contents.isDestroyed()
      ? {}
      : { canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() }
    const next = { ...runtime.state, ...navigation, ...patch }
    const changed = (Object.keys(next) as (keyof ReaderWebState)[]).some((key) => next[key] !== runtime.state[key])
    if (!changed) return
    const errorChanged = next.error !== runtime.state.error
    runtime.state = next
    if (runtime.hidden) return
    this.hooks.send({ ...next })
    if (errorChanged) this.layout()
  }

  private install(runtime: WebRuntime): void {
    const contents = runtime.view.webContents
    const tabID = runtime.tabID

    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!runtime.hidden && isWebScheme(url)) this.service.openLinkFrom(tabID, url, windowOpenInBackground(disposition))
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedTopLevelURL(url)) {
        event.preventDefault()
        return
      }
      void this.capture(runtime)
    })
    contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame && !isAllowedTopLevelURL(url)) event.preventDefault()
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && /^(file|chrome|chrome-extension|devtools|view-source):/i.test(event.url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())

    contents.on('did-start-loading', () => this.patch(runtime, { loading: true, progress: Math.max(0.1, runtime.state.loading ? runtime.state.progress : 0.1), error: null }))
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      this.patch(runtime, { loading: true, progress: Math.max(runtime.state.progress, 0.2), error: null })
    })
    contents.on('did-navigate', (_event, url) => {
      this.patch(runtime, { url, progress: Math.max(runtime.state.progress, 0.5) })
      if (!runtime.hidden) this.service.updateWebLocation(tabID, url)
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      this.patch(runtime, { url })
      if (!runtime.hidden) this.service.updateWebLocation(tabID, url)
    })
    contents.on('dom-ready', () => this.patch(runtime, { progress: Math.max(runtime.state.progress, 0.8) }))
    contents.on('page-title-updated', (_event, title) => {
      this.patch(runtime, { title })
      if (!runtime.hidden) this.service.updateWebTitle(tabID, title)
    })
    contents.on('did-finish-load', () => {
      this.patch(runtime, { progress: 1 })
      this.restore(runtime)
    })
    contents.on('did-stop-loading', () => this.patch(runtime, { loading: false, progress: 1 }))
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || isIgnorableLoadError(code)) return
      this.patch(runtime, { loading: false, progress: 1, error: webLoadErrorMessage(code, description) })
    })
    contents.on('render-process-gone', () => this.patch(runtime, { loading: false, error: CRASHED_MESSAGE }))
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || runtime.hidden) return
      const command = readerShortcut(
        { key: input.key, code: input.code, meta: input.meta, control: input.control, shift: input.shift, alt: input.alt },
        process.platform,
      )
      if (!command) return
      event.preventDefault()
      this.hooks.shortcut(command)
    })
    contents.on('context-menu', (_event, params) => this.contextMenu(runtime, params))
  }

  private contextMenu(runtime: WebRuntime, params: ContextMenuParams): void {
    const contents = runtime.view.webContents
    const window = runtime.window
    if (!window || window.isDestroyed()) return
    const items: MenuItemConstructorOptions[] = []
    const link = isWebScheme(params.linkURL) ? params.linkURL : null
    if (link) {
      items.push(
        { label: 'Abrir link em nova aba', click: () => this.service.openLinkFrom(runtime.tabID, link, true) },
        { label: 'Abrir link no navegador', click: () => void shell.openExternal(link) },
        { label: 'Copiar endereço do link', click: () => clipboard.writeText(link) },
        { type: 'separator' },
      )
    }
    if (params.isEditable) {
      items.push(
        { label: 'Recortar', enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: 'Copiar', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: 'Colar', enabled: params.editFlags.canPaste, click: () => contents.paste() },
        { type: 'separator' },
      )
    } else {
      items.push({ label: 'Copiar', enabled: params.selectionText.trim() !== '', click: () => contents.copy() }, { type: 'separator' })
    }
    items.push(
      { label: 'Voltar', enabled: contents.navigationHistory.canGoBack(), click: () => void this.act(runtime.tabID, 'back') },
      { label: 'Avançar', enabled: contents.navigationHistory.canGoForward(), click: () => void this.act(runtime.tabID, 'forward') },
      { label: 'Recarregar', click: () => void this.act(runtime.tabID, 'reload') },
      { type: 'separator' },
      { label: 'Abrir no navegador', click: () => void this.act(runtime.tabID, 'openExternal') },
    )
    Menu.buildFromTemplate(items).popup({ window })
  }

  // Rolagem por endereço.

  private async capture(runtime: WebRuntime): Promise<void> {
    // Depois que a janela fecha, a vista pode já não ter webContents.
    const contents = runtime.view.webContents as Electron.WebContents | undefined
    if (!contents || runtime.hidden || contents.isDestroyed() || runtime.state.loading || runtime.state.error || Date.now() < runtime.restoringUntil) return
    const result = (await withTimeout(contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: CAPTURE_SCRIPT }]), 600).catch(
      () => null,
    )) as { url?: unknown; x?: unknown; y?: unknown; restoring?: unknown } | null
    if (!result || result.restoring === true || contents.isDestroyed()) return
    if (typeof result.url !== 'string' || result.url !== contents.getURL()) return
    if (typeof result.x !== 'number' || typeof result.y !== 'number') return
    const position = { x: result.x, y: result.y }
    if (!isValidWebPosition(position)) return
    this.service.recordWebPosition(runtime.tabID, result.url, position)
  }

  private restore(runtime: WebRuntime): void {
    const contents = runtime.view.webContents
    if (runtime.hidden || contents.isDestroyed()) return
    const position = this.service.tab(runtime.tabID)?.webPositions?.[contents.getURL()]
    if (!position || !isValidWebPosition(position) || (position.x === 0 && position.y === 0)) return
    runtime.restoringUntil = Date.now() + 1700
    void contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: restoreScript(position.x, position.y) }]).catch(() => undefined)
  }

  /** Guarda a rolagem de todas as abas abertas (fechar a janela, sair do app). */
  async captureAll(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => this.capture(runtime)))
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      const visible = [...this.runtimes.values()].find((runtime) => runtime.visible)
      if (visible) void this.capture(visible)
      else if (this.pollTimer) {
        clearInterval(this.pollTimer)
        this.pollTimer = null
      }
    }, POLL_INTERVAL)
  }

  // Posição e visibilidade.

  setViewport(tabID: string | null, bounds: ReaderRect | null): void {
    this.requested = { tabID, bounds }
    this.layout()
  }

  /** Mostra só a aba selecionada, na área informada pela janela; cria a vista na primeira vez. */
  layout(): void {
    const window = this.hooks.window()
    const selected = this.service.state.selectedID
    const { tabID, bounds } = this.requested
    if (window && tabID && tabID === selected && bounds && !this.runtimes.has(tabID)) {
      const tab = this.service.tab(tabID)
      if (tab && tab.kind === 'web' && isWebScheme(tab.location)) {
        const runtime = this.runtimeFor(tab)
        this.runtimes.set(tab.id, runtime)
        this.hooks.send({ ...runtime.state })
      }
    }
    for (const runtime of this.runtimes.values()) {
      if (runtime.hidden) continue
      const shouldShow =
        window !== undefined &&
        runtime.tabID === tabID &&
        runtime.tabID === selected &&
        bounds !== null &&
        runtime.state.error === null
      const rect = shouldShow && window ? viewportToWindowBounds(bounds, window.webContents.getZoomFactor()) : null
      if (rect && window) {
        if (runtime.window !== window) {
          this.detach(runtime)
          window.contentView.addChildView(runtime.view)
          runtime.window = window
        }
        runtime.view.setBounds(rect)
        if (!runtime.visible) {
          runtime.view.setVisible(true)
          runtime.visible = true
          this.startPolling()
        }
      } else if (runtime.visible) {
        void this.capture(runtime)
        runtime.view.setVisible(false)
        runtime.visible = false
      }
    }
  }

  private detach(runtime: WebRuntime): void {
    const window = runtime.window
    if (window && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(runtime.view)
      } catch {
        // Já removida.
      }
    }
    runtime.window = null
  }

  private destroy(runtime: WebRuntime): void {
    this.detach(runtime)
    this.runtimes.delete(runtime.tabID)
    const contents = runtime.view.webContents as Electron.WebContents | undefined
    if (contents && !contents.isDestroyed()) contents.close()
  }

  /** Fecha as vistas das abas que não existem mais e reposiciona. */
  sync(): void {
    const ids = new Set(this.service.state.tabs.map((tab) => tab.id))
    for (const runtime of [...this.runtimes.values()]) if (!runtime.hidden && !ids.has(runtime.tabID)) this.destroy(runtime)
    this.layout()
  }

  /** Restauração de backup: as abas mudam todas; as vistas são recriadas sob demanda. */
  reset(): void {
    for (const runtime of [...this.runtimes.values()]) if (!runtime.hidden) this.destroy(runtime)
  }

  /** Janela do Leitor fechada: guarda a rolagem e libera todas as páginas. */
  async closeAll(): Promise<void> {
    await withTimeout(this.captureAll(), 800)
    for (const runtime of [...this.runtimes.values()]) if (!runtime.hidden) this.destroy(runtime)
    this.requested = { tabID: null, bounds: null }
  }

  // Comandos.

  async act(tabID: string, action: ReaderWebAction, url?: string): Promise<void> {
    const runtime = this.runtimes.get(tabID)
    if (action === 'openExternal') {
      const address = runtime?.state.url ?? this.service.tab(tabID)?.location
      if (address && isWebScheme(address)) await shell.openExternal(address)
      return
    }
    if (!runtime || runtime.hidden) return
    const contents = runtime.view.webContents
    if (contents.isDestroyed()) return
    switch (action) {
      case 'back':
        if (!contents.navigationHistory.canGoBack()) return
        await withTimeout(this.capture(runtime), 300)
        contents.navigationHistory.goBack()
        return
      case 'forward':
        if (!contents.navigationHistory.canGoForward()) return
        await withTimeout(this.capture(runtime), 300)
        contents.navigationHistory.goForward()
        return
      case 'reload':
        await withTimeout(this.capture(runtime), 300)
        this.patch(runtime, { error: null, loading: true, progress: 0.1 })
        if (contents.getURL() === '' || contents.getURL().startsWith('chrome-error:') || runtime.state.error) {
          void contents.loadURL(runtime.state.url || this.service.tab(tabID)?.location || 'about:blank').catch(() => undefined)
        } else contents.reload()
        return
      case 'stop':
        contents.stop()
        this.patch(runtime, { loading: false })
        return
      case 'load':
        if (!url || !isWebScheme(url)) return
        await withTimeout(this.capture(runtime), 300)
        this.patch(runtime, { url, error: null, loading: true, progress: 0.1 })
        void contents.loadURL(url).catch(() => undefined)
        return
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomReset': {
        const level = action === 'zoomReset' ? 0 : contents.getZoomLevel() + (action === 'zoomIn' ? 0.5 : -0.5)
        contents.setZoomLevel(Math.min(4, Math.max(-3, level)))
        return
      }
    }
  }

  async selectionText(tabID: string): Promise<{ text: string; url: string } | null> {
    const runtime = this.runtimes.get(tabID)
    if (!runtime || runtime.view.webContents.isDestroyed()) return null
    const text = await withTimeout(runtime.view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: SELECTION_SCRIPT }]), 1000).catch(
      () => null,
    )
    return typeof text === 'string' ? { text, url: runtime.view.webContents.getURL() || runtime.state.url } : null
  }

  // Revisão.

  /** Texto da página para a revisão: da vista aberta ou de um carregamento oculto. */
  async reviewSource(tab: ReaderTab): Promise<ReviewMaterialSource> {
    const live = this.runtimes.get(tab.id)
    if (live && !live.hidden && !live.view.webContents.isDestroyed()) {
      if (live.state.error) throw SermonReviewMaterialError.pageUnavailable()
      const loading = live.state.loading || live.view.webContents.isLoading()
      if (loading) throw SermonReviewMaterialError.pageStillLoading()
      return makeWebReviewSource(tab, await this.extract(live))
    }
    const runtime = this.runtimeFor(tab, true)
    runtime.view.setBounds({ x: 0, y: 0, width: 1280, height: 900 })
    try {
      const outcome = await withTimeout(
        new Promise<'ok' | 'failed'>((resolve) => {
          const contents = runtime.view.webContents
          contents.once('did-stop-loading', () => resolve('ok'))
          contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
            if (isMainFrame && !isIgnorableLoadError(code)) resolve('failed')
          })
        }),
        HIDDEN_LOAD_TIMEOUT,
      )
      if (outcome === null) throw SermonReviewMaterialError.pageStillLoading()
      if (outcome === 'failed') throw SermonReviewMaterialError.sourceUnavailable(tab.title)
      return makeWebReviewSource(tab, await this.extract(runtime))
    } finally {
      const contents = runtime.view.webContents
      if (!contents.isDestroyed()) contents.close()
    }
  }

  private async extract(runtime: WebRuntime): Promise<{ title: string; text: string; url: string }> {
    const value = (await withTimeout(
      runtime.view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: REVIEW_TEXT_SCRIPT }]),
      5000,
    ).catch(() => null)) as { title?: unknown; text?: unknown; url?: unknown } | null
    if (!value || typeof value.text !== 'string') throw SermonReviewMaterialError.pageUnavailable()
    return {
      title: typeof value.title === 'string' ? value.title : '',
      text: value.text,
      url: typeof value.url === 'string' && value.url !== '' ? value.url : runtime.state.url,
    }
  }
}
