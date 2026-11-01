import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import { loggedRequest, tryParseJSON } from '../util/http'
import { AIResearchError, providerErrorDetail } from './errors'
import { acceptsModel, providerName } from './providers'
import type { AIProvider } from './providers'
import { characterCount, PROVIDER_ENDPOINTS, providerHeaders } from './structured'
import type { AIConfiguration } from './structured'
import {
  AnthropicHTTPError,
  claudeFallbackParams,
  createAnthropicClient,
  runAnthropicCall,
} from './transport'
import { usageFromResponse } from './usage'
import type { AIUsage } from './usage'

/**
 * Pesquisa de materiais (`AIResearch.swift`): pede ao provedor fontes existentes sobre a passagem
 * com a ferramenta de busca de cada um, sem enviar manuscrito, e só aceita links https verificáveis
 * vindos dos resultados ou anotações da busca.
 */

/** Autores priorizados por padrão (`FavoriteAuthor.defaults`). */
export const DEFAULT_PRIORITY_AUTHORS: readonly string[] = [
  'N. T. Wright',
  'Michael Bird',
  'Scot McKnight',
  'Fleming Rutledge',
  'Andrew McGowan',
  'Richard Bauckham',
]

export interface AIResearchConfiguration extends AIConfiguration {
  /** Autores escolhidos pelo usuário; padrão: `DEFAULT_PRIORITY_AUTHORS`. */
  priorityAuthors?: readonly string[]
}

export interface AIResearchSource {
  title: string
  /** URL https absoluta. */
  url: string
  publishedDate?: string
  author?: string
  publisher?: string
  tradition?: string
  language?: string
}

export interface AIResearchReport {
  reference: string
  provider: AIProvider
  model: string
  /** Data e hora ISO 8601. */
  createdAt: string
  sources: AIResearchSource[]
}

export interface AIResearchResult {
  sources: AIResearchSource[]
  usage: AIUsage
}

/** Prazo da pesquisa (120 s) e limite de saída dos provedores que o aceitam. */
export const RESEARCH_TIMEOUT_MS = 120_000
export const RESEARCH_OUTPUT_TOKENS = 1_600
export const MAXIMUM_RESEARCH_SOURCES = 12

export function researchSourceID(source: Pick<AIResearchSource, 'url'>): string {
  return source.url
}

export function researchSourceDomain(source: Pick<AIResearchSource, 'url'>): string {
  try {
    return new URL(source.url).hostname || source.url
  } catch {
    return source.url
  }
}

/** Linha de contexto editorial; metadados ausentes nunca são inferidos. */
export function editorialContext(source: AIResearchSource): string {
  const details = [
    source.author ? `Autor: ${source.author}` : undefined,
    source.publisher ? `Instituição: ${source.publisher}` : undefined,
    source.tradition ? `Tradição: ${source.tradition}` : undefined,
    source.language ? `Idioma: ${source.language}` : undefined,
  ].filter((detail): detail is string => detail !== undefined)
  return details.length === 0 ? 'Metadados editoriais não informados pela busca' : details.join(' · ')
}

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

const storedSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  publishedDate: optionalText,
  author: optionalText,
  publisher: optionalText,
  tradition: optionalText,
  language: optionalText,
})

/** Lê uma fonte gravada; relatórios antigos sem autor, instituição, tradição ou idioma continuam válidos. */
export function decodeResearchSource(value: unknown): AIResearchSource {
  const parsed = storedSourceSchema.parse(value)
  const source: AIResearchSource = { title: parsed.title, url: parsed.url }
  if (parsed.publishedDate) source.publishedDate = parsed.publishedDate
  if (parsed.author) source.author = parsed.author
  if (parsed.publisher) source.publisher = parsed.publisher
  if (parsed.tradition) source.tradition = parsed.tradition
  if (parsed.language) source.language = parsed.language
  return source
}

/** Pedido montado sem envio; no Claude, `body` são os parâmetros do SDK e `headers` fica vazio. */
export interface ResearchRequest {
  provider: AIProvider
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  timeoutMs: number
  betas?: string[]
}

export function researchInstructions(priorityAuthors: readonly string[] = DEFAULT_PRIORITY_AUTHORS): string {
  const preferredAuthors = priorityAuthors
    .map((author) => author.trim())
    .filter((author) => author.length > 0)
    .join(', ')
  const authorInstruction = preferredAuthors
    ? `Prioritize these user-selected authors when relevant: ${preferredAuthors}. Do not invent a source or author.`
    : 'Do not invent a source or author.'
  return `Find existing web sources about the specified biblical passage. Search for biblical commentaries, exegetical articles, lectionary reflections, or sermons by serious Anglican, Catholic, and Protestant scholars and institutions. Prefer named scholars and identifiable scholarly or church publishers. ${authorInstruction} Return source links and titles only, with author, publisher, publication date, language, and self-identified tradition only when explicitly available in source metadata. Omit unknown metadata; never infer an author's denomination or tradition from a name or domain. Do not interpret the passage, summarize theology, suggest sermon ideas or applications, or draft any wording. Search only for this public passage and occasion; no sermon manuscript or personal text is provided.`
}

/** Monta o pedido de pesquisa (`AIResearchClient.makeRequest`). */
export function buildResearchRequest(
  reference: string,
  occasion: string | null | undefined,
  configuration: AIResearchConfiguration,
): ResearchRequest {
  const query = [reference, occasion]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .join(' · ')
  const instructions = researchInstructions(configuration.priorityAuthors ?? DEFAULT_PRIORITY_AUTHORS)
  const { provider, model, apiKey } = configuration
  const base = {
    provider,
    url: PROVIDER_ENDPOINTS[provider],
    headers: providerHeaders(provider, apiKey),
    timeoutMs: RESEARCH_TIMEOUT_MS,
  }
  switch (provider) {
    case 'openai':
      return {
        ...base,
        body: {
          model,
          input: `${instructions}\n\nPassagem e ocasião: ${query}`,
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          include: ['web_search_call.action.sources'],
          max_output_tokens: RESEARCH_OUTPUT_TOKENS,
          store: false,
        },
      }
    case 'anthropic': {
      const fallback = claudeFallbackParams(model, configuration.serverSideFallbacks ?? true)
      const request: ResearchRequest = {
        ...base,
        body: {
          model,
          max_tokens: RESEARCH_OUTPUT_TOKENS,
          system: instructions,
          messages: [{ role: 'user', content: `Pesquise fontes para: ${query}` }],
          tools: [
            { type: 'web_search_20250305', name: 'web_search', max_uses: 2, allowed_callers: ['direct'] },
          ],
          ...(fallback.fallbacks ? { fallbacks: fallback.fallbacks } : {}),
        },
      }
      if (fallback.betas) request.betas = fallback.betas
      return request
    }
    case 'google':
      return {
        ...base,
        body: {
          model,
          input: `${instructions}\n\nPassagem e ocasião: ${query}`,
          tools: [{ type: 'google_search' }],
          store: false,
        },
      }
    case 'perplexity':
      return {
        ...base,
        body: {
          model,
          input: `Pesquise fontes bíblicas sobre: ${query}. Retorne resultados com título e link, sem resumo ou interpretação.`,
          instructions,
          tools: [{ type: 'web_search' }],
          max_output_tokens: RESEARCH_OUTPUT_TOKENS,
          store: false,
        },
      }
  }
}

/** Pesquisa fontes para a passagem e a ocasião; lança `AIResearchError` sem fontes verificáveis. */
export async function searchResearchSources(
  reference: string,
  occasion: string | null | undefined,
  configuration: AIResearchConfiguration,
): Promise<AIResearchResult> {
  if (!reference.trim()) throw new AIResearchError('emptyReference')
  if (!acceptsModel(configuration.provider, configuration.model)) throw new AIResearchError('invalidModel')
  if (!configuration.apiKey) throw new AIResearchError('noKey')

  const { provider, model, apiKey, http } = configuration
  const request = buildResearchRequest(reference, occasion, configuration)
  const operation = `pesquisa de materiais · ${providerName(provider)} · ${model}`
  const date = configuration.now?.() ?? new Date()
  let root: unknown
  if (provider === 'anthropic') {
    const client = createAnthropicClient(apiKey, http, { operation })
    const params = { ...request.body, ...(request.betas ? { betas: request.betas } : {}) }
    try {
      root = await runAnthropicCall(http, request.timeoutMs, (options) =>
        client.beta.messages.create(params as unknown as MessageCreateParamsNonStreaming, options),
      )
    } catch (error) {
      if (error instanceof AnthropicHTTPError) {
        throw new AIResearchError('provider', {
          status: error.status,
          detail: providerErrorDetail(error.body, apiKey) ?? null,
        })
      }
      throw error
    }
  } else {
    const response = await loggedRequest(
      http,
      request.url,
      { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) },
      { integration: 'IA', operation, timeoutMs: request.timeoutMs, secrets: [apiKey] },
    )
    if (!response.ok) {
      throw new AIResearchError('provider', {
        status: response.status,
        detail: providerErrorDetail(response.text(), apiKey) ?? null,
      })
    }
    root = tryParseJSON(response.text())
  }
  const usage = usageFromResponse(provider, root, model, date)
  const sources = researchSourcesFromResponse(root, provider)
  if (sources.length === 0) throw new AIResearchError('unreadableResponse', { usage })
  return { sources, usage }
}

type JSONObject = Record<string, unknown>

function isObject(value: unknown): value is JSONObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Como `as? [[String: Any]]` do Swift: só aceita listas em que todos os itens são objetos. */
function objectList(value: unknown): JSONObject[] {
  return Array.isArray(value) && value.every(isObject) ? value : []
}

/** Extrai fontes dos resultados e anotações de busca de cada provedor (`AIResearchClient.sources`). */
export function researchSourcesFromResponse(response: unknown, provider: AIProvider): AIResearchSource[] {
  const root = typeof response === 'string' ? tryParseJSON(response) : response
  if (!isObject(root)) return []
  const candidates: JSONObject[] = []
  switch (provider) {
    case 'openai':
      for (const item of objectList(root.output)) {
        if (isObject(item.action)) candidates.push(...objectList(item.action.sources))
        if (Array.isArray(item.results)) candidates.push(...objectList(item.results))
        for (const block of objectList(item.content)) candidates.push(...objectList(block.annotations))
      }
      break
    case 'anthropic':
      for (const block of objectList(root.content)) {
        candidates.push(...objectList(block.content))
        candidates.push(...objectList(block.citations))
      }
      break
    case 'google':
      for (const step of objectList(root.steps)) {
        for (const block of objectList(step.content)) candidates.push(...objectList(block.annotations))
      }
      break
    case 'perplexity': {
      const output = objectList(root.output)
      for (const item of output) {
        if (item.type === 'search_results') candidates.push(...objectList(item.results))
      }
      for (const item of output) {
        for (const block of objectList(item.content)) candidates.push(...objectList(block.annotations))
      }
      break
    }
  }

  const seen = new Set<string>()
  const sources: AIResearchSource[] = []
  for (const candidate of candidates) {
    const url = verifiedURL(candidate.url)
    if (!url || seen.has(url.href)) continue
    seen.add(url.href)
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const source: AIResearchSource = { title: title || url.hostname, url: url.href }
    const publishedDate = metadataText(candidate, ['date', 'published_date', 'page_age'])
    const author = metadataText(candidate, ['author', 'authors', 'byline', 'creator'])
    const publisher = metadataText(candidate, ['publisher', 'site_name', 'organization'])
    const tradition = metadataText(candidate, ['tradition', 'denomination', 'church_tradition'])
    const language = metadataText(candidate, ['language', 'lang'])
    if (publishedDate) source.publishedDate = publishedDate
    if (author) source.author = author
    if (publisher) source.publisher = publisher
    if (tradition) source.tradition = tradition
    if (language) source.language = language
    sources.push(source)
    if (sources.length >= MAXIMUM_RESEARCH_SOURCES) break
  }
  return sources
}

/** Somente https, com host público (com ponto) e sem usuário ou senha; http não é promovido. */
function verifiedURL(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  if (!url.hostname.includes('.')) return undefined
  if (url.username || url.password) return undefined
  return url
}

const NEWLINES = /[\n\v\f\r\u0085\u2028\u2029]/

function metadataText(candidate: JSONObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = candidate[key]
    if (value === undefined || value === null) continue
    let text: string | undefined
    if (typeof value === 'string') {
      text = value
    } else if (Array.isArray(value)) {
      text = value
        .map((item) => {
          if (typeof item === 'string') return item
          if (isObject(item) && typeof item.name === 'string') return item.name
          return undefined
        })
        .filter((item): item is string => item !== undefined)
        .join(', ')
    } else if (isObject(value)) {
      text =
        typeof value.name === 'string'
          ? value.name
          : typeof value.label === 'string'
            ? value.label
            : undefined
    }
    const normalized = text?.split(NEWLINES).join(' ').trim()
    if (normalized && characterCount(normalized) <= 180) return normalized
  }
  return undefined
}
