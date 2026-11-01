import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { LiturgicalAPIError } from '@pregar/core/liturgy/client'
import type { InvokeChannel, InvokeChannels } from '@shared/ipc'
import type { IpcResult, PregarAPIErrorInfo } from '@shared/types'
import { isAppURL } from '../security'
import { PregarAPIError } from '../services/pregar-api'

export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code = 'error',
  ) {
    super(message)
    this.name = 'UserFacingError'
  }
}

type Handler<C extends InvokeChannel> = (
  request: InvokeChannels[C]['req'],
  event: IpcMainInvokeEvent,
) => Promise<InvokeChannels[C]['res']> | InvokeChannels[C]['res']

const handlers = new Map<string, Handler<InvokeChannel>>()

export function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  if (handlers.has(channel)) throw new Error(`Canal duplicado: ${channel}`)
  handlers.set(channel, handler as unknown as Handler<InvokeChannel>)
}

export function toErrorInfo(error: unknown): PregarAPIErrorInfo {
  if (error instanceof PregarAPIError) return { code: error.code, message: error.message, status: error.status }
  if (error instanceof LiturgicalAPIError) return { code: error.code ?? 'liturgy', message: error.message, status: error.status ?? 0 }
  if (error instanceof UserFacingError) return { code: error.code, message: error.message, status: 0 }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'canceled', message: 'Operação cancelada.', status: 0 }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { code: 'timeout', message: 'O serviço demorou demais para responder. Tente novamente.', status: 0 }
  }
  // Erros com mensagem pensada para o usuário vindos do domínio (mensagens em português) passam adiante.
  if (error instanceof Error && error.message && /[ãçéêóõáíú]|\s/.test(error.message) && error.message.length < 400) {
    return { code: (error as { code?: string }).code ?? 'error', message: error.message, status: 0 }
  }
  console.error(error)
  return { code: 'internal', message: 'Algo deu errado. Tente novamente; se persistir, veja o registro em Preferências › Registros.', status: 0 }
}

export function installRouter(): void {
  ipcMain.handle('pregar:invoke', async (event, channel: unknown, payload: unknown): Promise<IpcResult<unknown>> => {
    // Somente janelas do próprio app chamam o processo principal; páginas web do Leitor não têm acesso.
    if (!event.senderFrame || !isAppURL(event.senderFrame.url)) {
      return { ok: false, error: { code: 'forbidden', message: 'Origem não autorizada.', status: 403 } }
    }
    if (typeof channel !== 'string' || !handlers.has(channel)) {
      return { ok: false, error: { code: 'unknown_channel', message: `Canal desconhecido: ${String(channel)}`, status: 404 } }
    }
    try {
      const value = await handlers.get(channel)!(payload as never, event)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: toErrorInfo(error) }
    }
  })
}
