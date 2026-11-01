/** Limite simples por chave em janela fixa, em memória (uma instância do serviço). */
export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Devolve verdadeiro se a chamada cabe na janela atual. */
  take(key: string, now = Date.now()): boolean {
    const current = this.windows.get(key)
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 })
      if (this.windows.size > 50_000) this.prune(now)
      return true
    }
    if (current.count >= this.max) return false
    current.count += 1
    return true
  }

  private prune(now: number): void {
    for (const [key, value] of this.windows) {
      if (now - value.start >= this.windowMs) this.windows.delete(key)
    }
  }
}
