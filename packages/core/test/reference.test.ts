import { describe, expect, it } from 'vitest'
import {
  englishReference,
  parseAllReferences,
  parseHeadingReference,
  parseReference,
  passageRelation,
  portugueseReference,
} from '../src/bible/reference'

describe('referências bíblicas', () => {
  it('aceita cabeçalhos de seção e rejeita citações em prosa', () => {
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

  it('preserva o capítulo final de intervalos entre capítulos', () => {
    const reference = parseReference('João 3:16-4:1')
    expect(reference).toMatchObject({ book: 'john', chapter: 3, startVerse: 16, endChapter: 4, endVerse: 1 })
    expect(englishReference(parseReference('Mateus 21:33–22:4')!)).toBe('Matthew 21:33-22:4')
  })

  it('reconhece continuações no mesmo capítulo', () => {
    const references = parseAllReferences('Salmo 34:1-10, 22')
    expect(references).toHaveLength(2)
    expect(references[1]).toMatchObject({ book: 'psalms', chapter: 34, startVerse: 22, endVerse: 22 })
  })

  it('formata em português com meia-risca', () => {
    expect(portugueseReference(parseReference('Romans 13:8-14')!)).toBe('Romanos 13:8–14')
  })

  it('classifica relação entre material e passagem', () => {
    const target = parseReference('Romanos 13:8-14')!
    expect(passageRelation(parseReference('Romans 13:8-14')!, target)?.kind).toBe('exact')
    expect(passageRelation(parseReference('Romans 13')!, target)?.kind).toBe('contains')
    const partial = passageRelation(parseReference('Romans 13:11-14')!, target)
    expect(partial?.kind).toBe('partial')
    expect(partial?.common).toMatchObject({ chapter: 13, startVerse: 11, endVerse: 14 })
    expect(passageRelation(parseReference('Romans 13:1-7')!, target)?.kind).toBe('context')
    expect(passageRelation(parseReference('Romans 14:1-6')!, target)).toBeNull()
  })
})
