import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { BackupFileSystem } from '@pregar/core/backup'

/**
 * Sistema de arquivos do backup preso a uma pasta raiz: caminhos relativos com "/", sem sair da raiz.
 */
export function nodeBackupFileSystem(root: string): BackupFileSystem {
  const base = resolve(root)
  const absolute = (path: string): string => {
    const target = resolve(base, ...path.split('/').filter(Boolean))
    if (target !== base && !target.startsWith(base + sep)) throw new Error('Caminho fora da pasta do backup.')
    return target
  }
  return {
    readFile: async (path) => new Uint8Array(await readFile(absolute(path))),
    writeFile: async (path, data) => writeFile(absolute(path), data),
    async stat(path) {
      try {
        const info = await lstat(absolute(path))
        return { isFile: info.isFile(), isDirectory: info.isDirectory(), isSymbolicLink: info.isSymbolicLink(), size: info.size }
      } catch {
        return null
      }
    },
    list: async (path) => readdir(absolute(path)),
    mkdir: async (path) => {
      await mkdir(absolute(path), { recursive: true })
    },
    remove: async (path) => rm(absolute(path), { recursive: true, force: true }),
    rename: async (from, to) => rename(absolute(from), absolute(to)),
  }
}

export function joinNative(...parts: string[]): string {
  return join(...parts)
}
