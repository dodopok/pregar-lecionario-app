import { z } from 'zod'
import {
  DEFAULT_FAVORITE_AUTHORS,
  DEFAULT_FAVORITE_SITES,
  FavoriteSiteSearchCache,
  decodeFavoriteSites,
  encodeFavoriteAuthors,
  encodeFavoriteSites,
  favoriteAuthorsFromData,
  favoriteSiteSearchCacheKey,
  favoriteSitesFromData,
  searchFavoriteSites,
} from '@pregar/core/sources'
import type { FavoriteAuthor, FavoriteSite } from '@pregar/core/sources'
import { parseDateKey } from '@pregar/core/util/dates'
import type { MainContext } from '../../context'
import { handle, UserFacingError } from '../../ipc/router'

/** Fontes favoritas: perfis editáveis e busca de artigos por passagem, com cache de 24 horas. */
export function registerSources(context: MainContext): void {
  const store = context.kv('sources')
  const cache = new FavoriteSiteSearchCache({
    storage: { get: (key) => store.get<string>(key) ?? null, set: (key, value) => store.set(key, value) },
  })
  const inflight = new Map<string, Promise<unknown>>()

  function profiles(): { sites: FavoriteSite[]; authors: FavoriteAuthor[] } {
    const sites = store.get<string>('profiles.sites')
    const authors = store.get<string>('profiles.authors')
    return { sites: favoriteSitesFromData(sites ?? null), authors: favoriteAuthorsFromData(authors ?? null) }
  }

  handle('sources:profiles', () => profiles())
  handle('sources:saveProfiles', ({ sites, authors }) => {
    if (sites !== undefined) {
      // Revalida pelo próprio decodificador do domínio: perfis inválidos não entram.
      const decoded = decodeFavoriteSites(JSON.parse(JSON.stringify(sites)))
      if (!decoded) throw new UserFacingError('Os sites favoritos não puderam ser salvos: confira endereços e campos.')
      store.set('profiles.sites', encodeFavoriteSites(decoded))
    }
    if (authors !== undefined) {
      const list = z.array(z.unknown()).max(200).parse(JSON.parse(JSON.stringify(authors)))
      store.set('profiles.authors', encodeFavoriteAuthors(list.length === 0 ? [] : favoriteAuthorsFromData(list)))
    }
    return profiles()
  })
  handle('sources:resetProfiles', () => {
    store.set('profiles.sites', encodeFavoriteSites(DEFAULT_FAVORITE_SITES))
    store.set('profiles.authors', encodeFavoriteAuthors(DEFAULT_FAVORITE_AUTHORS))
    return profiles()
  })

  handle('sources:search', async ({ reference, occasion, dateKey, isSunday, force }) => {
    const date = parseDateKey(z.string().parse(dateKey))
    if (!date) throw new UserFacingError('Data inválida para a busca de materiais.')
    const { sites, authors } = profiles()
    const params = {
      reference: z.string().trim().min(1).max(200).parse(reference),
      occasion: occasion ? z.string().max(200).parse(occasion) : null,
      date,
      isSunday: Boolean(isSunday),
      sites,
      authors,
    }
    const key = await favoriteSiteSearchCacheKey(params)
    if (!force) {
      const fresh = await cache.getFresh(key)
      if (fresh) return { ...fresh, fromCache: true }
    }
    // Pedidos iguais simultâneos (várias janelas) compartilham a mesma busca.
    let pending = inflight.get(key) as Promise<Awaited<ReturnType<typeof searchFavoriteSites>>> | undefined
    if (!pending) {
      pending = searchFavoriteSites(context.http(), params).finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    const report = await pending
    await cache.put(report)
    return { ...report, fromCache: false }
  })
}
