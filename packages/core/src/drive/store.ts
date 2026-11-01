/**
 * Estado e regras da integração com o Google Drive dos sermões, sem interface: conexão OAuth,
 * pasta `Sermões`, vínculo de cada sermão com seu Google Doc, sincronização com controle de
 * revisão e o documento de ideias. Persistência, cofre de tokens e relógio são injetados.
 */

import type { RichDocument } from '../document/model'
import { dateKey } from '../util/dates'
import type { HttpContext } from '../util/http'
import { GoogleDriveAPI, GOOGLE_FOLDER_MIME_TYPE, googleDocURL } from './api'
import type { GoogleDriveFile } from './api'
import { googleDocsContentFromDocument, googleDocsContentHash } from './docs-content'
import { GoogleDriveError, localizedDescription } from './errors'
import { authorizeGoogleDrive, isRejectedRefreshToken, refreshGoogleAccessToken } from './oauth'
import type {
  GoogleOAuthClientConfig,
  GoogleOAuthFlowOptions,
  GoogleOAuthTokens,
  LoopbackReceiver,
} from './oauth'

export const DRIVE_SERMON_FOLDER_NAME = 'Sermões'
export const DRIVE_IDEAS_DOCUMENT_TITLE = 'Ideias de sermões'
/** Pausa depois da última edição antes da sincronização automática de um sermão já vinculado. */
export const DRIVE_AUTO_SYNC_DELAY_MS = 2_000
/** Margem antes do vencimento do access token. */
const TOKEN_EXPIRY_MARGIN_SECONDS = 60

/** Chaves das preferências locais da integração (os mesmos nomes do `UserDefaults` do app Swift). */
export type GoogleDriveSettingKey =
  | 'drive.sermonFolderID'
  | 'drive.ideasDocumentID'
  | 'drive.ideasDocumentKey'
  | 'drive.ideasText'
  | 'drive.ideasUpdatedAt'

export interface GoogleDriveSettings {
  get(key: GoogleDriveSettingKey): Promise<string | null>
  /** `null` remove a chave. Deve resolver só depois de gravado. */
  set(key: GoogleDriveSettingKey, value: string | null): Promise<void>
}

/** Cofre do refresh token (Acesso às Chaves no macOS; `safeStorage` no Electron). */
export interface GoogleDriveRefreshTokenStore {
  read(): Promise<string | null>
  save(token: string): Promise<void>
  delete(): Promise<void>
}

/** Vínculo de um sermão com o Google Doc (campos `googleDrive*` do `SermonDraft`). */
export interface GoogleDriveSermonLink {
  /** Chave privada estável gravada no Doc (`appProperties`), criada antes da primeira chamada de rede. */
  draftKey?: string | null
  documentId?: string | null
  /** Última revisão escrita pelo app. */
  revisionId?: string | null
  syncedAt?: Date | null
  /** Hash do conteúdo enviado na última sincronização. */
  syncedContentHash?: string | null
  syncError?: string | null
}

export interface GoogleDriveSermonDraft {
  title: string
  mainReadingReference?: string | null
  /** Data litúrgica, ou a chave yyyy-MM-dd. */
  liturgicalDate: Date | string
  document: RichDocument
  /** Estado mais recente do vínculo, como está gravado. */
  drive: GoogleDriveSermonLink
}

/** Grava o vínculo do sermão; deve resolver só depois de persistido em disco. */
export type GoogleDriveSermonLinkWriter = (link: GoogleDriveSermonLink) => Promise<void>

export type GoogleDriveAutoSyncResult = 'synced' | 'notConnected' | 'notLinked' | 'unchanged' | 'busy'

export interface GoogleDriveStoreState {
  isLoading: boolean
  isConnected: boolean
  isConnecting: boolean
  isSaving: boolean
  ideasDocumentId: string | null
  ideasText: string
  ideasUpdatedAt: Date | null
  errorMessage: string | null
}

export interface GoogleDriveStoreOptions {
  http: HttpContext
  /** Cliente OAuth do produto (configuração do app). */
  client: GoogleOAuthClientConfig
  settings: GoogleDriveSettings
  refreshTokens: GoogleDriveRefreshTokenStore
  /** Necessário para conectar pela primeira vez: servidor de loopback e abertura do navegador. */
  authorization?: {
    receiver: () => LoopbackReceiver
    openBrowser: GoogleOAuthFlowOptions['openBrowser']
    timeoutMs?: number
  }
  now?: () => Date
  /** Gera as chaves privadas dos documentos (UUID por padrão). */
  makeKey?: () => string
  /** Substitui o cliente da API (testes); o store passa a se considerar conectado. */
  api?: GoogleDriveAPI
  onChange?: (state: GoogleDriveStoreState) => void
}

/** Hash do manuscrito na forma enviada ao Google Docs. */
export function driveSermonContentHash(document: RichDocument): Promise<string> {
  return googleDocsContentHash(googleDocsContentFromDocument(document))
}

/** Nome do Google Doc: "2026-11-01 - Título" (ou a leitura principal, ou "Sermão"). */
export function driveSermonDocumentTitle(
  draft: Pick<GoogleDriveSermonDraft, 'title' | 'mainReadingReference' | 'liturgicalDate'>,
): string {
  const subject = draft.title.trim() === '' ? (draft.mainReadingReference ?? 'Sermão') : draft.title
  const date = typeof draft.liturgicalDate === 'string' ? draft.liturgicalDate : dateKey(draft.liturgicalDate)
  return `${date} - ${subject}`
}

export class GoogleDriveStore {
  private current: GoogleDriveStoreState = {
    isLoading: true,
    isConnected: false,
    isConnecting: false,
    isSaving: false,
    ideasDocumentId: null,
    ideasText: '',
    ideasUpdatedAt: null,
    errorMessage: null,
  }
  private refreshToken: string | null = null
  private cachedAccessToken: string | null = null
  private accessTokenExpiresAt = 0
  private pendingRefresh: Promise<string> | null = null
  private readonly now: () => Date
  private readonly makeKey: () => string

  constructor(private readonly options: GoogleDriveStoreOptions) {
    this.now = options.now ?? (() => new Date())
    this.makeKey = options.makeKey ?? (() => globalThis.crypto.randomUUID())
  }

  get state(): GoogleDriveStoreState {
    return { ...this.current }
  }

  private update(changes: Partial<GoogleDriveStoreState>): void {
    this.current = { ...this.current, ...changes }
    this.options.onChange?.(this.state)
  }

  /** Carrega as ideias guardadas e o refresh token. */
  async load(): Promise<void> {
    const settings = this.options.settings
    const [ideasDocumentId, ideasText, ideasUpdatedAt] = await Promise.all([
      settings.get('drive.ideasDocumentID'),
      settings.get('drive.ideasText'),
      settings.get('drive.ideasUpdatedAt'),
    ])
    const updatedAt = ideasUpdatedAt ? new Date(ideasUpdatedAt) : null
    const ideas = {
      ideasDocumentId,
      ideasText: ideasText ?? '',
      ideasUpdatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    }
    if (this.options.api) {
      this.update({ ...ideas, isConnected: true, isLoading: false })
      return
    }
    const token = await this.options.refreshTokens.read().catch(() => null)
    this.refreshToken = token
    this.update({ ...ideas, isConnected: token !== null, isLoading: false })
  }

  /** Conecta pelo navegador (primeira vez) ou renova o acesso com o refresh token guardado. */
  async connect(): Promise<void> {
    const clientId = this.options.client.clientId.trim()
    if (this.current.isConnecting) return
    if (!clientId) {
      this.update({ errorMessage: new GoogleDriveError('missingClientID').message })
      return
    }
    const client: GoogleOAuthClientConfig = { ...this.options.client, clientId }
    this.update({ isConnecting: true, errorMessage: null })
    try {
      if (this.refreshToken) {
        const tokens = await refreshGoogleAccessToken(this.options.http, {
          refreshToken: this.refreshToken,
          client,
        })
        this.cacheAccessToken(tokens)
      } else {
        const authorization = this.options.authorization
        if (!authorization) throw new GoogleDriveError('invalidOAuthResponse')
        const tokens = await authorizeGoogleDrive({
          http: this.options.http,
          client,
          receiver: authorization.receiver(),
          openBrowser: authorization.openBrowser,
          timeoutMs: authorization.timeoutMs,
        })
        if (!tokens.refreshToken) throw new GoogleDriveError('invalidOAuthResponse')
        await this.options.refreshTokens.save(tokens.refreshToken)
        this.refreshToken = tokens.refreshToken
        this.cacheAccessToken(tokens)
      }
      this.update({ isConnected: true })
    } catch (error) {
      await this.clearRefreshTokenIfRejected(error)
      this.update({ errorMessage: localizedDescription(error) })
    } finally {
      this.update({ isConnecting: false })
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.options.refreshTokens.delete()
      this.refreshToken = null
      this.cachedAccessToken = null
      this.accessTokenExpiresAt = 0
      this.update({ isConnected: false, errorMessage: null })
    } catch (error) {
      this.update({ errorMessage: localizedDescription(error) })
    }
  }

  /** Abre (ou cria, na pasta de sermões) o documento de ideias e atualiza o texto guardado. */
  async ensureIdeasDocument(): Promise<void> {
    const api = this.driveAPI()
    const existingId = this.current.ideasDocumentId
    if (existingId) {
      const document = await api.getDocument(existingId)
      await this.setIdeasText(document.text)
      return
    }
    const settings = this.options.settings
    let ideasKey = await settings.get('drive.ideasDocumentKey')
    if (!ideasKey) {
      // A chave privada é gravada antes da rede: uma criação com resposta ambígua é recuperada depois.
      ideasKey = this.makeKey()
      await settings.set('drive.ideasDocumentKey', ideasKey)
    }
    const folder = await this.ensureFolder(DRIVE_SERMON_FOLDER_NAME, api)
    const file = await api.findOrCreateIdeasDocument(DRIVE_IDEAS_DOCUMENT_TITLE, folder.id, ideasKey)
    await settings.set('drive.ideasDocumentID', file.id)
    this.update({ ideasDocumentId: file.id })
    const document = await api.getDocument(file.id)
    await this.setIdeasText(document.text)
  }

  async refreshIdeas(): Promise<void> {
    const id = this.current.ideasDocumentId
    if (!id) return
    const document = await this.driveAPI().getDocument(id)
    await this.setIdeasText(document.text)
  }

  /**
   * Envio explícito ("Criar/Atualizar Google Doc"). Sem documento vinculado, cria ou recupera o Doc
   * pela chave privada do sermão, gravada antes da chamada de rede; o ID remoto é gravado assim que
   * chega, antes de enviar o texto. Uma revisão remota diferente da última sincronizada vira
   * `documentConflict` sem escrita; `overwriteRemote` substitui mesmo assim.
   */
  async saveSermon(
    draft: GoogleDriveSermonDraft,
    writeLink: GoogleDriveSermonLinkWriter,
    options: { overwriteRemote?: boolean } = {},
  ): Promise<GoogleDriveSermonLink> {
    if (!this.current.isConnected) throw new GoogleDriveError('notConnected')
    if (this.current.isSaving) throw new GoogleDriveError('syncInProgress')
    const content = googleDocsContentFromDocument(draft.document)
    if (content.text.trim() === '') throw new GoogleDriveError('emptyDocument')
    this.update({ isSaving: true, errorMessage: null })

    const link: GoogleDriveSermonLink = { ...draft.drive }
    const api = this.driveAPI()
    try {
      const contentHash = await googleDocsContentHash(content)
      let documentId = link.documentId
      if (!documentId) {
        if (!link.draftKey) {
          link.draftKey = this.makeKey()
          await writeLink({ ...link })
        }
        const folder = await this.ensureFolder(DRIVE_SERMON_FOLDER_NAME, api)
        const file = await api.findOrCreateSermonDocument(
          driveSermonDocumentTitle(draft),
          folder.id,
          link.draftKey,
        )
        documentId = file.id
        link.documentId = documentId
        await writeLink({ ...link })
      }
      const revisionId = await api.synchronizeDocument(
        documentId,
        content,
        link.revisionId,
        options.overwriteRemote ?? false,
      )
      link.documentId = documentId
      link.revisionId = revisionId
      link.syncedAt = this.now()
      link.syncedContentHash = contentHash
      link.syncError = null
      await writeLink({ ...link })
      return link
    } catch (error) {
      const message = localizedDescription(error)
      link.syncError = message
      try {
        await writeLink({ ...link })
      } catch {
        // O erro original é o que importa para quem chamou.
      }
      this.update({ errorMessage: message })
      throw error
    } finally {
      this.update({ isSaving: false })
    }
  }

  /**
   * Sincronização automática (depois de `DRIVE_AUTO_SYNC_DELAY_MS` sem edição): só para sermões já
   * vinculados explicitamente e só quando o conteúdo mudou. Nunca cria documento nem sobrescreve
   * uma revisão remota divergente. Com outro envio em andamento devolve `busy`, e o app tenta de
   * novo com o vínculo atualizado.
   */
  async syncIfNeeded(
    draft: GoogleDriveSermonDraft,
    writeLink: GoogleDriveSermonLinkWriter,
  ): Promise<GoogleDriveAutoSyncResult> {
    if (!this.current.isConnected) return 'notConnected'
    if (!draft.drive.documentId) return 'notLinked'
    if (this.current.isSaving) return 'busy'
    if (!(await this.hasUnsyncedChanges(draft))) return 'unchanged'
    if (this.current.isSaving) return 'busy'
    await this.saveSermon(draft, writeLink)
    return 'synced'
  }

  documentURL(id: string): string {
    return googleDocURL(id)
  }

  /** Há edição local ainda não enviada a um Doc vinculado. */
  async hasUnsyncedChanges(draft: Pick<GoogleDriveSermonDraft, 'document' | 'drive'>): Promise<boolean> {
    if (!draft.drive.documentId) return false
    return draft.drive.syncedContentHash !== (await driveSermonContentHash(draft.document))
  }

  /** Access token válido, renovado pelo refresh token quando vence. */
  async accessToken(): Promise<string> {
    const refreshToken = this.refreshToken
    const clientId = this.options.client.clientId.trim()
    if (!refreshToken || !clientId) throw new GoogleDriveError('notConnected')
    if (this.cachedAccessToken && this.accessTokenExpiresAt > this.now().getTime())
      return this.cachedAccessToken
    this.pendingRefresh ??= (async () => {
      try {
        const tokens = await refreshGoogleAccessToken(this.options.http, {
          refreshToken,
          client: { ...this.options.client, clientId },
        })
        this.cacheAccessToken(tokens)
        return tokens.accessToken
      } catch (error) {
        await this.clearRefreshTokenIfRejected(error)
        throw error
      } finally {
        this.pendingRefresh = null
      }
    })()
    return this.pendingRefresh
  }

  private cacheAccessToken(tokens: GoogleOAuthTokens): void {
    this.cachedAccessToken = tokens.accessToken
    this.accessTokenExpiresAt = this.now().getTime() + (tokens.expiresIn - TOKEN_EXPIRY_MARGIN_SECONDS) * 1000
  }

  private async ensureFolder(name: string, api: GoogleDriveAPI): Promise<GoogleDriveFile> {
    const settings = this.options.settings
    const savedId = await settings.get('drive.sermonFolderID')
    if (savedId) return { id: savedId, name, mimeType: GOOGLE_FOLDER_MIME_TYPE }
    const existing = await api.searchFolder(name)
    if (existing) {
      await settings.set('drive.sermonFolderID', existing.id)
      return existing
    }
    const folder = await api.createFolder(name)
    await settings.set('drive.sermonFolderID', folder.id)
    return folder
  }

  private driveAPI(): GoogleDriveAPI {
    if (this.options.api) return this.options.api
    return new GoogleDriveAPI({ http: this.options.http, accessToken: () => this.accessToken() })
  }

  /** Refresh token revogado ou expirado (`invalid_grant`): apaga e marca como desconectado. */
  private async clearRefreshTokenIfRejected(error: unknown): Promise<void> {
    if (!isRejectedRefreshToken(error)) return
    try {
      await this.options.refreshTokens.delete()
    } catch {
      // Mesmo sem conseguir apagar, a sessão atual deixa de usar o token recusado.
    }
    this.refreshToken = null
    this.cachedAccessToken = null
    this.accessTokenExpiresAt = 0
    this.update({ isConnected: false })
  }

  private async setIdeasText(text: string): Promise<void> {
    const updatedAt = this.now()
    this.update({ ideasText: text, ideasUpdatedAt: updatedAt })
    await this.options.settings.set('drive.ideasText', text)
    await this.options.settings.set('drive.ideasUpdatedAt', updatedAt.toISOString())
  }
}
