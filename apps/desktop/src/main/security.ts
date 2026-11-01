import { app, session, shell } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'node:path'
import { makeAppURLCheck } from './app-url'

let appURLCheck: ((url: string) => boolean) | null = null

/** Origens das janelas do app (arquivos da interface empacotada ou servidor do Vite em desenvolvimento). */
export function isAppURL(url: string): boolean {
  appURLCheck ??= makeAppURLCheck(join(__dirname, '../renderer'), process.env.ELECTRON_RENDERER_URL)
  return appURLCheck(url)
}

const SAFE_EXTERNAL = new Set(['https:', 'mailto:'])

export function openExternalSafely(url: string): void {
  try {
    const parsed = new URL(url)
    if (SAFE_EXTERNAL.has(parsed.protocol)) void shell.openExternal(parsed.toString())
  } catch {
    // URL inválida: ignora.
  }
}

/**
 * Regras globais: nenhuma janela do app navega para fora, abre popups ou recebe permissões
 * (câmera, notificações etc.). Links externos vão para o navegador padrão.
 */
export function installGlobalSecurity(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // As abas web do Leitor têm suas próprias regras (ver ReaderWebManager).
    if ((contents as WebContents & { pregarReaderTab?: boolean }).pregarReaderTab) return
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!isAppURL(url)) {
        event.preventDefault()
        openExternalSafely(url)
      }
    })
  })

  for (const target of [session.defaultSession]) {
    target.setPermissionRequestHandler((_contents, permission, callback) => {
      // Área de transferência para copiar texto formatado; nada além disso.
      callback(permission === 'clipboard-sanitized-write')
    })
    target.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')
  }
}
