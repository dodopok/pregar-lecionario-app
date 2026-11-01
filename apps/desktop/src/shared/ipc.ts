import type {
  AccountView,
  BillingCycle,
  PaymentView,
  PlansView,
  SessionView,
  SubscriptionView,
} from '@pregar/core/plans/contract'
import type {
  BiblePassageText,
  BibleVersion,
  LiturgicalDay,
  PrayerBookCatalogEntry,
} from '@pregar/core/liturgy/types'
import type { AIEventChannels, AIInvokeChannels } from './ipc-ai'
import type { ContentEventChannels, ContentInvokeChannels } from './ipc-content'
import type { LibraryEventChannels, LibraryInvokeChannels } from './ipc-library'
import type { ReaderEventChannels, ReaderInvokeChannels } from './ipc-reader'
import type { AppSettings, SettingsPatch } from './settings'
import type {
  AppInfo,
  ArchiveSearchMode,
  SecretName,
  SecretStatus,
  SermonPatch,
  SermonRecord,
  SermonSummary,
  WindowKind,
} from './types'

/**
 * Canais de invocação (janela → processo principal). Cada entrada define a requisição e a resposta.
 * Módulos que dependem de outros serviços acrescentam canais em `ipc-*.ts` e os unem aqui.
 */
export interface CoreInvokeChannels {
  'app:info': { req: void; res: AppInfo }
  'app:openWindow': { req: { window: WindowKind; route?: string }; res: void }
  'app:openExternal': { req: { url: string }; res: void }
  'app:showItemInFolder': { req: { path: string }; res: void }
  'app:chooseFolder': { req: { title: string }; res: string | null }
  'app:chooseFiles': { req: { title: string; extensions: string[]; multiple: boolean }; res: string[] }
  'app:setTitle': { req: { title: string }; res: void }
  /** A janela salva antes de fechar: o processo principal espera `app:closeReady` (até 2 s). */
  'app:guardClose': { req: { enabled: boolean }; res: void }
  'app:closeReady': { req: void; res: void }

  'settings:get': { req: void; res: AppSettings }
  'settings:update': { req: SettingsPatch; res: AppSettings }

  'secrets:status': { req: void; res: SecretStatus }
  'secrets:set': { req: { name: SecretName; value: string }; res: SecretStatus }
  'secrets:delete': { req: { name: SecretName }; res: SecretStatus }

  'account:get': { req: { refresh?: boolean }; res: AccountState }
  'account:startLogin': { req: { email: string }; res: { expiresInMinutes: number } }
  'account:verifyLogin': { req: { email: string; code: string }; res: AccountState }
  'account:logout': { req: void; res: AccountState }
  'account:rename': { req: { name: string }; res: AccountState }
  'account:sessions': { req: void; res: SessionView[] }
  'account:revokeSession': { req: { id: string }; res: SessionView[] }
  'account:export': { req: void; res: { path: string } | null }
  'account:delete': { req: { confirm: string }; res: AccountState }

  'billing:plans': { req: void; res: PlansView }
  'billing:checkout': { req: { cycle: BillingCycle; name: string; cpfCnpj: string }; res: SubscriptionView }
  'billing:subscription': { req: void; res: SubscriptionView | null }
  'billing:cancel': { req: void; res: SubscriptionView | null }
  'billing:payments': { req: void; res: PaymentView[] }

  'liturgy:day': { req: { dateKey: string }; res: LiturgicalDay }
  'liturgy:calendar': { req: { from: string; to: string }; res: LiturgicalDay[] }
  'liturgy:passage': { req: { reference: string; bible: string }; res: BiblePassageText }
  'liturgy:bibleVersions': { req: void; res: BibleVersion[] }
  'liturgy:prayerBooks': { req: void; res: PrayerBookCatalogEntry[] }
  'liturgy:status': { req: void; res: LiturgyAccess }

  'sermons:get': { req: { dateKey: string }; res: SermonRecord | null }
  'sermons:save': { req: { dateKey: string; patch: SermonPatch }; res: SermonRecord }
  'sermons:list': { req: void; res: SermonSummary[] }
  'sermons:search': { req: { mode: ArchiveSearchMode; query: string }; res: SermonSummary[] }
  'sermons:states': { req: { from: string; to: string }; res: Record<string, SermonSummary['state']> }

  'logs:tail': { req: { lines?: number }; res: { path: string; text: string } }
  'logs:clear': { req: void; res: void }
  'logs:reveal': { req: void; res: void }

  'updates:check': { req: void; res: UpdateStatus }
  'updates:install': { req: void; res: void }
}

export interface AccountState {
  loggedIn: boolean
  /** Conta carregada do servidor; ausente quando offline ou sem login. */
  account: AccountView | null
  email: string | null
  offline: boolean
  apiBaseURL: string
}

/** Como as leituras estão sendo obtidas agora. */
export interface LiturgyAccess {
  mode: 'proxy' | 'direct' | 'none'
  message: string
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'unsupported'
  version?: string
  progress?: number
  message?: string
}

/** Eventos enviados pelo processo principal às janelas. */
export interface CoreEventChannels {
  'settings:changed': AppSettings
  'account:changed': AccountState
  'sermon:changed': { dateKey: string; origin: number }
  'updates:status': UpdateStatus
  /** Comando de menu ou atalho global encaminhado à janela em foco. */
  'menu:command': { command: string; payload?: unknown }
  'navigate': { route: string }
  /** A janela vai fechar: salve o que estiver pendente e responda com `app:closeReady`. */
  'app:willClose': undefined
}

export type InvokeChannels = CoreInvokeChannels & ExtraInvokeChannels
export type EventChannels = CoreEventChannels & ExtraEventChannels

// Canais dos módulos (IA, conteúdo, Leitor, Biblioteca), declarados em arquivos próprios.
export interface ExtraInvokeChannels extends AIInvokeChannels, ContentInvokeChannels, ReaderInvokeChannels, LibraryInvokeChannels {}
export interface ExtraEventChannels extends AIEventChannels, ContentEventChannels, ReaderEventChannels, LibraryEventChannels {}

export type InvokeChannel = keyof InvokeChannels
export type InvokeRequest<C extends InvokeChannel> = InvokeChannels[C]['req']
export type InvokeResponse<C extends InvokeChannel> = InvokeChannels[C]['res']
export type EventChannel = keyof EventChannels

export interface PregarBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]): Promise<InvokeResponse<C>>
  on<E extends EventChannel>(event: E, handler: (payload: EventChannels[E]) => void): () => void
  platform: 'darwin' | 'win32' | 'linux'
  windowKind: string
}
