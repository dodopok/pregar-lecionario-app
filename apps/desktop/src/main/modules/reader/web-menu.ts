import type { MenuItemConstructorOptions } from 'electron'
import { isWebScheme } from '@pregar/core/reader'

/** O que o menu de contexto de uma página web precisa saber (subconjunto de `ContextMenuParams`). */
export interface WebMenuInput {
  linkURL: string
  isEditable: boolean
  selectionText: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean }
  canGoBack: boolean
  canGoForward: boolean
}

export interface WebMenuActions {
  openLinkInTab(link: string): void
  openLinkInBrowser(link: string): void
  copyLink(link: string): void
  cut(): void
  copy(): void
  paste(): void
  back(): void
  forward(): void
  reload(): void
  openPageInBrowser(): void
}

/**
 * Menu de contexto das abas web do Leitor. Ações de link só aparecem para http(s) — `javascript:`,
 * `file:` e outros esquemas nunca chegam a uma ação. Sem "Inspecionar", sem salvar e sem imprimir.
 */
export function webContextMenuTemplate(input: WebMenuInput, actions: WebMenuActions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  const link = isWebScheme(input.linkURL) ? input.linkURL : null
  if (link) {
    items.push(
      { label: 'Abrir link em nova aba', click: () => actions.openLinkInTab(link) },
      { label: 'Abrir link no navegador', click: () => actions.openLinkInBrowser(link) },
      { label: 'Copiar endereço do link', click: () => actions.copyLink(link) },
      { type: 'separator' },
    )
  }
  if (input.isEditable) {
    items.push(
      { label: 'Recortar', enabled: input.editFlags.canCut, click: () => actions.cut() },
      { label: 'Copiar', enabled: input.editFlags.canCopy, click: () => actions.copy() },
      { label: 'Colar', enabled: input.editFlags.canPaste, click: () => actions.paste() },
      { type: 'separator' },
    )
  } else {
    items.push({ label: 'Copiar', enabled: input.selectionText.trim() !== '', click: () => actions.copy() }, { type: 'separator' })
  }
  items.push(
    { label: 'Voltar', enabled: input.canGoBack, click: () => actions.back() },
    { label: 'Avançar', enabled: input.canGoForward, click: () => actions.forward() },
    { label: 'Recarregar', click: () => actions.reload() },
    { type: 'separator' },
    { label: 'Abrir no navegador', click: () => actions.openPageInBrowser() },
  )
  return items
}
