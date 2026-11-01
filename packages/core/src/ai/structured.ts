import type { MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { silentIntegrationLog } from '../log/integration'
import { loggedRequest, tryParseJSON } from '../util/http'
import type { HttpContext } from '../util/http'
import { providerErrorDetail, SermonReviewError } from './errors'
import { utf8ByteLength } from './materials'
import type { AIProvider } from './providers'
import {
  AnthropicHTTPError,
  claudeFallbackParams,
  createAnthropicClient,
  runAnthropicCall,
} from './transport'
import { combineUsage, emptyUsage, usageFromResponse } from './usage'
import type { AIUsage } from './usage'

/**
 * Pedido estruturado comum à revisão e às perguntas (`SermonAIReviewClient.makeStructuredRequest`
 * e `completedStructuredResponse`). OpenAI, Gemini e Perplexity usam `fetch` direto pelo
 * `loggedRequest`; o Claude usa o SDK oficial em modo de fluxo, com o mesmo corpo.
 */

/** Configuração de uma chamada: provedor, modelo, chave e o transporte injetado pelo chamador. */
export interface AIConfiguration {
  provider: AIProvider
  model: string
  apiKey: string
  http: HttpContext
  /** Claude: pede a troca de modelo do servidor quando o modelo recusa por política (padrão: sim). */
  serverSideFallbacks?: boolean
  /** Data usada na tabela de tarifas; padrão: agora. */
  now?: () => Date
}

export type JSONSchema = Record<string, unknown>

/** Saída do Claude: 16 mil tokens e uma única nova tentativa com 32 mil se houver `max_tokens`. */
export const CLAUDE_OUTPUT_TOKEN_BUDGETS: readonly number[] = [16_000, 32_000]

/** Prazo dos pedidos estruturados; o Claude espera até cinco minutos. */
export const STRUCTURED_TIMEOUT_MS = 150_000
export const CLAUDE_STRUCTURED_TIMEOUT_MS = 300_000

export const PROVIDER_ENDPOINTS: Record<AIProvider, string> = {
  openai: 'https://api.openai.com/v1/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  google: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  perplexity: 'https://api.perplexity.ai/v1/agent',
}

/**
 * Pedido montado, sem envio. No Claude, `headers` fica vazio (o SDK envia autenticação e versão),
 * `body` são os parâmetros do SDK e `betas` vai no cabeçalho `anthropic-beta`.
 */
export interface StructuredRequest {
  provider: AIProvider
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  timeoutMs: number
  betas?: string[]
}

export interface StructuredRequestInput {
  userText: string
  systemPrompt: string
  formatName: string
  schema: JSONSchema
  maxOutputTokens: number
  configuration: AIConfiguration
}

/** Cabeçalhos do transporte direto: a chave vai sempre em cabeçalho, nunca na URL. */
export function providerHeaders(provider: AIProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  switch (provider) {
    case 'openai':
    case 'perplexity':
      headers.Authorization = `Bearer ${apiKey}`
      break
    case 'google':
      headers['x-goog-api-key'] = apiKey
      break
    case 'anthropic':
      // O SDK do Claude monta a autenticação e a versão da API.
      return {}
  }
  return headers
}

export function makeStructuredRequest(input: StructuredRequestInput): StructuredRequest {
  const { userText, systemPrompt, formatName, schema, maxOutputTokens, configuration } = input
  const { provider, model, apiKey } = configuration
  const url = PROVIDER_ENDPOINTS[provider]
  switch (provider) {
    case 'openai':
      return {
        provider,
        url,
        headers: providerHeaders(provider, apiKey),
        timeoutMs: STRUCTURED_TIMEOUT_MS,
        body: {
          model,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userText },
          ],
          text: { format: { type: 'json_schema', name: formatName, strict: true, schema } },
          max_output_tokens: maxOutputTokens,
          store: false,
        },
      }
    case 'anthropic': {
      const fallback = claudeFallbackParams(model, configuration.serverSideFallbacks ?? true)
      const request: StructuredRequest = {
        provider,
        url,
        headers: providerHeaders(provider, apiKey),
        timeoutMs: STRUCTURED_TIMEOUT_MS,
        body: {
          model,
          max_tokens: maxOutputTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userText }],
          output_config: { format: { type: 'json_schema', schema: adaptSchemaForClaude(schema) } },
          ...(fallback.fallbacks ? { fallbacks: fallback.fallbacks } : {}),
        },
      }
      if (fallback.betas) request.betas = fallback.betas
      return request
    }
    case 'google':
      return {
        provider,
        url,
        headers: providerHeaders(provider, apiKey),
        timeoutMs: STRUCTURED_TIMEOUT_MS,
        body: {
          model,
          input: `${systemPrompt}\n\nDados de entrada (JSON):\n${userText}`,
          response_format: { type: 'text', mime_type: 'application/json', schema },
        },
      }
    case 'perplexity':
      return {
        provider,
        url,
        headers: providerHeaders(provider, apiKey),
        timeoutMs: STRUCTURED_TIMEOUT_MS,
        body: {
          model,
          input: userText,
          instructions: systemPrompt,
          response_format: { type: 'json_schema', json_schema: { name: formatName, schema } },
          tools: [],
          max_output_tokens: maxOutputTokens,
          store: false,
        },
      }
  }
}

// Esquema para o Claude

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Adapta um JSON Schema ao subconjunto aceito pelo Claude (`ClaudeStructuredOutputSchema.adapted`):
 * limites numéricos e de tamanho viram texto na descrição, `oneOf` vira `anyOf` e arrays sem
 * `items` recebem itens de texto. Só palavras-chave são tratadas; nomes de propriedades não.
 */
export function adaptSchemaForClaude(schema: JSONSchema): JSONSchema {
  const result: JSONSchema = { ...schema }
  const constraints: string[] = []
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'maxItems']) {
    if (key in result) {
      constraints.push(`${key}: ${String(result[key])}`)
      delete result[key]
    }
  }
  const minItems = result.minItems
  if (typeof minItems === 'number' && Number.isInteger(minItems) && minItems > 1) {
    delete result.minItems
    constraints.push(`minItems: ${minItems}`)
  }
  if (constraints.length > 0) {
    const description = typeof result.description === 'string' ? result.description : ''
    result.description = [description, ...constraints].filter((part) => part.length > 0).join('. ')
  }
  for (const key of ['properties', '$defs', 'definitions']) {
    const properties = result[key]
    if (isPlainObject(properties) && Object.values(properties).every(isPlainObject)) {
      result[key] = Object.fromEntries(
        Object.entries(properties).map(([name, value]) => [name, adaptSchemaForClaude(value as JSONSchema)]),
      )
    }
  }
  if (isPlainObject(result.items)) result.items = adaptSchemaForClaude(result.items)
  // O Claude aceita anyOf para uniões que outros provedores recebem como oneOf.
  if ('oneOf' in result) {
    const alternatives = result.oneOf
    delete result.oneOf
    if (Array.isArray(alternatives) && alternatives.every(isPlainObject)) result.anyOf = alternatives
  }
  for (const key of ['anyOf', 'allOf']) {
    const alternatives = result[key]
    if (Array.isArray(alternatives) && alternatives.every(isPlainObject)) {
      result[key] = alternatives.map((alternative) => adaptSchemaForClaude(alternative as JSONSchema))
    }
  }
  if (result.type === 'array' && result.items === undefined) result.items = { type: 'string' }
  return result
}

// Leitura da resposta

function asRoot(response: unknown): Record<string, unknown> | undefined {
  const value = typeof response === 'string' ? tryParseJSON(response) : response
  return isPlainObject(value) ? value : undefined
}

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : []
}

/**
 * Texto final da resposta (`SermonAIReviewClient.outputText`). Aceita o corpo como texto ou o JSON
 * já decodificado. No Claude só blocos `text` contam; pensamento e marcadores de troca de modelo
 * ficam de fora, e o texto anterior a uma troca pertence ao modelo que recusou.
 */
export function outputText(response: unknown, provider: AIProvider): string | undefined {
  const root = asRoot(response)
  if (!root) return undefined
  if (provider === 'perplexity') {
    if (!Array.isArray(root.output)) return undefined
    const strings: string[] = []
    for (const item of objects(root.output)) {
      if (item.type !== 'message' || !Array.isArray(item.content)) continue
      for (const block of objects(item.content)) {
        if (block.type === 'output_text' && typeof block.text === 'string') strings.push(block.text)
      }
    }
    return strings.length === 0 ? undefined : strings.join('')
  }
  if (typeof root.output_text === 'string') return root.output_text
  if (provider === 'anthropic' && Array.isArray(root.content)) {
    const content = objects(root.content)
    let start = 0
    content.forEach((block, index) => {
      if (block.type === 'fallback') start = index + 1
    })
    const texts = content
      .slice(start)
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
    return texts.length === 0 ? undefined : texts.join('')
  }
  if (Array.isArray(root.output)) {
    const strings: string[] = []
    for (const item of objects(root.output)) {
      if (typeof item.text === 'string') {
        strings.push(item.text)
      } else if (Array.isArray(item.content)) {
        for (const block of objects(item.content)) {
          if (typeof block.text === 'string') strings.push(block.text)
        }
      }
    }
    if (strings.length > 0) return strings.join('')
  }
  if (Array.isArray(root.candidates)) {
    const strings: string[] = []
    for (const candidate of objects(root.candidates)) {
      const content = isPlainObject(candidate.content) ? candidate.content : undefined
      for (const part of objects(content?.parts)) {
        if (typeof part.text === 'string') strings.push(part.text)
      }
    }
    return strings.join('')
  }
  return undefined
}

function prefix(value: string, length: number): string {
  return Array.from(value).slice(0, length).join('')
}

/** Diagnóstico de transporte sem manuscrito, resposta textual ou blocos de pensamento. */
export function responseDiagnostics(response: unknown, provider: AIProvider, byteLength?: number): string {
  const root = asRoot(response)
  if (!root) {
    const size = byteLength ?? (typeof response === 'string' ? utf8ByteLength(response) : 0)
    return `resposta não JSON · ${size} bytes`
  }
  const reason =
    typeof root.stop_reason === 'string'
      ? root.stop_reason
      : typeof root.status === 'string'
        ? root.status
        : 'ausente'
  const usage = isPlainObject(root.usage) ? root.usage : undefined
  const outputTokens =
    typeof usage?.output_tokens === 'number' && Number.isInteger(usage.output_tokens)
      ? String(usage.output_tokens)
      : 'ausente'
  const types = objects(root.content)
    .map((block) => block.type)
    .filter((type): type is string => typeof type === 'string')
    .join(',')
  const textBytes = utf8ByteLength(outputText(root, provider) ?? '')
  return `stop_reason=${prefix(reason, 60)} · output_tokens=${outputTokens} · blocos=${prefix(types, 120)} · texto=${textBytes} bytes`
}

/**
 * Conferência literal de citações: compara com espaços colapsados, como o app Swift, e em forma
 * NFC (o Swift compara strings por equivalência canônica).
 */
export function containsExact(needle: string, haystack: string): boolean {
  const normalized = (value: string) =>
    value
      .normalize('NFC')
      .split(/\s+/u)
      .filter((part) => part.length > 0)
      .join(' ')
  const excerpt = normalized(needle)
  return excerpt.length > 0 && normalized(haystack).includes(excerpt)
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('pt', { granularity: 'grapheme' })
    : undefined

/** Contagem de caracteres como `String.count` do Swift (grupos de grafemas). */
export function characterCount(value: string): number {
  if (!segmenter) return Array.from(value).length
  return Array.from(segmenter.segment(value)).length
}

// Envio com a regra de truncamento do Claude

export interface StructuredResponse {
  /** JSON decodificado (a mensagem final do SDK no Claude); `undefined` quando não é JSON. */
  root: unknown
  status: number
  byteLength: number
  /** Consumo somado de todas as tentativas. */
  usage: AIUsage
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const reason: unknown = signal.reason
  throw reason instanceof Error ? reason : new DOMException('A operação foi cancelada.', 'AbortError')
}

async function sendStructuredRequest(
  request: StructuredRequest,
  configuration: AIConfiguration,
  operation: string,
): Promise<StructuredResponse> {
  const { provider, model, apiKey, http } = configuration
  const date = configuration.now?.() ?? new Date()
  if (provider === 'anthropic') {
    let status = 200
    const client = createAnthropicClient(apiKey, http, {
      operation,
      onResponse: (value) => {
        status = value
      },
    })
    const params = { ...request.body, ...(request.betas ? { betas: request.betas } : {}) }
    let message: unknown
    try {
      message = await runAnthropicCall(http, request.timeoutMs, (options) =>
        client.beta.messages.stream(params as unknown as MessageCreateParamsBase, options).finalMessage(),
      )
    } catch (error) {
      if (error instanceof AnthropicHTTPError) {
        throw new SermonReviewError('provider', {
          status: error.status,
          detail: providerErrorDetail(error.body, apiKey) ?? null,
        })
      }
      throw error
    }
    return {
      root: message,
      status,
      byteLength: utf8ByteLength(JSON.stringify(message) ?? ''),
      usage: usageFromResponse(provider, message, model, date),
    }
  }
  const response = await loggedRequest(
    http,
    request.url,
    { method: 'POST', headers: request.headers, body: JSON.stringify(request.body) },
    { integration: 'IA', operation, timeoutMs: request.timeoutMs, secrets: [apiKey] },
  )
  if (!response.ok) {
    throw new SermonReviewError('provider', {
      status: response.status,
      detail: providerErrorDetail(response.text(), apiKey) ?? null,
    })
  }
  const root = tryParseJSON(response.text())
  return {
    root,
    status: response.status,
    byteLength: response.body.byteLength,
    usage: usageFromResponse(provider, root, model, date),
  }
}

/**
 * Envia o pedido e só devolve respostas concluídas. No Claude, `max_tokens` provoca uma única nova
 * tentativa com mais espaço; recusa, contexto excedido e motivos desconhecidos não são repetidos.
 * Erros lançados são `SermonReviewError`, com o consumo já cobrado em `usage`.
 */
export async function completedStructuredResponse(
  configuration: AIConfiguration,
  operation: string,
  makeRequest: (budget: number) => StructuredRequest,
  defaultOutputTokens = 4_000,
): Promise<StructuredResponse> {
  const { provider, model, http } = configuration
  const log = http.log ?? silentIntegrationLog
  const budgets = provider === 'anthropic' ? CLAUDE_OUTPUT_TOKEN_BUDGETS : [defaultOutputTokens]
  let usage = emptyUsage(provider, model)
  for (const [attempt, budget] of budgets.entries()) {
    throwIfAborted(http.signal)
    const request = makeRequest(budget)
    const response = await sendStructuredRequest(request, configuration, operation)
    usage = combineUsage(usage, response.usage)
    const root = asRoot(response.root)
    if (provider === 'anthropic' && root) {
      const reason = typeof root.stop_reason === 'string' ? root.stop_reason : undefined
      if (reason === 'max_tokens') {
        log.record({
          level: 'AVISO',
          integration: 'IA',
          operation,
          status: response.status,
          note: `${responseDiagnostics(root, provider)} · resposta interrompida · tentativa ${attempt + 1}/${budgets.length}`,
        })
        if (attempt + 1 >= budgets.length) throw new SermonReviewError('incompleteResponse', { usage })
        continue
      }
      if (reason === 'refusal') throw new SermonReviewError('refusedResponse', { usage })
      if (reason === 'model_context_window_exceeded')
        throw new SermonReviewError('contextTooLarge', { usage })
      if (reason !== undefined && reason !== 'end_turn' && reason !== 'stop_sequence') {
        throw new SermonReviewError('unreadableResponse', { usage })
      }
    }
    return { ...response, usage }
  }
  throw new SermonReviewError('incompleteResponse', { usage })
}
