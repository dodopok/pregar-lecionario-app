import { describe, expect, it } from 'vitest'
import {
  activeSectionForPage,
  countTabsMarkedForReview,
  decodeReaderArchive,
  decodeRememberedPages,
  encodeReaderArchive,
  linkOpensNewTab,
  makeSectionLocation,
  printedPageLabel,
  readerTabWidth,
  readerWebUrl,
  sectionMatchesSearch,
  type ReaderTab,
} from '../../src/reader'

describe('barra de abas e endereços', () => {
  it('abas encolhem até o mínimo e depois a barra rola', () => {
    expect(readerTabWidth(900, 2)).toBe(220)
    expect(readerTabWidth(620, 4)).toBe(152)
    expect(readerTabWidth(620, 20)).toBe(108)
    expect(readerTabWidth(620, 20) * 20).toBeGreaterThan(620)
    expect(readerTabWidth(620, 0)).toBe(220)
  })

  it('normaliza endereços digitados e recusa esquemas que não são web', () => {
    expect(readerWebUrl('example.org/article')).toBe('https://example.org/article')
    expect(readerWebUrl('  http://example.org/a?b=1  ')).toBe('http://example.org/a?b=1')
    expect(readerWebUrl('javascript:alert(1)')).toBeNull()
    expect(readerWebUrl('file:///etc/passwd')).toBeNull()
    expect(readerWebUrl('   ')).toBeNull()
  })

  it('decide como abrir links pelo gesto', () => {
    const gesture = (middleButton: boolean, commandKey: boolean, shiftKey: boolean) => ({
      middleButton,
      commandKey,
      shiftKey,
    })
    expect(linkOpensNewTab(gesture(true, false, false))).toBe(true)
    expect(linkOpensNewTab(gesture(true, false, true))).toBe(false)
    expect(linkOpensNewTab(gesture(false, true, false))).toBe(true)
    expect(linkOpensNewTab(gesture(false, true, true))).toBe(false)
    expect(linkOpensNewTab(gesture(false, false, false))).toBeNull()
    expect(linkOpensNewTab(gesture(false, false, false), true)).toBe(false)
  })

  it('mostra a numeração impressa só quando difere da física', () => {
    expect(printedPageLabel('88', 102)).toBe('88')
    expect(printedPageLabel('102', 102)).toBeNull()
    expect(printedPageLabel('', 5)).toBeNull()
    expect(printedPageLabel(null, 5)).toBeNull()
  })
})

describe('arquivo do Leitor', () => {
  const tab = (overrides: Partial<ReaderTab>): ReaderTab => ({
    id: 'A',
    title: 'T',
    kind: 'pdf',
    location: '/a.pdf',
    physicalPage: 1,
    includedInReview: true,
    reviewInclusionConfirmed: true,
    ...overrides,
  })

  it('conta materiais marcados para a passagem e a data exatas', () => {
    const tabs = [
      tab({ reference: 'Salmo 34', sermonDateKey: '2026-11-01' }),
      tab({ id: 'B', reference: 'Salmo 34', sermonDateKey: '2026-11-08' }),
      tab({
        id: 'C',
        reference: 'Salmo 34',
        sermonDateKey: '2026-11-01',
        reviewInclusionConfirmed: undefined,
      }),
      tab({ id: 'D', reference: 'Salmo 34' }),
    ]
    expect(countTabsMarkedForReview(tabs, 'Salmo 34', '2026-11-01')).toBe(1)
    expect(countTabsMarkedForReview(tabs, 'Salmo 34', null)).toBe(0)
    expect(countTabsMarkedForReview(tabs, null, '2026-11-01')).toBe(0)
  })

  it('lê e grava no formato do Swift, omitindo opcionais ausentes', () => {
    const json = {
      tabs: [
        {
          id: 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F',
          title: 'Feasting',
          kind: 'pdf',
          location: '/Users/u/Feasting.pdf',
          physicalPage: 265,
          reference: 'Mateus 21.33-46',
          sermonDateKey: '2026-10-04',
          includedInReview: true,
          reviewInclusionConfirmed: true,
          pdfPosition: { page: 265, x: 12.5, y: 640, scale: 1.25, autoScales: false },
          navigationID: '5A0C8E1F-0B7D-4C3B-9F2E-6D1A4B8C7E90',
        },
        {
          id: 'C4D2B1A0-1111-4222-8333-944455556666',
          title: 'Working Preacher',
          kind: 'web',
          location: 'https://www.workingpreacher.org/commentaries',
          physicalPage: 1,
          reference: null,
          includedInReview: false,
          webPositions: { 'https://www.workingpreacher.org/commentaries': { x: 0, y: 1750 } },
        },
      ],
      selectedID: 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F',
      activeSermonDateKey: '2026-10-04',
      selectedBySermon: { '2026-10-04': 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F' },
      closedTabs: [],
    }
    const archive = decodeReaderArchive(json)!
    expect(archive.tabs[1]!.reference).toBeUndefined()
    const encoded = JSON.parse(JSON.stringify(encodeReaderArchive(archive)))
    expect(encoded.tabs[1]).not.toHaveProperty('reference')
    expect(encoded.tabs[1]).not.toHaveProperty('sermonDateKey')
    expect(Object.keys(encoded.tabs[0])).toEqual([
      'id',
      'title',
      'kind',
      'location',
      'physicalPage',
      'reference',
      'sermonDateKey',
      'includedInReview',
      'reviewInclusionConfirmed',
      'pdfPosition',
      'navigationID',
    ])
    expect(decodeReaderArchive(encoded)).toEqual(archive)
    expect(decodeReaderArchive({ selectedID: 'x' })).toBeNull()
    expect(decodeReaderArchive({ tabs: [{ id: 'bad' }], selectedID: 'x' })).toEqual({
      tabs: [],
      selectedID: 'x',
    })
  })

  it('lê as páginas lembradas por vínculo', () => {
    expect(decodeRememberedPages({ '/a.pdf|salmo 34': 52 })).toEqual({ '/a.pdf|salmo 34': 52 })
    expect(decodeRememberedPages({ '/a.pdf|salmo 34': 'x' })).toEqual({})
  })

  it('exporta também o modelo de seções do PDF', () => {
    const sections = [makeSectionLocation({ title: 'Matthew 21:23–32', startPage: 636, endPage: 643 })]
    expect(sectionMatchesSearch(sections[0]!, 'matthew 21:23-32')).toBe(true)
    expect(activeSectionForPage(sections, 640)?.startPage).toBe(636)
  })
})
