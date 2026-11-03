import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

/** O que o app guarda na pasta de dados; o restante é do Chromium e pode ficar para trás. */
const APP_ENTRIES = [
  'pregar.sqlite',
  'pregar.sqlite-wal',
  'pregar.sqlite-shm',
  'secrets.bin',
  'Logs',
  'Library',
  'tessdata',
  'Backups',
]

/**
 * O app chamou-se Pregar até novembro de 2026, e a pasta de dados leva o nome do app. Na primeira
 * abertura com o nome novo, move a pasta antiga (ou só o que é nosso dentro dela, se o Chromium já
 * criou a nova) para o lugar novo: sermões, chaves e biblioteca continuam onde o usuário os deixou.
 * Nunca sobrescreve dados já existentes na pasta nova.
 */
export function migrateLegacyUserData(legacyDir: string, currentDir: string): 'moved' | 'kept' | 'none' {
  if (legacyDir === currentDir || !existsSync(join(legacyDir, 'pregar.sqlite'))) return 'none'
  if (existsSync(join(currentDir, 'pregar.sqlite'))) return 'kept'
  if (!existsSync(currentDir)) {
    renameSync(legacyDir, currentDir)
    return 'moved'
  }
  for (const entry of APP_ENTRIES) {
    const from = join(legacyDir, entry)
    const to = join(currentDir, entry)
    if (existsSync(from) && !existsSync(to)) renameSync(from, to)
  }
  return 'moved'
}
