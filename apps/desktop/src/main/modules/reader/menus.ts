import { Menu } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { canReopenClosedTab, visibleReaderTabs } from '@pregar/core/reader'
import type { ReaderMenuRequest } from '@shared/ipc-reader'
import { contextOptions } from './helpers'
import type { ReaderService } from './service'

/**
 * Menus do Leitor como menus nativos: ficam acima das páginas web (que são vistas nativas) e
 * seguem o sistema em teclado e leitores de tela.
 */
export function popupReaderMenu(service: ReaderService, window: BrowserWindow, request: ReaderMenuRequest): void {
  const state = service.state
  const visible = visibleReaderTabs(state)
  const reopen: MenuItemConstructorOptions = {
    label: 'Reabrir aba fechada',
    enabled: canReopenClosedTab(state),
    click: () => service.command({ type: 'reopenClosed' }),
  }
  let items: MenuItemConstructorOptions[] = []
  switch (request.menu) {
    case 'tab':
      items = [
        { label: 'Duplicar aba', click: () => service.command({ type: 'duplicate', tabID: request.tabID }) },
        { label: 'Fechar aba', click: () => service.command({ type: 'close', tabID: request.tabID }) },
        {
          label: 'Fechar outras abas',
          enabled: visible.length >= 2,
          click: () => service.command({ type: 'closeOthers', tabID: request.tabID }),
        },
        {
          label: 'Fechar abas à direita',
          enabled: visible.findIndex((tab) => tab.id === request.tabID) < visible.length - 1,
          click: () => service.command({ type: 'closeOthers', tabID: request.tabID, toRightOnly: true }),
        },
        { type: 'separator' },
        reopen,
      ]
      break
    case 'allTabs':
      items = visible.length
        ? visible.map((tab) => ({
            label: tab.title || tab.location,
            type: 'checkbox' as const,
            checked: tab.id === state.selectedID,
            click: () => service.command({ type: 'select', tabID: tab.id }),
          }))
        : [{ label: 'Nenhuma aba nesta pesquisa', enabled: false }]
      items.push({ type: 'separator' }, reopen)
      break
    case 'research':
      items = contextOptions(state).map((option) => ({
        label: option.label,
        type: 'checkbox' as const,
        checked: option.dateKey === (state.activeSermonDateKey ?? null),
        click: () => service.activateSermon(option.dateKey),
      }))
      break
    case 'section':
      items = [
        {
          label: 'Abrir seção em nova aba',
          click: () => service.command({ type: 'openPdfPage', fromID: request.tabID, page: request.page, background: false }),
        },
        {
          label: 'Abrir seção em segundo plano',
          click: () => service.command({ type: 'openPdfPage', fromID: request.tabID, page: request.page, background: true }),
        },
      ]
      break
  }
  const zoom = window.webContents.getZoomFactor()
  Menu.buildFromTemplate(items).popup({ window, x: Math.round(request.x * zoom), y: Math.round(request.y * zoom) })
}
