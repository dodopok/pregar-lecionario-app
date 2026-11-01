// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { webContextMenuTemplate, type WebMenuActions, type WebMenuInput } from '../../src/main/modules/reader/web-menu'

const base: WebMenuInput = {
  linkURL: '',
  isEditable: false,
  selectionText: '',
  editFlags: { canCut: false, canCopy: false, canPaste: false },
  canGoBack: false,
  canGoForward: false,
}

function actions(): WebMenuActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    openLinkInTab: vi.fn(),
    openLinkInBrowser: vi.fn(),
    copyLink: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openPageInBrowser: vi.fn(),
  }
}

const labels = (items: ReturnType<typeof webContextMenuTemplate>) => items.filter((item) => item.type !== 'separator').map((item) => item.label)
const item = (items: ReturnType<typeof webContextMenuTemplate>, label: string) => items.find((entry) => entry.label === label)!
const click = (entry: { click?: unknown }) => (entry.click as () => void)()

describe('menu de contexto das abas web do Leitor', () => {
  it('página sem seleção: copiar desativado, navegação conforme o histórico', () => {
    const items = webContextMenuTemplate({ ...base, canGoBack: true }, actions())
    expect(labels(items)).toEqual(['Copiar', 'Voltar', 'Avançar', 'Recarregar', 'Abrir no navegador'])
    expect(item(items, 'Copiar').enabled).toBe(false)
    expect(item(items, 'Voltar').enabled).toBe(true)
    expect(item(items, 'Avançar').enabled).toBe(false)
  })

  it('texto selecionado habilita copiar e copia da página', () => {
    const handlers = actions()
    const items = webContextMenuTemplate({ ...base, selectionText: '  Romanos 13 ' }, handlers)
    expect(item(items, 'Copiar').enabled).toBe(true)
    click(item(items, 'Copiar'))
    expect(handlers.copy).toHaveBeenCalledOnce()
  })

  it('link http(s) oferece nova aba, navegador e copiar endereço com o próprio link', () => {
    const handlers = actions()
    const items = webContextMenuTemplate({ ...base, linkURL: 'https://exemplo.com/artigo' }, handlers)
    expect(labels(items).slice(0, 3)).toEqual(['Abrir link em nova aba', 'Abrir link no navegador', 'Copiar endereço do link'])
    click(item(items, 'Abrir link em nova aba'))
    click(item(items, 'Abrir link no navegador'))
    click(item(items, 'Copiar endereço do link'))
    expect(handlers.openLinkInTab).toHaveBeenCalledWith('https://exemplo.com/artigo')
    expect(handlers.openLinkInBrowser).toHaveBeenCalledWith('https://exemplo.com/artigo')
    expect(handlers.copyLink).toHaveBeenCalledWith('https://exemplo.com/artigo')
  })

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,oi', 'mailto:a@b.c'])('link %s não ganha ações de link', (linkURL) => {
    const handlers = actions()
    const items = webContextMenuTemplate({ ...base, linkURL }, handlers)
    expect(labels(items)).not.toContain('Abrir link no navegador')
    expect(labels(items)).not.toContain('Abrir link em nova aba')
  })

  it('campo editável mostra recortar, copiar e colar conforme o Chromium permite', () => {
    const handlers = actions()
    const items = webContextMenuTemplate({ ...base, isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: false } }, handlers)
    expect(labels(items).slice(0, 3)).toEqual(['Recortar', 'Copiar', 'Colar'])
    expect(item(items, 'Colar').enabled).toBe(false)
    click(item(items, 'Recortar'))
    expect(handlers.cut).toHaveBeenCalledOnce()
  })

  it('nunca oferece inspecionar, salvar ou imprimir', () => {
    const items = webContextMenuTemplate({ ...base, linkURL: 'https://exemplo.com', isEditable: true }, actions())
    expect(labels(items).join(' ')).not.toMatch(/Inspecionar|Salvar|Imprimir/)
  })

  it('ações de navegação chamam o Leitor', () => {
    const handlers = actions()
    const items = webContextMenuTemplate({ ...base, canGoBack: true, canGoForward: true }, handlers)
    for (const label of ['Voltar', 'Avançar', 'Recarregar', 'Abrir no navegador']) click(item(items, label))
    expect(handlers.back).toHaveBeenCalledOnce()
    expect(handlers.forward).toHaveBeenCalledOnce()
    expect(handlers.reload).toHaveBeenCalledOnce()
    expect(handlers.openPageInBrowser).toHaveBeenCalledOnce()
  })
})
