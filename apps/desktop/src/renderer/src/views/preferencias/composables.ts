import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { invoke } from '@/lib/api'

/** Relógio reativo para contagens regressivas. */
export function useNow(intervalMs = 1000): Ref<number> {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => {
    timer = setInterval(() => (now.value = Date.now()), intervalMs)
  })
  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
  })
  return now
}

/**
 * Repete `task` a cada `intervalMs` enquanto `enabled` for verdadeiro e a janela estiver visível.
 * A tarefa devolve `true` para parar. Ao voltar a ficar visível, consulta na hora.
 */
export function usePolling(task: () => Promise<boolean | void>, intervalMs: number, enabled: Ref<boolean>): { runNow: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let disposed = false

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

  function clear(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule(): void {
    clear()
    if (disposed || !enabled.value) return
    timer = setTimeout(() => void tick(), intervalMs)
  }

  async function tick(): Promise<void> {
    if (disposed || !enabled.value) return
    if (!visible()) return // retoma no evento de visibilidade
    if (running) return schedule()
    running = true
    let stop = false
    try {
      stop = (await task()) === true
    } catch {
      // Falha de rede: tenta de novo no próximo intervalo.
    } finally {
      running = false
    }
    if (stop) enabled.value = false
    else schedule()
  }

  function onVisibility(): void {
    if (visible() && enabled.value) void tick()
  }

  watch(enabled, (value) => (value ? schedule() : clear()), { immediate: true })
  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onBeforeUnmount(() => {
    disposed = true
    clear()
    document.removeEventListener('visibilitychange', onVisibility)
  })
  return { runNow: tick }
}

/** Copia texto simples; usa a API assíncrona e recorre ao execCommand se ela falhar. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

export function openExternal(url: string): void {
  void invoke('app:openExternal', { url }).catch(() => undefined)
}
