import { describe, expect, it } from 'vitest'
import {
  activateReaderSermon,
  beginPdfOpen,
  canReopenClosedTab,
  closeOtherReaderTabs,
  closeReaderTab,
  createReaderState,
  decodeReaderArchive,
  duplicateReaderTab,
  encodeReaderArchive,
  isPdfLocationOpen,
  isTabIncludedForReview,
  materialsMarkedForReview,
  moveReaderTab,
  openLinkTab,
  openPdfPageInNewTab,
  openPdfTab,
  openWebTab,
  readerArchiveFromState,
  readerContextLabel,
  readerContextTitle,
  readerStateFromArchive,
  recordPdfTabPage,
  recordPdfTabPosition,
  recordWebTabPosition,
  rememberSectionLink,
  reopenClosedReaderTab,
  savedSermonDates,
  selectReaderTab,
  selectRelativeReaderTab,
  selectedReaderTab,
  setPdfTabPage,
  setTabReviewInclusion,
  updateWebTabLocation,
  updateWebTabTitle,
  visibleReaderTabs,
  type ReaderPdfPosition,
  type ReaderState,
} from '../../src/reader'

const PAGES = 800

/** Grava e recria o estado, como fechar e abrir o app. */
function restart(state: ReaderState): ReaderState {
  const json = JSON.parse(JSON.stringify(encodeReaderArchive(readerArchiveFromState(state))))
  return readerStateFromArchive(decodeReaderArchive(json), state.rememberedPages)
}

function openPdf(
  state: ReaderState,
  options: Omit<Parameters<typeof openPdfTab>[1], 'pageCount'>,
): ReaderState {
  const result = openPdfTab(state, { pageCount: PAGES, ...options })
  expect(result.opened).toBe(true)
  return result.state
}

function openWeb(state: ReaderState, options: Parameters<typeof openWebTab>[1]): ReaderState {
  const result = openWebTab(state, options)
  expect(result.opened).toBe(true)
  return result.state
}

describe('posição ao voltar para um material aberto', () => {
  it('preserva a página do material e ainda navega em outros contextos', () => {
    const reference = 'Salmo 34:1-10, 22'
    const date = '2026-11-01'
    let state = createReaderState()

    state = openPdf(state, {
      title: 'Feasting',
      location: '/tmp/feasting.pdf',
      page: 493,
      reference,
      sermonDateKey: date,
    })
    const feastingID = state.selectedID!
    state = setPdfTabPage(state, feastingID, 497, PAGES)

    state = openPdf(state, {
      title: 'Connections',
      location: '/tmp/connections.pdf',
      page: 778,
      reference,
      sermonDateKey: date,
    })
    const connectionsID = state.selectedID!
    state = setPdfTabPage(state, connectionsID, 780, PAGES)

    state = openPdf(state, {
      title: 'Feasting',
      location: '/tmp/feasting.pdf',
      page: 493,
      reference,
      sermonDateKey: date,
      preservePositionIfOpen: true,
    })
    expect(selectedReaderTab(state)?.physicalPage).toBe(497)
    state = selectReaderTab(state, connectionsID)
    expect(selectedReaderTab(state)?.physicalPage).toBe(780)

    const restored = restart(state)
    expect(restored.tabs.find((tab) => tab.id === feastingID)?.physicalPage).toBe(497)
    expect(restored.tabs.find((tab) => tab.id === connectionsID)?.physicalPage).toBe(780)

    state = openPdf(state, {
      title: 'Feasting',
      location: '/tmp/feasting.pdf',
      page: 25,
      reference: 'Salmo 35:1-10',
      sermonDateKey: date,
      preservePositionIfOpen: true,
    })
    expect(selectedReaderTab(state)?.physicalPage).toBe(25)
    state = openPdf(state, {
      title: 'Feasting',
      location: '/tmp/feasting.pdf',
      page: 30,
      reference: 'Salmo 35:1-10',
      sermonDateKey: date,
    })
    expect(selectedReaderTab(state)?.physicalPage).toBe(30)
    expect(state.tabs).toHaveLength(2)
  })

  it('não abre PDFs que não carregaram e limita a página ao documento', () => {
    const state = createReaderState()
    expect(openPdfTab(state, { title: 'X', location: '/x.pdf', pageCount: 0 }).opened).toBe(false)
    const opened = openPdfTab(state, { title: 'X', location: '/x.pdf', pageCount: 10, page: 50 })
    expect(selectedReaderTab(opened.state)?.physicalPage).toBe(10)
    expect(opened.tabID).toBe(opened.state.selectedID)
  })

  it('usa a página lembrada para a passagem', () => {
    let state = openPdf(createReaderState(), {
      title: 'Obra',
      location: '/tmp/obra.pdf',
      page: 14,
      reference: 'Salmo 34',
    })
    const tab = selectedReaderTab(state)!
    state = rememberSectionLink(state, tab, { startPage: 52 })
    state = closeReaderTab(state, tab.id)
    state = openPdf(state, { title: 'Obra', location: '/tmp/obra.pdf', page: 14, reference: 'salmo 34' })
    expect(selectedReaderTab(state)?.physicalPage).toBe(52)
    const restored = restart(state)
    expect(restored.rememberedPages).toEqual({ '/tmp/obra.pdf|salmo 34': 52 })
  })

  it('deixa ao fundo a abertura que termina depois de uma troca de contexto', () => {
    let state = openWeb(createReaderState(), {
      title: 'A',
      url: 'https://example.invalid/a',
      sermonDateKey: '2026-11-01',
    })
    const begun = beginPdfOpen(state)
    state = activateReaderSermon(begun.state, '2026-11-08')
    const result = openPdfTab(state, {
      title: 'Obra',
      location: '/tmp/obra.pdf',
      pageCount: PAGES,
      sermonDateKey: '2026-11-01',
      revision: begun.revision,
    })
    expect(result.state.activeSermonDateKey).toBe('2026-11-08')
    expect(result.state.selectedID).toBeUndefined()
    expect(result.state.tabs.find((tab) => tab.id === result.tabID)?.sermonDateKey).toBe('2026-11-01')

    const quiet = beginPdfOpen(result.state)
    const foreground = openPdfTab(quiet.state, {
      title: 'B',
      location: '/tmp/b.pdf',
      pageCount: PAGES,
      sermonDateKey: '2026-11-08',
      revision: quiet.revision,
    })
    expect(foreground.state.selectedID).toBe(foreground.tabID)
  })
})

describe('pesquisa por sermão', () => {
  it('cada sermão mantém abas, seleção e posição do PDF depois de reiniciar', () => {
    let state = createReaderState()
    state = openPdf(state, {
      title: 'Obra',
      location: '/tmp/shared.pdf',
      page: 14,
      reference: 'Salmo 34',
      sermonDateKey: '2026-11-01',
    })
    const pdfA = state.selectedID!
    const pointA: ReaderPdfPosition = { page: 14, x: 24, y: 370, scale: 1.4, autoScales: false }
    state = recordPdfTabPosition(state, pdfA, pointA)
    state = setTabReviewInclusion(state, pdfA, true)
    const url = 'https://example.invalid/article'
    state = openWeb(state, { title: 'Artigo', url, reference: 'Salmo 34', sermonDateKey: '2026-11-01' })
    const webA = state.selectedID!
    state = openPdf(state, {
      title: 'Obra',
      location: '/tmp/shared.pdf',
      page: 60,
      reference: 'Salmo 35',
      sermonDateKey: '2026-11-08',
    })
    const pdfB = state.selectedID!
    state = recordPdfTabPosition(state, pdfB, { page: 60, x: 10, y: 250, scale: 0.9, autoScales: false })
    state = openWeb(state, { title: 'Artigo', url, reference: 'Salmo 35', sermonDateKey: '2026-11-08' })
    const webB = state.selectedID!

    expect(pdfA).not.toBe(pdfB)
    expect(webA).not.toBe(webB)
    expect(state.tabs).toHaveLength(4)
    expect(visibleReaderTabs(state)).toHaveLength(2)
    state = activateReaderSermon(state, '2026-11-01')
    expect(state.selectedID).toBe(webA)
    expect(materialsMarkedForReview(state).map((tab) => tab.id)).toEqual([pdfA])
    state = activateReaderSermon(state, '2026-11-08')
    expect(state.selectedID).toBe(webB)
    expect(materialsMarkedForReview(state)).toEqual([])
    expect(materialsMarkedForReview(state, '2026-11-01').map((tab) => tab.id)).toEqual([pdfA])
    expect(savedSermonDates(state)).toEqual(['2026-11-08', '2026-11-01'])

    let restored = restart(state)
    expect(restored.activeSermonDateKey).toBe('2026-11-08')
    expect(restored.selectedID).toBe(webB)
    expect(restored.activeReference).toBe('Salmo 35')
    restored = activateReaderSermon(restored, '2026-11-01')
    expect(restored.selectedID).toBe(webA)
    expect(restored.activeReference).toBe('Salmo 34')
    expect(restored.tabs.find((tab) => tab.id === pdfA)?.pdfPosition).toEqual(pointA)
    expect(restored.tabs.find((tab) => tab.id === pdfB)?.physicalPage).toBe(60)
  })

  it('abas ao fundo não mudam a seleção nem tomam outro sermão', () => {
    const url = 'https://example.invalid/article'
    let state = openWeb(createReaderState(), { title: 'Primeiro', url, sermonDateKey: '2026-11-01' })
    const first = state.selectedID!
    state = setTabReviewInclusion(state, first, true)
    state = openWeb(state, {
      title: 'Outra cópia',
      url,
      sermonDateKey: '2026-11-01',
      inBackground: true,
      forceNewTab: true,
      afterTabID: first,
    })
    expect(visibleReaderTabs(state)).toHaveLength(2)
    expect(state.selectedID).toBe(first)
    state = openWeb(state, { title: 'Outro sermão', url, sermonDateKey: '2026-11-08', inBackground: true })
    expect(state.activeSermonDateKey).toBe('2026-11-01')
    expect(state.selectedID).toBe(first)
    expect(visibleReaderTabs(state)).toHaveLength(2)
    const duplicated = duplicateReaderTab(state, first, { inBackground: true })
    state = duplicated.state
    expect(state.selectedID).toBe(first)
    expect(visibleReaderTabs(state)[1]!.id).toBe(duplicated.tabID)
    expect(isTabIncludedForReview(visibleReaderTabs(state)[1]!)).toBe(false)
    expect(isTabIncludedForReview(visibleReaderTabs(state)[0]!)).toBe(true)
  })

  it('reabre abas fechadas no seu sermão e reordena sem afetar outros grupos', () => {
    let state = openWeb(createReaderState(), {
      title: 'A',
      url: 'https://example.invalid/a',
      sermonDateKey: '2026-11-01',
    })
    const first = state.selectedID!
    state = openWeb(state, { title: 'B', url: 'https://example.invalid/b', sermonDateKey: '2026-11-01' })
    const second = state.selectedID!
    state = openWeb(state, { title: 'Outro', url: 'https://example.invalid/a', sermonDateKey: '2026-11-08' })
    const other = state.selectedID!
    state = activateReaderSermon(state, '2026-11-01')
    state = moveReaderTab(state, second, first)
    expect(visibleReaderTabs(state).map((tab) => tab.id)).toEqual([second, first])
    expect(moveReaderTab(state, second, other)).toBe(state)
    state = closeReaderTab(state, second)
    state = activateReaderSermon(state, '2026-11-08')
    expect(canReopenClosedTab(state)).toBe(false)
    state = activateReaderSermon(state, '2026-11-01')

    let restored = restart(state)
    expect(canReopenClosedTab(restored)).toBe(true)
    restored = reopenClosedReaderTab(restored)
    expect(restored.selectedID).toBe(second)
    restored = selectRelativeReaderTab(restored, -1)
    expect(restored.selectedID).toBe(first)
    restored = closeOtherReaderTabs(restored, first)
    expect(visibleReaderTabs(restored).map((tab) => tab.id)).toEqual([first])
    expect(restored.tabs.some((tab) => tab.id === other)).toBe(true)
  })

  it('guarda só as últimas 20 abas fechadas e seleciona a vizinha à direita', () => {
    let state = createReaderState()
    const ids: string[] = []
    for (let index = 0; index < 23; index += 1) {
      state = openWeb(state, {
        title: `T${index}`,
        url: `https://example.invalid/${index}`,
        forceNewTab: true,
      })
      ids.push(state.selectedID!)
    }
    state = selectReaderTab(state, ids[5]!)
    state = closeReaderTab(state, ids[5]!)
    expect(state.selectedID).toBe(ids[6])
    state = closeReaderTab(state, ids[22]!)
    state = selectReaderTab(state, ids[21]!)
    state = closeReaderTab(state, ids[21]!)
    expect(state.selectedID).toBe(ids[20])
    state = closeOtherReaderTabs(state, ids[0]!, { toRightOnly: true })
    expect(visibleReaderTabs(state).map((tab) => tab.id)).toEqual([ids[0]])
    expect(state.closedTabs).toHaveLength(20)
    expect(state.closedTabs.at(-1)!.id).toBe(ids[20])
  })

  it('arquivo antigo migra por sermão e mantém PDFs indisponíveis', () => {
    const a = {
      id: '0F6B3A8E-2C1D-4E5F-8A9B-1C2D3E4F5A6B',
      title: 'Antigo A',
      kind: 'web',
      location: 'https://example.invalid/a',
      physicalPage: 1,
      sermonDateKey: '2026-11-01',
      includedInReview: false,
    }
    const b = {
      id: '7A8B9C0D-1E2F-4A3B-8C4D-5E6F7A8B9C0D',
      title: 'PDF offline',
      kind: 'pdf',
      location: '/tmp/missing/offline.pdf',
      physicalPage: 52,
      reference: 'Salmo 35',
      sermonDateKey: '2026-11-08',
      includedInReview: false,
    }
    const archive = decodeReaderArchive({ tabs: [a, b], selectedID: b.id })
    let restored = readerStateFromArchive(archive)
    expect(restored.tabs).toHaveLength(2)
    expect(visibleReaderTabs(restored).map((tab) => tab.id)).toEqual([b.id])
    expect(selectedReaderTab(restored)?.physicalPage).toBe(52)
    restored = activateReaderSermon(restored, '2026-11-01')
    expect(restored.selectedID).toBe(a.id)
  })

  it('descarta ao restaurar abas web sem http(s) e PDFs sem caminho', () => {
    const archive = decodeReaderArchive({
      tabs: [
        {
          id: '1',
          title: 'JS',
          kind: 'web',
          location: 'javascript:alert(1)',
          physicalPage: 1,
          includedInReview: false,
        },
        {
          id: '2',
          title: 'Arquivo',
          kind: 'web',
          location: 'file:///etc/passwd',
          physicalPage: 1,
          includedInReview: false,
        },
        {
          id: '3',
          title: 'Sem caminho',
          kind: 'pdf',
          location: '',
          physicalPage: 1,
          includedInReview: false,
        },
        {
          id: '4',
          title: 'Ok',
          kind: 'web',
          location: 'HTTPS://example.invalid/ok',
          physicalPage: 1,
          includedInReview: true,
        },
      ],
      selectedID: '1',
    })
    const state = readerStateFromArchive(archive)
    expect(state.tabs.map((tab) => tab.id)).toEqual(['4'])
    expect(state.selectedID).toBe('4')
    expect(isTabIncludedForReview(state.tabs[0]!)).toBe(false)
  })
})

describe('navegação dentro das abas', () => {
  it('navegação explícita recria o destino mesmo na mesma página', () => {
    let state = openPdf(createReaderState(), { title: 'Obra', location: '/tmp/document.pdf', page: 14 })
    const id = state.selectedID!
    state = recordPdfTabPosition(state, id, { page: 14, x: 0, y: 320, scale: 1.5, autoScales: false })
    const before = selectedReaderTab(state)!.navigationID
    state = setPdfTabPage(state, id, 14, PAGES)
    const tab = selectedReaderTab(state)!
    expect(tab.pdfPosition).toBeUndefined()
    expect(tab.navigationID).toBeDefined()
    expect(tab.navigationID).not.toBe(before)
  })

  it('ignora posições inválidas e atualiza a página publicada pelo visor', () => {
    let state = openPdf(createReaderState(), { title: 'Obra', location: '/tmp/document.pdf', page: 14 })
    const id = state.selectedID!
    expect(recordPdfTabPosition(state, id, { page: 0, x: 0, y: 0, scale: 1, autoScales: true })).toBe(state)
    expect(
      recordPdfTabPosition(state, id, { page: 3, x: Number.NaN, y: 0, scale: 1, autoScales: true }),
    ).toBe(state)
    expect(recordPdfTabPosition(state, id, { page: 3, x: 0, y: 0, scale: 120, autoScales: false })).toBe(
      state,
    )
    state = recordPdfTabPosition(state, id, { page: 20, x: 5, y: 600, scale: 2, autoScales: false })
    expect(selectedReaderTab(state)?.physicalPage).toBe(20)
    expect(recordPdfTabPage(state, id, 20)).toBe(state)
    state = recordPdfTabPage(state, id, 21)
    expect(selectedReaderTab(state)?.physicalPage).toBe(21)
  })

  it('abre seção ou destino interno em nova aba, desmarcada para revisão', () => {
    let state = openPdf(createReaderState(), {
      title: 'Obra',
      location: '/tmp/document.pdf',
      page: 14,
      sermonDateKey: '2026-11-01',
    })
    const id = state.selectedID!
    state = setTabReviewInclusion(state, id, true)
    const position: ReaderPdfPosition = { page: 90, x: 0, y: 400, scale: 1.2, autoScales: false }
    const result = openPdfPageInNewTab(state, id, { page: 90, pageCount: 80, position, inBackground: true })
    state = result.state
    expect(state.selectedID).toBe(id)
    const copy = state.tabs.find((tab) => tab.id === result.tabID)!
    expect(copy.physicalPage).toBe(80)
    expect(copy.pdfPosition).toEqual(position)
    expect(copy.navigationID).toBeUndefined()
    expect(isTabIncludedForReview(copy)).toBe(false)
    expect(state.tabs.map((tab) => tab.id)).toEqual([id, copy.id])
  })

  it('link com nova janela cria aba no mesmo sermão; mudar de página revoga a marcação', () => {
    let state = openWeb(createReaderState(), {
      title: 'A',
      url: 'http://127.0.0.1:8080/a',
      reference: 'Salmo 34',
      sermonDateKey: '2026-11-01',
    })
    const original = state.selectedID!
    const popup = openLinkTab(state, original, 'http://127.0.0.1:8080/popup')
    state = popup.state
    expect(visibleReaderTabs(state)).toHaveLength(2)
    expect(selectedReaderTab(state)).toMatchObject({
      location: 'http://127.0.0.1:8080/popup',
      title: '127.0.0.1',
      reference: 'Salmo 34',
      sermonDateKey: '2026-11-01',
    })
    expect(openLinkTab(state, original, 'file:///etc/passwd').opened).toBe(false)

    state = selectReaderTab(state, original)
    state = setTabReviewInclusion(state, original, true)
    state = updateWebTabLocation(state, original, 'http://127.0.0.1:8080/a#notes')
    expect(isTabIncludedForReview(selectedReaderTab(state)!)).toBe(true)
    state = updateWebTabLocation(state, original, 'http://127.0.0.1:8080/b')
    state = updateWebTabTitle(state, original, 'Artigo B')
    expect(selectedReaderTab(state)).toMatchObject({ location: 'http://127.0.0.1:8080/b', title: 'Artigo B' })
    expect(isTabIncludedForReview(selectedReaderTab(state)!)).toBe(false)
    expect(updateWebTabTitle(state, original, '')).toBe(state)
  })

  it('clique do meio abre aba ao fundo sem trocar o artigo', () => {
    let state = openWeb(createReaderState(), {
      title: 'A',
      url: 'https://example.invalid/a',
      sermonDateKey: '2026-11-01',
    })
    const id = state.selectedID!
    state = openLinkTab(state, id, 'https://example.invalid/b', { inBackground: true }).state
    expect(visibleReaderTabs(state)).toHaveLength(2)
    expect(state.selectedID).toBe(id)
    expect(selectedReaderTab(state)?.location).toBe('https://example.invalid/a')
    expect(visibleReaderTabs(state).some((tab) => tab.location === 'https://example.invalid/b')).toBe(true)
  })

  it('guarda a rolagem por endereço e a mantém ao reiniciar', () => {
    let state = openWeb(createReaderState(), { title: 'A', url: 'https://example.invalid/a' })
    const id = state.selectedID!
    state = recordWebTabPosition(state, id, 'https://example.invalid/a', { x: 0, y: 1750 })
    expect(recordWebTabPosition(state, id, 'https://example.invalid/a', { x: 0, y: 1750 })).toBe(state)
    expect(recordWebTabPosition(state, id, 'https://example.invalid/a', { x: -1, y: 10 })).toBe(state)
    for (let index = 0; index < 55; index += 1) {
      state = recordWebTabPosition(state, id, `https://example.invalid/page-${index}`, { x: 0, y: index })
    }
    const positions = selectedReaderTab(state)!.webPositions!
    expect(Object.keys(positions)).toHaveLength(50)
    expect(positions['https://example.invalid/page-54']).toEqual({ x: 0, y: 54 })
    expect(positions['https://example.invalid/a']).toBeUndefined()
    expect(restart(state).tabs[0]!.webPositions).toEqual(positions)
  })

  it('informa contexto, documentos abertos e rótulos da pesquisa', () => {
    const state = openPdf(createReaderState(), { title: 'Obra', location: '/tmp/a.pdf' })
    expect(isPdfLocationOpen(state, '/tmp/a.pdf')).toBe(true)
    expect(isPdfLocationOpen(closeReaderTab(state, state.selectedID!), '/tmp/a.pdf')).toBe(false)
    expect(readerContextLabel(null)).toBe('Pesquisa geral')
    expect(readerContextLabel('2026-11-01')).toBe('1 de novembro de 2026')
    expect(readerContextLabel('not-a-date')).toBe('not-a-date')
    expect(readerContextTitle('2026-11-08')).toBe('Pesquisa · 8 de novembro de 2026')
    expect(readerContextTitle(undefined)).toBe('Pesquisa geral')
  })
})
