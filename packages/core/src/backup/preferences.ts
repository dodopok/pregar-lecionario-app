/**
 * Preferências no backup. Credenciais nunca entram no pacote nem são tocadas na restauração:
 * tokens OAuth, Client ID do Google e chaves de API ficam no cofre do sistema de cada máquina.
 */
import type { JsonValue } from './json'

/** Chaves de preferência do app Swift (`PregarBackupService.preferenceKeys`). */
export const LEGACY_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  'api.prayerBook',
  'api.language',
  'api.bible',
  'api.readingType',
  'ai.reviewProvider',
  'ai.researchProvider',
  'ai.reviewModel',
  'ai.researchModel',
  'drive.targets',
  'drive.font',
  'drive.fontSize',
  'drive.lastTabletFolder',
  'library.pdfFolder',
  'pregar.material-research.reports.v1',
  'pregar.favorite-site-search.reports.v3',
  'pregar.favorite-sites.v1',
  'pregar.favorite-authors.v1',
])

const CREDENTIAL_PATTERN =
  /(token|secret|password|passphrase|api[-_.]?key|client[-_.]?id|oauth|credential|private[-_.]?key|authorization|bearer|cookie|session)/i

/** Chave que parece guardar segredo; nunca vai para o backup, mesmo se estiver na lista permitida. */
export function isCredentialPreferenceKey(key: string): boolean {
  return CREDENTIAL_PATTERN.test(key)
}

/** A chave pode entrar no backup: não é credencial e, havendo lista permitida, está nela. */
export function isBackupPreferenceKey(key: string, allowed?: ReadonlySet<string>): boolean {
  if (isCredentialPreferenceKey(key)) return false
  return allowed ? allowed.has(key) : true
}

/** Copia apenas as preferências que podem entrar no pacote. */
export function filterBackupPreferences(
  preferences: Readonly<Record<string, JsonValue | undefined>>,
  allowed?: ReadonlySet<string>,
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(preferences).sort()) {
    const value = preferences[key]
    if (value === undefined || !isBackupPreferenceKey(key, allowed)) continue
    Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
  }
  return result
}

export interface PreferenceRestorePlan {
  /** Valores do backup a gravar. */
  set: Record<string, JsonValue>
  /** Preferências do destino, cobertas pelo backup, ausentes no pacote: devem ser apagadas. */
  remove: string[]
}

/**
 * Como no Swift: limpa as preferências permitidas que o backup não traz e grava as do backup.
 * Credenciais do destino ficam intocadas.
 */
export function planPreferenceRestore(
  backup: Readonly<Record<string, JsonValue>>,
  currentKeys: Iterable<string>,
  allowed?: ReadonlySet<string>,
): PreferenceRestorePlan {
  const set = filterBackupPreferences(backup, allowed)
  const remove = [...new Set(currentKeys)]
    .filter((key) => isBackupPreferenceKey(key, allowed) && !Object.hasOwn(set, key))
    .sort()
  return { set, remove }
}
