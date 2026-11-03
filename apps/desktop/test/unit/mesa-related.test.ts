import { describe, expect, it } from 'vitest'
import {
  isPortugueseOrUnknown,
  languageTag,
  relatedMetaLine,
  relatedRelationLabel,
} from '../../src/renderer/src/views/mesa/panels/materials'

describe('idioma das fontes', () => {
  it('reduz o idioma declarado a uma sigla', () => {
    expect(languageTag('Português')).toBe('PT')
    expect(languageTag('pt-BR')).toBe('PT')
    expect(languageTag('Inglês')).toBe('EN')
    expect(languageTag('English (US)')).toBe('EN')
    expect(languageTag('Espanhol')).toBe('ES')
    expect(languageTag('')).toBeNull()
    expect(languageTag(null)).toBeNull()
    expect(languageTag('Coreano')).toBe('CO')
  })

  it('o filtro Em português mantém fontes sem idioma declarado', () => {
    expect(isPortugueseOrUnknown('Português')).toBe(true)
    expect(isPortugueseOrUnknown(undefined)).toBe(true)
    expect(isPortugueseOrUnknown('Inglês')).toBe(false)
  })
})

describe('já preguei sobre isto', () => {
  it('descreve a relação em palavras', () => {
    expect(relatedRelationLabel({ relation: 'passage', relationKind: 'exact' })).toBe('mesma passagem')
    expect(relatedRelationLabel({ relation: 'passage', relationKind: 'contains' })).toBe('passagem maior')
    expect(relatedRelationLabel({ relation: 'passage', relationKind: 'partial' })).toBe('trecho em comum')
    expect(relatedRelationLabel({ relation: 'passage', relationKind: 'context' })).toBe('mesmo capítulo')
    expect(relatedRelationLabel({ relation: 'occasion', relationKind: null })).toBe('mesma ocasião')
  })

  it('monta a linha de metadados em português', () => {
    expect(
      relatedMetaLine({ dateKey: '2023-11-12', liturgicalOccasion: 'Próprio 27', wordCount: 1240 }),
    ).toBe('12/11/2023 · Próprio 27 · 1.240 palavras')
    expect(relatedMetaLine({ dateKey: '2014-11-09', liturgicalOccasion: null, wordCount: 0 })).toBe(
      '09/11/2014',
    )
  })
})
