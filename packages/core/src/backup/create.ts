/**
 * Criação do pacote, como `PregarBackupService.create`: monta tudo numa pasta temporária oculta,
 * guarda cada PDF uma vez por SHA-256, reescreve os caminhos para `Files/<sha>.pdf`, valida o
 * pacote pronto e só então o publica com o nome "Pregar Backup yyyy-MM-dd HH.mm.ss".
 */
import { sha256Hex } from '../util/hash'
import { isDateKey } from '../util/dates'
import { BackupError } from './errors'
import { assetPathFor, lastPathComponent, scopeFileSystem } from './fs'
import type { BackupFileSystem } from './fs'
import { encodeJSON } from './json'
import { BACKUP_FILES, BACKUP_FORMAT_VERSION, PDF_TAB_KIND, historyPathFor, remapPdfPaths } from './format'
import type { BackupData, BackupManifest } from './format'
import { filterBackupPreferences } from './preferences'
import { validateBackup } from './validate'

/** Lê um PDF da máquina; `null` quando não existe, não é arquivo comum ou é link simbólico. */
export type PdfSourceReader = (sourcePath: string) => Promise<Uint8Array | null>

export interface CreateBackupOptions {
  /** Pasta escolhida pelo usuário; o pacote é criado dentro dela. */
  target: BackupFileSystem
  /** Dados atuais com caminhos de PDF absolutos da máquina. */
  data: BackupData
  readPdf: PdfSourceReader
  appVersion: string
  now?: () => Date
  /** Preferências que podem entrar; credenciais são sempre excluídas. */
  preferenceKeys?: ReadonlySet<string>
  newId?: () => string
}

export interface CreatedBackup {
  /** Nome da pasta criada dentro de `target`. */
  folderName: string
  manifest: BackupManifest
}

export async function createBackup(options: CreateBackupOptions): Promise<CreatedBackup> {
  const { target, data } = options
  const now = (options.now ?? (() => new Date()))()
  const root = await target.stat('')
  if (!root?.isDirectory) throw BackupError.restoreFailed('A pasta escolhida não existe.')

  const staging = `.pregar-backup-${(options.newId ?? (() => globalThis.crypto.randomUUID()))()}`
  await target.mkdir(staging)
  const fs = scopeFileSystem(target, staging)
  try {
    await fs.mkdir('Files')
    await fs.mkdir('History')
    const files: Record<string, string> = {}
    const write = async (path: string, bytes: Uint8Array) => {
      await fs.writeFile(path, bytes)
      files[path] = await sha256Hex(bytes)
    }

    // PDFs: um arquivo por conteúdo. Vínculos de páginas só acompanham PDFs já incluídos.
    const required = new Set(requiredPdfPaths(data).map(normalizeSourcePath))
    const closed = (data.readerArchive.closedTabs ?? []).filter((tab) => tab.kind === PDF_TAB_KIND)
    const sources = [...requiredPdfPaths(data), ...closed.map((tab) => tab.location)]
    const locations = new Map<string, string>()
    for (const sourcePath of [...new Set(sources)].sort()) {
      const normalized = normalizeSourcePath(sourcePath)
      if (locations.has(normalized)) continue
      const bytes = await options.readPdf(sourcePath)
      if (bytes === null) {
        // Abas fechadas e vínculos de PDFs que sumiram são descartados; os demais são erro.
        if (required.has(normalized)) throw BackupError.missingPDF(lastPathComponent(sourcePath))
        continue
      }
      const relativePath = assetPathFor(await sha256Hex(bytes))
      locations.set(normalized, relativePath)
      if (files[relativePath] === undefined) await write(relativePath, bytes)
    }
    const mapped = remapPdfPaths(
      data,
      (path) => locations.get(normalizeSourcePath(path)) ?? null,
      () => {
        throw BackupError.missingAsset()
      },
    )

    const keys = new Set<string>()
    let revisionCount = 0
    for (const item of data.history) {
      if (!isDateKey(item.dateKey) || keys.has(item.dateKey)) {
        throw new Error(`Histórico com data inválida ou repetida: ${item.dateKey}`)
      }
      keys.add(item.dateKey)
      revisionCount += item.revisions.length
      await write(historyPathFor(item.dateKey), encodeJSON(item.revisions))
    }

    const preferences = filterBackupPreferences(data.preferences, options.preferenceKeys)
    await write(BACKUP_FILES.sermons, encodeJSON(mapped.sermons))
    await write(BACKUP_FILES.library, encodeJSON(mapped.libraryRecords))
    await write(BACKUP_FILES.reader, encodeJSON(mapped.readerArchive))
    await write(BACKUP_FILES.sectionLinks, encodeJSON(mapped.sectionLinks))
    await write(BACKUP_FILES.preferences, encodeJSON(preferences))
    await write(BACKUP_FILES.favoriteSources, encodeJSON(data.favoriteSources))
    await write(BACKUP_FILES.reviewReports, encodeJSON(data.reviewReports))

    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now.toISOString(),
      appVersion: options.appVersion,
      counts: {
        sermons: mapped.sermons.length,
        historyFiles: data.history.length,
        revisions: revisionCount,
        libraryRecords: mapped.libraryRecords.length,
        assets: Object.keys(files).filter((path) => path.startsWith('Files/')).length,
        reviewReports: Object.values(data.reviewReports).reduce(
          (total, reports) => total + reports.length,
          0,
        ),
      },
      files,
    }
    await fs.writeFile(BACKUP_FILES.manifest, encodeJSON(manifest))
    await validateBackup(fs, { preferenceKeys: options.preferenceKeys })

    const folderName = await uniqueBackupName(target, now)
    await target.rename(staging, folderName)
    return { folderName, manifest }
  } catch (error) {
    await target.remove(staging).catch(() => undefined)
    throw error
  }
}

/** PDFs cuja falta impede o backup: tablet, Biblioteca e abas abertas. */
function requiredPdfPaths(data: BackupData): string[] {
  const paths: string[] = []
  for (const sermon of data.sermons) if (sermon.tabletPdfPath) paths.push(sermon.tabletPdfPath)
  for (const record of data.libraryRecords) paths.push(record.path)
  for (const tab of data.readerArchive.tabs) if (tab.kind === PDF_TAB_KIND) paths.push(tab.location)
  return paths
}

/**
 * Padroniza um caminho absoluto da máquina (resolve "." e "..", junta separadores repetidos)
 * para que o mesmo PDF citado de formas diferentes seja copiado uma vez.
 */
export function normalizeSourcePath(path: string): string {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const prefixMatch = /^(?:[A-Za-z]:)?[\\/]*/.exec(path)
  const rawPrefix = prefixMatch?.[0] ?? ''
  const prefix = rawPrefix.replace(/[\\/]+/g, separator)
  const parts: string[] = []
  for (const part of path.slice(rawPrefix.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') parts.pop()
      else if (prefix === '') parts.push(part)
      continue
    }
    parts.push(part)
  }
  return prefix + parts.join(separator)
}

/** "Pregar Backup 2026-11-01 14.05.09", com " (2)", " (3)"... se já existir. */
export function backupFolderName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  return `Pregar Backup ${day} ${time}`
}

async function uniqueBackupName(target: BackupFileSystem, date: Date): Promise<string> {
  const base = backupFolderName(date)
  let candidate = base
  for (let index = 2; (await target.stat(candidate)) !== null; index += 1) candidate = `${base} (${index})`
  return candidate
}
