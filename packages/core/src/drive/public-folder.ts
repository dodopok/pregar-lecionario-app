/**
 * Importação de PDFs de uma pasta pública do Google Drive ("Qualquer pessoa com o link"), sem
 * OAuth: a Drive API lista e baixa os arquivos com uma chave de API, encaminhando as chaves de
 * recurso (`resourcekey`) dos links compartilhados. A gravação em disco fica com o app, por meio
 * de `GoogleDriveImportFileSink`.
 */

import { loggedRequest, tryParseJSON } from '../util/http'
import type { HttpContext, LoggedResponse } from '../util/http'
import {
  GOOGLE_DRIVE_FILES_URL,
  GOOGLE_FOLDER_MIME_TYPE,
  DRIVE_PDF_MIME_TYPE,
  escapeDriveQueryLiteral,
  googleAPIErrorMessage,
  googleDriveFileListSchema,
  parseGoogleDriveFile,
} from './api'
import type { GoogleDriveFile } from './api'
import { GoogleDriveError, localizedDescription } from './errors'
import { md5Hex } from './md5'

export const PUBLIC_DRIVE_MAXIMUM_PDF_SIZE = 128 * 1024 * 1024
export const PUBLIC_DRIVE_MAXIMUM_PDF_COUNT = 5_000
/** Limite de itens listados numa única pasta (PDFs e não PDFs). */
export const PUBLIC_DRIVE_MAXIMUM_LISTED_ITEMS = 10_000
export const PUBLIC_DRIVE_IMPORT_CONCURRENCY = 2
/** Profundidade máxima de subpastas percorridas. */
export const PUBLIC_DRIVE_MAXIMUM_DEPTH = 24
const METADATA_TIMEOUT_MS = 60_000
/** Tempo total de um download (a requisição do Swift tinha 90 s de inatividade). */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

export interface GoogleDrivePublicFolderLink {
  folderId: string
  resourceKey?: string
}

const DRIVE_HOSTS = new Set(['drive.google.com', 'www.drive.google.com'])

/**
 * Lê o link compartilhável de uma pasta (`/drive/folders/<id>` ou `/open?id=<id>`), mantendo a
 * `resourcekey`. Só aceita https em drive.google.com, sem usuário/senha.
 */
export function parseGoogleDrivePublicFolderLink(value: string): GoogleDrivePublicFolderLink | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null
  if (url.username || url.password) return null
  let pathParts: string[]
  try {
    pathParts = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
  } catch {
    return null
  }
  const folderIndex = pathParts.indexOf('folders')
  const pathId = folderIndex >= 0 ? pathParts[folderIndex + 1] : undefined
  const query = new Map<string, string>()
  for (const [name, item] of url.searchParams) {
    const key = name.toLowerCase()
    if (!query.has(key)) query.set(key, item)
  }
  const id = pathId ?? query.get('id')
  if (!id || !/^[A-Za-z0-9_-]{5,}$/.test(id)) return null
  const link: GoogleDrivePublicFolderLink = { folderId: id }
  const resourceKey = query.get('resourcekey')
  if (resourceKey) link.resourceKey = resourceKey
  return link
}

export interface GoogleDrivePublicPDF {
  file: GoogleDriveFile
  /** Chaves de recurso das pastas acima do arquivo (id → chave). */
  parentResourceKeys: Record<string, string>
}

export interface GoogleDrivePublicPDFDownloadResult {
  index: number
  pdf: GoogleDrivePublicPDF
  data?: Uint8Array
  errorMessage?: string
}

/** Valor do cabeçalho `X-Goog-Drive-Resource-Keys`: pares `id/chave` em ordem de id. */
export function driveResourceKeysHeader(keys: Record<string, string>): string | undefined {
  const ids = Object.keys(keys).sort()
  if (ids.length === 0) return undefined
  return ids.map((id) => `${id}/${keys[id]}`).join(',')
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' })

function isPDFSignature(data: Uint8Array): boolean {
  return PDF_SIGNATURE.every((byte, index) => data[index] === byte)
}

export interface GoogleDrivePublicFolderClientOptions {
  apiKey: string
  http: HttpContext
}

export class GoogleDrivePublicFolderClient {
  static readonly filesURL = GOOGLE_DRIVE_FILES_URL
  static readonly maximumPDFSize = PUBLIC_DRIVE_MAXIMUM_PDF_SIZE
  static readonly importConcurrency = PUBLIC_DRIVE_IMPORT_CONCURRENCY

  constructor(private readonly options: GoogleDrivePublicFolderClientOptions) {}

  /** Metadados da pasta do link; recusa links de arquivos que não são pastas. */
  async folder(link: GoogleDrivePublicFolderLink): Promise<GoogleDriveFile> {
    const file = await this.getFile(link.folderId, link.resourceKey)
    if (file.mimeType !== GOOGLE_FOLDER_MIME_TYPE) throw new GoogleDriveError('invalidPublicDriveFolderLink')
    return file
  }

  /** PDFs da pasta (e das subpastas, se pedido), ordenados pelo nome como no Finder. */
  async pdfFiles(
    folder: GoogleDriveFile,
    rootResourceKey: string | undefined,
    includeSubfolders: boolean,
  ): Promise<GoogleDrivePublicPDF[]> {
    const rootKeys: Record<string, string> = {}
    const rootKey = rootResourceKey ?? folder.resourceKey
    if (rootKey) rootKeys[folder.id] = rootKey
    const pending: { folder: GoogleDriveFile; keys: Record<string, string>; depth: number }[] = [
      { folder, keys: rootKeys, depth: 0 },
    ]
    const visited = new Set<string>()
    const results: GoogleDrivePublicPDF[] = []

    for (let current = pending.pop(); current; current = pending.pop()) {
      if (visited.has(current.folder.id)) continue
      visited.add(current.folder.id)
      const children = await this.listChildren(current.folder.id, current.keys)
      for (const child of children) {
        if (child.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
          if (includeSubfolders && current.depth < PUBLIC_DRIVE_MAXIMUM_DEPTH) {
            const keys = { ...current.keys }
            if (child.resourceKey) keys[child.id] = child.resourceKey
            pending.push({ folder: child, keys, depth: current.depth + 1 })
          }
        } else if (child.mimeType === DRIVE_PDF_MIME_TYPE || child.name.toLowerCase().endsWith('.pdf')) {
          results.push({ file: child, parentResourceKeys: current.keys })
          if (results.length > PUBLIC_DRIVE_MAXIMUM_PDF_COUNT)
            throw new GoogleDriveError('driveImportTooManyFiles')
        }
      }
    }
    return results.sort((left, right) => nameCollator.compare(left.file.name, right.file.name))
  }

  /** Baixa um PDF conferindo tamanho, assinatura `%PDF-` e MD5 informados pelo Drive. */
  async download(pdf: GoogleDrivePublicPDF): Promise<Uint8Array> {
    const name = pdf.file.name
    if (pdf.file.size !== undefined && pdf.file.size > PUBLIC_DRIVE_MAXIMUM_PDF_SIZE) {
      throw GoogleDriveError.fileTooLarge(name)
    }
    const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(pdf.file.id)}`)
    url.searchParams.set('alt', 'media')
    url.searchParams.set('key', this.options.apiKey)
    const keys = { ...pdf.parentResourceKeys }
    if (pdf.file.resourceKey) keys[pdf.file.id] = pdf.file.resourceKey
    const headers = new Headers({ Accept: DRIVE_PDF_MIME_TYPE })
    const header = driveResourceKeysHeader(keys)
    if (header) headers.set('X-Goog-Drive-Resource-Keys', header)
    const response = await this.request(url, headers, 'pasta pública · download', DOWNLOAD_TIMEOUT_MS)
    if (!response.ok) throw publicAPIError(response)
    const data = response.body
    if (data.byteLength > PUBLIC_DRIVE_MAXIMUM_PDF_SIZE) throw GoogleDriveError.fileTooLarge(name)
    if (!isPDFSignature(data)) throw GoogleDriveError.invalidPDF(name)
    if (pdf.file.size !== undefined && pdf.file.size !== data.byteLength)
      throw GoogleDriveError.integrityMismatch(name)
    if (pdf.file.md5Checksum !== undefined && md5Hex(data) !== pdf.file.md5Checksum.toLowerCase()) {
      throw GoogleDriveError.integrityMismatch(name)
    }
    return data
  }

  /**
   * Baixa no máximo `maximumConcurrentDownloads` arquivos ao mesmo tempo. Cada resultado (com os
   * bytes ou a mensagem de erro) é entregue a `onCompletion`, uma chamada por vez; falhas de um
   * arquivo não interrompem os demais.
   */
  async downloadConcurrently(
    pdfs: GoogleDrivePublicPDF[],
    maximumConcurrentDownloads: number,
    onCompletion: (result: GoogleDrivePublicPDFDownloadResult) => void | Promise<void>,
    download: (pdf: GoogleDrivePublicPDF) => Promise<Uint8Array> = (pdf) => this.download(pdf),
  ): Promise<void> {
    const limit = Math.min(Math.max(1, Math.floor(maximumConcurrentDownloads) || 1), pdfs.length)
    if (limit <= 0) return
    const inFlight = new Map<number, Promise<GoogleDrivePublicPDFDownloadResult>>()
    const start = (index: number) => {
      const pdf = pdfs[index] as GoogleDrivePublicPDF
      inFlight.set(
        index,
        (async (): Promise<GoogleDrivePublicPDFDownloadResult> => {
          try {
            return { index, pdf, data: await download(pdf) }
          } catch (error) {
            return { index, pdf, errorMessage: localizedDescription(error) }
          }
        })(),
      )
    }
    let nextIndex = 0
    for (; nextIndex < limit; nextIndex += 1) start(nextIndex)
    while (inFlight.size > 0) {
      const result = await Promise.race(inFlight.values())
      inFlight.delete(result.index)
      await onCompletion(result)
      if (nextIndex < pdfs.length) {
        start(nextIndex)
        nextIndex += 1
      }
    }
  }

  private async getFile(id: string, resourceKey: string | undefined): Promise<GoogleDriveFile> {
    const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(id)}`)
    url.searchParams.set('key', this.options.apiKey)
    url.searchParams.set('fields', 'id,name,mimeType,webViewLink,size,md5Checksum,parents,resourceKey')
    const headers = new Headers({ Accept: 'application/json' })
    if (resourceKey) headers.set('X-Goog-Drive-Resource-Keys', `${id}/${resourceKey}`)
    const response = await this.request(url, headers, 'pasta pública · metadados', METADATA_TIMEOUT_MS)
    if (!response.ok) throw publicAPIError(response)
    const file = parseGoogleDriveFile(tryParseJSON(response.text()))
    if (!file) throw new GoogleDriveError('invalidOAuthResponse')
    return file
  }

  private async listChildren(
    folderId: string,
    resourceKeys: Record<string, string>,
  ): Promise<GoogleDriveFile[]> {
    const query = `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`
    const results: GoogleDriveFile[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(GOOGLE_DRIVE_FILES_URL)
      url.searchParams.set('q', query)
      url.searchParams.set('key', this.options.apiKey)
      url.searchParams.set('spaces', 'drive')
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('supportsAllDrives', 'true')
      url.searchParams.set('includeItemsFromAllDrives', 'true')
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,webViewLink,size,md5Checksum,parents,resourceKey)',
      )
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const headers = new Headers({ Accept: 'application/json' })
      const header = driveResourceKeysHeader(resourceKeys)
      if (header) headers.set('X-Goog-Drive-Resource-Keys', header)
      const response = await this.request(url, headers, 'pasta pública · listagem', METADATA_TIMEOUT_MS)
      if (!response.ok) throw publicAPIError(response)
      const page = googleDriveFileListSchema.safeParse(tryParseJSON(response.text()))
      if (!page.success) throw new GoogleDriveError('invalidOAuthResponse')
      results.push(...page.data.files)
      pageToken = page.data.nextPageToken ?? undefined
      if (results.length > PUBLIC_DRIVE_MAXIMUM_LISTED_ITEMS)
        throw new GoogleDriveError('driveImportTooManyFiles')
    } while (pageToken)
    return results
  }

  private request(url: URL, headers: Headers, operation: string, timeoutMs: number): Promise<LoggedResponse> {
    return loggedRequest(
      this.options.http,
      url,
      { method: 'GET', headers },
      { integration: 'Google Drive', operation, timeoutMs, secrets: [this.options.apiKey] },
    )
  }
}

const KEY_FAILURE_MARKERS = ['api key', 'api_key', 'api has not been used', 'service_disabled', 'referer']

/**
 * Distingue chave de API inválida/desativada (erro da API, com a mensagem do Google) de pasta
 * privada ou inexistente (404, ou 403 sem sinal de problema na chave).
 */
function publicAPIError(response: LoggedResponse): GoogleDriveError {
  const message = googleAPIErrorMessage(response) ?? 'A API do Google Drive recusou a solicitação.'
  const normalized = message.toLowerCase()
  const keyFailure = KEY_FAILURE_MARKERS.some((marker) => normalized.includes(marker))
  if (response.status === 404 || (response.status === 403 && !keyFailure)) {
    return new GoogleDriveError('publicDriveFolderIsNotAccessible')
  }
  return GoogleDriveError.api(response.status, message)
}

// MARK: - Importador

/** Pasta das cópias locais, relativa à pasta de dados do app (Application Support/Pregar no macOS). */
export const PUBLIC_DRIVE_IMPORT_DIRECTORY = ['Library', 'Google Drive'] as const

/** Grava arquivos para o importador; o core não acessa o sistema de arquivos. */
export interface GoogleDriveImportFileSink {
  /**
   * Cria `directory` (segmentos relativos à pasta de dados do app) se preciso e grava `data` em
   * `fileName` de forma atômica, substituindo uma cópia anterior. Devolve o caminho gravado.
   */
  writeFile(directory: readonly string[], fileName: string, data: Uint8Array): Promise<string>
}

/** Onde fica guardada a chave de API pública (cofre do sistema, no app). */
export interface GoogleDrivePublicAPIKeyStore {
  read(): Promise<string | null>
  save(key: string): Promise<void>
}

export interface GoogleDrivePublicPDFImportResult {
  folderName: string
  /** Caminhos devolvidos pelo `GoogleDriveImportFileSink`, na ordem dos PDFs. */
  localPaths: string[]
  failures: string[]
}

export interface GoogleDrivePublicPDFImporterState {
  isLoadingKey: boolean
  isImporting: boolean
  savedAPIKeyExists: boolean
  status: string
  completedCount: number
  totalCount: number
}

function safeIdentifier(value: string): string {
  return [...value].filter((character) => /^[\p{L}\p{M}\p{N}_-]$/u.test(character)).join('')
}

/** Pasta das cópias de uma pasta pública: uma por id da pasta, para reimportar no mesmo lugar. */
export function publicDriveImportDirectory(folderId: string): string[] {
  return [...PUBLIC_DRIVE_IMPORT_DIRECTORY, safeIdentifier(folderId)]
}

/** Nome local estável: nome do arquivo saneado e o id do Drive (`Nome [id].pdf`). */
export function publicDriveLocalFilename(file: Pick<GoogleDriveFile, 'id' | 'name'>): string {
  const lastComponent = file.name.split('/').filter(Boolean).pop() ?? ''
  const dot = lastComponent.lastIndexOf('.')
  const basename = dot > 0 ? lastComponent.slice(0, dot) : lastComponent
  const cleaned = [...basename]
    .map((character) => (/^[\p{L}\p{M}\p{N} ()._-]$/u.test(character) ? character : '_'))
    .join('')
    .trim()
  const safeName = cleaned || 'Comentario'
  return `${safeName} [${safeIdentifier(file.id)}].pdf`
}

export interface GoogleDrivePublicPDFImporterOptions {
  http: HttpContext
  sink: GoogleDriveImportFileSink
  keyStore: GoogleDrivePublicAPIKeyStore
  onChange?: (state: GoogleDrivePublicPDFImporterState) => void
}

/** Importação de uma pasta pública para a Biblioteca, com estado de progresso para a interface. */
export class GoogleDrivePublicPDFImporter {
  private savedAPIKey: string | null = null
  private loadedKey = false
  private current: GoogleDrivePublicPDFImporterState = {
    isLoadingKey: true,
    isImporting: false,
    savedAPIKeyExists: false,
    status: '',
    completedCount: 0,
    totalCount: 0,
  }

  constructor(private readonly options: GoogleDrivePublicPDFImporterOptions) {}

  get state(): GoogleDrivePublicPDFImporterState {
    return { ...this.current }
  }

  private update(changes: Partial<GoogleDrivePublicPDFImporterState>): void {
    this.current = { ...this.current, ...changes }
    this.options.onChange?.(this.state)
  }

  /**
   * Lê a chave salva. Uma leitura que termina depois de uma importação não apaga a chave que a
   * importação acabou de guardar.
   */
  async loadSavedKey(): Promise<void> {
    const key = await this.options.keyStore.read().catch(() => null)
    if (this.savedAPIKey === null) this.savedAPIKey = key
    this.loadedKey = true
    this.update({ savedAPIKeyExists: this.savedAPIKey !== null, isLoadingKey: false })
  }

  async importPDFs(
    publicFolderLink: string,
    enteredAPIKey: string,
    includeSubfolders: boolean,
  ): Promise<GoogleDrivePublicPDFImportResult> {
    if (this.current.isImporting) throw new GoogleDriveError('syncInProgress')
    const link = parseGoogleDrivePublicFolderLink(publicFolderLink)
    if (!link) throw new GoogleDriveError('invalidPublicDriveFolderLink')
    const submittedKey = enteredAPIKey.trim()
    if (!submittedKey && !this.loadedKey && this.savedAPIKey === null) await this.loadSavedKey()
    const key = submittedKey || this.savedAPIKey
    if (!key) throw new GoogleDriveError('missingPublicDriveAPIKey')

    this.update({ isImporting: true, completedCount: 0, totalCount: 0, status: 'Verificando pasta pública…' })
    try {
      const client = new GoogleDrivePublicFolderClient({ apiKey: key, http: this.options.http })
      const folder = await client.folder(link)
      if (submittedKey) {
        await this.options.keyStore.save(submittedKey)
        this.savedAPIKey = submittedKey
        this.update({ savedAPIKeyExists: true })
      }
      const files = await client.pdfFiles(folder, link.resourceKey, includeSubfolders)
      if (files.length === 0) throw new GoogleDriveError('noPDFsInPublicDriveFolder')
      const directory = publicDriveImportDirectory(folder.id)
      this.update({
        totalCount: files.length,
        status: `Baixando até ${PUBLIC_DRIVE_IMPORT_CONCURRENCY} PDFs simultaneamente…`,
      })
      const imported = new Map<number, string>()
      const failures: [number, string][] = []

      await client.downloadConcurrently(files, PUBLIC_DRIVE_IMPORT_CONCURRENCY, async (result) => {
        const name = result.pdf.file.name
        if (result.data) {
          try {
            const path = await this.options.sink.writeFile(
              directory,
              publicDriveLocalFilename(result.pdf.file),
              result.data,
            )
            imported.set(result.index, path)
          } catch (error) {
            failures.push([result.index, `${name}: ${localizedDescription(error)}`])
          }
        } else {
          failures.push([result.index, `${name}: ${result.errorMessage ?? 'Falha ao baixar o arquivo.'}`])
        }
        const completedCount = this.current.completedCount + 1
        this.update({ completedCount, status: `Processados ${completedCount} de ${files.length} PDFs` })
      })

      const localPaths = [...imported.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, path]) => path)
      const failureMessages = failures.sort(([left], [right]) => left - right).map(([, message]) => message)
      if (localPaths.length === 0) {
        throw GoogleDriveError.api(400, failureMessages[0] ?? 'Nenhum PDF pôde ser baixado.')
      }
      const suffix = failureMessages.length === 0 ? '' : ` · ${failureMessages.length} com erro`
      this.update({ status: `${localPaths.length} PDF(s) baixado(s)${suffix}` })
      return { folderName: folder.name, localPaths, failures: failureMessages }
    } finally {
      this.update({ isImporting: false })
    }
  }
}
