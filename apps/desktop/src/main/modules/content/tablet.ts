import { BrowserWindow, app, dialog, session } from 'electron'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { SERMON_KEY_PATTERN } from '@pregar/core/util/dates'
import serifNormal from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2?asset'
import serifItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2?asset'
import sansNormal from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?asset'
import sansItalic from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-italic.woff2?asset'
import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'
import { withEmbeddedFonts } from './print-fonts'
import type { EmbeddedFont } from './print-fonts'

/**
 * Fontes embutidas do app que a folha do púlpito pode usar: Source Serif 4 e Source Sans 3, as mesmas
 * da interface. Os arquivos saem do pacote pelo electron-vite (`?asset`) e entram no HTML em base64.
 */
const EMBEDDED_FONTS: EmbeddedFont[] = [
  {
    family: 'Source Serif 4',
    files: [
      { path: serifNormal, style: 'normal' },
      { path: serifItalic, style: 'italic' },
    ],
  },
  {
    family: 'Source Sans 3',
    files: [
      { path: sansNormal, style: 'normal' },
      { path: sansItalic, style: 'italic' },
    ],
  },
]

/** Pasta do Google Drive para computador, quando montada (sugestão de destino da cópia do tablet). */
export function googleDriveFolder(): string | null {
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    const cloud = join(homedir(), 'Library', 'CloudStorage')
    if (existsSync(cloud)) {
      for (const entry of readdirSync(cloud)) {
        if (entry.startsWith('GoogleDrive-'))
          candidates.push(join(cloud, entry, 'My Drive'), join(cloud, entry, 'Meu Drive'))
      }
    }
  } else if (process.platform === 'win32') {
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZ') {
      candidates.push(`${letter}:\\My Drive`, `${letter}:\\Meu Drive`)
    }
  }
  candidates.push(join(homedir(), 'Google Drive'), join(homedir(), 'Google Drive', 'My Drive'))
  return candidates.find((path) => existsSync(path)) ?? null
}

function safeFileName(value: string): string {
  // Caracteres proibidos em nomes de arquivo no Windows e no macOS, inclusive os de controle.
  const cleaned = Array.from(value, (char) =>
    char.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(char) ? '-' : char,
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Sermão').slice(0, 120)
}

/** Janela oculta com o HTML da folha, sem scripts e sem acesso à rede (usada para PDF e impressão). */
async function openPrintWindow(html: string, parent?: BrowserWindow): Promise<BrowserWindow> {
  const partition = 'tablet-print'
  const printSession = session.fromPartition(partition, { cache: false })
  printSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') })
  })
  const window = new BrowserWindow({
    show: false,
    parent,
    width: 900,
    height: 1200,
    webPreferences: {
      partition,
      sandbox: true,
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  await window.loadURL(
    `data:text/html;charset=utf-8;base64,${Buffer.from(withEmbeddedFonts(html, EMBEDDED_FONTS), 'utf8').toString('base64')}`,
  )
  return window
}

/** Gera o PDF de leitura em uma janela oculta, sem scripts e sem acesso à rede. */
async function renderPdf(html: string): Promise<Buffer> {
  const window = await openPrintWindow(html)
  try {
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      displayHeaderFooter: false,
    })
  } finally {
    window.destroy()
  }
}

/** Abre o diálogo de impressão do sistema para a folha; cancelar não é erro. */
async function printHtml(
  html: string,
  parent?: BrowserWindow,
): Promise<{ printed: boolean; message: string | null }> {
  const window = await openPrintWindow(html, parent)
  try {
    return await new Promise((resolve) => {
      window.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        if (success) {
          resolve({ printed: true, message: null })
          return
        }
        const cancelled = !failureReason || /cancel/i.test(failureReason)
        resolve({ printed: false, message: cancelled ? null : `Não foi possível imprimir: ${failureReason}` })
      })
    })
  } finally {
    window.destroy()
  }
}

export function registerTablet(context: MainContext): void {
  handle('tablet:suggestedFolder', () => googleDriveFolder())
  handle('tablet:export', async ({ dateKey, html, title, choosePath }, event) => {
    const key = z.string().regex(SERMON_KEY_PATTERN).parse(dateKey)
    const content = z.string().min(1).max(30_000_000).parse(html)
    const record = context.sermons.get(key)
    let path = record?.tabletPdfPath ?? null
    if (choosePath || !path) {
      const folder =
        context.currentSettings().tablet.lastExportFolder ?? googleDriveFolder() ?? app.getPath('documents')
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const result = await dialog.showSaveDialog(parent!, {
        title: 'Salvar cópia para o tablet',
        defaultPath: join(folder, `${key} - ${safeFileName(title)}.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return null
      path = result.filePath.toLowerCase().endsWith('.pdf') ? result.filePath : `${result.filePath}.pdf`
      context.settings.update({ tablet: { lastExportFolder: join(path, '..') } })
    }
    const pdf = await renderPdf(content)
    writeFileSync(path, pdf)
    const updated = context.sermons.save(key, {
      tabletPdfPath: path,
      tabletPdfUpdatedAt: new Date().toISOString(),
    })
    context.windows.broadcast('sermon:changed', { dateKey: key, origin: event.sender.id })
    return { path, record: updated }
  })
  handle('tablet:print', async ({ html }, event) => {
    const content = z.string().min(1).max(30_000_000).parse(html)
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return printHtml(content, parent)
  })
  handle('tablet:saveText', async ({ dateKey, text, title }, event) => {
    const key = z.string().regex(SERMON_KEY_PATTERN).parse(dateKey)
    const content = z.string().max(5_000_000).parse(text)
    const folder = context.currentSettings().tablet.lastExportFolder ?? app.getPath('documents')
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(parent!, {
      title: 'Salvar como texto simples',
      defaultPath: join(folder, `${key} - ${safeFileName(title)}.txt`),
      filters: [{ name: 'Texto', extensions: ['txt'] }],
    })
    if (result.canceled || !result.filePath) return null
    const path = result.filePath.toLowerCase().endsWith('.txt') ? result.filePath : `${result.filePath}.txt`
    writeFileSync(path, content, 'utf8')
    return { path }
  })
}
