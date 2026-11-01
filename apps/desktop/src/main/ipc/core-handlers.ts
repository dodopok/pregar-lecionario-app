import { app, BrowserWindow, dialog, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { MainContext } from '../context'
import { openExternalSafely } from '../security'
import { handle, UserFacingError } from './router'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const secretName = z.enum(['estevao', 'openai', 'anthropic', 'google', 'perplexity', 'driveApiKey'])

export function registerCoreHandlers(context: MainContext): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    arch: process.arch,
    userDataPath: context.paths.root,
    isPackaged: app.isPackaged,
    electron: process.versions.electron ?? '',
  }))
  handle('app:openWindow', ({ window, route }) => {
    context.windows.open(z.enum(['mesa', 'leitor', 'biblioteca', 'arquivo', 'biblia', 'preferencias']).parse(window), route)
  })
  handle('app:openExternal', ({ url }) => openExternalSafely(z.string().url().parse(url)))
  handle('app:showItemInFolder', ({ path }) => shell.showItemInFolder(z.string().min(1).parse(path)))
  handle('app:chooseFolder', async ({ title }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('app:chooseFiles', async ({ title, extensions, multiple }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(window!, {
      title,
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: extensions.join(', ').toUpperCase(), extensions }],
    })
    return result.canceled ? [] : result.filePaths
  })
  handle('app:setTitle', ({ title }, event) => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(String(title).slice(0, 200))
  })

  handle('settings:get', () => context.settings.get())
  handle('settings:update', (patch) => {
    const next = context.settings.update(patch ?? {})
    context.windows.broadcast('settings:changed', next)
    return next
  })

  handle('secrets:status', () => context.secrets.status())
  handle('secrets:set', ({ name, value }) => {
    const parsed = secretName.parse(name)
    const text = z.string().max(4000).parse(value)
    if (!context.secrets.encryptionAvailable && process.platform === 'linux') {
      // Sem libsecret/kwallet, o Electron não cifra; avisamos em vez de gravar em texto puro silenciosamente.
      throw new UserFacingError(
        'O cofre de senhas do sistema não está disponível. Instale o gnome-keyring (ou KWallet) e abra o Pregar de novo para salvar chaves.',
      )
    }
    context.secrets.set(parsed, text)
    return context.secrets.status()
  })
  handle('secrets:delete', ({ name }) => {
    context.secrets.delete(secretName.parse(name))
    return context.secrets.status()
  })

  handle('account:get', async ({ refresh }) => {
    if (refresh) {
      try {
        return await context.account.refresh(true)
      } catch {
        return context.account.current()
      }
    }
    void context.account.refresh(false).catch(() => undefined)
    return context.account.current()
  })
  handle('account:startLogin', ({ email }) => context.account.startLogin(z.string().trim().toLowerCase().email().parse(email)))
  handle('account:verifyLogin', ({ email, code }) =>
    context.account.verifyLogin(z.string().trim().toLowerCase().email().parse(email), z.string().trim().regex(/^\d{6}$/).parse(code)),
  )
  handle('account:logout', () => context.account.logout())
  handle('account:rename', ({ name }) => context.account.rename(z.string().trim().min(1).max(120).parse(name)))
  handle('account:sessions', () => context.account.sessions())
  handle('account:revokeSession', ({ id }) => context.account.revokeSession(z.string().uuid().parse(id)))
  handle('account:export', async (_request, event) => {
    const data = await context.account.exportData()
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(window!, {
      title: 'Salvar dados da conta',
      defaultPath: join(app.getPath('documents'), 'pregar-conta.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8')
    return { path: result.filePath }
  })
  handle('account:delete', ({ confirm }) => context.account.deleteAccount(z.literal('APAGAR').parse(confirm)))

  handle('billing:plans', () => context.account.plans())
  handle('billing:checkout', (input) =>
    context.account.checkout({
      cycle: z.enum(['monthly', 'yearly']).parse(input.cycle),
      name: z.string().trim().min(3).max(120).parse(input.name),
      cpfCnpj: z.string().trim().max(20).parse(input.cpfCnpj),
    }),
  )
  handle('billing:subscription', () => context.account.subscription())
  handle('billing:cancel', () => context.account.cancel())
  handle('billing:payments', () => context.account.payments())

  handle('liturgy:status', () => context.liturgy.access())
  handle('liturgy:day', ({ dateKey: key }) => context.liturgy.day(dateKey.parse(key)))
  handle('liturgy:calendar', ({ from, to }) => context.liturgy.calendar(dateKey.parse(from), dateKey.parse(to)))
  handle('liturgy:passage', ({ reference, bible }) =>
    context.liturgy.passage(z.string().trim().min(1).max(200).parse(reference), z.string().trim().min(1).max(20).parse(bible)),
  )
  handle('liturgy:bibleVersions', () => context.liturgy.bibleVersions())
  handle('liturgy:prayerBooks', () => context.liturgy.prayerBooks())

  handle('sermons:get', ({ dateKey: key }) => context.sermons.get(dateKey.parse(key)))
  handle('sermons:save', ({ dateKey: key, patch }, event) => {
    const record = context.sermons.save(dateKey.parse(key), patch ?? {})
    context.windows.broadcast('sermon:changed', { dateKey: record.dateKey, origin: event.sender.id })
    return record
  })
  handle('sermons:list', () => context.sermons.list())
  handle('sermons:search', ({ mode, query }) =>
    context.sermons.search(z.enum(['passage', 'occasion', 'date', 'text']).parse(mode), z.string().max(200).parse(query)),
  )
  handle('sermons:states', ({ from, to }) => context.sermons.states(dateKey.parse(from), dateKey.parse(to)))

  handle('logs:tail', ({ lines }) => ({ path: context.integrationLog.file, text: context.integrationLog.tail(lines ?? 400) }))
  handle('logs:clear', () => context.integrationLog.clear())
  handle('logs:reveal', () => shell.showItemInFolder(context.integrationLog.ensureFile()))

  handle('updates:check', () => context.updater.check())
  handle('updates:install', () => context.updater.install())
}
