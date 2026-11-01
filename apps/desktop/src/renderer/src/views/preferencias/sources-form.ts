/**
 * Validação dos editores de sites e autores favoritos (porte de FavoriteSiteEditor e
 * FavoriteAuthorEditor do Swift). Funções puras.
 */
import type { FavoriteAuthor, FavoriteSite, FavoriteSiteAdapter } from '@pregar/core/sources/favorites'

/** Endereço https com host de verdade e sem credenciais; devolve a forma normalizada. */
export function parseHttpsURL(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null
    return trimmed
  } catch {
    return null
  }
}

/** Adaptadores com endereço de busca próprio, que não usam o template. */
export function adapterUsesTemplate(adapter: FavoriteSiteAdapter): boolean {
  return adapter !== 'workingPreacherArchive' && adapter !== 'anglicanCompass'
}

export const TEMPLATE_VARIABLES = ['{query}', '{reference}', '{book}', '{chapter}', '{occasion}', '{date}'] as const

const SAMPLE_VALUES: Record<string, string> = {
  '{query}': 'Matthew%2021',
  '{reference}': 'Matthew%2021%3A33-46',
  '{book}': 'Matthew',
  '{chapter}': '21',
  '{occasion}': 'Proper%2022',
  '{date}': '2026-10-04',
}

export function exampleSearchURL(template: string): string {
  let result = template
  for (const [variable, sample] of Object.entries(SAMPLE_VALUES)) result = result.split(variable).join(sample)
  return result
}

export type SiteValidation = { ok: true; site: FavoriteSite } | { ok: false; message: string; field: 'title' | 'baseURL' | 'searchURLTemplate' | 'feedURL' }

export function validateFavoriteSite(draft: FavoriteSite): SiteValidation {
  const title = draft.title.trim()
  if (!title) return { ok: false, message: 'Dê um nome ao site.', field: 'title' }
  const baseURL = parseHttpsURL(draft.baseURL)
  if (!baseURL) return { ok: false, message: 'Informe um endereço HTTPS válido para o site.', field: 'baseURL' }
  const usesTemplate = adapterUsesTemplate(draft.adapter)
  const template = usesTemplate ? draft.searchURLTemplate.trim() : draft.searchURLTemplate
  if (usesTemplate || template.trim()) {
    try {
      const example = new URL(exampleSearchURL(template.trim()))
      if (example.protocol !== 'https:' || !example.hostname) throw new Error('scheme')
    } catch {
      return {
        ok: false,
        message: 'A URL de busca precisa começar com https:// e conter um endereço válido.',
        field: 'searchURLTemplate',
      }
    }
  }
  let feedURL: string | null = null
  if (draft.adapter === 'rssAtom' && (draft.feedURL ?? '').trim()) {
    feedURL = parseHttpsURL(draft.feedURL ?? '')
    if (!feedURL) return { ok: false, message: 'O feed RSS/Atom precisa usar um endereço HTTPS válido.', field: 'feedURL' }
  }
  return {
    ok: true,
    site: {
      ...draft,
      title,
      baseURL,
      searchURLTemplate: template,
      feedURL,
      detail: draft.detail.trim(),
      language: draft.language.trim(),
      tradition: draft.tradition.trim(),
    },
  }
}

export type AuthorValidation = { ok: true; author: FavoriteAuthor } | { ok: false; message: string; field: 'name' | 'referenceURL' }

export function validateFavoriteAuthor(draft: FavoriteAuthor): AuthorValidation {
  const name = draft.name.trim()
  if (!name) return { ok: false, message: 'Informe o nome do autor.', field: 'name' }
  const raw = (draft.referenceURL ?? '').trim()
  if (!raw) return { ok: true, author: { ...draft, name, referenceURL: null } }
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('scheme')
  } catch {
    return { ok: false, message: 'O site do autor precisa usar HTTPS.', field: 'referenceURL' }
  }
  return { ok: true, author: { ...draft, name, referenceURL: raw } }
}

/** Domínio para exibir na lista ("anglicancompass.com"). */
export function displayHost(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}
