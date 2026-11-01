import { describe, expect, it } from 'vitest'
import { parseAllReferences, parseHeadingReference, parseReference } from '../../src/bible/reference'
import {
  activeSectionForPage,
  confidenceLabel,
  findingMethodLabel,
  hasHighConfidence,
  isReferenceHeading,
  makeSectionLocation,
  pageHeadingCandidates,
  sectionId,
  sectionMatchesSearch,
} from '../../src/library'

describe('filtro de seções', () => {
  it('aceita variações de traço, contexto e consulta vazia', () => {
    const section = makeSectionLocation({
      title: 'Matthew 21:23–32',
      startPage: 636,
      endPage: 643,
      context: 'Proper 21 (Sunday between September 25 and October 1 inclusive)',
    })

    expect(sectionMatchesSearch(section, 'Matthew 21:23-32')).toBe(true)
    expect(sectionMatchesSearch(section, 'proper 21')).toBe(true)
    expect(sectionMatchesSearch(section, '')).toBe(true)
    expect(sectionMatchesSearch(section, 'Matthew 21:33-46')).toBe(false)
  })

  it('ignora acentos, caixa, espaços repetidos e outros hífens tipográficos', () => {
    const section = makeSectionLocation({
      title: 'Romanos 13:8—14',
      startPage: 1,
      endPage: 2,
      context: 'Próprio 18',
    })
    expect(sectionMatchesSearch(section, '  romanos   13:8-14 ')).toBe(true)
    expect(sectionMatchesSearch(section, 'PROPRIO 18')).toBe(true)
    const hyphenated = makeSectionLocation({ title: 'Matthew 21:23\u{2011}32', startPage: 1, endPage: 1 })
    expect(sectionMatchesSearch(hyphenated, 'matthew 21:23-32')).toBe(true)
  })

  it('identifica seções e a seção ativa pela página física', () => {
    const sections = [
      makeSectionLocation({ title: 'Romans 13:1-7', startPage: 96, endPage: 101 }),
      makeSectionLocation({ title: 'Romans 13:8-14', startPage: 102, endPage: 107 }),
    ]
    expect(sectionId(sections[1]!)).toBe('Romans 13:8-14|102')
    expect(activeSectionForPage(sections, 104)?.title).toBe('Romans 13:8-14')
    expect(activeSectionForPage(sections, 50)).toBeUndefined()
  })
})

describe('origem e confiança da seção', () => {
  it('mapeia bookmark, cabeçalho textual, OCR e origem desconhecida', () => {
    const labels = (['bookmark', 'textHeading', 'ocrHeading', 'unknown', undefined] as const).map(
      (findingMethod) => {
        const section = { findingMethod }
        return [findingMethodLabel(section), confidenceLabel(section), hasHighConfidence(section)]
      },
    )
    expect(labels).toEqual([
      ['bookmark do PDF', 'alta', true],
      ['cabeçalho textual', 'média', false],
      ['cabeçalho reconhecido por OCR', 'baixa · conferir', false],
      ['não identificado', 'não verificada', false],
      ['não identificado', 'não verificada', false],
    ])
  })

  it('usa origem desconhecida como padrão do inicializador e permite registros sem origem', () => {
    expect(makeSectionLocation({ title: 'A', startPage: 1, endPage: 1 }).findingMethod).toBe('unknown')
    expect(
      makeSectionLocation({ title: 'A', startPage: 1, endPage: 1, findingMethod: null }).findingMethod,
    ).toBeUndefined()
  })
})

describe('cabeçalhos de seção', () => {
  it('aceita cabeçalhos e rejeita citações em prosa e listas de citações', () => {
    const heading = parseHeadingReference('Romans 13.8—14 Love, the Law and the Coming Day')
    expect(heading?.startVerse).toBe(8)
    expect(heading?.endVerse).toBe(14)
    expect(parseHeadingReference('different kinds of material (Leviticus 19.19). Someone')).toBeNull()
    expect(parseHeadingReference('Romans 6.1—14, 8.12-17 or 12.1-2')).toBeNull()
  })

  it('normaliza abreviações portuguesas do lecionário', () => {
    const references = parseAllReferences('Zc 9.9-12 · Sl 145.8-15 · Rm 7.15-25a')
    expect(references.map((item) => item.book)).toEqual(['zechariah', 'psalms', 'romans'])
    expect(references.map((item) => item.startVerse)).toEqual([9, 8, 15])
    expect(references.map((item) => item.endVerse)).toEqual([12, 15, 25])
  })

  it('considera só o início da linha e as 12 primeiras linhas da página', () => {
    const page = [
      'end of the previous commentary, as in Romans 12.21.',
      'Romans 13.8-14 Love, the Law and the Coming Day',
      'different kinds of material (Leviticus 19.19). Someone',
      'Romans 6.1—14, 8.12-17 or 12.1-2',
    ].join('\n')
    expect(pageHeadingCandidates(page).map((entry) => entry.title)).toEqual([
      'Romans 13.8-14 Love, the Law and the Coming Day',
    ])

    const late = [
      ...Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of prose.`),
      'Romans 14.1-6 Welcoming',
    ].join('\n')
    expect(pageHeadingCandidates(late)).toEqual([])
    expect(pageHeadingCandidates(late, 48).map((entry) => entry.title)).toEqual(['Romans 14.1-6 Welcoming'])
  })

  it('conta \\r\\n como duas quebras no limite de linhas, como no Swift', () => {
    const lines = Array.from({ length: 6 }, (_, index) => `Line ${index + 1}.`)
    const page = [...lines, 'Romans 14.1-6 Welcoming'].join('\r\n')
    expect(pageHeadingCandidates(page)).toEqual([])
    expect(pageHeadingCandidates(page.replaceAll('\r\n', '\n'))).toHaveLength(1)
  })

  it('descarta páginas densas de sumário ou tabela (três referências distintas)', () => {
    const contents = [
      'Contents',
      'Romans 13.1-7 Submitting to the Authorities 85',
      'Romans 13.8-14 Love, the Law and the Coming Day 88',
      'Romans 14.1-6 Welcoming the Weak 94',
    ].join('\n')
    expect(pageHeadingCandidates(contents)).toEqual([])

    const repeated = [
      'Romans 13.8-14 Love',
      'ROMANS 13.8-14 LOVE, THE LAW AND THE COMING DAY',
      'Romans 14.1-6 Welcoming',
    ].join('\n')
    expect(pageHeadingCandidates(repeated)).toHaveLength(3)
  })

  it('reconhece títulos de leitura que são só a referência', () => {
    const target = parseReference('Romans 13:8-14')!
    expect(isReferenceHeading('Romans 13:8-14\n')).toBe(true)
    expect(isReferenceHeading('  1 Corinthians 1:18-31  ')).toBe(true)
    expect(isReferenceHeading('Romans 13:8-14', target)).toBe(true)
    expect(isReferenceHeading('Matthew 18:15-20', target)).toBe(false)
    expect(isReferenceHeading('Psalm 122')).toBe(false)
    expect(isReferenceHeading('8 Owe no one anything.')).toBe(false)
    expect(isReferenceHeading('See Romans 13:8-14')).toBe(true)
    expect(isReferenceHeading('Romans 13:8-14 Love')).toBe(false)
  })
})
