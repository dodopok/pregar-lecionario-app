import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'

const { autoUpdater } = electronUpdater

/** Atualização automática pelo GitHub Releases (instaladores assinados). */
export class UpdaterService {
  private status: UpdateStatus = { state: 'idle' }

  constructor(private readonly emit: (status: UpdateStatus) => void) {
    if (!this.supported()) {
      this.status = { state: 'unsupported', message: 'Atualização automática indisponível nesta instalação.' }
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', message: 'Você já tem a versão mais recente.' }))
    autoUpdater.on('download-progress', (progress) => this.set({ state: 'downloading', progress: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ state: 'ready', version: info.version, message: 'A atualização será instalada ao reiniciar.' }),
    )
    autoUpdater.on('error', (error) => this.set({ state: 'error', message: `Não foi possível atualizar: ${error.message}` }))
  }

  private supported(): boolean {
    if (!app.isPackaged) return false
    // Pacotes .deb e instalações por gerenciador atualizam pelo próprio sistema.
    if (process.platform === 'linux' && !process.env.APPIMAGE) return false
    return true
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.emit(status)
  }

  current(): UpdateStatus {
    return this.status
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported()) return this.status
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.set({ state: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return this.status
  }

  install(): void {
    if (this.status.state === 'ready') autoUpdater.quitAndInstall()
  }
}
