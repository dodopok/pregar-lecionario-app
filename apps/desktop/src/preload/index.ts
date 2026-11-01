import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const windowArgument = process.argv.find((value) => value.startsWith('--pregar-window='))
const windowKind = windowArgument ? windowArgument.slice('--pregar-window='.length) : 'mesa'

/**
 * Ponte mínima com o processo principal: só invocações por canal nomeado e assinatura de eventos.
 * Nenhuma API do Node ou do Electron é exposta à página.
 */
const bridge = {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke('pregar:invoke', channel, payload),
  on: (event: string, handler: (payload: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) handler(payload)
    }
    ipcRenderer.on('pregar:event', listener)
    return () => ipcRenderer.removeListener('pregar:event', listener)
  },
  platform: process.platform,
  windowKind,
}

contextBridge.exposeInMainWorld('pregar', bridge)
