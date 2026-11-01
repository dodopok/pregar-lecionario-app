import { describe, expect, it } from 'vitest'
import type { BiblePassageText } from '@pregar/core/liturgy/types'
import {
  alignedPositions,
  chapterButtonLabel,
  chapterCoordinatesUnavailable,
  chapterReference,
  comparisonRows,
  displayedVersionCodes,
  fallbackChapter,
  footerStatus,
  requestReference,
  spansMultipleChapters,
  verseLabel,
} from '../../src/renderer/src/views/biblia/alignment'

const nvt: BiblePassageText = {
  verses: [
    { number: 16, text: 'Porque Deus amou tanto o mundo…' },
    { number: 17, text: 'Deus enviou seu Filho…' },
    { number: 18, text: 'Quem nele crê não é condenado…' },
  ],
}
const naa: BiblePassageText = {
  verses: [
    { chapter: 3, number: 16, text: 'Porque Deus amou o mundo de tal maneira…' },
    { chapter: 3, number: 18, text: 'Quem nele crê não é julgado…' },
  ],
}

describe('referências', () => {
  it('reduz a referência ao capítulo', () => {
    expect(chapterReference('João 3:16')).toBe('João 3')
    expect(chapterReference('João 3:16-18')).toBe('João 3')
    expect(chapterReference('João 3:16–4:2')).toBe('João 3')
    expect(chapterReference('1 Coríntios 13.1-13')).toBe('1 Coríntios 13')
    expect(chapterReference('Salmo 23')).toBe('Salmo 23')
    expect(requestReference('  João 3:16 ', 'chapter')).toBe('João 3')
    expect(requestReference('  João 3:16 ', 'pericope')).toBe('João 3:16')
    expect(chapterButtonLabel('João 3:16')).toBe('Capítulo 3')
    expect(chapterButtonLabel('')).toBe('Capítulo')
  })

  it('identifica referências entre capítulos', () => {
    expect(spansMultipleChapters('João 3:16-18')).toBe(false)
    expect(spansMultipleChapters('João 3:16-4:2')).toBe(true)
    expect(fallbackChapter('João 3:16-18')).toBe(3)
    expect(fallbackChapter('João 3:16-4:2')).toBeNull()
  })

  it('põe a tradução principal primeiro, sem repetir', () => {
    expect(displayedVersionCodes('nvt', ['naa', 'nvt', 'ara', 'naa'])).toEqual(['nvt', 'naa', 'ara'])
  })
})

describe('alinhamento por capítulo e versículo', () => {
  it('alinha versículos com e sem capítulo numa referência de um capítulo', () => {
    const rows = comparisonRows('João 3:16-18', ['nvt', 'naa'], (code) => (code === 'nvt' ? nvt : naa))
    expect(rows.map((row) => row.id)).toEqual(['3:16', '3:17', '3:18'])
    expect(rows.map((row) => row.label)).toEqual(['16', '17', '18'])
    expect(rows[1]?.cells.map((cell) => cell.text)).toEqual(['Deus enviou seu Filho…', null])
    expect(rows[2]?.cells[1]?.text).toBe('Quem nele crê não é julgado…')
  })

  it('ordena por capítulo e mostra capítulo:versículo entre capítulos', () => {
    const crossing: BiblePassageText = {
      verses: [
        { chapter: 4, number: 1, text: 'b' },
        { chapter: 3, number: 36, text: 'a' },
        { chapter: 4, number: 2, text: 'c' },
      ],
    }
    const rows = comparisonRows('João 3:36-4:2', ['nvt'], () => crossing)
    expect(rows.map((row) => row.label)).toEqual(['3:36', '4:1', '4:2'])
    expect(verseLabel('João 3:36-4:2', { chapter: 4, number: 1 })).toBe('4:1')
  })

  it('não funde versículos repetidos quando a resposta não informa o capítulo', () => {
    const legacy: BiblePassageText = {
      verses: [
        { number: 36, text: 'a' },
        { number: 1, text: 'b' },
      ],
    }
    expect(chapterCoordinatesUnavailable('João 3:36-4:2', [legacy])).toBe(true)
    expect(alignedPositions('João 3:36-4:2', [legacy])).toEqual([])
    // Num só capítulo, a resposta antiga continua servindo.
    expect(chapterCoordinatesUnavailable('João 3:16-18', [nvt])).toBe(false)
    // Tradução ainda não carregada não decide nada.
    expect(chapterCoordinatesUnavailable('João 3:36-4:2', [undefined])).toBe(false)
  })

  it('usa uma linha única quando só há texto corrido', () => {
    const prose: BiblePassageText = { content: 'O Senhor é o meu pastor; nada me faltará.' }
    const rows = comparisonRows('Salmo 23', ['nvt', 'naa'], (code) => (code === 'nvt' ? prose : undefined))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('')
    expect(rows[0]?.cells.map((cell) => cell.text)).toEqual(['O Senhor é o meu pastor; nada me faltará.', null])
  })

  it('sem passagens não há linhas', () => {
    expect(comparisonRows('João 3:16', ['nvt'], () => undefined)).toEqual([])
  })

  it('monta o rodapé', () => {
    expect(footerStatus('João 3:16', 1)).toBe('João 3:16 · 1 tradução · Estêvão API v2')
    expect(footerStatus('João 3:16', 3)).toBe('João 3:16 · 3 traduções · Estêvão API v2')
    expect(footerStatus('  ', 2)).toBe('Digite uma referência e pressione Enter para comparar traduções.')
  })
})
