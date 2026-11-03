import { app, BrowserWindow, nativeTheme, protocol, session } from 'electron'
import { appPaths } from './paths'
import { LocalDatabase } from './storage/db'
import { SettingsRepository } from './storage/settings'
import { SermonRepository } from './storage/sermons'
import { IdeaRepository } from './storage/ideas'
import { SecretStore } from './secrets'
import { FileIntegrationLog } from './log'
import { WindowManager } from './windows'
import { installGlobalSecurity } from './security'
import { installRouter } from './ipc/router'
import { registerCoreHandlers } from './ipc/core-handlers'
import { registerIdeasHandlers } from './ipc/ideas-handlers'
import { buildMenu } from './menu'
import { makeHttp, makeKV } from './context'
import type { MainContext } from './context'
import { PregarAPIClient, resolveAPIBaseURL } from './services/pregar-api'
import { AccountService } from './services/account'
import { LiturgyService } from './services/liturgy'
import { UpdaterService } from './services/updater'
import { registerExtensions } from './extensions'
import { installCrashGuards } from './crash-guard'
import { migrateLegacyUserData } from './legacy-data'
import { join } from 'node:path'

app.setName('Proper')
// Até novembro de 2026 o app chamava-se Pregar; quem já o usava encontra seus dados na pasta nova.
try {
  migrateLegacyUserData(join(app.getPath('appData'), 'Pregar'), app.getPath('userData'))
} catch (error) {
  console.error('Não foi possível migrar a pasta de dados antiga:', error)
}
installCrashGuards(join(app.getPath('userData'), 'Logs'))
// Protocolos próprios precisam ser declarados antes do app ficar pronto.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pregar-pdf',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
  {
    scheme: 'pregar-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
])
app.setAppUserModelId('br.caminhoanglicano.proper')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()
  installGlobalSecurity()
  installRouter()

  const paths = appPaths()
  const database = new LocalDatabase(paths.database)
  const kv = makeKV(database)
  const settings = new SettingsRepository(database)
  const integrationLog = new FileIntegrationLog(paths.logs)
  const secrets = new SecretStore(paths.secrets)
  const windows = new WindowManager(kv('window-bounds'))
  const http = makeHttp(integrationLog)
  const apiBaseURL = () => resolveAPIBaseURL(settings.get().apiBaseURL)
  const api = new PregarAPIClient(
    () => http(),
    apiBaseURL,
    () => secrets.get('pregarSession'),
  )
  const account = new AccountService(api, secrets, kv('account'), apiBaseURL, (state) =>
    windows.broadcast('account:changed', state),
  )
  const liturgy = new LiturgyService({
    http: () => http(),
    settings: () => settings.get(),
    secrets,
    account,
    cache: kv('liturgy-cache'),
    apiBaseURL,
  })
  const updater = new UpdaterService((status) => windows.broadcast('updates:status', status))
  // Degustação sem conta: descobre se a API pública está ligada e avisa as janelas quando o acesso muda.
  const refreshPreview = (force = false) =>
    liturgy
      .refreshPreviewStatus(force)
      .then((changed) => {
        if (changed) windows.broadcast('account:changed', account.current())
      })
      .catch(() => undefined)

  const context: MainContext = {
    paths,
    database,
    settings,
    sermons: new SermonRepository(database),
    ideas: new IdeaRepository(database),
    secrets,
    integrationLog,
    windows,
    api,
    account,
    liturgy,
    updater,
    apiBaseURL,
    http,
    kv,
    currentSettings: () => settings.get(),
    modules: {},
  }

  let lastAPIBaseURL = settings.get().apiBaseURL
  const applyAppearance = () => {
    nativeTheme.themeSource = settings.get().appearance
    windows.applyTextScale(settings.get().textScale)
    // Outro servidor do Proper pode ter a degustação ligada ou desligada.
    if (settings.get().apiBaseURL !== lastAPIBaseURL) {
      lastAPIBaseURL = settings.get().apiBaseURL
      void refreshPreview(true)
    }
  }
  applyAppearance()
  if (process.platform !== 'darwin') session.defaultSession.setSpellCheckerLanguages(['pt-BR', 'en-US'])

  registerCoreHandlers(context)
  registerIdeasHandlers(context)
  registerExtensions(context)

  buildMenu({
    openWindow: (kind) => windows.open(kind),
    command: (command) => {
      if (!windows.sendToFocused('menu:command', { command })) windows.open('mesa')
    },
    revealLog: () =>
      void import('electron').then(({ shell }) => shell.showItemInFolder(integrationLog.ensureFile())),
    checkUpdates: () => void updater.check(),
    privacyURL: () => {
      try {
        return `${apiBaseURL()}/legal/privacidade`
      } catch {
        return 'https://caminhoanglicano.com.br'
      }
    },
  })

  windows.open('mesa')
  void account.refresh(false).catch(() => undefined)
  void refreshPreview()
  setInterval(() => void refreshPreview(), 6 * 60 * 60 * 1000)
  if (settings.get().updates.automatic) setTimeout(() => void updater.check(), 15_000)

  app.on('second-instance', () => windows.open('mesa'))
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.open('mesa')
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    windows.quitting = true
  })
  // O banco só fecha depois que todas as janelas fecharam (e salvaram o que estava pendente).
  app.on('will-quit', (event) => {
    // Um módulo adiou a saída para terminar de salvar; o banco fecha na próxima tentativa.
    if (event.defaultPrevented) return
    try {
      database.close()
    } catch {
      // Já fechado.
    }
  })
  // Mudanças de aparência nas Preferências valem para todas as janelas.
  windows.onSettingsChanged = applyAppearance
}
