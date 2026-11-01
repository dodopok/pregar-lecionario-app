/** Implementação do processo utilitário de indexação; preenchida pelo módulo da Biblioteca. */
export function runIndexerWorker(): void {
  const port = (process as unknown as { parentPort?: { on(event: 'message', listener: (event: { data: unknown }) => void): void; postMessage(message: unknown): void } }).parentPort
  port?.on('message', (event) => port.postMessage({ id: (event.data as { id?: number })?.id, error: 'Indexação ainda não disponível.' }))
}
