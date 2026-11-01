import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import type { AccountState, LiturgyAccess } from '@shared/ipc'
import type { SecretStatus } from '@shared/types'
import { normalizeLiturgicalColor } from '@pregar/core/liturgy/types'
import { invoke, on } from '@/lib/api'

/** Preferências, conta e acesso às leituras, sincronizados entre as janelas pelo processo principal. */
export const useAppStore = defineStore('app', () => {
  const settings = ref<AppSettings>(structuredClone(DEFAULT_SETTINGS))
  const account = ref<AccountState>({ loggedIn: false, account: null, email: null, offline: false, apiBaseURL: '' })
  const secrets = ref<SecretStatus | null>(null)
  const liturgyAccess = ref<LiturgyAccess>({ mode: 'none', message: '' })
  const ready = ref(false)

  async function load(): Promise<void> {
    const [loadedSettings, loadedAccount, loadedSecrets, access] = await Promise.all([
      invoke('settings:get'),
      invoke('account:get', {}),
      invoke('secrets:status'),
      invoke('liturgy:status'),
    ])
    settings.value = loadedSettings
    account.value = loadedAccount
    secrets.value = loadedSecrets
    liturgyAccess.value = access
    applyLiturgicalColor(loadedSettings.liturgy.lastColor ?? null)
    ready.value = true
    on('settings:changed', (next) => {
      settings.value = next
      applyLiturgicalColor(next.liturgy.lastColor ?? null)
      void refreshAccess()
    })
    on('account:changed', (next) => {
      account.value = next
      void refreshAccess()
    })
  }

  async function refreshAccess(): Promise<void> {
    liturgyAccess.value = await invoke('liturgy:status')
  }

  async function updateSettings(patch: SettingsPatch): Promise<void> {
    settings.value = await invoke('settings:update', patch)
  }

  async function refreshSecrets(): Promise<void> {
    secrets.value = await invoke('secrets:status')
    await refreshAccess()
  }

  function applyLiturgicalColor(color: string | null): void {
    document.documentElement.dataset.liturgical = normalizeLiturgicalColor(color) ?? 'green'
  }

  const isPro = () => account.value.loggedIn && account.value.account?.plan === 'pro'

  return { settings, account, secrets, liturgyAccess, ready, load, updateSettings, refreshSecrets, refreshAccess, applyLiturgicalColor, isPro }
})
