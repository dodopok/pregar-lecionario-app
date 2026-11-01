import { describe, expect, it } from 'vitest'
import type { PdfLibraryRecord } from '@pregar/core/library/model'
import { parseReference } from '@pregar/core/bible/reference'
import { matchSection, sectionReferences } from '@pregar/core/library/matching'
import { SectionMatchIndex, groupMatches, matchReferences } from '../../src/main/modules/library/matches'
import { groupTextLines, pageTextFromItems, type PositionedTextItem } from '../../src/main/modules/library/text-lines'
import {
  assetTargetFromURL,
  encodePathSegment,
  inlineDisposition,
  isAllowedOrigin,
  parseRange,
  pathFromPdfURL,
  pdfURLForPath,
} from '../../src/main/modules/library/urls'

describe('URLs da Biblioteca', () => {
  it('codifica o caminho em base64url e decodifica de volta', () => {
    const paths = ['/Users/ana/Comentários/Feasting (1).pdf', 'C:\\Users\\Ana\\Livros\\Wright – Romans.pdf', '/tmp/a+b/=c?.pdf']
    for (const path of paths) {
      const url = pdfURLForPath(path)
      expect(url).toMatch(/^pregar-pdf:\/\/open\/[A-Za-z0-9_-]+$/)
      expect(pathFromPdfURL(url)).toBe(path)
    }
    expect(encodePathSegment('/a')).toBe('L2E')
  })

  it('rejeita outros hosts, segmentos extras e base64 malformado', () => {
    const segment = encodePathSegment('/tmp/x.pdf')
    expect(pathFromPdfURL(`pregar-pdf://other/${segment}`)).toBeNull()
    expect(pathFromPdfURL(`pregar-pdf://open/${segment}/extra`)).toBeNull()
    expect(pathFromPdfURL('pregar-pdf://open/../../etc/passwd')).toBeNull()
    expect(pathFromPdfURL('pregar-pdf://open/%2F')).toBeNull()
    expect(pathFromPdfURL(`pregar-asset://open/${segment}`)).toBeNull()
    // Bytes que não são UTF-8 válido.
    expect(pathFromPdfURL('pregar-pdf://open/_w')).toBeNull()
  })

  it('aceita só capas e dados de idioma com nomes esperados', () => {
    const cover = 'a'.repeat(32) + '.jpg'
    expect(assetTargetFromURL(`pregar-asset://cover/${cover}?v=12`)).toEqual({ kind: 'cover', file: cover })
    expect(assetTargetFromURL('pregar-asset://tessdata/por.traineddata.gz')).toEqual({ kind: 'tessdata', file: 'por.traineddata.gz' })
    expect(assetTargetFromURL('pregar-asset://tessdata/../secrets.bin')).toBeNull()
    expect(assetTargetFromURL('pregar-asset://tessdata/deu.traineddata.gz')).toBeNull()
    expect(assetTargetFromURL('pregar-asset://cover/x.jpg')).toBeNull()
    expect(assetTargetFromURL('pregar-asset://other/por.traineddata.gz')).toBeNull()
  })

  it('lê o cabeçalho Range', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=990-2000', 1000)).toEqual({ start: 990, end: 999 })
    expect(parseRange('bytes=0-9, 20-29', 1000)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=50-10', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
    expect(parseRange('items=0-1', 1000)).toBeNull()
  })

  it('autoriza só as janelas do app', () => {
    expect(isAllowedOrigin(null, undefined)).toBe(true)
    expect(isAllowedOrigin('null', undefined)).toBe(true)
    expect(isAllowedOrigin('file://', undefined)).toBe(true)
    expect(isAllowedOrigin('https://exemplo.com', undefined)).toBe(false)
    expect(isAllowedOrigin('http://localhost:5173', 'http://localhost:5173/')).toBe(true)
    expect(isAllowedOrigin('http://localhost:9999', 'http://localhost:5173/')).toBe(false)
  })

  it('nome do arquivo em Content-Disposition', () => {
    expect(inlineDisposition('Comentário "A".pdf')).toBe(`inline; filename="Coment_rio _A_.pdf"; filename*=UTF-8''Coment%C3%A1rio%20%22A%22.pdf`)
  })
})

function item(str: string, x: number, y: number, width = str.length * 5, fontSize = 10, hasEOL = false): PositionedTextItem {
  return { str, x, y, width, fontSize, hasEOL }
}

describe('linhas da camada de texto', () => {
  it('junta itens da mesma linha com espaço e ordena de cima para baixo', () => {
    const lines = groupTextLines([
      item('Rodapé 3', 72, 760),
      item('Romans', 72, 100),
      item('13:8-14', 110, 100.4),
      item('Love, the Law', 72, 120),
    ])
    expect(lines.map((line) => line.text)).toEqual(['Romans 13:8-14', 'Love, the Law', 'Rodapé 3'])
  })

  it('não duplica espaços já presentes', () => {
    expect(groupTextLines([item('Romans ', 72, 100, 35), item('13:8', 108, 100)])[0]?.text).toBe('Romans 13:8')
    expect(groupTextLines([item('Ro', 72, 100, 10), item('mans', 82, 100)])[0]?.text).toBe('Romans')
  })

  it('mantém a ordem do conteúdo em páginas com colunas', () => {
    const lines = groupTextLines([
      item('Coluna A1', 72, 100),
      item('Coluna A2', 72, 112),
      item('Coluna B1', 320, 100),
      item('Coluna B2', 320, 112),
    ])
    expect(lines.map((line) => line.text)).toEqual(['Coluna A1', 'Coluna A2', 'Coluna B1', 'Coluna B2'])
  })

  it('página sem texto selecionável vira null', () => {
    expect(pageTextFromItems([item('  ', 72, 100), item('', 72, 110, 0, 10, true)])).toBeNull()
    expect(pageTextFromItems([item('Texto', 72, 100)])?.text).toBe('Texto')
  })
})

function record(path: string, title: string, sections: { title: string; startPage: number; endPage: number; context?: string }[]): PdfLibraryRecord {
  return {
    id: path,
    path,
    title,
    pageCount: 200,
    bookmarkCount: sections.length,
    sections: sections.map((section) => ({ ...section, findingMethod: 'bookmark' as const })),
    indexVersion: 4,
  }
}

describe('índice de correspondências', () => {
  const records = [
    record('/w.pdf', 'Paul for Everyone: Romans Part 2', [
      { title: 'Romans 13:1-7 Submitting to the Authorities', startPage: 95, endPage: 101 },
      { title: 'Romans 13:8-14 Love, the Law and the Coming Day', startPage: 102, endPage: 107 },
      { title: 'Romans 14:1-6', startPage: 108, endPage: 112 },
    ]),
    record('/f.pdf', 'Feasting on the Word: Year A, Volume 1', [
      { title: 'Romans 13:11-14', startPage: 30, endPage: 34, context: 'First Sunday of Advent' },
      { title: 'Matthew 24:36-44', startPage: 43, endPage: 54, context: 'First Sunday of Advent' },
    ]),
    record('/c.pdf', 'Connections', [{ title: 'Proper 18', startPage: 600, endPage: 610, context: 'Romans 13' }]),
  ]
  const index = new SectionMatchIndex(records)

  it('agrupa coincidência exata, sobreposição e contexto, nessa ordem', () => {
    const matches = index.matches('Romanos 13:8-14')
    expect(matches.map((match) => [match.workTitle, match.section.startPage, match.kind])).toEqual([
      ['Paul for Everyone: Romans Part 2', 102, 'exact'],
      ['Feasting on the Word: Year A, Volume 1', 30, 'partial'],
      ['Connections', 600, 'context'],
    ])
    expect(groupMatches(matches).map((group) => [group.kind, group.items.length])).toEqual([
      ['exact', 1],
      ['partial', 1],
      ['context', 1],
    ])
  })

  it('conta como o Arquivo e ignora referências inválidas', () => {
    expect(index.count('Mateus 24:36-44')).toBe(1)
    expect(index.count('Romanos 13')).toBe(4)
    expect(index.count('não é passagem')).toBe(0)
    expect(index.count(null)).toBe(0)
  })

  it('responde em poucos milissegundos com centenas de seções', () => {
    const big = Array.from({ length: 40 }, (_, work) =>
      record(
        `/obra-${work}.pdf`,
        `Obra ${work}`,
        Array.from({ length: 25 }, (_, section) => ({ title: `Romans ${(section % 16) + 1}:1-${(section % 9) + 2}`, startPage: section * 4 + 1, endPage: section * 4 + 4 })),
      ),
    )
    const bigIndex = new SectionMatchIndex(big)
    bigIndex.matches('Gênesis 1:1')
    const started = performance.now()
    for (let chapter = 1; chapter <= 16; chapter += 1) bigIndex.matches(`Romanos ${chapter}:1-5`)
    // Dezesseis consultas sobre mil seções do mesmo livro.
    expect(performance.now() - started).toBeLessThan(80)
    expect(bigIndex.matches('Romanos 3:1-5').length).toBeGreaterThan(0)
  })

  it('classifica exatamente como matchSection do domínio', () => {
    const titles = [
      'Romans 13:8-14',
      'Romans 13:11-14',
      'Romans 13',
      'Romans 12:9-13:10',
      'Romans 13:8',
      'Psalm 122',
      'Matthew 21:23–32',
      'Romans 14:1-6',
      'Isaiah 2:1-5; Romans 13:11-14',
      'Introdução',
    ]
    const targets = ['Romanos 13:8-14', 'Romanos 13', 'Romanos 13:1-14:6', 'Salmos 122:1', 'Mateus 21:23-32', 'Romanos 12:21']
    for (const title of titles) {
      for (const context of [undefined, 'Romans 13', 'Proper 18']) {
        const section = { title, context }
        for (const value of targets) {
          const target = parseReference(value)!
          expect(matchReferences(sectionReferences(section), target), `${title} | ${context} | ${value}`).toBe(matchSection(section, target))
        }
      }
    }
  })
})
