/**
 * Acesso a arquivos injetado. O core não importa `node:fs`: o processo principal do Electron
 * entrega uma implementação presa a uma pasta (o pacote de backup, a pasta escolhida pelo
 * usuário ou a pasta de PDFs restaurados). Os caminhos são sempre relativos a essa raiz, com
 * "/" como separador; "" é a própria raiz.
 */
import { sha256Hex } from '../util/hash'
import { BackupError } from './errors'

export interface BackupFileStat {
  isFile: boolean
  isDirectory: boolean
  /** Precisa refletir o próprio caminho, sem seguir o link (semântica de `lstat`). */
  isSymbolicLink: boolean
  size?: number
}

export interface BackupFileSystem {
  readFile(path: string): Promise<Uint8Array>
  /** Cria ou substitui o arquivo; a pasta pai já existe. */
  writeFile(path: string, data: Uint8Array): Promise<void>
  /** `lstat`; `null` quando o caminho não existe. */
  stat(path: string): Promise<BackupFileStat | null>
  /** Nomes das entradas diretas da pasta. */
  list(path: string): Promise<string[]>
  /** Cria a pasta e as intermediárias; não falha se já existir. */
  mkdir(path: string): Promise<void>
  /** Remove arquivo ou pasta inteira; não falha se não existir. */
  remove(path: string): Promise<void>
  /** Move dentro da mesma raiz, sem sobrescrever; usado para publicar o pacote pronto. */
  rename(from: string, to: string): Promise<void>
}

export function joinPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('/')
}

export function lastPathComponent(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts.at(-1) ?? path
}

/** Vista de uma subpasta como raiz própria. */
export function scopeFileSystem(fs: BackupFileSystem, directory: string): BackupFileSystem {
  const resolve = (path: string) => joinPath(directory, path)
  return {
    readFile: (path) => fs.readFile(resolve(path)),
    writeFile: (path, data) => fs.writeFile(resolve(path), data),
    stat: (path) => fs.stat(resolve(path)),
    list: (path) => fs.list(resolve(path)),
    mkdir: (path) => fs.mkdir(resolve(path)),
    remove: (path) => fs.remove(resolve(path)),
    rename: (from, to) => fs.rename(resolve(from), resolve(to)),
  }
}

// Nomes reservados do Windows abririam um dispositivo em vez de um arquivo.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * Caminho relativo seguro: sem "/" inicial, sem "\\", ":" ou NUL, sem componentes vazios,
 * "." ou "..". Não consulta o disco.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/')) return false
  if (/[\\:\0]/.test(path)) return false
  return path
    .split('/')
    .every((part) => part.length > 0 && part !== '.' && part !== '..' && !WINDOWS_RESERVED.test(part))
}

/**
 * Confere, antes de ler, que o caminho é seguro, que cada pasta intermediária é pasta de verdade
 * e que o destino é arquivo comum; links simbólicos são recusados em qualquer nível.
 */
export async function assertSafePackageFile(fs: BackupFileSystem, path: string): Promise<void> {
  if (!isSafeRelativePath(path)) throw BackupError.invalidPackage()
  const components = path.split('/')
  let parent = ''
  for (const component of components.slice(0, -1)) {
    parent = joinPath(parent, component)
    const stat = await fs.stat(parent)
    if (!stat || !stat.isDirectory || stat.isSymbolicLink) throw BackupError.invalidPackage()
  }
  const stat = await fs.stat(path)
  if (!stat || !stat.isFile || stat.isSymbolicLink) throw BackupError.invalidPackage()
}

export async function readPackageFile(fs: BackupFileSystem, path: string): Promise<Uint8Array> {
  await assertSafePackageFile(fs, path)
  return fs.readFile(path)
}

export async function assertPackageRoot(fs: BackupFileSystem): Promise<void> {
  const root = await fs.stat('')
  if (!root || !root.isDirectory) throw BackupError.invalidPackage()
}

/**
 * Lê os arquivos do manifesto, recusando caminhos inseguros e conteúdo com hash diferente.
 * Devolve o conteúdo apenas dos caminhos aceitos por `keep` (os PDFs só têm o hash conferido).
 */
export async function verifyChecksums(
  fs: BackupFileSystem,
  files: Readonly<Record<string, string>>,
  keep: (path: string) => boolean = () => true,
): Promise<Map<string, Uint8Array>> {
  const contents = new Map<string, Uint8Array>()
  for (const path of Object.keys(files).sort()) {
    await assertSafePackageFile(fs, path)
    let data: Uint8Array
    try {
      data = await fs.readFile(path)
    } catch {
      throw BackupError.corruptedFile()
    }
    if ((await sha256Hex(data)) !== files[path]) throw BackupError.corruptedFile()
    if (keep(path)) contents.set(path, data)
  }
  return contents
}

export const SHA256_PATTERN = /^[0-9a-f]{64}$/
export const ASSET_PATH_PATTERN = /^Files\/[0-9a-f]{64}\.pdf$/

export function isValidDigest(value: string): boolean {
  return SHA256_PATTERN.test(value)
}

export function isValidAssetPath(path: string): boolean {
  return ASSET_PATH_PATTERN.test(path)
}

/** Nome do PDF no pacote: um arquivo por conteúdo. */
export function assetPathFor(digest: string): string {
  return `Files/${digest}.pdf`
}
