import { net } from 'electron'
import type { HttpContext } from '@pregar/core/util/http'
import type { AppSettings } from '@shared/settings'
import type { AppPaths } from './paths'
import type { LocalDatabase } from './storage/db'
import { KeyValueStore } from './storage/db'
import type { SettingsRepository } from './storage/settings'
import type { SermonRepository } from './storage/sermons'
import type { SecretStore } from './secrets'
import type { FileIntegrationLog } from './log'
import type { WindowManager } from './windows'
import type { AccountService } from './services/account'
import type { LiturgyService } from './services/liturgy'
import type { PregarAPIClient } from './services/pregar-api'
import type { UpdaterService } from './services/updater'

/** Serviços do processo principal, montados uma vez em `index.ts` e passados aos módulos de IPC. */
export interface MainContext {
  paths: AppPaths
  database: LocalDatabase
  settings: SettingsRepository
  sermons: SermonRepository
  secrets: SecretStore
  integrationLog: FileIntegrationLog
  windows: WindowManager
  api: PregarAPIClient
  account: AccountService
  liturgy: LiturgyService
  updater: UpdaterService
  apiBaseURL(): string
  http(signal?: AbortSignal): HttpContext
  kv(namespace: string): KeyValueStore
  currentSettings(): AppSettings
}

/** fetch do Chromium (proxy e certificados do sistema), com o registro de integrações. */
export function makeHttp(log: FileIntegrationLog) {
  return (signal?: AbortSignal): HttpContext => ({
    fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    log: log.log,
    signal,
  })
}

export function makeKV(database: LocalDatabase) {
  const stores = new Map<string, KeyValueStore>()
  return (namespace: string): KeyValueStore => {
    let store = stores.get(namespace)
    if (!store) {
      store = new KeyValueStore(database, namespace)
      stores.set(namespace, store)
    }
    return store
  }
}
