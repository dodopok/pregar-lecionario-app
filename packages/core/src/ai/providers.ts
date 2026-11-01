/**
 * Provedores e modelos de IA. Porte de `AIProvider` e `AIModelOption` (AISettings.swift); a parte
 * de chaves e preferências da interface fica com cada aplicativo.
 */

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'perplexity'

/** Mesma ordem de `AIProvider.allCases`. */
export const AI_PROVIDERS: readonly AIProvider[] = ['openai', 'anthropic', 'google', 'perplexity']

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}

const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  perplexity: 'Perplexity',
}

const PROVIDER_MODELS: Record<AIProvider, readonly string[]> = {
  openai: ['gpt-6-sol', 'gpt-6-luna'],
  anthropic: [
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'claude-sonnet-5',
    'claude-haiku-4-5',
  ],
  google: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'],
  perplexity: ['perplexity/sonar'],
}

/** Nome exibido do provedor ("Claude", "Gemini"...). */
export function providerName(provider: AIProvider): string {
  return PROVIDER_NAMES[provider]
}

export function providerModels(provider: AIProvider): readonly string[] {
  return PROVIDER_MODELS[provider]
}

export function suggestedModel(provider: AIProvider): string {
  return PROVIDER_MODELS[provider][0] ?? ''
}

/** IDs do Claude vêm do catálogo dinâmico; o formato é conferido para não aceitar caminhos ou URLs. */
const CLAUDE_MODEL_PATTERN = /^claude-[a-z0-9][a-z0-9-]{0,119}$/

export function acceptsModel(provider: AIProvider, model: string): boolean {
  if (provider === 'anthropic') return CLAUDE_MODEL_PATTERN.test(model)
  return PROVIDER_MODELS[provider].includes(model)
}

export function modelDisplayName(provider: AIProvider, model: string): string {
  if (provider === 'perplexity' && model === 'perplexity/sonar') return 'Sonar · Agent API'
  return model
}

/** Opção de modelo; `display_name` no JSON do catálogo e no cache, como no app Swift. */
export interface AIModelOption {
  id: string
  displayName: string
  lifecycle?: string | null
}

/** Escolhas padrão do `AISettingsStore`: revisão no Claude, pesquisa no Perplexity. */
export const DEFAULT_REVIEW_PROVIDER: AIProvider = 'anthropic'
export const DEFAULT_RESEARCH_PROVIDER: AIProvider = 'perplexity'

/** Chaves de preferência usadas pelo app Swift, úteis para migrar configurações. */
export const AI_PREFERENCE_KEYS = {
  reviewProvider: 'ai.reviewProvider',
  reviewModel: 'ai.reviewModel',
  researchProvider: 'ai.researchProvider',
  researchModel: 'ai.researchModel',
  claudeModels: 'ai.models.anthropic',
} as const

export interface AIModelChoice {
  provider: AIProvider
  model: string
}

/**
 * Resolve provedor e modelo salvos como o `AISettingsStore`: provedor desconhecido volta ao padrão
 * e modelo que não pertence ao provedor volta ao modelo sugerido.
 */
export function resolveModelChoice(
  savedProvider: string | null | undefined,
  savedModel: string | null | undefined,
  fallbackProvider: AIProvider,
): AIModelChoice {
  const provider = isAIProvider(savedProvider) ? savedProvider : fallbackProvider
  const model = savedModel && acceptsModel(provider, savedModel) ? savedModel : suggestedModel(provider)
  return { provider, model }
}

export function defaultReviewChoice(
  savedProvider?: string | null,
  savedModel?: string | null,
): AIModelChoice {
  return resolveModelChoice(savedProvider, savedModel, DEFAULT_REVIEW_PROVIDER)
}

export function defaultResearchChoice(
  savedProvider?: string | null,
  savedModel?: string | null,
): AIModelChoice {
  return resolveModelChoice(savedProvider, savedModel, DEFAULT_RESEARCH_PROVIDER)
}

/** Catálogo do Claude em cache: descarta IDs inválidos e modelos aposentados. */
export function usableClaudeModels(models: readonly AIModelOption[]): AIModelOption[] {
  return models.filter((model) => acceptsModel('anthropic', model.id) && model.lifecycle !== 'retired')
}

/**
 * Opções do seletor de modelo (`AISettingsStore.modelOptions`): catálogo do Claude quando houver,
 * lista fixa nos demais, e a seleção salva acrescentada se ainda for aceita.
 */
export function modelOptions(
  provider: AIProvider,
  options: { claudeModels?: readonly AIModelOption[]; selectedModel?: string | null } = {},
): AIModelOption[] {
  const claudeModels = options.claudeModels ?? []
  const result: AIModelOption[] =
    provider === 'anthropic' && claudeModels.length > 0
      ? [...claudeModels]
      : PROVIDER_MODELS[provider].map((id) => ({ id, displayName: modelDisplayName(provider, id) }))
  const selected = options.selectedModel
  if (selected && acceptsModel(provider, selected) && !result.some((option) => option.id === selected)) {
    result.push({ id: selected, displayName: `${selected} · seleção salva` })
  }
  return result
}
