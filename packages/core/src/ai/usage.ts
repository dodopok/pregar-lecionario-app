import { estimateCostUSD, roundUSD } from './pricing'
import type { AIProvider } from './providers'

/**
 * Consumo de uma operação de IA, para medir cotas da assinatura e registrar custos. `inputTokens`
 * conta a entrada sem cache (inclusive escrita de cache); leituras de cache ficam separadas.
 */
export interface AIUsage {
  provider: AIProvider
  /** Modelo que efetivamente atendeu (o de reserva, quando o Claude troca de modelo). */
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  costUSD: number
  /** Verdadeiro quando o modelo não tinha tarifa conhecida ou o provedor não informou o consumo. */
  estimated?: boolean
  /** Requisições cobradas; a nova tentativa do Claude por limite de saída conta duas. */
  requests: number
}

export function emptyUsage(provider: AIProvider, model: string): AIUsage {
  return { provider, model, inputTokens: 0, outputTokens: 0, costUSD: 0, requests: 0 }
}

/** Soma o consumo de várias requisições da mesma operação; o modelo é o da última. */
export function combineUsage(first: AIUsage, second: AIUsage): AIUsage {
  const cacheRead = (first.cacheReadTokens ?? 0) + (second.cacheReadTokens ?? 0)
  const combined: AIUsage = {
    provider: second.provider,
    model: second.requests > 0 ? second.model : first.model,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    costUSD: roundUSD(first.costUSD + second.costUSD),
    requests: first.requests + second.requests,
  }
  if (cacheRead > 0 || first.cacheReadTokens !== undefined || second.cacheReadTokens !== undefined) {
    combined.cacheReadTokens = cacheRead
  }
  if (first.estimated || second.estimated) combined.estimated = true
  return combined
}

type JSONObject = Record<string, unknown>

function object(value: unknown): JSONObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function firstCount(source: JSONObject | undefined, keys: string[]): number | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = count(source[key])
    if (value !== undefined) return value
  }
  return undefined
}

function servedModel(root: JSONObject | undefined, keys: string[], requestedModel: string): string {
  for (const key of keys) {
    const value = root?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return requestedModel
}

interface Counted {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

function priced(
  provider: AIProvider,
  parts: Counted[],
  model: string,
  date: Date,
  missing: boolean,
): AIUsage {
  let cost = 0
  let estimated = missing
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  for (const part of parts) {
    const estimate = estimateCostUSD(part, date)
    cost += estimate.costUSD
    estimated ||= estimate.estimated
    totals.inputTokens += part.inputTokens
    totals.outputTokens += part.outputTokens
    totals.cacheReadTokens += part.cacheReadTokens
  }
  const usage: AIUsage = {
    provider,
    model,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUSD: roundUSD(cost),
    requests: 1,
  }
  if (totals.cacheReadTokens > 0) usage.cacheReadTokens = totals.cacheReadTokens
  if (estimated) usage.estimated = true
  return usage
}

/** Responses API da OpenAI e Agent API da Perplexity: `input_tokens` já inclui os tokens em cache. */
function responsesUsage(
  provider: AIProvider,
  root: JSONObject | undefined,
  requestedModel: string,
  date: Date,
): AIUsage {
  const usage = object(root?.usage)
  const model = servedModel(root, ['model'], requestedModel)
  const input = firstCount(usage, ['input_tokens', 'prompt_tokens'])
  const output = firstCount(usage, ['output_tokens', 'completion_tokens'])
  const cached =
    firstCount(object(usage?.input_tokens_details), ['cached_tokens']) ??
    firstCount(object(usage?.prompt_tokens_details), ['cached_tokens']) ??
    0
  const total = input ?? 0
  return priced(
    provider,
    [
      {
        model,
        inputTokens: Math.max(0, total - cached),
        outputTokens: output ?? 0,
        cacheReadTokens: Math.min(cached, total),
      },
    ],
    model,
    date,
    input === undefined && output === undefined,
  )
}

/**
 * Gemini: aceita o formato da Interactions API (`usage.total_*`) e o do generateContent
 * (`usageMetadata`). Tokens de raciocínio são somados à saída, como o Google cobra.
 */
function googleUsage(root: JSONObject | undefined, requestedModel: string, date: Date): AIUsage {
  const usage = object(root?.usage) ?? object(root?.usageMetadata) ?? object(root?.usage_metadata)
  const model = servedModel(root, ['model', 'modelVersion', 'model_version'], requestedModel)
  const input = firstCount(usage, [
    'total_input_tokens',
    'input_tokens',
    'promptTokenCount',
    'prompt_token_count',
  ])
  const cached =
    firstCount(usage, [
      'total_cached_tokens',
      'cached_tokens',
      'cachedContentTokenCount',
      'cached_content_token_count',
    ]) ?? 0
  const output = firstCount(usage, [
    'total_output_tokens',
    'output_tokens',
    'candidatesTokenCount',
    'candidates_token_count',
  ])
  const thoughts =
    firstCount(usage, ['total_thought_tokens', 'thoughtsTokenCount', 'thoughts_token_count']) ?? 0
  const total = input ?? 0
  return priced(
    'google',
    [
      {
        model,
        inputTokens: Math.max(0, total - cached),
        outputTokens: (output ?? 0) + thoughts,
        cacheReadTokens: Math.min(cached, total),
      },
    ],
    model,
    date,
    input === undefined && output === undefined,
  )
}

/**
 * Claude: `input_tokens` não inclui cache. Quando o servidor troca de modelo por recusa, cada
 * iteração (a recusada e a de reserva) é cobrada pela tarifa do próprio modelo.
 */
function anthropicUsage(root: JSONObject | undefined, requestedModel: string, date: Date): AIUsage {
  const usage = object(root?.usage)
  const model = servedModel(root, ['model'], requestedModel)
  const iterations = Array.isArray(usage?.iterations) ? usage.iterations.map(object) : []
  if (iterations.some((entry) => entry?.type === 'fallback_message')) {
    const parts: Counted[] = []
    for (const entry of iterations) {
      if (!entry || (entry.type !== 'message' && entry.type !== 'fallback_message')) continue
      const entryModel = typeof entry.model === 'string' && entry.model ? entry.model : requestedModel
      parts.push({
        model: entryModel,
        inputTokens: (count(entry.input_tokens) ?? 0) + (count(entry.cache_creation_input_tokens) ?? 0),
        outputTokens: count(entry.output_tokens) ?? 0,
        cacheReadTokens: count(entry.cache_read_input_tokens) ?? 0,
      })
    }
    return priced('anthropic', parts, model, date, false)
  }
  const input = count(usage?.input_tokens)
  const output = count(usage?.output_tokens)
  return priced(
    'anthropic',
    [
      {
        model,
        inputTokens: (input ?? 0) + (count(usage?.cache_creation_input_tokens) ?? 0),
        outputTokens: output ?? 0,
        cacheReadTokens: count(usage?.cache_read_input_tokens) ?? 0,
      },
    ],
    model,
    date,
    input === undefined && output === undefined,
  )
}

/**
 * Lê o consumo informado na resposta de cada provedor (JSON já decodificado, ou a mensagem final do
 * SDK no Claude). Sem campos de consumo, devolve zero tokens marcado como estimado.
 */
export function usageFromResponse(
  provider: AIProvider,
  response: unknown,
  requestedModel: string,
  date: Date = new Date(),
): AIUsage {
  const root = object(response)
  switch (provider) {
    case 'openai':
    case 'perplexity':
      return responsesUsage(provider, root, requestedModel, date)
    case 'google':
      return googleUsage(root, requestedModel, date)
    case 'anthropic':
      return anthropicUsage(root, requestedModel, date)
  }
}
