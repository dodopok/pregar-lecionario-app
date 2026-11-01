import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

/** Avisos breves no canto da janela (salvamento, erros de rede, confirmações). */
export const useToasts = defineStore('toasts', () => {
  const items = ref<Toast[]>([])
  let counter = 0

  function show(message: string, kind: Toast['kind'] = 'info', options: { action?: Toast['action']; timeout?: number } = {}): void {
    const id = (counter += 1)
    items.value = [...items.value.slice(-3), { id, message, kind, action: options.action }]
    const timeout = options.timeout ?? (kind === 'error' ? 7000 : 3500)
    if (timeout > 0) setTimeout(() => dismiss(id), timeout)
  }

  function dismiss(id: number): void {
    items.value = items.value.filter((item) => item.id !== id)
  }

  return { items, show, dismiss }
})
