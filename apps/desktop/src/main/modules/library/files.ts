import { lstat, open, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, normalize, resolve } from 'node:path'
import { swiftDateFromDate } from '@pregar/core/library/model'
import type { WorkerFile } from './worker-protocol'

/** Limite por arquivo, como na importação do app Swift. */
export const MAX_PDF_BYTES = 128 * 1024 * 1024
/** O cabeçalho `%PDF-` pode vir depois de bytes iniciais, mas dentro do primeiro KB. */
const SIGNATURE_WINDOW = 1024

export class PdfFileError extends Error {
  constructor(
    message: string,
    readonly fileName: string,
  ) {
    super(message)
    this.name = 'PdfFileError'
  }
}

/** Chave do acervo para um caminho: absoluto e normalizado (o registro usa o caminho como id). */
export function libraryKey(path: string): string {
  return resolve(path)
}

/**
 * Confere o arquivo antes de indexar: arquivo comum, até 128 MB e com assinatura `%PDF-`.
 * Com `strict` (caminhos vindos da janela, não do diálogo), exige também caminho absoluto já
 * normalizado, extensão .pdf e que não seja um link simbólico.
 */
export async function checkPdfFile(path: string, options: { strict?: boolean } = {}): Promise<WorkerFile> {
  const name = basename(path) || path
  if (typeof path !== 'string' || path === '' || path.includes('\0')) throw new PdfFileError('caminho inválido', name)
  if (options.strict) {
    if (!isAbsolute(path) || normalize(path) !== path || path.length > 4096) throw new PdfFileError('caminho inválido', name)
    if (extname(path).toLowerCase() !== '.pdf') throw new PdfFileError('não é um arquivo .pdf', name)
    const link = await lstat(path).catch(() => null)
    if (!link) throw new PdfFileError('arquivo não encontrado', name)
    if (link.isSymbolicLink()) throw new PdfFileError('links simbólicos não são aceitos', name)
  }
  const info = await stat(path).catch(() => null)
  if (!info) throw new PdfFileError('arquivo não encontrado', name)
  if (!info.isFile()) throw new PdfFileError('não é um arquivo', name)
  if (info.size > MAX_PDF_BYTES) throw new PdfFileError('excede o limite de 128 MB', name)
  if (info.size < 8) throw new PdfFileError('não é um PDF válido', name)
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) throw new PdfFileError('sem permissão para ler o arquivo', name)
  try {
    const buffer = Buffer.alloc(Math.min(SIGNATURE_WINDOW, info.size))
    await handle.read(buffer, 0, buffer.length, 0)
    if (!buffer.includes('%PDF-')) throw new PdfFileError('não é um PDF (assinatura %PDF- ausente)', name)
  } finally {
    await handle.close()
  }
  return { path: libraryKey(path), sizeBytes: info.size, modificationDate: swiftDateFromDate(info.mtime) }
}

/** Tamanho e data atuais, sem reler a assinatura (reindexação de arquivos já aceitos). */
export async function currentFileInfo(path: string): Promise<WorkerFile | null> {
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) return null
  return { path, sizeBytes: info.size, modificationDate: swiftDateFromDate(info.mtime) }
}
