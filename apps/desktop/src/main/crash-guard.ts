import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redactSecrets } from '@pregar/core/log/integration'

const MAXIMUM_FILE_SIZE = 512_000

/** Marca usada no stderr; os testes ponta a ponta procuram por ela. */
export const UNHANDLED_ERROR_MARKER = '[pregar] erro não tratado no processo principal'

/**
 * Erros não tratados no processo principal vão para Logs/erros.log (com segredos conhecidos
 * removidos) em vez do diálogo padrão do Electron, que bloqueia o app até ser fechado. Um erro
 * isolado num canal não deve derrubar a escrita do sermão.
 */
export function installCrashGuards(logDirectory: string, onError?: (error: unknown) => void): void {
  const file = join(logDirectory, 'erros.log')
  const previous = join(logDirectory, 'erros-anterior.log')

  const record = (kind: string, error: unknown): void => {
    const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)
    const line = `${new Date().toISOString()} ${kind}\n${redactSecrets(detail)}\n`
    console.error(`${UNHANDLED_ERROR_MARKER} (${kind})\n${redactSecrets(detail)}`)
    try {
      mkdirSync(logDirectory, { recursive: true })
      if (existsSync(file) && statSync(file).size > MAXIMUM_FILE_SIZE) {
        rmSync(previous, { force: true })
        renameSync(file, previous)
      }
      appendFileSync(file, line, 'utf8')
    } catch {
      // Sem disco para o registro: o stderr já recebeu o erro.
    }
    try {
      onError?.(error)
    } catch {
      // O aviso ao usuário é opcional.
    }
  }

  process.on('uncaughtException', (error) => record('exceção', error))
  process.on('unhandledRejection', (reason) => record('promessa rejeitada', reason))
}
