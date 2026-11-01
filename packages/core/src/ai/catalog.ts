import { z } from 'zod'
import type { HttpContext } from '../util/http'
import { AIModelCatalogError } from './errors'
import { acceptsModel } from './providers'
import type { AIModelOption } from './providers'
import { AnthropicHTTPError, createAnthropicClient, runAnthropicCall } from './transport'

/**
 * Catálogo de modelos do Claude (`AIModelCatalogClient`): pagina `/v1/models` pelo SDK, mantém
 * modelos novos, descarta duplicados, aposentados e IDs fora do formato aceito, e interrompe
 * paginações que repetem o cursor.
 */

export const CATALOG_TIMEOUT_MS = 30_000
const MAXIMUM_CURSORS = 100

const pageModelSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  lifecycle: z.string().nullish(),
})

export async function fetchClaudeModels(apiKey: string, http: HttpContext): Promise<AIModelOption[]> {
  if (!apiKey) throw new AIModelCatalogError('noKey')
  const client = createAnthropicClient(apiKey, http, { operation: 'catálogo de modelos Claude' })
  const models: AIModelOption[] = []
  const seenModels = new Set<string>()
  const cursors = new Set<string>()
  let afterID: string | undefined
  for (;;) {
    let page: { data: unknown[]; has_more: boolean; last_id: string | null }
    try {
      page = await runAnthropicCall(http, CATALOG_TIMEOUT_MS, (options) =>
        client.models.list({ limit: 1000, ...(afterID ? { after_id: afterID } : {}) }, options),
      )
    } catch (error) {
      if (error instanceof AnthropicHTTPError)
        throw new AIModelCatalogError('provider', { status: error.status })
      throw error
    }
    const data = z.array(pageModelSchema).safeParse(page.data)
    if (!data.success) throw new AIModelCatalogError('unreadableResponse')
    for (const model of data.data) {
      if (!acceptsModel('anthropic', model.id) || model.lifecycle === 'retired' || seenModels.has(model.id))
        continue
      seenModels.add(model.id)
      const option: AIModelOption = { id: model.id, displayName: model.display_name }
      if (model.lifecycle) option.lifecycle = model.lifecycle
      models.push(option)
    }
    if (!page.has_more) break
    const cursor = page.last_id
    if (!cursor || cursors.has(cursor)) throw new AIModelCatalogError('unreadableResponse')
    cursors.add(cursor)
    if (cursors.size >= MAXIMUM_CURSORS) throw new AIModelCatalogError('unreadableResponse')
    afterID = cursor
  }
  if (models.length === 0) throw new AIModelCatalogError('unreadableResponse')
  return models
}

/** Opções no formato gravado pelo app Swift (`display_name`), para o cache de preferências. */
export function encodeModelOptions(
  options: readonly AIModelOption[],
): { id: string; display_name: string; lifecycle?: string }[] {
  return options.map((option) => ({
    id: option.id,
    display_name: option.displayName,
    ...(option.lifecycle ? { lifecycle: option.lifecycle } : {}),
  }))
}

/** Lê o cache de modelos; entradas inválidas tornam o cache inteiro descartável, como no Swift. */
export function decodeModelOptions(value: unknown): AIModelOption[] | undefined {
  const parsed = z.array(pageModelSchema).safeParse(value)
  if (!parsed.success) return undefined
  return parsed.data.map((model) => ({
    id: model.id,
    displayName: model.display_name,
    ...(model.lifecycle ? { lifecycle: model.lifecycle } : {}),
  }))
}
