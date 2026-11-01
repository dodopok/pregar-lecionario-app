import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { SecretName, SecretStatus } from '@shared/types'

const SECRET_NAMES: SecretName[] = ['estevao', 'openai', 'anthropic', 'google', 'perplexity', 'driveApiKey']

/** Segredos internos que nunca aparecem na interface. */
type InternalSecret = 'pregarSession' | 'googleRefreshToken' | 'googleClientSecret'

/**
 * Cofre de segredos cifrado com o chaveiro do sistema (Keychain, DPAPI ou libsecret) via safeStorage.
 * Os valores ficam só no processo principal; as janelas recebem apenas se cada chave está salva.
 */
export class SecretStore {
  private cache: Record<string, string> | null = null

  constructor(private readonly path: string) {}

  get encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache
    if (!existsSync(this.path)) {
      this.cache = {}
      return this.cache
    }
    try {
      const raw = readFileSync(this.path)
      const text = this.encryptionAvailable ? safeStorage.decryptString(raw) : raw.toString('utf8')
      this.cache = JSON.parse(text) as Record<string, string>
    } catch {
      // Cofre ilegível (outra máquina ou chave do sistema trocada): começa vazio sem apagar o arquivo antigo.
      renameSync(this.path, `${this.path}.ilegivel-${Date.now()}`)
      this.cache = {}
    }
    return this.cache
  }

  private persist(): void {
    const text = JSON.stringify(this.cache ?? {})
    const data = this.encryptionAvailable ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8')
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, data, { mode: 0o600 })
    renameSync(temporary, this.path)
  }

  get(name: SecretName | InternalSecret): string | null {
    const value = this.load()[name]
    return value && value.length > 0 ? value : null
  }

  set(name: SecretName | InternalSecret, value: string): void {
    const trimmed = value.trim()
    const store = this.load()
    if (trimmed) store[name] = trimmed
    else delete store[name]
    this.persist()
  }

  delete(name: SecretName | InternalSecret): void {
    const store = this.load()
    delete store[name]
    this.persist()
  }

  status(): SecretStatus {
    const store = this.load()
    const result = Object.fromEntries(SECRET_NAMES.map((name) => [name, Boolean(store[name])])) as Record<SecretName, boolean>
    return { ...result, encryptionAvailable: this.encryptionAvailable }
  }
}
