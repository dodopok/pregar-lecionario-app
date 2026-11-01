import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { AIOperationKind } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { ApiError, errors } from '../../lib/errors'
import { parseInput } from '../../lib/validate'
import type { BillingService } from '../billing/service'
import type { QuotaService } from './quota'
import type { AIRunner, AIRunResult } from './runner'
import { AIRunError } from './runner'
import { aiQuestionsRequestSchema, aiResearchRequestSchema, aiReviewRequestSchema } from './schemas'

const AI_TIMEOUT_MS = 5 * 60 * 1000 + 30_000

export function aiRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  services: { billing: BillingService; quota: QuotaService; runner: AIRunner },
  requireAuth: preHandlerHookHandler,
): void {
  async function run(
    request: FastifyRequest,
    kind: AIOperationKind,
    execute: (signal: AbortSignal) => Promise<AIRunResult>,
  ): Promise<unknown> {
    const user = request.auth!.user
    if ((await services.billing.planFor(user.id)) !== 'pro') throw errors.forbiddenPlan()
    const release = await services.quota.acquire(user.id, kind)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), AI_TIMEOUT_MS)
    // Se o app desistir (fechar a folha), a chamada ao provedor também é cancelada.
    const onClose = () => {
      if (!request.raw.complete || request.raw.destroyed) controller.abort(new Error('client_closed'))
    }
    request.raw.on('close', onClose)
    const started = Date.now()
    try {
      const outcome = await execute(controller.signal)
      await services.quota.record({
        userId: user.id,
        kind,
        status: 'ok',
        provider: outcome.usage.provider,
        model: outcome.usage.model,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        costUSD: outcome.usage.costUSD,
        durationMs: Date.now() - started,
      })
      const usage = await services.quota.summary(user.id)
      return { result: outcome.result, model: outcome.usage.model, provider: outcome.usage.provider, usage }
    } catch (error) {
      const usage = error instanceof AIRunError ? error.usage : undefined
      await services.quota.record({
        userId: user.id,
        kind,
        status: 'error',
        provider: usage?.provider,
        model: usage?.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        costUSD: usage?.costUSD,
        durationMs: Date.now() - started,
        errorCode: error instanceof AIRunError ? error.code : 'internal',
      })
      if (error instanceof AIRunError) throw new ApiError(error.statusCode, error.code, error.message)
      if (controller.signal.aborted) {
        throw new ApiError(504, 'ai_timeout', 'A análise demorou demais e foi interrompida. Tente novamente.')
      }
      throw error
    } finally {
      clearTimeout(timer)
      request.raw.off('close', onClose)
      await release()
    }
  }

  const routeConfig = { preHandler: requireAuth, bodyLimit: 600 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }

  app.post('/v1/ai/review', routeConfig, async (request) => {
    const input = parseInput(aiReviewRequestSchema, request.body)
    const structureOnly = input.criteria.length === 1 && input.criteria[0] === 'structure'
    return run(request, structureOnly ? 'structure' : 'review', (signal) => services.runner.review(input, signal))
  })

  app.post('/v1/ai/questions', routeConfig, async (request) => {
    const input = parseInput(aiQuestionsRequestSchema, request.body)
    return run(request, 'questions', (signal) => services.runner.questions(input, signal))
  })

  app.post('/v1/ai/research', routeConfig, async (request) => {
    const input = parseInput(aiResearchRequestSchema, request.body)
    return run(request, 'research', (signal) => services.runner.research(input, signal))
  })

  void deps
}
