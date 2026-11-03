import {
  AIResearchError,
  SermonAIQuestionError,
  SermonReviewError,
  generateSermonQuestions,
  reviewSermon,
  searchResearchSources,
} from '@pregar/core/ai'
import type { AIProvider, AIUsage } from '@pregar/core/ai'
import type { AppDeps } from '../../lib/context'
import { errors } from '../../lib/errors'
import type { AIRunner, AIUsage as RunnerUsage } from './runner'
import { AIRunError } from './runner'

const KEY_ENV: Record<AIProvider, keyof AppDeps['config']> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_AI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
}

function runnerUsage(usage: AIUsage | undefined): RunnerUsage | undefined {
  if (!usage) return undefined
  return {
    provider: usage.provider,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUSD: usage.costUSD,
  }
}

/** Converte as falhas do domínio em erros da API, com mensagens adequadas a quem assina (sem falar de chaves). */
function mapError(error: unknown): never {
  if (error instanceof SermonReviewError || error instanceof SermonAIQuestionError || error instanceof AIResearchError) {
    const usage = runnerUsage(error.usage)
    switch (error.kind) {
      case 'emptyManuscript':
      case 'noCriteria':
      case 'contextTooLarge':
      case 'emptyReference':
        throw new AIRunError(error.message, error.kind, 400, usage)
      case 'noKey':
      case 'invalidModel':
        throw new AIRunError('A revisão pelo servidor está temporariamente indisponível.', 'ai_unavailable', 503, usage)
      case 'refusedResponse':
        throw new AIRunError(error.message, 'refused', 422, usage)
      case 'incompleteResponse':
        throw new AIRunError(error.message, 'incomplete', 502, usage)
      case 'unreadableResponse':
        throw new AIRunError(error.message, 'unreadable', 502, usage)
      default:
        throw new AIRunError(
          'O serviço de IA não conseguiu responder agora. Tente novamente em alguns minutos.',
          'provider_error',
          502,
          usage,
        )
    }
  }
  throw error
}

/** Executor das operações de IA com as chaves do servidor, sobre o mesmo domínio que o app usa no BYOK. */
export function createAIRunner(deps: AppDeps): AIRunner {
  const { config } = deps
  function configuration(provider: AIProvider, model: string, signal: AbortSignal) {
    const apiKey = config[KEY_ENV[provider]]
    if (typeof apiKey !== 'string' || !apiKey) throw errors.unavailable('A revisão pelo servidor ainda não está configurada.')
    return {
      provider,
      model,
      apiKey,
      http: { fetch: deps.fetch, signal },
      now: () => deps.clock.now(),
    }
  }

  return {
    async review(request, signal) {
      const cfg = configuration(config.AI_REVIEW_PROVIDER, config.AI_REVIEW_MODEL, signal)
      try {
        // Data e título ficam no app: o servidor recebe só o necessário para a análise.
        const result = await reviewSermon(
          { dateKey: '', title: '', mainReference: request.mainReference, manuscript: request.manuscript, criteria: request.criteria },
          request.sources,
          cfg,
        )
        const { usage, ...rest } = result
        return { result: rest, usage: runnerUsage(usage)! }
      } catch (error) {
        mapError(error)
      }
    },
    async questions(request, signal) {
      const cfg = configuration(config.AI_REVIEW_PROVIDER, config.AI_REVIEW_MODEL, signal)
      try {
        const result = await generateSermonQuestions(
          { dateKey: '', title: '', mainReference: request.mainReference, manuscript: request.manuscript },
          request.sources,
          cfg,
        )
        const { usage, ...rest } = result
        return { result: rest, usage: runnerUsage(usage)! }
      } catch (error) {
        mapError(error)
      }
    },
    async research(request, signal) {
      const cfg = configuration(config.AI_RESEARCH_PROVIDER, config.AI_RESEARCH_MODEL, signal)
      try {
        const result = await searchResearchSources(request.reference, request.occasion ?? null, {
          ...cfg,
          ...(request.preferredAuthors !== undefined ? { priorityAuthors: request.preferredAuthors } : {}),
        })
        const { usage, ...rest } = result
        return { result: rest, usage: runnerUsage(usage)! }
      } catch (error) {
        mapError(error)
      }
    },
  }
}
