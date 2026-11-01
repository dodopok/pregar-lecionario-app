/**
 * `BackupFileSystem` em memória, com links simbólicos, para testes e para montar pacotes sem
 * disco. Simula o sistema real: links intermediários são seguidos na resolução, `stat` não segue
 * o último componente e ".." sobe de pasta (por isso a validação precisa recusar antes de ler).
 */
import type { BackupFileStat, BackupFileSystem } from './fs'

type Entry = { kind: 'file'; data: Uint8Array } | { kind: 'directory' } | { kind: 'symlink'; target: string }

const MAX_LINKS = 32

function notFound(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
}

function split(path: string): string[] {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts
}

export class MemoryBackupFileSystem implements BackupFileSystem {
  private readonly entries = new Map<string, Entry>([['', { kind: 'directory' }]])

  /** Cria um link simbólico; `target` é um caminho desta mesma raiz. */
  symlink(path: string, target: string): void {
    const key = this.resolve(path, false)
    this.requireDirectory(parentOf(key))
    this.entries.set(key, { kind: 'symlink', target })
  }

  /** Caminhos de todos os arquivos comuns, em ordem. */
  files(): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.kind === 'file')
      .map(([key]) => key)
      .sort()
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(this.resolve(path, true))
    if (entry?.kind !== 'file') throw notFound(path)
    return entry.data.slice()
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const key = this.resolve(path, true)
    this.requireDirectory(parentOf(key))
    if (this.entries.get(key)?.kind === 'directory') throw new Error(`EISDIR: ${path}`)
    this.entries.set(key, { kind: 'file', data: data.slice() })
  }

  async stat(path: string): Promise<BackupFileStat | null> {
    let key: string
    try {
      key = this.resolve(path, false)
    } catch {
      return null
    }
    const entry = this.entries.get(key)
    if (!entry) return null
    return {
      isFile: entry.kind === 'file',
      isDirectory: entry.kind === 'directory',
      isSymbolicLink: entry.kind === 'symlink',
      size: entry.kind === 'file' ? entry.data.byteLength : 0,
    }
  }

  async list(path: string): Promise<string[]> {
    const key = this.resolve(path, true)
    this.requireDirectory(key)
    const prefix = key === '' ? '' : `${key}/`
    return [...this.entries.keys()]
      .filter((candidate) => candidate.startsWith(prefix) && candidate !== key)
      .map((candidate) => candidate.slice(prefix.length))
      .filter((rest) => rest.length > 0 && !rest.includes('/'))
      .sort()
  }

  async mkdir(path: string): Promise<void> {
    let current = ''
    for (const part of split(path)) {
      current = current === '' ? part : `${current}/${part}`
      current = this.resolve(current, true)
      const entry = this.entries.get(current)
      if (!entry) this.entries.set(current, { kind: 'directory' })
      else if (entry.kind !== 'directory') throw new Error(`EEXIST: ${path}`)
    }
  }

  async remove(path: string): Promise<void> {
    const key = this.resolve(path, false)
    if (key === '') throw new Error('Não é possível remover a raiz.')
    for (const candidate of [...this.entries.keys()]) {
      if (candidate === key || candidate.startsWith(`${key}/`)) this.entries.delete(candidate)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.resolve(from, false)
    const destination = this.resolve(to, false)
    if (!this.entries.has(source)) throw notFound(from)
    if (this.entries.has(destination)) throw new Error(`EEXIST: ${to}`)
    this.requireDirectory(parentOf(destination))
    for (const [candidate, entry] of [...this.entries.entries()]) {
      if (candidate === source || candidate.startsWith(`${source}/`)) {
        this.entries.delete(candidate)
        this.entries.set(destination + candidate.slice(source.length), entry)
      }
    }
  }

  /** Resolve links intermediários (e o último, se `followLast`). */
  private resolve(path: string, followLast: boolean): string {
    let pending = split(path)
    let resolved: string[] = []
    let hops = 0
    while (pending.length > 0) {
      const [part, ...rest] = pending
      const candidate = [...resolved, part!].join('/')
      const entry = this.entries.get(candidate)
      if (entry?.kind === 'symlink' && (rest.length > 0 || followLast)) {
        if ((hops += 1) > MAX_LINKS) throw new Error(`ELOOP: ${path}`)
        resolved = []
        pending = [...split(entry.target), ...rest]
        continue
      }
      resolved = [...resolved, part!]
      pending = rest
    }
    return resolved.join('/')
  }

  private requireDirectory(key: string): void {
    if (this.entries.get(key)?.kind !== 'directory') throw notFound(key)
  }
}

function parentOf(key: string): string {
  const index = key.lastIndexOf('/')
  return index === -1 ? '' : key.slice(0, index)
}
