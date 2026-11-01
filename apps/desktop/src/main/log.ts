import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { IntegrationLog } from '@pregar/core/log/integration'

const MAXIMUM_FILE_SIZE = 1_000_000

/** Registro das integrações em Logs/integracoes.log, com rotação em 1 MB (igual ao app Swift). */
export class FileIntegrationLog {
  readonly file: string
  readonly previous: string
  readonly log: IntegrationLog

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.file = join(directory, 'integracoes.log')
    this.previous = join(directory, 'integracoes-anterior.log')
    this.log = new IntegrationLog({ write: (line) => this.append(line) })
  }

  private append(line: string): void {
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAXIMUM_FILE_SIZE) {
        rmSync(this.previous, { force: true })
        renameSync(this.file, this.previous)
      }
      appendFileSync(this.file, `${line}\n`, 'utf8')
    } catch {
      // Falha de disco no registro não interrompe a operação registrada.
    }
  }

  tail(lines = 400): string {
    if (!existsSync(this.file)) return ''
    const text = readFileSync(this.file, 'utf8')
    return text.split('\n').slice(-lines - 1).join('\n').trim()
  }

  clear(): void {
    rmSync(this.file, { force: true })
    rmSync(this.previous, { force: true })
  }

  ensureFile(): string {
    if (!existsSync(this.file)) appendFileSync(this.file, '')
    return this.file
  }
}
