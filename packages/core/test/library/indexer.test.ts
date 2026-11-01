import { describe, expect, it, vi } from 'vitest'
import { parseAllReferences } from '../../src/bible/reference'
import {
  confidenceLabel,
  countBookmarks,
  decodeLibraryRecord,
  encodeLibraryRecord,
  extractPdfReviewSources,
  extractSpanText,
  hasHighConfidence,
  indexPdf,
  joinRecognizedLines,
  matchSection,
  ocrResultNotice,
  recognizeScannedPages,
  sectionsForDocument,
  SermonReviewMaterialError,
  type PdfFileInfo,
  type PdfLibraryRecord,
} from '../../src/library'
import { FEASTING_PAGES, FakePdfTextSource, bookmark, filler } from './fixtures'

const scannedFile: PdfFileInfo = {
  path: '/tmp/PregarOCR/scanned-commentary.pdf',
  sizeBytes: 48_213,
  modificationDate: new Date('2026-10-30T12:00:00Z'),
}

function storedCopy(record: PdfLibraryRecord): PdfLibraryRecord {
  return decodeLibraryRecord(JSON.parse(JSON.stringify(encodeLibraryRecord(record))))!
}

function feastingSource(): FakePdfTextSource {
  const pages = filler(14)
  for (const [page, text] of Object.entries(FEASTING_PAGES)) pages[Number(page) - 1] = text
  return new FakePdfTextSource({
    pages,
    metadata: {
      title: ' Feasting on the Word: Year A, Volume 4 ',
      author: 'Bartlett, David L.; Taylor, Barbara Brown',
    },
    outline: [
      bookmark('Proper 18', 9, [
        bookmark('Psalm 122', 9),
        bookmark('Romans 13:8-14', 10),
        bookmark('Matthew 18:15-20', 13),
        { title: null, pageIndex: null, children: [] },
      ]),
    ],
  })
}

describe('índice por bookmarks', () => {
  it('cria seções com contexto, intervalo físico até a próxima e componentes do Feasting', async () => {
    const source = feastingSource()
    const record = (await indexPdf(
      source,
      {
        path: '/Users/u/Downloads/Feasting-on-the-Word_-Year-A_-Volume-4 (1).pdf',
        sizeBytes: 1_000,
        modificationDate: 781_234_567,
      },
      { coverJPEG: '/9j/cover' },
    ))!

    expect(record.title).toBe('Feasting on the Word: Year A, Volume 4')
    expect(record.author).toBe('David L Bartlett & Barbara Brown Taylor (orgs.)')
    expect(record.copyLabel).toBe('Cópia 2')
    expect(record.coverJPEG).toBe('/9j/cover')
    expect(record.indexVersion).toBe(4)
    expect(record.pageCount).toBe(14)
    expect(record.bookmarkCount).toBe(5)
    expect(record.fileModificationDate).toBe(781_234_567)
    expect(
      record.sections?.map((section) => [section.title, section.startPage, section.endPage, section.context]),
    ).toEqual([
      ['Proper 18', 9, 9, undefined],
      ['Psalm 122', 9, 9, 'Proper 18'],
      ['Romans 13:8-14', 10, 13, 'Proper 18'],
      ['Matthew 18:15-20', 13, 14, 'Proper 18'],
    ])
    const romans = record.sections![2]!
    expect(romans.findingMethod).toBe('bookmark')
    expect(confidenceLabel(romans)).toBe('alta')
    expect(hasHighConfidence(romans)).toBe(true)
    expect(romans.components?.map((item) => item.author)).toEqual([
      undefined,
      'ELEAZAR S. FERNANDEZ',
      'ROCHELLE A. STACKHOUSE',
      'CHRISTOPHER R. HUTSON',
      'DAVID L. BARTLETT',
    ])
    const scripture = await extractSpanText(romans.components![0]!.content, source)
    expect(scripture).toContain('Owe no one anything')
    expect(scripture).not.toContain('ELIZABETH P. RANDALL')
    expect(scripture).not.toContain('Theological Perspective')
    expect(record.sections![3]!.components).toBeUndefined()
  })

  it('lê cada página uma única vez por indexação', async () => {
    const source = feastingSource()
    await indexPdf(source, { path: '/tmp/feasting.pdf' })
    expect(new Set(source.reads).size).toBe(source.reads.length)
  })

  it('conta todos os itens do sumário e ignora destinos inválidos', () => {
    expect(
      countBookmarks([bookmark('A', 1, [bookmark('B', null), bookmark('C', 2, [bookmark('D', 3)])])]),
    ).toBe(4)
  })

  it('devolve null para PDF sem páginas', async () => {
    expect(await indexPdf(new FakePdfTextSource({ pages: [] }), { path: '/tmp/empty.pdf' })).toBeNull()
  })
})

describe('índice por cabeçalhos textuais (PDF sem bookmarks)', () => {
  const pages = [
    [
      'Contents',
      'Romans 13.1-7 Submitting to the Authorities 85',
      'Romans 13.8-14 Love, the Law and the Coming Day 88',
      'Romans 14.1-6 Welcoming the Weak 94',
    ].join('\n'),
    'Introduction.\nThis volume follows the letter section by section.',
    'Romans 13.1-7 Submitting to the Authorities\n1 Every person is to be subject to the governing authorities.',
    'commentary on the passage continues,\ndifferent kinds of material (Leviticus 19.19). Someone\nRomans 6.1—14, 8.12-17 or 12.1-2\nmore prose.',
    'end of the previous section.\nROMANS 13.8-14\nRomans 13.8-14 Love, the Law and the Coming Day\n8 Owe no one anything.',
    'Commentary on love continues.',
    'Commentary on the coming day continues.',
    'Romans 14.1-6 Welcoming the Weak\n1 Welcome those who are weak in faith.',
    [
      ...Array.from({ length: 12 }, (_, index) => `Prose line ${index + 1}.`),
      'Romans 15.1-6 Pleasing Others',
    ].join('\n'),
  ]

  it('favorece o corpo, descarta sumário e citações e fecha antes da próxima perícope', async () => {
    const record = (await indexPdf(
      new FakePdfTextSource({ pages, metadata: { title: 'Paul for Everyone: Romans Part 2' } }),
      {
        path: '/tmp/wright.pdf',
      },
    ))!

    expect(record.bookmarkCount).toBe(0)
    expect(record.sections?.map((section) => [section.title, section.startPage, section.endPage])).toEqual([
      ['Romans 13.1-7 Submitting to the Authorities', 3, 4],
      ['ROMANS 13.8-14', 5, 7],
      ['Romans 14.1-6 Welcoming the Weak', 8, 9],
    ])
    const matches = record.sections!.filter((section) => matchSection(section, 'Romans 13:8-14') === 'exact')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.findingMethod).toBe('textHeading')
    expect(confidenceLabel(matches[0]!)).toBe('média')
  })

  it('obtém as seções de um PDF aberto fora do acervo', async () => {
    const sections = await sectionsForDocument(new FakePdfTextSource({ pages }), { filename: 'wright' })
    expect(sections.map((section) => section.startPage)).toEqual([3, 5, 8])
  })
})

describe('OCR sob demanda', () => {
  it('encontra cabeçalhos em PDF escaneado, persiste o texto e o usa na revisão', async () => {
    const source = new FakePdfTextSource({ pages: [''] })
    const recognizePage = vi.fn(async () => 'Romans 13:8-14\nThe command is to love your neighbor.')
    const progress: [number, number][] = []

    const result = (await recognizeScannedPages(source, scannedFile, {
      recognizePage,
      onProgress: (completed, total) => progress.push([completed, total]),
    }))!
    const section = result.record.sections?.find((item) => item.findingMethod === 'ocrHeading')

    expect(result.candidatePageCount).toBe(1)
    expect(result.scannedPageCount).toBe(1)
    expect(result.recognizedTextPageCount).toBe(1)
    expect(result.sectionsFound).toBe(1)
    expect(recognizePage).toHaveBeenCalledWith(0, undefined)
    expect(progress).toEqual([
      [0, 1],
      [1, 1],
    ])
    expect(section?.startPage).toBe(1)
    expect(confidenceLabel(section!)).toBe('baixa · conferir')
    expect(hasHighConfidence(section!)).toBe(false)
    expect(matchSection(section!, 'Romans 13:8-14')).toBe('exact')
    expect(result.record.ocrPageNumbers).toEqual([1])
    expect(ocrResultNotice(result)).toBe(
      'OCR examinou 1 de 1 páginas, reconheceu texto em 1 e identificou 1 novas referências.',
    )

    const stored = storedCopy(result.record)
    expect(stored.ocrTextByPage?.[1]?.toLowerCase()).toContain('neighbor')

    const tab = {
      id: 'B4E1C3B6-1D5D-4E7A-9A51-2B8C6F1E0A11',
      title: 'Scanned commentary',
      location: scannedFile.path,
      physicalPage: 1,
      reference: 'Romans 13:8-14',
    }
    const sources = await extractPdfReviewSources({
      tab,
      targetReference: 'Romans 13:8-14',
      source,
      libraryRecords: [stored],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]!.text.toLowerCase()).toContain('neighbor')
    expect(sources[0]!.citation).toBe('Romans 13:8-14 · páginas física 1')

    const missingOcrText: PdfLibraryRecord = { ...stored, ocrTextByPage: undefined }
    await expect(
      extractPdfReviewSources({
        tab,
        targetReference: 'Romans 13:8-14',
        source,
        libraryRecords: [missingOcrText],
      }),
    ).rejects.toThrow(SermonReviewMaterialError.pageUnavailable().message)

    const reindexed = (await indexPdf(source, scannedFile, { previousRecord: stored }))!
    expect(reindexed.ocrPageNumbers).toEqual([1])
    expect(reindexed.ocrTextByPage).toEqual(stored.ocrTextByPage)
    expect(reindexed.sections?.some((item) => item.findingMethod === 'ocrHeading')).toBe(true)

    const again = (await recognizeScannedPages(source, scannedFile, {
      previousRecord: stored,
      recognizePage,
    }))!
    expect(again.scannedPageCount).toBe(0)
    expect(recognizePage).toHaveBeenCalledTimes(1)
    expect(ocrResultNotice(again)).toBe('As páginas digitalizadas deste arquivo já foram examinadas.')
  })

  it('descarta o OCR anterior quando o arquivo mudou', async () => {
    const source = new FakePdfTextSource({ pages: [''] })
    const result = (await recognizeScannedPages(source, scannedFile, {
      recognizePage: async () => 'Romans 13:8-14\nText.',
    }))!
    const changed = { ...scannedFile, sizeBytes: 50_000 }
    const reindexed = (await indexPdf(source, changed, { previousRecord: result.record }))!
    expect(reindexed.ocrTextByPage).toBeUndefined()
    expect(reindexed.sections).toEqual([])
    const missingDate = (await indexPdf(
      source,
      { path: scannedFile.path, sizeBytes: 48_213 },
      { previousRecord: result.record },
    ))!
    expect(missingDate.ocrPageNumbers).toBeUndefined()
  })

  it('informa quando não há páginas sem texto', async () => {
    const recognizePage = vi.fn(async () => 'never')
    const result = (await recognizeScannedPages(
      new FakePdfTextSource({ pages: ['Selectable text.'] }),
      scannedFile,
      { recognizePage },
    ))!
    expect(result.candidatePageCount).toBe(0)
    expect(recognizePage).not.toHaveBeenCalled()
    expect(ocrResultNotice(result)).toBe('Nenhuma página sem texto selecionável foi encontrada.')
  })

  it('amplia a janela para 48 linhas só no OCR do Feasting', async () => {
    const previousEssay = Array.from({ length: 20 }, (_, index) => `Previous essay line ${index + 1}.`)
    const ocr: Record<number, string> = {
      1: [
        ...previousEssay,
        'NATHAN EDDY',
        'Matthew 21:33-46',
        '33 Listen to another parable.',
        'Theological Perspective',
        'Theological text.',
        'ANDREW PURVES',
      ].join('\n'),
      2: [
        'Pastoral Perspective',
        'Pastoral text.',
        'RICHARD E. SPALDING',
        'Exegetical Perspective',
        'Exegetical text.',
        'SUSAN GROVE EASTMAN',
      ].join('\n'),
      3: [
        'Homiletical Perspective',
        'It must be read as an allegory.',
        'MARVIN A. MCMICKLE',
        '1. A note.',
        'Isaiah 25:1-9',
        'Next reading.',
      ].join('\n'),
    }
    const recognizePage = async (pageIndex: number) => ocr[pageIndex + 1] ?? null

    const feasting = (await recognizeScannedPages(
      new FakePdfTextSource({
        pages: ['', '', ''],
        metadata: { title: 'Feasting on the Word: Year A, Volume 4' },
      }),
      { path: '/tmp/Feasting-on-the-Word-Year-A-Volume-4-scan.pdf' },
      { recognizePage },
    ))!
    const matching = feasting.record.sections!.filter(
      (section) => matchSection(section, 'Matthew 21:33-46') === 'exact',
    )
    expect(matching).toHaveLength(1)
    expect(matching[0]).toMatchObject({ startPage: 1, endPage: 3, findingMethod: 'ocrHeading' })
    expect(matching[0]!.components?.map((item) => item.author)).toEqual([
      undefined,
      'ANDREW PURVES',
      'RICHARD E. SPALDING',
      'SUSAN GROVE EASTMAN',
      'MARVIN A. MCMICKLE',
    ])
    const homiletical = await extractSpanText(
      matching[0]!.components![4]!.content,
      new FakePdfTextSource({ pages: ['', '', ''] }),
      feasting.record.ocrTextByPage,
    )
    expect(homiletical).toContain('must be read as an allegory')
    expect(homiletical).not.toContain('MARVIN A. MCMICKLE')
    expect(homiletical).not.toContain('Isaiah 25:1-9')

    const other = (await recognizeScannedPages(
      new FakePdfTextSource({ pages: ['', '', ''], metadata: { title: 'Some Commentary' } }),
      { path: '/tmp/other-scan.pdf' },
      { recognizePage },
    ))!
    expect(
      other.record.sections!.filter((section) => matchSection(section, 'Matthew 21:33-46') === 'exact'),
    ).toEqual([])
  })

  it('não promove a seção uma tabela litúrgica reconhecida', async () => {
    const table = 'Proper 9\nZc 9.9-12\nSl 145.8-15\nRm 7.15-25\nMt 11.16-19\nYear A'
    const result = (await recognizeScannedPages(
      new FakePdfTextSource({ pages: [''] }),
      { path: '/tmp/loc.pdf' },
      {
        recognizePage: async () => table,
      },
    ))!
    expect(parseAllReferences(result.record.ocrTextByPage![1]!)).toContainEqual(
      expect.objectContaining({ book: 'romans', chapter: 7, startVerse: 15, endVerse: 25 }),
    )
    expect(result.record.sections).toEqual([])
    expect(result.sectionsFound).toBe(0)
  })

  it('interrompe pelo AbortSignal sem devolver um índice parcial', async () => {
    const controller = new AbortController()
    const promise = recognizeScannedPages(new FakePdfTextSource({ pages: ['', ''] }), scannedFile, {
      signal: controller.signal,
      recognizePage: async () => {
        controller.abort()
        return 'Romans 13:8-14'
      },
    })
    await expect(promise).rejects.toThrow()
  })

  it('ordena as linhas do OCR de cima para baixo e da esquerda para a direita', () => {
    const text = joinRecognizedLines(
      [
        { text: 'second', left: 10, top: 200, bottom: 220 },
        { text: 'right', left: 300, top: 101, bottom: 121 },
        { text: 'left', left: 10, top: 100, bottom: 120 },
      ],
      2000,
    )
    expect(text).toBe('left\nright\nsecond')
  })
})
