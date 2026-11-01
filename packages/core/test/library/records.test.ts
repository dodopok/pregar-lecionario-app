import { describe, expect, it } from 'vitest'
import {
  PDF_LIBRARY_INDEX_VERSION,
  authorsFromPdfMetadata,
  backfillBookmarkMethod,
  cleanPdfFilename,
  compareLibraryRecords,
  copyLabelFromFilename,
  dateFromSwiftDate,
  decodeLibraryRecord,
  decodeLibraryRecords,
  decodeSectionLocation,
  encodeLibraryRecord,
  filenameFromPath,
  makeSectionLocation,
  metadataOverridesFromRecord,
  migrateLibraryRecords,
  preservingMetadata,
  recordDisplayAuthor,
  recordDisplayCredits,
  recordDisplayTitle,
  requiresReindex,
  swiftDateFromDate,
  titleFromPdfMetadata,
  type PdfLibraryMetadataOverrides,
  type PdfLibraryRecord,
} from '../../src/library'

function roundTrip(record: PdfLibraryRecord): PdfLibraryRecord {
  return decodeLibraryRecord(JSON.parse(JSON.stringify(encodeLibraryRecord(record))))!
}

describe('registros antigos', () => {
  it('decodifica seções antigas sem componentes nem origem', () => {
    const section = decodeSectionLocation(
      JSON.parse('{"title":"Romans 13:8-14","startPage":96,"endPage":107,"context":null}'),
    )
    expect(section).toEqual({ title: 'Romans 13:8-14', startPage: 96, endPage: 107 })
    expect(section?.components).toBeUndefined()
    expect(section?.findingMethod).toBeUndefined()
  })

  it('decodifica registros sem correção de metadados', () => {
    const record = decodeLibraryRecord(
      JSON.parse(
        '{"id":"legacy","title":"Book title","path":"/tmp/book.pdf","pageCount":20,"bookmarkCount":3}',
      ),
    )!
    expect(record.metadataOverrides).toBeUndefined()
    expect(recordDisplayTitle(record)).toBe('Book title')
    expect(recordDisplayAuthor(record)).toBeUndefined()
  })

  it('lê o JSON completo gravado pelo app Swift', () => {
    const json = String.raw`{"id":"\/Users\/u\/Feasting.pdf","title":"Feasting on the Word: Year A, Volume 4","path":"\/Users\/u\/Feasting.pdf","pageCount":761,"bookmarkCount":412,"author":"David L. Bartlett & Barbara Brown Taylor (orgs.)","coverJPEG":"\/9j\/4AAQ","sections":[{"title":"Romans 13:8-14","startPage":96,"endPage":108,"context":"Proper 18","findingMethod":"bookmark","components":[{"kind":"biblicalText","title":"Texto bíblico","location":{"start":{"page":96,"utf16Offset":12},"end":{"page":97,"utf16Offset":0}},"content":{"start":{"page":96,"utf16Offset":27},"end":{"page":97,"utf16Offset":0}}},{"kind":"theological","title":"Theological Perspective","author":"ELEAZAR S. FERNANDEZ","location":{"start":{"page":97,"utf16Offset":0},"end":{"page":100,"utf16Offset":0}},"content":{"start":{"page":97,"utf16Offset":24},"end":{"page":99,"utf16Offset":1800}}}]}],"indexVersion":4,"copyLabel":"Cópia 2","ocrPageNumbers":[1,2],"ocrTextByPage":{"2":"Romans 13:8-14\nText","1":"Cover"},"fileSizeBytes":15234567,"fileModificationDate":781234567.25}`
    const record = decodeLibraryRecord(JSON.parse(json))!

    expect(record.path).toBe('/Users/u/Feasting.pdf')
    expect(record.sections?.[0]?.components?.[1]?.author).toBe('ELEAZAR S. FERNANDEZ')
    expect(record.sections?.[0]?.components?.[0]?.author).toBeUndefined()
    expect(record.ocrTextByPage?.[2]).toBe('Romans 13:8-14\nText')
    expect(record.ocrTextByPage?.[1]).toBe('Cover')
    expect(record.coverJPEG).toBe('/9j/4AAQ')
    expect(dateFromSwiftDate(record.fileModificationDate!).toISOString()).toBe('2025-10-04T01:36:07.250Z')
    expect(roundTrip(record)).toEqual(record)

    const encoded = encodeLibraryRecord(record) as Record<string, unknown>
    expect(Object.keys(encoded)).toEqual([
      'id',
      'title',
      'path',
      'pageCount',
      'bookmarkCount',
      'author',
      'coverJPEG',
      'sections',
      'indexVersion',
      'copyLabel',
      'ocrPageNumbers',
      'ocrTextByPage',
      'fileSizeBytes',
      'fileModificationDate',
    ])
    expect(encoded.ocrTextByPage).toEqual({ 1: 'Cover', 2: 'Romans 13:8-14\nText' })
  })

  it('descarta só os registros inválidos da lista', () => {
    const records = decodeLibraryRecords([
      { id: 'a', title: 'A', path: '/a.pdf', pageCount: 1, bookmarkCount: 0 },
      { id: 'b', title: 'B', path: '/b.pdf', pageCount: 'many', bookmarkCount: 0 },
      { id: 'c', title: 'C', path: '/c.pdf', pageCount: 1, bookmarkCount: 0, ocrTextByPage: { first: 'x' } },
      {
        id: 'd',
        title: 'D',
        path: '/d.pdf',
        pageCount: 1,
        bookmarkCount: 0,
        sections: [{ title: 'S', startPage: 1, endPage: 1, findingMethod: 'guess' }],
      },
    ])
    expect(records.map((record) => record.id)).toEqual(['a'])
    expect(decodeLibraryRecords({ not: 'a list' })).toEqual([])
  })

  it('converte datas no formato do Swift', () => {
    const date = new Date('2026-11-01T12:00:00Z')
    expect(swiftDateFromDate(date)).toBe(date.getTime() / 1000 - 978_307_200)
    expect(dateFromSwiftDate(swiftDateFromDate(date)).getTime()).toBe(date.getTime())
  })
})

describe('reindexação', () => {
  it('reindexa só Feasting antigo e PDFs sem bookmarks', () => {
    const base = { sections: [], indexVersion: 2 }
    const legacyFeasting: PdfLibraryRecord = {
      ...base,
      id: 'feasting',
      title: 'Feasting on the Word: Year A, Volume 4',
      path: '/tmp/feasting.pdf',
      pageCount: 761,
      bookmarkCount: 0,
    }
    const legacyUnbookmarked: PdfLibraryRecord = {
      ...base,
      id: 'wright',
      title: 'Paul for Everyone: Romans Part 2',
      path: '/tmp/wright.pdf',
      pageCount: 184,
      bookmarkCount: 0,
    }
    const legacyBookmarked: PdfLibraryRecord = {
      ...base,
      id: 'matthew',
      title: 'Matthew for Everyone, Part 2',
      path: '/tmp/matthew.pdf',
      pageCount: 242,
      bookmarkCount: 60,
    }

    expect(requiresReindex(legacyFeasting)).toBe(true)
    expect(requiresReindex(legacyUnbookmarked)).toBe(true)
    expect(requiresReindex(legacyBookmarked)).toBe(false)
    expect(requiresReindex({ ...legacyBookmarked, sections: undefined })).toBe(true)
    expect(requiresReindex({ ...legacyBookmarked, indexVersion: 1 })).toBe(true)
    expect(requiresReindex({ ...legacyFeasting, indexVersion: PDF_LIBRARY_INDEX_VERSION })).toBe(false)
  })

  it('preserva a correção manual na reindexação e na gravação', () => {
    const metadata: PdfLibraryMetadataOverrides = {
      title: 'Matthew for Everyone, Part 2',
      author: 'N. T. Wright',
      publisher: 'SPCK',
      year: '2004',
      volume: 'Part 2',
      edition: '',
      language: 'English',
    }
    const previous: PdfLibraryRecord = {
      id: 'book',
      title: 'Feasting on the Word: Year A, Volume 4',
      path: '/tmp/book.pdf',
      pageCount: 242,
      bookmarkCount: 60,
      sections: [],
      indexVersion: 3,
      metadataOverrides: metadata,
    }
    const indexed: PdfLibraryRecord = { ...previous, pageCount: 243, metadataOverrides: undefined }

    const decoded = roundTrip(preservingMetadata(indexed, previous))

    expect(recordDisplayTitle(decoded)).toBe('Matthew for Everyone, Part 2')
    expect(recordDisplayCredits(decoded)).toEqual(['N. T. Wright', 'SPCK', '2004', 'Part 2', 'English'])
    expect(decoded.pageCount).toBe(243)
    // A classificação usa o título extraído do PDF, não a correção do usuário.
    expect(requiresReindex(decoded)).toBe(true)
    expect(preservingMetadata(previous, null).metadataOverrides).toBeUndefined()
  })

  it('autoria corrigida vazia não volta para a autoria extraída', () => {
    const record: PdfLibraryRecord = {
      id: 'x',
      title: 'Extracted',
      path: '/x.pdf',
      pageCount: 1,
      bookmarkCount: 0,
      author: 'Extracted Author',
      copyLabel: 'Cópia 2',
    }
    expect(recordDisplayCredits(record)).toEqual(['Extracted Author', 'Cópia 2'])
    const overrides = { ...metadataOverridesFromRecord(record), author: '  ', title: ' ' }
    expect(metadataOverridesFromRecord(record).author).toBe('Extracted Author')
    expect(recordDisplayAuthor({ ...record, metadataOverrides: overrides })).toBeUndefined()
    expect(recordDisplayTitle({ ...record, metadataOverrides: overrides })).toBe('Extracted')
  })

  it('preenche a origem bookmark só em seções antigas de PDFs com bookmarks', () => {
    const legacy = decodeSectionLocation({
      title: 'Romans 13:8-14',
      startPage: 102,
      endPage: 107,
      context: null,
    })!
    const heading = makeSectionLocation({
      title: 'Romans 14:1-6',
      startPage: 108,
      endPage: 112,
      findingMethod: 'textHeading',
    })

    const recovered = backfillBookmarkMethod([legacy, heading], 60)
    expect(recovered[0]!.findingMethod).toBe('bookmark')
    expect(recovered[1]!.findingMethod).toBe('textHeading')
    expect(backfillBookmarkMethod([legacy], 0)[0]!.findingMethod).toBeUndefined()
  })

  it('migra o acervo sem reprocessar o que não precisa', () => {
    const legacySection = decodeSectionLocation({ title: 'Matthew 21:33-46', startPage: 91, endPage: 97 })!
    const bookmarked: PdfLibraryRecord = {
      id: '/m.pdf',
      title: 'Matthew for Everyone, Part 2',
      path: '/m.pdf',
      pageCount: 242,
      bookmarkCount: 60,
      sections: [legacySection],
      indexVersion: 2,
    }
    const feasting: PdfLibraryRecord = {
      ...bookmarked,
      id: '/f.pdf',
      path: '/f.pdf',
      title: 'Feasting on the Word: Year A, Volume 1',
    }

    const migration = migrateLibraryRecords([bookmarked, feasting])

    expect(migration.pathsToReindex).toEqual(['/f.pdf'])
    expect(migration.records[0]!.indexVersion).toBe(PDF_LIBRARY_INDEX_VERSION)
    expect(migration.records[0]!.sections?.[0]?.findingMethod).toBe('bookmark')
    expect(migration.records[1]).toBe(feasting)
  })

  it('ordena o acervo pelo título exibido em ordem natural', () => {
    const make = (title: string): PdfLibraryRecord => ({
      id: title,
      title,
      path: title,
      pageCount: 1,
      bookmarkCount: 0,
    })
    const sorted = [make('Volume 10'), make('Volume 2'), make('connections')].sort(compareLibraryRecords)
    expect(sorted.map((record) => record.title)).toEqual(['connections', 'Volume 2', 'Volume 10'])
  })
})

describe('metadados extraídos do PDF', () => {
  it('usa o título dos metadados quando útil', () => {
    expect(titleFromPdfMetadata('Paul_for  Everyone:  Romans Part 2 ', 'file')).toBe(
      'Paul for Everyone: Romans Part 2',
    )
    expect(titleFromPdfMetadata('Untitled', 'Some_Book - Commentary')).toBe('Some Book: Commentary')
    expect(titleFromPdfMetadata('Microsoft Word - draft.docx', 'Real Title')).toBe('Real Title')
    expect(titleFromPdfMetadata('layout.indd', 'Real Title')).toBe('Real Title')
    expect(titleFromPdfMetadata('x'.repeat(141), 'Real Title')).toBe('Real Title')
    expect(titleFromPdfMetadata(null, 'Plain (2)')).toBe('Plain')
  })

  it('reconhece Feasting e Connections pelo nome do arquivo', () => {
    expect(
      titleFromPdfMetadata(
        null,
        'Feasting-on-the-Word_-Year-A_-Volume-4-Preaching-the-Revised-Common-Lectionary-2011-Westminster (1)',
      ),
    ).toBe('Feasting on the Word: Year A, Volume 4')
    expect(titleFromPdfMetadata('', 'connections_year_a_vol_3')).toBe(
      'Connections: A Lectionary Commentary for Preaching and Worship',
    )
  })

  it('formata autores, organizadores e listas longas', () => {
    // Como no Swift, pontos nas pontas de cada nome são removidos ("David L." vira "David L").
    const feasting = 'Feasting on the Word: Year A, Volume 4'
    expect(authorsFromPdfMetadata('Bartlett, David L.; Taylor, Barbara Brown', feasting)).toBe(
      'David L Bartlett & Barbara Brown Taylor (orgs.)',
    )
    expect(authorsFromPdfMetadata('Wright, N. T.', 'Romans')).toBe('N. T Wright')
    expect(authorsFromPdfMetadata('A; B; C; D', 'X')).toBe('A, B et al.')
    expect(authorsFromPdfMetadata('A;;B', 'X')).toBe('A & B')
    expect(authorsFromPdfMetadata('unknown', 'X')).toBeUndefined()
    expect(authorsFromPdfMetadata(';;', 'X')).toBeUndefined()
  })

  it('identifica cópias e limpa o nome do arquivo', () => {
    expect(copyLabelFromFilename('Feasting Volume 1 (1)')).toBe('Cópia 2')
    expect(copyLabelFromFilename('Feasting Volume 1')).toBeUndefined()
    expect(filenameFromPath('/Users/u/Downloads/Matthew for Everyone (2).pdf')).toBe(
      'Matthew for Everyone (2)',
    )
    expect(filenameFromPath('C:\\Books\\Romans.Part.2.pdf')).toBe('Romans.Part.2')
    expect(cleanPdfFilename('Romans_Part_2 - Wright (1)')).toBe('Romans Part 2: Wright')
  })
})
