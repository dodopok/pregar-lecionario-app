/**
 * Cliente da Drive API e da Docs API com OAuth (`drive.file`): pasta `Sermões`, um Google Doc por
 * sermão, documento de ideias e substituição do conteúdo com controle de revisão.
 */

import { z } from 'zod'
import { loggedRequest, tryParseJSON } from '../util/http'
import type { HttpContext, LoggedResponse } from '../util/http'
import { googleDocsBatchUpdateBody, plainTextFromDocsContent } from './docs-content'
import type { GoogleDocsBatchUpdateBody, GoogleDocsContent } from './docs-content'
import { GoogleDriveError } from './errors'

export const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const GOOGLE_DOCS_DOCUMENTS_URL = 'https://docs.googleapis.com/v1/documents'
export const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'
export const GOOGLE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
export const DRIVE_PDF_MIME_TYPE = 'application/pdf'
/** Chaves privadas (`appProperties`) que ligam um arquivo do Drive ao sermão ou às ideias. */
export const SERMON_DRAFT_PROPERTY_KEY = 'pregarDraftKey'
export const IDEAS_DOCUMENT_PROPERTY_KEY = 'pregarIdeasKey'
const API_TIMEOUT_MS = 60_000

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType?: string
  webViewLink?: string
  /** Tamanho em bytes (a API envia como texto). */
  size?: number
  md5Checksum?: string
  parents?: string[]
  resourceKey?: string
}

const optionalString = z.string().nullish()

export const googleDriveFileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mimeType: optionalString,
    webViewLink: optionalString,
    size: z.union([z.string(), z.number()]).nullish(),
    md5Checksum: optionalString,
    parents: z.array(z.string()).nullish(),
    resourceKey: optionalString,
  })
  .transform((value): GoogleDriveFile => {
    const file: GoogleDriveFile = { id: value.id, name: value.name }
    if (value.mimeType != null) file.mimeType = value.mimeType
    if (value.webViewLink != null) file.webViewLink = value.webViewLink
    if (value.size != null) {
      const size =
        typeof value.size === 'number' ? value.size : /^\d+$/.test(value.size) ? Number(value.size) : NaN
      if (Number.isSafeInteger(size)) file.size = size
    }
    if (value.md5Checksum != null) file.md5Checksum = value.md5Checksum
    if (value.parents != null) file.parents = value.parents
    if (value.resourceKey != null) file.resourceKey = value.resourceKey
    return file
  })

export const googleDriveFileListSchema = z.object({
  files: z.array(googleDriveFileSchema),
  nextPageToken: z.string().nullish(),
})

export function parseGoogleDriveFile(value: unknown): GoogleDriveFile | null {
  const parsed = googleDriveFileSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Escapa um literal para a linguagem de busca `q` da Drive API. */
export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function googleDocURL(id: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`
}

export interface GoogleDocsDocumentSnapshot {
  revisionId: string
  text: string
  endIndex: number
}

export interface GoogleDriveAPIOptions {
  http: HttpContext
  /** Access token atual; renovado por quem chama quando expira. */
  accessToken: () => Promise<string>
}

export class GoogleDriveAPI {
  static readonly driveFilesURL = GOOGLE_DRIVE_FILES_URL
  static readonly googleDocMimeType = GOOGLE_DOC_MIME_TYPE
  static readonly folderMimeType = GOOGLE_FOLDER_MIME_TYPE

  constructor(private readonly options: GoogleDriveAPIOptions) {}

  static batchUpdateBody(
    content: GoogleDocsContent,
    currentEndIndex: number,
    requiredRevisionId: string,
  ): GoogleDocsBatchUpdateBody {
    return googleDocsBatchUpdateBody(content, currentEndIndex, requiredRevisionId)
  }

  async searchFolder(name: string): Promise<GoogleDriveFile | null> {
    const escaped = escapeDriveQueryLiteral(name)
    const files = await this.listFiles(
      `name = '${escaped}' and mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and trashed = false`,
    )
    return files[0] ?? null
  }

  createFolder(name: string): Promise<GoogleDriveFile> {
    return this.createFile({ name, mimeType: GOOGLE_FOLDER_MIME_TYPE })
  }

  createDocument(name: string, folderId: string): Promise<GoogleDriveFile> {
    return this.createFile({ name, mimeType: GOOGLE_DOC_MIME_TYPE, parents: [folderId] })
  }

  /**
   * Procura o Doc pela chave privada do sermão antes de criar. Se uma criação anterior teve
   * resposta ambígua (o arquivo foi criado mas a resposta se perdeu), a nova tentativa o recupera.
   */
  findOrCreateSermonDocument(name: string, folderId: string, draftKey: string): Promise<GoogleDriveFile> {
    return this.findOrCreateKeyedDocument(name, folderId, SERMON_DRAFT_PROPERTY_KEY, draftKey)
  }

  findOrCreateIdeasDocument(name: string, folderId: string, ideasKey: string): Promise<GoogleDriveFile> {
    return this.findOrCreateKeyedDocument(name, folderId, IDEAS_DOCUMENT_PROPERTY_KEY, ideasKey)
  }

  private async findOrCreateKeyedDocument(
    name: string,
    folderId: string,
    propertyKey: string,
    value: string,
  ): Promise<GoogleDriveFile> {
    const query =
      `'${escapeDriveQueryLiteral(folderId)}' in parents and mimeType = '${GOOGLE_DOC_MIME_TYPE}' and ` +
      `appProperties has { key='${propertyKey}' and value='${escapeDriveQueryLiteral(value)}' } and trashed = false`
    const existing = (await this.listFiles(query))[0]
    if (existing) return existing
    return this.createFile({
      name,
      mimeType: GOOGLE_DOC_MIME_TYPE,
      parents: [folderId],
      appProperties: { [propertyKey]: value },
    })
  }

  async getDocument(id: string): Promise<GoogleDocsDocumentSnapshot> {
    const response = await this.send(
      `${GOOGLE_DOCS_DOCUMENTS_URL}/${encodeURIComponent(id)}`,
      { method: 'GET' },
      'Docs · leitura',
    )
    if (!response.ok) throw docsAPIError(response)
    const json = tryParseJSON<Record<string, unknown>>(response.text())
    const revisionId = json?.revisionId
    const body = json?.body as Record<string, unknown> | undefined
    const content = body && typeof body === 'object' ? body.content : undefined
    if (typeof revisionId !== 'string' || !Array.isArray(content))
      throw new GoogleDriveError('invalidOAuthResponse')
    const endIndexes = content
      .map((block) => (block as Record<string, unknown> | null)?.endIndex)
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
    const endIndex = endIndexes.length > 0 ? Math.max(...endIndexes) : 2
    return { revisionId, text: plainTextFromDocsContent(content), endIndex }
  }

  /** Substitui o conteúdo exigindo a revisão informada; devolve a revisão produzida pela escrita. */
  async replaceDocument(
    id: string,
    content: GoogleDocsContent,
    currentEndIndex: number,
    requiredRevisionId: string,
  ): Promise<string> {
    const body = googleDocsBatchUpdateBody(content, currentEndIndex, requiredRevisionId)
    const response = await this.send(
      `${GOOGLE_DOCS_DOCUMENTS_URL}/${encodeURIComponent(id)}:batchUpdate`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Docs · atualização',
    )
    if (!response.ok) throw docsAPIError(response)
    const json = tryParseJSON<Record<string, unknown>>(response.text())
    const writeControl = json?.writeControl as Record<string, unknown> | undefined
    const revisionId =
      writeControl && typeof writeControl === 'object' ? writeControl.requiredRevisionId : undefined
    if (typeof revisionId !== 'string') throw new GoogleDriveError('invalidOAuthResponse')
    return revisionId
  }

  /**
   * Lê a revisão remota; se ela diverge da última sincronizada e não há confirmação explícita,
   * lança `documentConflict` sem escrever nada. Caso contrário substitui o conteúdo exigindo a
   * revisão recém-lida.
   */
  async synchronizeDocument(
    id: string,
    content: GoogleDocsContent,
    expectedRevisionId: string | null | undefined,
    overwriteRemote: boolean,
  ): Promise<string> {
    const remote = await this.getDocument(id)
    if (!overwriteRemote && expectedRevisionId && expectedRevisionId !== remote.revisionId) {
      throw new GoogleDriveError('documentConflict')
    }
    return this.replaceDocument(id, content, remote.endIndex, remote.revisionId)
  }

  private async listFiles(query: string): Promise<GoogleDriveFile[]> {
    const url = new URL(GOOGLE_DRIVE_FILES_URL)
    url.searchParams.set('q', query)
    url.searchParams.set('spaces', 'drive')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('fields', 'files(id,name,mimeType,webViewLink)')
    const response = await this.send(url.toString(), { method: 'GET' }, 'Drive · busca')
    if (!response.ok) throw docsAPIError(response)
    const parsed = googleDriveFileListSchema.safeParse(tryParseJSON(response.text()))
    if (!parsed.success) throw new GoogleDriveError('invalidOAuthResponse')
    return parsed.data.files
  }

  private async createFile(metadata: Record<string, unknown>): Promise<GoogleDriveFile> {
    const url = new URL(GOOGLE_DRIVE_FILES_URL)
    url.searchParams.set('fields', 'id,name,mimeType,webViewLink')
    const response = await this.send(
      url.toString(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) },
      'Drive · criação',
    )
    if (!response.ok) throw docsAPIError(response)
    const file = parseGoogleDriveFile(tryParseJSON(response.text()))
    if (!file) throw new GoogleDriveError('invalidOAuthResponse')
    return file
  }

  private async send(url: string, init: RequestInit, operation: string): Promise<LoggedResponse> {
    const token = await this.options.accessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    return loggedRequest(
      this.options.http,
      url,
      { ...init, headers },
      { integration: 'Google Drive', operation, timeoutMs: API_TIMEOUT_MS, secrets: [token] },
    )
  }
}

/** Mensagem de erro do Google (`error.message`), quando o corpo é JSON. */
export function googleAPIErrorMessage(response: LoggedResponse): string | undefined {
  const payload = tryParseJSON<Record<string, unknown>>(response.text())
  const error = payload?.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return undefined
}

function docsAPIError(response: LoggedResponse): GoogleDriveError {
  const message = googleAPIErrorMessage(response) ?? 'Confira a conexão e as APIs ativadas no Google Cloud.'
  if (response.status === 409 || message.toLowerCase().includes('revision')) {
    return new GoogleDriveError('documentConflict')
  }
  return GoogleDriveError.api(response.status, message)
}
