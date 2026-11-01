import { BrowserWindow, app, dialog, session } from 'electron'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'

/** Pasta do Google Drive para computador, quando montada (sugestão de destino da cópia do tablet). */
export function googleDriveFolder(): string | null {
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    const cloud = join(homedir(), 'Library', 'CloudStorage')
    if (existsSync(cloud)) {
      for (const entry of readdirSync(cloud)) {
        if (entry.startsWith('GoogleDrive-')) candidates.push(join(cloud, entry, 'My Drive'), join(cloud, entry, 'Meu Drive'))
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
  const cleaned = Array.from(value, (char) => (char.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(char) ? '-' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Sermão').slice(0, 120)
}

/** Gera o PDF de leitura em uma janela oculta, sem scripts e sem acesso à rede. */
async function renderPdf(html: string): Promise<Buffer> {
  const partition = 'tablet-print'
  const printSession = session.fromPartition(partition, { cache: false })
  printSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') })
  })
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { partition, sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`)
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

export function registerTablet(context: MainContext): void {
  handle('tablet:suggestedFolder', () => googleDriveFolder())
  handle('tablet:export', async ({ dateKey, html, title, choosePath }, event) => {
    const key = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dateKey)
    const content = z.string().min(1).max(30_000_000).parse(html)
    const record = context.sermons.get(key)
    let path = record?.tabletPdfPath ?? null
    if (choosePath || !path) {
      const folder = context.currentSettings().tablet.lastExportFolder ?? googleDriveFolder() ?? app.getPath('documents')
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
    const updated = context.sermons.save(key, { tabletPdfPath: path, tabletPdfUpdatedAt: new Date().toISOString() })
    context.windows.broadcast('sermon:changed', { dateKey: key, origin: event.sender.id })
    return { path, record: updated }
  })
}
