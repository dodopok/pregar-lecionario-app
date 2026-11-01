/**
 * Tarifas em dólares por milhão de tokens, usadas para medir o consumo das assinaturas. São
 * estimativas a partir das tabelas públicas: não incluem buscas na web, impostos ou câmbio.
 */

export interface ModelPrice {
  /** Entrada sem cache, por milhão de tokens. */
  input: number
  output: number
  /** Leitura de cache; quando ausente, cobra-se como entrada comum (estimativa conservadora). */
  cacheRead?: number
}

interface PriceRule {
  model: string
  prices: { from?: string; price: ModelPrice }[]
}

/** Datas em UTC (yyyy-MM-dd); a última regra cujo `from` já passou vale. */
const PRICE_TABLE: readonly PriceRule[] = [
  { model: 'claude-fable-5-1', prices: [{ price: { input: 10, output: 50 } }] },
  { model: 'claude-opus-5-5', prices: [{ price: { input: 4, output: 20, cacheRead: 0.2 } }] },
  { model: 'claude-opus-5', prices: [{ price: { input: 5, output: 25 } }] },
  { model: 'claude-sonnet-5-5', prices: [{ price: { input: 2, output: 10, cacheRead: 0.2 } }] },
  { model: 'claude-sonnet-5', prices: [{ price: { input: 2, output: 10 } }] },
  { model: 'claude-haiku-5-5', prices: [{ price: { input: 0.1, output: 0.5 } }] },
  { model: 'claude-haiku-4-5', prices: [{ price: { input: 1, output: 5 } }] },
  { model: 'gpt-6-sol', prices: [{ price: { input: 2, output: 10 } }] },
  {
    model: 'gemini-3.8-flash',
    prices: [
      { price: { input: 0.75, output: 3.75 } },
      { from: '2027-01-01', price: { input: 1.5, output: 7.5 } },
    ],
  },
  { model: 'perplexity/sonar', prices: [{ price: { input: 0.25, output: 2.5 } }] },
]

/** Modelo sem tarifa conhecida: valor alto, para que a cota nunca subestime o gasto. */
export const FALLBACK_MODEL_PRICE: ModelPrice = { input: 10, output: 50 }

/** Sufixos de versão datada que os provedores devolvem no modelo servido (-20261001, -2026-10-01). */
const SNAPSHOT_SUFFIX = /^-(?:\d{8}|\d{4}-\d{2}-\d{2})$/

function normalizedModel(model: string): string {
  let value = model.trim().toLowerCase()
  // O Gemini pode devolver "models/gemini-...".
  if (value.startsWith('models/')) value = value.slice('models/'.length)
  // A Agent API pode devolver o modelo sem o prefixo do provedor.
  if (value === 'sonar') value = 'perplexity/sonar'
  return value
}

function ruleFor(model: string): PriceRule | undefined {
  const value = normalizedModel(model)
  const exact = PRICE_TABLE.find((rule) => rule.model === value)
  if (exact) return exact
  return PRICE_TABLE.filter(
    (rule) => value.startsWith(rule.model) && SNAPSHOT_SUFFIX.test(value.slice(rule.model.length)),
  ).sort((left, right) => right.model.length - left.model.length)[0]
}

/** Tarifa do modelo na data indicada, ou `undefined` quando o modelo não está na tabela. */
export function modelPrice(model: string, date: Date = new Date()): ModelPrice | undefined {
  const rule = ruleFor(model)
  if (!rule) return undefined
  const day = date.toISOString().slice(0, 10)
  let current: ModelPrice | undefined
  for (const entry of rule.prices) {
    if (!entry.from || entry.from <= day) current = entry.price
  }
  return current
}

export interface TokenCounts {
  model: string
  /** Tokens de entrada sem cache (inclui escrita de cache). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
}

export interface CostEstimate {
  costUSD: number
  /** Verdadeiro quando o modelo não estava na tabela e a tarifa de reserva foi usada. */
  estimated: boolean
}

export function estimateCostUSD(tokens: TokenCounts, date: Date = new Date()): CostEstimate {
  const known = modelPrice(tokens.model, date)
  const price = known ?? FALLBACK_MODEL_PRICE
  const cacheRead = tokens.cacheReadTokens ?? 0
  const cost =
    (Math.max(0, tokens.inputTokens) * price.input +
      Math.max(0, cacheRead) * (price.cacheRead ?? price.input) +
      Math.max(0, tokens.outputTokens) * price.output) /
    1_000_000
  return { costUSD: roundUSD(cost), estimated: known === undefined }
}

/** Arredonda a frações de micro-dólar para evitar ruído de ponto flutuante nas somas. */
export function roundUSD(value: number): number {
  return Math.round(value * 1e9) / 1e9
}
