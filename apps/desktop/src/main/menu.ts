import { Menu, app, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { WindowKind } from '@shared/types'

export interface MenuActions {
  openWindow(kind: WindowKind): void
  command(command: string): void
  revealLog(): void
  checkUpdates(): void
  privacyURL(): string
}

/** Menu do app em português, com os atalhos do README (Google Docs para Mac na escrita). */
export function buildMenu(actions: MenuActions): void {
  const isMac = process.platform === 'darwin'
  const command = (name: string, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => actions.command(name),
  })
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Sobre o Pregar' },
              { type: 'separator' },
              { label: 'Preferências…', accelerator: 'Cmd+,', click: () => actions.openWindow('preferencias') },
              { type: 'separator' },
              { role: 'services', label: 'Serviços' },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar Pregar' },
              { role: 'hideOthers', label: 'Ocultar outros' },
              { role: 'unhide', label: 'Mostrar tudo' },
              { type: 'separator' },
              { role: 'quit', label: 'Sair do Pregar' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Arquivo',
      submenu: [
        command('save', 'Salvar agora', 'CmdOrCtrl+S'),
        command('print', 'Imprimir', 'CmdOrCtrl+P'),
        { type: 'separator' },
        command('tablet', 'Cópia para o tablet…', 'Shift+CmdOrCtrl+T'),
        command('drive', 'Google Drive…'),
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close', label: 'Fechar janela' } satisfies MenuItemConstructorOptions]
          : [
              { label: 'Preferências…', accelerator: 'Ctrl+,', click: () => actions.openWindow('preferencias') } satisfies MenuItemConstructorOptions,
              { type: 'separator' } satisfies MenuItemConstructorOptions,
              { role: 'quit', label: 'Sair' } satisfies MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: 'Editar',
      submenu: [
        command('undo', 'Desfazer', 'CmdOrCtrl+Z'),
        command('redo', 'Refazer', 'Shift+CmdOrCtrl+Z'),
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        command('pastePlain', 'Colar sem formatação', 'Shift+CmdOrCtrl+V'),
        { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        command('find', 'Localizar', 'CmdOrCtrl+F'),
        command('replace', 'Localizar e substituir', 'Shift+CmdOrCtrl+H'),
      ],
    },
    {
      label: 'Ver',
      submenu: [
        command('toggleCalendar', 'Calendário', 'Shift+Alt+CmdOrCtrl+1'),
        command('toggleReadings', 'Leituras', 'Shift+Alt+CmdOrCtrl+2'),
        command('toggleMaterials', 'Materiais', 'Shift+Alt+CmdOrCtrl+3'),
        command('focusMode', 'Modo de escrita', 'Shift+CmdOrCtrl+F'),
        { type: 'separator' },
        command('zoomIn', 'Aumentar zoom do texto', 'CmdOrCtrl+='),
        command('zoomOut', 'Diminuir zoom do texto', 'CmdOrCtrl+-'),
        command('zoomReset', 'Zoom 100%', 'Alt+CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Ferramentas de desenvolvimento' } satisfies MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Preparação',
      submenu: [
        { label: 'Mesa', accelerator: 'CmdOrCtrl+0', click: () => actions.openWindow('mesa') },
        { label: 'Bíblia', accelerator: 'CmdOrCtrl+1', click: () => actions.openWindow('biblia') },
        { label: 'Leitor', accelerator: 'CmdOrCtrl+2', click: () => actions.openWindow('leitor') },
        { label: 'Biblioteca', accelerator: 'CmdOrCtrl+3', click: () => actions.openWindow('biblioteca') },
        { label: 'Arquivo', accelerator: 'CmdOrCtrl+4', click: () => actions.openWindow('arquivo') },
        { type: 'separator' },
        command('review', 'Revisar…', 'Shift+Alt+CmdOrCtrl+R'),
        command('questions', 'Perguntas de emergência…'),
        command('rehearsal', 'Ensaio', 'Shift+Alt+CmdOrCtrl+E'),
        command('history', 'Histórico de versões', 'Shift+Alt+CmdOrCtrl+H'),
      ],
    },
    { role: 'windowMenu', label: 'Janela' },
    {
      role: 'help',
      label: 'Ajuda',
      submenu: [
        command('shortcuts', 'Atalhos de teclado', 'CmdOrCtrl+/'),
        command('commandSearch', 'Pesquisar comandos', 'Alt+/'),
        { type: 'separator' },
        { label: 'Registro de integrações', click: () => actions.revealLog() },
        { label: 'Verificar atualizações', click: () => actions.checkUpdates() },
        { label: 'Política de privacidade', click: () => void shell.openExternal(actions.privacyURL()) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
