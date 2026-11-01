import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { Rectangle } from 'electron'
import { join } from 'node:path'
import type { EventChannel, EventChannels } from '@shared/ipc'
import type { WindowKind } from '@shared/types'
import type { KeyValueStore } from './storage/db'

interface WindowSpec {
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
}

const SPECS: Record<WindowKind, WindowSpec> = {
  mesa: { title: 'Pregar', width: 1600, height: 980, minWidth: 1024, minHeight: 680 },
  leitor: { title: 'Leitor · Pregar', width: 1320, height: 920, minWidth: 820, minHeight: 560 },
  biblioteca: { title: 'Biblioteca · Pregar', width: 1240, height: 840, minWidth: 860, minHeight: 560 },
  arquivo: { title: 'Arquivo · Pregar', width: 1120, height: 780, minWidth: 760, minHeight: 520 },
  biblia: { title: 'Bíblia · Pregar', width: 1080, height: 860, minWidth: 720, minHeight: 520 },
  preferencias: { title: 'Preferências · Pregar', width: 1120, height: 860, minWidth: 820, minHeight: 600 },
}

const BACKGROUND = { light: '#f5f3ee', dark: '#1e1d1b' }

export class WindowManager {
  private readonly windows = new Map<WindowKind, BrowserWindow>()
  /** Chamado quando as preferências mudam (aplica aparência). */
  onSettingsChanged: (() => void) | null = null

  constructor(private readonly bounds: KeyValueStore) {}

  get(kind: WindowKind): BrowserWindow | undefined {
    const window = this.windows.get(kind)
    return window && !window.isDestroyed() ? window : undefined
  }

  kindOf(window: BrowserWindow): WindowKind | undefined {
    for (const [kind, candidate] of this.windows) if (candidate === window) return kind
    return undefined
  }

  all(): BrowserWindow[] {
    return [...this.windows.values()].filter((window) => !window.isDestroyed())
  }

  private restoredBounds(kind: WindowKind, spec: WindowSpec): Partial<Rectangle> {
    const saved = this.bounds.get<Rectangle>(kind)
    if (saved) {
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea
        return saved.x < area.x + area.width - 80 && saved.x + saved.width > area.x + 80 && saved.y >= area.y - 20 && saved.y < area.y + area.height - 80
      })
      if (visible) return saved
    }
    const area = screen.getPrimaryDisplay().workAreaSize
    return { width: Math.min(spec.width, area.width), height: Math.min(spec.height, area.height) }
  }

  open(kind: WindowKind, route?: string): BrowserWindow {
    const existing = this.get(kind)
    if (existing) {
      if (route) this.send(existing, 'navigate', { route })
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return existing
    }
    const spec = SPECS[kind]
    const isMac = process.platform === 'darwin'
    const window = new BrowserWindow({
      ...this.restoredBounds(kind, spec),
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      title: spec.title,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
      titleBarStyle: isMac ? 'hiddenInset' : 'default',
      trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
      autoHideMenuBar: !isMac,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        additionalArguments: [`--pregar-window=${kind}`],
      },
    })
    this.windows.set(kind, window)
    window.once('ready-to-show', () => window.show())
    const saveBounds = () => {
      if (!window.isDestroyed() && !window.isMinimized() && !window.isFullScreen()) this.bounds.set(kind, window.getNormalBounds())
    }
    window.on('resized', saveBounds)
    window.on('moved', saveBounds)
    window.on('close', saveBounds)
    window.on('closed', () => this.windows.delete(kind))

    const hash = `/${kind}${route ? `?${new URLSearchParams({ to: route })}` : ''}`
    const devServer = process.env.ELECTRON_RENDERER_URL
    if (devServer) void window.loadURL(`${devServer}#${hash}`)
    else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    return window
  }

  send<E extends EventChannel>(window: BrowserWindow, event: E, payload: EventChannels[E]): void {
    if (!window.isDestroyed()) window.webContents.send('pregar:event', event, payload)
  }

  broadcast<E extends EventChannel>(event: E, payload: EventChannels[E]): void {
    if (event === 'settings:changed') this.onSettingsChanged?.()
    for (const window of this.all()) this.send(window, event, payload)
  }

  sendToFocused<E extends EventChannel>(event: E, payload: EventChannels[E]): boolean {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused || !this.kindOf(focused)) return false
    this.send(focused, event, payload)
    return true
  }
}
