import { describe, expect, it } from 'vitest'
import type { LibrarySectionRow, LibraryWork } from '@shared/ipc-library'
import {
  buildOffsets,
  coverInitials,
  coverTone,
  filterSections,
  filterWorks,
  highlightParts,
  highlightRanges,
  isReferenceQuery,
  libraryTotals,
  metadataLine,
  pageRange,
  rowAtOffset,
  scrollToReveal,
  sectionRowHeight,
  sidebarWidth,
  visibleRange,
  workSummaryLine,
} from '../../src/renderer/src/views/biblioteca/library-helpers'

function row(title: string, startPage: number, endPage = startPage, context: string | null = null): LibrarySectionRow {
  return {
    id: `${title}|${startPage}`,
    title,
    context,
    startPage,
    endPage,
    method: 'bookmark',
    methodLabel: 'bookmark do PDF',
    confidence: 'high',
    confidenceLabel: 'alta',
    isReference: true,
    components: [],
  }
}

function work(overrides: Partial<LibraryWork> = {}): LibraryWork {
  return {
    id: '/pdfs/obra.pdf',
    path: '/pdfs/obra.pdf',
    pdfURL: 'pregar-pdf://open/x',
    title: 'Paul for Everyone: Romans Part 2',
    author: 'Tom Wright',
    credits: ['Tom Wright'],
    extracted: { title: 'Paul for Everyone: Romans Part 2', author: 'Tom Wright' },
    overrides: null,
    pageCount: 184,
    bookmarkCount: 0,
    sectionCount: 12,
    copyLabel: null,
    ocrPageCount: 0,
    coverURL: null,
    available: true,
    indexing: false,
    ...overrides,
  }
}

describe('filtro de seções', () => {
  const rows = [
    row('Matthew 21:23–32', 636, 643, 'Proper 21'),
    row('Romans 13:8-14 Love, the Law and the Coming Day', 102, 107),
    row('Romans 13:11-14', 30, 34, 'Advent 1'),
    row('Introdução à Epístola', 1, 4),
  ]

  it('aceita hífen comum para o travessão (como no app Swift)', () => {
    expect(filterSections(rows, 'Matthew 21:23-32').map((item) => item.row.startPage)).toEqual([636])
  })

  it('ignora acentos e caixa', () => {
    expect(filterSections(rows, 'introducao').map((item) => item.row.title)).toEqual(['Introdução à Epístola'])
  })

  it('procura também no contexto', () => {
    expect(filterSections(rows, 'proper 21')).toHaveLength(1)
  })

  it('consulta vazia mostra tudo sem relação', () => {
    const all = filterSections(rows, '   ')
    expect(all).toHaveLength(4)
    expect(all.every((item) => item.match === null)).toBe(true)
  })

  it('passagem em português encontra seções em inglês e classifica a relação', () => {
    const found = filterSections(rows, 'Romanos 13:8-14')
    expect(found.map((item) => [item.row.startPage, item.match])).toEqual([
      [102, 'exact'],
      [30, 'partial'],
    ])
  })

  it('usa as relações calculadas pelo índice quando informadas', () => {
    const kinds = new Map([['Romans 13:11-14|30', 'partial' as const]])
    const found = filterSections(rows, 'Romanos 13:8-14', kinds)
    expect(found.map((item) => [item.row.startPage, item.match])).toEqual([[30, 'partial']])
    expect(isReferenceQuery(' Romanos 13:8-14 ')).toBe(true)
    expect(isReferenceQuery('love')).toBe(false)
  })
})

describe('realce', () => {
  it('marca o trecho no texto original apesar de acentos e traços', () => {
    const text = 'Matthew 21:23–32 Introdução'
    const ranges = highlightRanges(text, '21:23-32 introducao')
    expect(ranges).toHaveLength(1)
    const [start, end] = ranges[0]!
    expect(text.slice(start, end)).toBe('21:23–32 Introdução')
  })

  it('colapsa espaços repetidos e encontra várias ocorrências', () => {
    const parts = highlightParts('Love  the law, love', 'love')
    expect(parts.filter((part) => part.marked).map((part) => part.text)).toEqual(['Love', 'love'])
    expect(highlightParts('Love  the law', 'the law').find((part) => part.marked)?.text).toBe('the law')
  })

  it('sem consulta devolve o texto inteiro', () => {
    expect(highlightParts('Romanos', '')).toEqual([{ text: 'Romanos', marked: false }])
  })
})

describe('lista virtualizada', () => {
  const heights = [37, 44, 37, 37, 44]
  const offsets = buildOffsets(heights)

  it('acumula alturas', () => {
    expect(offsets).toEqual([0, 37, 81, 118, 155, 199])
    expect(sectionRowHeight({ context: null })).toBe(37)
    expect(sectionRowHeight({ context: 'Proper 21' })).toBe(44)
  })

  it('encontra a linha de uma posição', () => {
    expect(rowAtOffset(offsets, 0)).toBe(0)
    expect(rowAtOffset(offsets, 36)).toBe(0)
    expect(rowAtOffset(offsets, 37)).toBe(1)
    expect(rowAtOffset(offsets, 198)).toBe(4)
    expect(rowAtOffset(offsets, 10_000)).toBe(4)
  })

  it('monta só as linhas visíveis com margem', () => {
    expect(visibleRange(offsets, 40, 50, 0)).toEqual({ start: 1, end: 3 })
    expect(visibleRange(offsets, 40, 50, 1)).toEqual({ start: 0, end: 4 })
    expect(visibleRange(buildOffsets([]), 0, 400)).toEqual({ start: 0, end: 0 })
  })

  it('escala para centenas de seções', () => {
    const many = buildOffsets(Array.from({ length: 900 }, (_, index) => (index % 3 === 0 ? 44 : 37)))
    const range = visibleRange(many, 12_000, 600, 8)
    expect(range.end - range.start).toBeLessThan(40)
    expect(many[range.start]!).toBeLessThanOrEqual(12_000)
  })

  it('rola o mínimo para revelar a linha', () => {
    expect(scrollToReveal(offsets, 4, 0, 100)).toBe(99)
    expect(scrollToReveal(offsets, 0, 50, 100)).toBe(0)
    expect(scrollToReveal(offsets, 2, 40, 100)).toBe(40)
  })
})

describe('obras', () => {
  it('filtra por título, autoria e arquivo sem acentos', () => {
    const works = [work(), work({ id: '/b.pdf', path: '/pdfs/Feasting-Vol-4.pdf', title: 'Feasting on the Word', author: 'Bartlett & Taylor (orgs.)', credits: [] })]
    expect(filterWorks(works, 'feasting').map((item) => item.id)).toEqual(['/b.pdf'])
    expect(filterWorks(works, 'WRIGHT')).toHaveLength(1)
    expect(filterWorks(works, 'vol-4')).toHaveLength(1)
    expect(filterWorks(works, '')).toHaveLength(2)
  })

  it('resume totais e linhas como no app Swift', () => {
    expect(libraryTotals([work(), work({ pageCount: 7251, sectionCount: 866 })])).toBe('2 obras · 7.435 páginas · 878 seções')
    expect(workSummaryLine(work({ copyLabel: 'Cópia 2' }))).toBe('Cópia 2')
    expect(workSummaryLine(work())).toBe('12 seções')
    expect(workSummaryLine(work({ sectionCount: 0, bookmarkCount: 0 }))).toBe('sem sumário')
    expect(metadataLine(work())).toBe('Tom Wright · 184 páginas físicas')
    expect(metadataLine(work({ credits: [] }))).toBe('184 páginas físicas')
    expect(pageRange(row('x', 3))).toBe('3')
    expect(pageRange(row('x', 3, 9))).toBe('3–9')
  })

  it('capa tipográfica usa a cor da série e iniciais', () => {
    expect(coverTone('Feasting on the Word: Year A')).toBe('blue')
    expect(coverTone('Paul for Everyone')).toBe('brown')
    expect(coverTone('Connections')).toBe('stone')
    expect(coverInitials('Paul for Everyone: Romans Part 2')).toBe('PE')
    expect(coverInitials('connections')).toBe('C')
  })

  it('divisor fica entre 320 e 768 px sem esmagar o detalhe', () => {
    expect(sidebarWidth(0.38, 1240)).toBe(471)
    expect(sidebarWidth(0.1, 1240)).toBe(320)
    expect(sidebarWidth(0.9, 1240)).toBe(768)
    expect(sidebarWidth(0.9, 900)).toBe(441)
    expect(sidebarWidth(0.38, 700)).toBe(320)
  })
})
