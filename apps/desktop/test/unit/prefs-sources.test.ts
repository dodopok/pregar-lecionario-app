import { describe, expect, it } from 'vitest'
import { DEFAULT_FAVORITE_SITES } from '@pregar/core/sources/favorites'
import type { FavoriteSite } from '@pregar/core/sources/favorites'
import {
  adapterUsesTemplate,
  displayHost,
  exampleSearchURL,
  validateFavoriteAuthor,
  validateFavoriteSite,
} from '../../src/renderer/src/views/preferencias/sources-form'

const base: FavoriteSite = {
  id: 'x',
  title: '  Meu site ',
  baseURL: 'https://example.org',
  detail: ' Sermões ',
  language: ' português ',
  tradition: '',
  adapter: 'websiteSearch',
  searchURLTemplate: ' https://example.org/?s={query} ',
  feedURL: null,
}

describe('editor de sites favoritos', () => {
  it('aceita e limpa um site válido', () => {
    const result = validateFavoriteSite(base)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.site.title).toBe('Meu site')
      expect(result.site.detail).toBe('Sermões')
      expect(result.site.language).toBe('português')
      expect(result.site.searchURLTemplate).toBe('https://example.org/?s={query}')
    }
  })

  it('exige HTTPS no endereço base e na busca', () => {
    expect(validateFavoriteSite({ ...base, baseURL: 'http://example.org' })).toMatchObject({ ok: false, field: 'baseURL' })
    expect(validateFavoriteSite({ ...base, baseURL: 'https://localhost' })).toMatchObject({ ok: false, field: 'baseURL' })
    expect(validateFavoriteSite({ ...base, searchURLTemplate: 'http://example.org/?s={query}' })).toMatchObject({
      ok: false,
      field: 'searchURLTemplate',
    })
    expect(validateFavoriteSite({ ...base, title: '  ' })).toMatchObject({ ok: false, field: 'title' })
  })

  it('valida o feed só para RSS/Atom', () => {
    expect(validateFavoriteSite({ ...base, adapter: 'rssAtom', feedURL: 'ftp://x.org/feed' })).toMatchObject({ ok: false, field: 'feedURL' })
    const ok = validateFavoriteSite({ ...base, adapter: 'rssAtom', feedURL: ' https://example.org/feed ' })
    expect(ok.ok && ok.site.feedURL).toBe('https://example.org/feed')
    const ignored = validateFavoriteSite({ ...base, adapter: 'wordpress', feedURL: 'qualquer coisa' })
    expect(ignored.ok && ignored.site.feedURL).toBeNull()
  })

  it('os perfis iniciais passam na validação', () => {
    for (const site of DEFAULT_FAVORITE_SITES) expect(validateFavoriteSite({ ...site }).ok).toBe(true)
    expect(adapterUsesTemplate('anglicanCompass')).toBe(false)
    expect(adapterUsesTemplate('blogger')).toBe(true)
  })

  it('preenche todas as variáveis no exemplo', () => {
    expect(exampleSearchURL('https://x.org/{book}/{chapter}?q={query}&r={reference}&o={occasion}&d={date}')).toBe(
      'https://x.org/Matthew/21?q=Matthew%2021&r=Matthew%2021%3A33-46&o=Proper%2022&d=2026-10-04',
    )
    expect(displayHost('https://www.workingpreacher.org/path')).toBe('workingpreacher.org')
  })
})

describe('editor de autores favoritos', () => {
  it('aceita autor sem site e exige HTTPS quando há site', () => {
    expect(validateFavoriteAuthor({ id: 'a', name: ' N. T. Wright ', referenceURL: '  ' })).toEqual({
      ok: true,
      author: { id: 'a', name: 'N. T. Wright', referenceURL: null },
    })
    expect(validateFavoriteAuthor({ id: 'a', name: 'X', referenceURL: 'http://x.org' })).toMatchObject({ ok: false, field: 'referenceURL' })
    expect(validateFavoriteAuthor({ id: 'a', name: '', referenceURL: null })).toMatchObject({ ok: false, field: 'name' })
  })
})
