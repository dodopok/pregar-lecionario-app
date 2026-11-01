/**
 * Revisão por IA, perguntas de emergência, pesquisa de materiais e catálogo de modelos. Roda no
 * Electron (chaves do usuário) e no servidor (chaves da assinatura, com consumo medido): o
 * transporte HTTP é injetado em cada configuração e todo resultado traz `usage`.
 */
export * from './providers'
export * from './pricing'
export * from './usage'
export * from './errors'
export * from './materials'
export * from './prompts'
export {
  ANTHROPIC_BASE_URL,
  AnthropicHTTPError,
  CLAUDE_FALLBACK_BETA,
  CLAUDE_FALLBACK_MODELS,
  claudeFallbackParams,
  createAnthropicClient,
  loggingFetch,
  runAnthropicCall,
} from './transport'
export type { AnthropicCallOptions, ClaudeFallbackParams, LoggingFetchOptions } from './transport'
export * from './structured'
export * from './review'
export * from './report'
export * from './questions'
export * from './research'
export * from './catalog'
