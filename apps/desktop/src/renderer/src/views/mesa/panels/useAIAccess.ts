import { onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { AIAccess } from '@shared/ipc-ai'
import { invoke, on } from '@/lib/api'
import { useAppStore } from '@/stores/app'

/**
 * Como a IA será chamada agora (assinatura, chaves próprias ou indisponível), consultado no
 * processo principal e atualizado quando a conta ou as preferências de IA mudam.
 */
export function useAIAccess(purpose: 'review' | 'research'): { access: Ref<AIAccess | null>; refresh: () => Promise<void> } {
  const app = useAppStore()
  const access = ref<AIAccess | null>(null)
  let request = 0

  async function refresh(): Promise<void> {
    const current = (request += 1)
    try {
      const loaded = await invoke('ai:access', { purpose })
      if (current === request) access.value = loaded
    } catch {
      if (current === request) access.value = null
    }
  }

  // Chave em texto: outras preferências (larguras de painel, zoom) não disparam nova consulta.
  watch(
    () => JSON.stringify([app.account.loggedIn, app.account.account?.plan ?? null, app.settings.ai]),
    () => void refresh(),
    { immediate: true },
  )
  // O uso da assinatura muda depois de cada análise; a conta é atualizada pelo processo principal.
  const stop = on('account:changed', () => void refresh())
  onBeforeUnmount(stop)

  return { access, refresh }
}
