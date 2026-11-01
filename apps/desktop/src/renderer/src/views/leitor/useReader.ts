import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ReaderCommand, ReaderMenuRequest, ReaderSnapshot, ReaderTabView, ReaderWebAction, ReaderWebState } from '@shared/ipc-reader'
import { errorMessage, invoke, on } from '@/lib/api'
import { useToasts } from '@/stores/toasts'

/**
 * Estado do Leitor na janela: o processo principal é a fonte; a janela envia comandos e recebe
 * o estado novo por `reader:stateChanged`.
 */
export function useReader() {
  const toasts = useToasts()
  const snapshot = shallowRef<ReaderSnapshot | null>(null)
  const webStates = ref<Record<string, ReaderWebState>>({})
  const ready = ref(false)

  const tabs = computed<ReaderTabView[]>(() => snapshot.value?.tabs ?? [])
  const selectedTab = computed<ReaderTabView | null>(() => {
    const value = snapshot.value
    if (!value || value.selectedID === null) return null
    return value.tabs.find((tab) => tab.id === value.selectedID) ?? null
  })
  const selectedWebState = computed<ReaderWebState | null>(() => {
    const tab = selectedTab.value
    return tab && tab.kind === 'web' ? (webStates.value[tab.id] ?? null) : null
  })

  function accept(next: ReaderSnapshot): void {
    if (snapshot.value && next.revision < snapshot.value.revision) return
    snapshot.value = next
    // Estados de abas fechadas não servem mais.
    const ids = new Set(next.tabs.map((tab) => tab.id))
    const kept = Object.fromEntries(Object.entries(webStates.value).filter(([id]) => ids.has(id)))
    if (Object.keys(kept).length !== Object.keys(webStates.value).length) webStates.value = kept
  }

  const stops = [
    on('reader:stateChanged', accept),
    on('reader:webChanged', (state) => {
      webStates.value = { ...webStates.value, [state.tabID]: state }
    }),
  ]
  onBeforeUnmount(() => stops.forEach((stop) => stop()))

  async function load(): Promise<void> {
    try {
      const [state, web] = await Promise.all([invoke('reader:state'), invoke('reader:webStates')])
      accept(state)
      webStates.value = Object.fromEntries(web.map((item) => [item.tabID, item]))
    } catch (error) {
      toasts.show(errorMessage(error), 'error')
    } finally {
      ready.value = true
    }
  }

  async function command(value: ReaderCommand): Promise<void> {
    try {
      await invoke('reader:command', value)
    } catch (error) {
      toasts.show(errorMessage(error), 'error')
    }
  }

  async function web(tabID: string, action: ReaderWebAction, url?: string): Promise<void> {
    try {
      await invoke('reader:web', { tabID, action, url })
    } catch (error) {
      toasts.show(errorMessage(error), 'error')
    }
  }

  async function activateSermon(dateKey: string | null): Promise<void> {
    try {
      await invoke('reader:activateSermon', { dateKey })
    } catch (error) {
      toasts.show(errorMessage(error), 'error')
    }
  }

  async function setReviewInclusion(tabID: string, included: boolean): Promise<void> {
    try {
      await invoke('reader:setReviewInclusion', { tabID, included })
    } catch (error) {
      toasts.show(errorMessage(error), 'error')
    }
  }

  function menu(request: ReaderMenuRequest): void {
    void invoke('reader:menu', request).catch((error: unknown) => toasts.show(errorMessage(error), 'error'))
  }

  return { snapshot, webStates, ready, tabs, selectedTab, selectedWebState, load, command, web, activateSermon, setReviewInclusion, menu }
}

/** Chama um canal que pode não existir ainda (de outro módulo); `undefined` se não existir. */
export async function invokeOptional<T>(channel: string, payload?: unknown): Promise<T | undefined> {
  const bridge = window.pregar as unknown as {
    invoke(channel: string, payload?: unknown): Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>
  }
  const result = await bridge.invoke(channel, payload)
  if (result.ok) return result.value
  if (result.error.code === 'unknown_channel') return undefined
  throw new Error(result.error.message)
}
