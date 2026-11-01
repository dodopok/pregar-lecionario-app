import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createReaderState, openWebTab, setTabReviewInclusion, type ReaderState } from '@pregar/core/reader'
import { readerShortcut, type ReaderKeyInput } from '../../src/shared/ipc-reader'
import {
  cleanUserAgent,
  contextOptions,
  copySource,
  isAllowedTopLevelURL,
  isIgnorableLoadError,
  makeSnapshot,
  markedMaterial,
  textWithSource,
  viewportToWindowBounds,
  webLoadErrorMessage,
  windowOpenInBackground,
} from '../../src/main/modules/reader/helpers'

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined }, app: { on: () => undefined }, session: {}, shell: {}, net: {} }))

const key = (value: Partial<ReaderKeyInput> & { key: string }): ReaderKeyInput => ({
  meta: false,
  control: false,
  shift: false,
  alt: false,
  ...value,
})

describe('atalhos do Leitor', () => {
  it('usa ⌘ no macOS e Ctrl nos demais', () => {
    expect(readerShortcut(key({ key: 't', meta: true }), 'darwin')).toBe('newTab')
    expect(readerShortcut(key({ key: 't', control: true }), 'darwin')).toBeNull()
    expect(readerShortcut(key({ key: 't', control: true }), 'win32')).toBe('newTab')
    expect(readerShortcut(key({ key: 't', meta: true }), 'linux')).toBeNull()
  })

  it('cobre a tabela do README', () => {
    const ctrl = (value: Partial<ReaderKeyInput> & { key: string }) => readerShortcut(key({ control: true, ...value }), 'linux')
    expect(ctrl({ key: 'w' })).toBe('closeTab')
    expect(ctrl({ key: 'T', shift: true })).toBe('reopenClosedTab')
    expect(ctrl({ key: '[' })).toBe('back')
    expect(ctrl({ key: ']' })).toBe('forward')
    expect(ctrl({ key: 'l' })).toBe('focusAddress')
    expect(ctrl({ key: 'r' })).toBe('reload')
    expect(ctrl({ key: '=' })).toBe('zoomIn')
    expect(ctrl({ key: '+', shift: true })).toBe('zoomIn')
    expect(ctrl({ key: '-' })).toBe('zoomOut')
    expect(ctrl({ key: '+', code: 'NumpadAdd' })).toBe('zoomIn')
  })

  it('⌃Tab e ⇧⌃Tab usam Control em todos os sistemas', () => {
    expect(readerShortcut(key({ key: 'Tab', control: true }), 'darwin')).toBe('nextTab')
    expect(readerShortcut(key({ key: 'Tab', control: true, shift: true }), 'darwin')).toBe('previousTab')
    expect(readerShortcut(key({ key: 'Tab', control: true }), 'win32')).toBe('nextTab')
    expect(readerShortcut(key({ key: 'Tab', meta: true, control: true }), 'darwin')).toBeNull()
  })

  it('não captura combinações com Alt, letras sem modificador nem ⇧ fora de ⇧⌘T', () => {
    expect(readerShortcut(key({ key: 't', control: true, alt: true }), 'linux')).toBeNull()
    expect(readerShortcut(key({ key: 't' }), 'linux')).toBeNull()
    expect(readerShortcut(key({ key: 'W', control: true, shift: true }), 'linux')).toBeNull()
    expect(readerShortcut(key({ key: 'x', control: true }), 'linux')).toBeNull()
  })

  it('em teclados não latinos, usa a posição física da letra', () => {
    expect(readerShortcut(key({ key: 'е', code: 'KeyT', control: true }), 'linux')).toBe('newTab')
    expect(readerShortcut(key({ key: 'ц', code: 'KeyW', control: true }), 'linux')).toBe('closeTab')
    // Com letra latina, vale a tecla (Dvorak: a tecla física KeyT produz "y").
    expect(readerShortcut(key({ key: 'y', code: 'KeyT', control: true }), 'linux')).toBeNull()
  })
})

describe('posição da página web', () => {
  it('converte px CSS em DIP com o zoom da janela, sem frestas', () => {
    expect(viewportToWindowBounds({ x: 230.4, y: 132.6, width: 750.2, height: 727.9 }, 1)).toEqual({ x: 230, y: 133, width: 751, height: 728 })
    expect(viewportToWindowBounds({ x: 100, y: 50, width: 400, height: 300 }, 1.25)).toEqual({ x: 125, y: 63, width: 500, height: 375 })
  })

  it('recusa áreas vazias e valores inválidos', () => {
    expect(viewportToWindowBounds({ x: 0, y: 0, width: 0.2, height: 100 }, 1)).toBeNull()
    expect(viewportToWindowBounds({ x: Number.NaN, y: 0, width: 10, height: 10 }, 1)).toBeNull()
    expect(viewportToWindowBounds({ x: -5, y: 0, width: 105, height: 10 }, 1)).toEqual({ x: 0, y: 0, width: 100, height: 10 })
  })
})

describe('regras das páginas web', () => {
  it('limpa Electron e o app do agente de usuário', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Pregar/0.1.0 Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36'
    expect(cleanUserAgent(ua, ['Pregar'])).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Safari/537.36')
  })

  it('nova janela: só background-tab fica ao fundo', () => {
    expect(windowOpenInBackground('background-tab')).toBe(true)
    expect(windowOpenInBackground('foreground-tab')).toBe(false)
    expect(windowOpenInBackground('new-window')).toBe(false)
  })

  it('quadro principal só abre http(s)', () => {
    expect(isAllowedTopLevelURL('https://www.workingpreacher.org/')).toBe(true)
    expect(isAllowedTopLevelURL('http://127.0.0.1:8080/a')).toBe(true)
    expect(isAllowedTopLevelURL('about:blank')).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,oi', 'chrome://settings', 'devtools://devtools', 'nada'])
      expect(isAllowedTopLevelURL(url)).toBe(false)
  })

  it('mensagens de falha em português', () => {
    expect(webLoadErrorMessage(-105, 'ERR_NAME_NOT_RESOLVED')).toMatch(/não foi encontrado/)
    expect(webLoadErrorMessage(-106, '')).toBe('Sem conexão com a internet.')
    expect(webLoadErrorMessage(-202, 'ERR_CERT_AUTHORITY_INVALID')).toMatch(/certificado/)
    expect(webLoadErrorMessage(-999, 'ERR_X')).toBe('Não foi possível abrir a página (ERR_X).')
    expect(isIgnorableLoadError(-3)).toBe(true)
    expect(isIgnorableLoadError(-105)).toBe(false)
  })

  it('copia com a origem no formato do Swift', () => {
    expect(textWithSource('  Trecho  ', 'https://a.org/x')).toBe('Trecho\n\n— https://a.org/x')
    expect(textWithSource('   ', 'x')).toBeNull()
    expect(copySource({ kind: 'pdf', title: 'Feasting', location: '/a.pdf', physicalPage: 14 })).toBe('Feasting, página física 14')
    expect(copySource({ kind: 'web', title: 'Site', location: 'https://a.org/', physicalPage: 1 }, 'https://a.org/b')).toBe('https://a.org/b')
  })
})

describe('estado para a janela', () => {
  const withTabs = (): ReaderState => {
    let state = createReaderState()
    state = openWebTab(state, { title: 'Um', url: 'https://a.org/um?x=1#y', sermonDateKey: '2026-11-01', reference: 'Mateus 21:23-32' }).state
    state = openWebTab(state, { title: 'Geral', url: 'https://b.org/', inBackground: true }).state
    return state
  }

  it('mostra só as abas da pesquisa ativa e as datas salvas', () => {
    const snapshot = makeSnapshot(withTabs(), 7, () => null)
    expect(snapshot.revision).toBe(7)
    expect(snapshot.tabs.map((tab) => tab.title)).toEqual(['Um'])
    expect(snapshot.contextTitle).toBe('Pesquisa · 1 de novembro de 2026')
    expect(snapshot.contexts.map((option) => option.dateKey)).toEqual([null, '2026-11-01'])
    expect(snapshot.tabs[0]).toMatchObject({ reference: 'Mateus 21:23-32', includedInReview: false, pdfURL: null })
  })

  it('a pesquisa ativa aparece no menu mesmo sem abas', () => {
    const state = { ...createReaderState(), activeSermonDateKey: '2026-11-08' }
    expect(contextOptions(state).map((option) => option.label)).toEqual(['Pesquisa geral', '8 de novembro de 2026'])
  })

  it('material marcado cita o endereço sem consulta nem fragmento', () => {
    const state = withTabs()
    const tab = setTabReviewInclusion(state, state.tabs[0]!.id, true).tabs[0]!
    expect(markedMaterial(tab)).toEqual({ id: tab.id, kind: 'web', title: 'Um', citation: 'https://a.org/um' })
  })
})

describe('ReaderService', async () => {
  const { ReaderService } = await import('../../src/main/modules/reader/service')

  function setup(initial?: unknown) {
    const values = new Map<string, unknown>(initial ? [['session', initial]] : [])
    const store = {
      get: (name: string) => values.get(name),
      set: (name: string, value: unknown) => values.set(name, JSON.parse(JSON.stringify(value))),
    }
    let links: Record<string, number> = {}
    const sent: { event: string; payload: unknown }[] = []
    const context = {
      windows: {
        get: () => ({}),
        send: (_window: unknown, event: string, payload: unknown) => sent.push({ event, payload }),
        broadcast: (event: string, payload: unknown) => sent.push({ event, payload }),
      },
      modules: {
        library: {
          pdfURL: (path: string) => `pregar-pdf://open/${Buffer.from(path).toString('base64url')}`,
          exportSectionLinks: () => links,
          replaceSectionLinks: (next: Record<string, number>) => (links = { ...next }),
        },
      },
    }
    const service = new ReaderService(context as never, store as never)
    return { service, values, sent, links: () => links }
  }

  const pdf = join(mkdtempSync(join(tmpdir(), 'pregar-reader-unit-')), 'Feasting.pdf')
  writeFileSync(pdf, '%PDF-1.7\n')

  it('abre site da Mesa, seleciona e grava após uma pausa', async () => {
    const { service, values, sent } = setup()
    const result = await service.open({ kind: 'web', location: 'https://a.org/', title: 'A', sermonDateKey: '2026-11-01' })
    expect(result).toEqual({ opened: true, selected: true })
    expect(service.state.activeSermonDateKey).toBe('2026-11-01')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect((values.get('session') as { tabs: unknown[] }).tabs).toHaveLength(1)
    expect(sent.map((item) => item.event)).toContain('reader:stateChanged')
    expect(sent.map((item) => item.event)).toContain('reader:changed')
  })

  it('botão do meio abre nova aba ao fundo; ⇧ seleciona', async () => {
    const { service } = setup()
    await service.open({ kind: 'web', location: 'https://a.org/', title: 'A', sermonDateKey: '2026-11-01' })
    const background = await service.open({ kind: 'web', location: 'https://a.org/', title: 'A', sermonDateKey: '2026-11-01', background: true })
    expect(background.selected).toBe(false)
    expect(service.state.tabs).toHaveLength(2)
    const selected = await service.open({ kind: 'web', location: 'https://b.org/', title: 'B', sermonDateKey: '2026-11-01', background: true, select: true })
    expect(selected.selected).toBe(true)
  })

  it('recusa endereços que não são http(s) e PDFs ausentes', async () => {
    const { service } = setup()
    await expect(service.open({ kind: 'web', location: 'javascript:alert(1)', title: 'x' })).rejects.toThrow(/http ou https/)
    await expect(service.open({ kind: 'pdf', location: '/nao/existe.pdf', title: 'Sumido' })).rejects.toThrow(/Sumido/)
  })

  it('PDF: página pedida, limite pelas páginas reais, navegação explícita e posição', async () => {
    const { service } = setup()
    await service.open({ kind: 'pdf', location: pdf, title: 'Feasting', physicalPage: 900, sermonDateKey: '2026-11-01', reference: 'Mateus 21:23-32' })
    const tab = service.state.tabs[0]!
    expect(tab.physicalPage).toBe(900)
    expect(service.snapshot().tabs[0]!.pdfURL).toMatch(/^pregar-pdf:\/\/open\//)
    service.command({ type: 'pdfLoaded', tabID: tab.id, pageCount: 800 })
    expect(service.tab(tab.id)!.physicalPage).toBe(800)
    service.command({ type: 'setPage', tabID: tab.id, page: 14 })
    const navigation = service.tab(tab.id)!.navigationID
    service.command({ type: 'setPage', tabID: tab.id, page: 14 })
    expect(service.tab(tab.id)!.navigationID).not.toBe(navigation)
    service.command({ type: 'pdfPosition', tabID: tab.id, position: { page: 15, x: 0, y: 700, scale: 1.4, autoScales: false } })
    expect(service.tab(tab.id)).toMatchObject({ physicalPage: 15, pdfPosition: { page: 15, scale: 1.4 } })
    // Voltar ao mesmo material pela Mesa mantém a página.
    await service.open({ kind: 'pdf', location: pdf, title: 'Feasting', physicalPage: 2, sermonDateKey: '2026-11-01', reference: 'Mateus 21:23-32' })
    expect(service.tab(tab.id)!.physicalPage).toBe(15)
  })

  it('lembrar vínculo grava na Biblioteca e vale na próxima abertura', async () => {
    const { service, links } = setup()
    await service.open({ kind: 'pdf', location: pdf, title: 'Feasting', physicalPage: 3, sermonDateKey: '2026-11-01', reference: 'Mateus 21:23-32' })
    const tab = service.state.tabs[0]!
    service.command({ type: 'rememberLink', tabID: tab.id, startPage: 42 })
    expect(Object.values(links())).toEqual([42])
    service.command({ type: 'close', tabID: tab.id })
    await service.open({ kind: 'pdf', location: pdf, title: 'Feasting', physicalPage: 3, sermonDateKey: '2026-11-01', reference: 'Mateus 21:23-32' })
    expect(service.state.tabs[0]!.physicalPage).toBe(42)
  })

  it('pesquisas por sermão, reabrir aba fechada e marcação para revisão', async () => {
    const { service } = setup()
    await service.open({ kind: 'web', location: 'https://a.org/', title: 'A', sermonDateKey: '2026-11-01' })
    await service.open({ kind: 'web', location: 'https://b.org/', title: 'B', sermonDateKey: '2026-11-08' })
    expect(service.snapshot().tabs.map((tab) => tab.title)).toEqual(['B'])
    service.activateSermon('2026-11-01')
    expect(service.snapshot().tabs.map((tab) => tab.title)).toEqual(['A'])
    const id = service.state.selectedID!
    service.setReviewInclusion(id, true)
    expect(service.snapshot().tabs[0]!.includedInReview).toBe(true)
    service.updateWebLocation(id, 'https://a.org/outra')
    expect(service.snapshot().tabs[0]!.includedInReview).toBe(false)
    service.command({ type: 'close', tabID: id })
    expect(service.snapshot().canReopenClosedTab).toBe(true)
    service.command({ type: 'reopenClosed' })
    expect(service.snapshot().tabs.map((tab) => tab.id)).toEqual([id])
  })

  it('exporta e substitui o arquivo (backup)', async () => {
    const { service, values } = setup()
    await service.open({ kind: 'web', location: 'https://a.org/', title: 'A', sermonDateKey: '2026-11-01' })
    const archive = service.exportArchive() as { tabs: { title: string }[] }
    expect(archive.tabs.map((tab) => tab.title)).toEqual(['A'])
    service.replace({ tabs: [{ id: 'X', title: 'Restaurada', kind: 'web', location: 'https://r.org/', physicalPage: 1, includedInReview: false }] })
    expect(service.snapshot().tabs.map((tab) => tab.title)).toEqual(['Restaurada'])
    expect((values.get('session') as { tabs: { title: string }[] }).tabs[0]!.title).toBe('Restaurada')
  })

  it('carrega o arquivo salvo (formato do Swift) e descarta abas inválidas', () => {
    const { service } = setup({
      tabs: [
        { id: 'A', title: 'Ok', kind: 'web', location: 'https://a.org/', physicalPage: 1, includedInReview: false },
        { id: 'B', title: 'Ruim', kind: 'web', location: 'file:///etc/passwd', physicalPage: 1, includedInReview: false },
      ],
      selectedID: 'A',
    })
    expect(service.snapshot().tabs.map((tab) => tab.id)).toEqual(['A'])
    expect(service.snapshot().selectedID).toBe('A')
  })
})
