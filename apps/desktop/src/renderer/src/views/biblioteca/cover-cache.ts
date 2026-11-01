/**
 * Capas servidas por `pregar-asset://cover/…` são lidas com fetch (permitido pela CSP em
 * connect-src) e exibidas como blob:, com um cache limitado como no app Swift (32 capas).
 */
const MAX_COVERS = 48
const cache = new Map<string, Promise<string | null>>()

async function load(src: string): Promise<string | null> {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    return URL.createObjectURL(await response.blob())
  } catch {
    return null
  }
}

/** URL `blob:` da capa (ou `null` se não pôde ser lida). */
export function coverObjectURL(src: string): Promise<string | null> {
  const cached = cache.get(src)
  if (cached) {
    // Mais recente no fim (LRU).
    cache.delete(src)
    cache.set(src, cached)
    return cached
  }
  const promise = load(src)
  cache.set(src, promise)
  while (cache.size > MAX_COVERS) {
    const [oldest, value] = cache.entries().next().value as [string, Promise<string | null>]
    cache.delete(oldest)
    // A imagem já decodificada continua na tela depois de revogar a URL.
    void value.then((url) => url && setTimeout(() => URL.revokeObjectURL(url), 5000))
  }
  return promise
}
