import type { EventChannel, EventChannels, InvokeChannel, InvokeRequest, InvokeResponse } from '@shared/ipc'
import type { IpcResult, PregarAPIErrorInfo } from '@shared/types'

/** Erro vindo do processo principal, com mensagem pronta para mostrar. */
export class AppError extends Error {
  readonly code: string
  readonly status: number

  constructor(info: PregarAPIErrorInfo) {
    super(info.message)
    this.name = 'AppError'
    this.code = info.code
    this.status = info.status
  }
}

export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]
): Promise<InvokeResponse<C>> {
  const bridge = window.pregar as unknown as { invoke(channel: string, payload?: unknown): Promise<IpcResult<InvokeResponse<C>>> }
  const result = await bridge.invoke(channel, args[0])
  if (result.ok) return result.value
  throw new AppError(result.error)
}

export function on<E extends EventChannel>(event: E, handler: (payload: EventChannels[E]) => void): () => void {
  return window.pregar.on(event, handler)
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  if (error instanceof Error) return error.message
  return 'Algo deu errado.'
}

export const platform = (): 'darwin' | 'win32' | 'linux' => window.pregar?.platform ?? 'linux'
export const isMac = (): boolean => platform() === 'darwin'
/** Rótulo do modificador principal para dicas de atalho. */
export const mod = (): string => (isMac() ? '⌘' : 'Ctrl+')
export const shortcut = (keys: string): string =>
  isMac() ? keys : keys.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+').replace(/⌃/g, 'Ctrl+')
