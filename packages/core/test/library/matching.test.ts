import { describe, expect, it } from 'vitest'
import { parseReference } from '../../src/bible/reference'
import {
  makeSectionLocation,
  matchSection,
  matchingSectionCount,
  sameIndexedReference,
  type PdfLibraryRecord,
} from '../../src/library'

describe('correspondência de seções com a passagem', () => {
  it('conta no Arquivo as seções relacionadas à leitura principal', () => {
    const record: PdfLibraryRecord = {
      id: 'commentary',
      title: 'Commentary',
      path: '/tmp/commentary.pdf',
      pageCount: 120,
      bookmarkCount: 3,
      sections: [
        makeSectionLocation({ title: 'Matthew 21:33-46', startPage: 91, endPage: 97 }),
        makeSectionLocation({ title: 'Matthew 21:23-40', startPage: 88, endPage: 90 }),
        makeSectionLocation({ title: 'Romans 13:8-14', startPage: 96, endPage: 102 }),
      ],
    }

    expect(matchingSectionCount([record], 'Mateus 21.33-46')).toBe(2)
    expect(matchingSectionCount([record], null)).toBe(0)
    expect(matchingSectionCount([record], 'invalid')).toBe(0)
  })

  it('classifica como exata, parcial ou de contexto', () => {
    const section = (title: string, context?: string) =>
      makeSectionLocation({ title, startPage: 1, endPage: 2, context })
    expect(matchSection(section('Romans 13:8-14'), 'Romanos 13.8–14')).toBe('exact')
    expect(matchSection(section('Romans 13:1-14'), 'Romans 13:8-14')).toBe('exact')
    expect(matchSection(section('Romans 13:11-14'), 'Romans 13:8-14')).toBe('partial')
    expect(matchSection(section('Romans 13'), 'Romans 13:8-14')).toBe('context')
    expect(matchSection(section('Romans 13:8-14'), 'Romans 13')).toBe('context')
    expect(matchSection(section('Romans 14:1-6'), 'Romans 13:8-14')).toBeNull()
    expect(matchSection(section('Proper 18', 'Romans 13:8-14; Matthew 18:15-20'), 'Matthew 18:15-20')).toBe(
      'exact',
    )
    expect(matchSection(section('John 3:16-4:2'), 'John 4:1-3')).toBe('partial')
    expect(matchSection(section('John 3:16-4:2'), parseReference('John 3:20-4:1')!)).toBe('exact')
    expect(matchSection(section('Salmo 34:1-10, 22'), 'Psalm 34:22')).toBe('exact')
    expect(matchSection(section('Romans 13:8-14'), 'not a reference')).toBeNull()
  })

  it('compara referências como o indexador Swift', () => {
    const plain = parseReference('Romans 13:8-14')!
    expect(sameIndexedReference(plain, { ...plain, endChapter: 13 })).toBe(true)
    expect(sameIndexedReference(plain, { ...plain, endVerse: null })).toBe(false)
  })
})
