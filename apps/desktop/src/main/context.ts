import { net } from 'electron'
import type { HttpContext } from '@pregar/core/util/http'
import type { AppSettings } from '@shared/settings'
import type { AppPaths } from './paths'
import type { LocalDatabase } from './storage/db'
import { KeyValueStore } from './storage/db'
import type { SettingsRepository } from './storage/settings'
import type { SermonRepository } from './storage/sermons'
import type { IdeaRepository } from './storage/ideas'
import type { SecretStore } from './secrets'
import type { FileIntegrationLog } from './log'
import type { WindowManager } from './windows'
import type { AccountService } from './services/account'
import type { LiturgyService } from './services/liturgy'
import type { PregarAPIClient } from './services/pregar-api'
import type { UpdaterService } from './services/updater'
import type { ReviewMaterialSource } from '@pregar/core/library'

/** Acesso da revisão e do Leitor à Biblioteca (implementado pelo módulo da Biblioteca). */
export interface LibraryAccess {
  /** Extrai o texto da seção do PDF marcada para revisão (limites de 24 KB e 36 páginas). */
  extractReviewSources(input: { path: string; title: string; reference: string | null; physicalPage: number }): Promise<ReviewMaterialSource[]>
  /** O PDF está na Biblioteca (somente esses são servidos ao Leitor). */
  isRegisteredPath(path: string): boolean
  /** URL do protocolo pregar-pdf para abrir o arquivo no visor. */
  pdfURL(path: string): string
  /** Importa e indexa PDFs já gravados em disco (usado pela importação de pasta pública do Drive). */
  importFiles(paths: string[]): Promise<void>
  /** Registros da Biblioteca no JSON do domínio (encodeLibraryRecord), para o backup. */
  exportRecords(): unknown[]
  /** Substitui todos os registros (restauração de backup); reindexa em segundo plano o que precisar. */
  replaceRecords(records: unknown[]): Promise<void>
  /** Páginas lembradas por "caminho|referência", para o backup. */
  exportSectionLinks(): Record<string, number>
  replaceSectionLinks(links: Record<string, number>): void
}

/** Materiais da preparação marcados para revisão no Leitor (implementado pelo módulo do Leitor). */
export interface ReviewMaterialsProvider {
  /** Lista os materiais marcados, sem extrair texto. */
  marked(dateKey: string): { id: string; kind: 'pdf' | 'web'; title: string; citation: string }[]
  /** Extrai o texto dos materiais marcados; lança erro com mensagem em português se algum falhar. */
  collect(dateKey: string, mainReference: string): Promise<ReviewMaterialSource[]>
  /** Arquivo do Leitor no JSON do domínio (encodeReaderArchive), para o backup. */
  exportArchive(): unknown
  /** Substitui o arquivo do Leitor (restauração de backup) e atualiza a janela aberta. */
  replaceArchive(archive: unknown): void
}

/** Serviços do processo principal, montados uma vez em `index.ts` e passados aos módulos de IPC. */
export interface MainContext {
  paths: AppPaths
  database: LocalDatabase
  settings: SettingsRepository
  sermons: SermonRepository
  ideas: IdeaRepository
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
  /** Preenchidos pelos módulos ao registrar seus canais. */
  modules: { library?: LibraryAccess; reviewMaterials?: ReviewMaterialsProvider }
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
