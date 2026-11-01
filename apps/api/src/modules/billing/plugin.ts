import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { checkoutSchema } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { safeEqual } from '../../lib/crypto'
import { ApiError } from '../../lib/errors'
import { parseInput } from '../../lib/validate'
import type { BillingService } from './service'

export function billingRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  billing: BillingService,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/v1/billing/plans', async () => billing.plans())

  app.get('/v1/billing/subscription', { preHandler: requireAuth }, async (request) => {
    const subscription = await billing.latestSubscription(request.auth!.user.id)
    return { subscription: await billing.view(subscription) }
  })

  app.post(
    '/v1/billing/checkout',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request) => {
      const input = parseInput(checkoutSchema, request.body)
      return { subscription: await billing.checkout(request.auth!.user, input) }
    },
  )

  app.post('/v1/billing/cancel', { preHandler: requireAuth }, async (request) => {
    return { subscription: await billing.cancel(request.auth!.user) }
  })

  app.get('/v1/billing/payments', { preHandler: requireAuth }, async (request) => {
    return { payments: await billing.payments(request.auth!.user.id) }
  })

  // Webhook do Asaas: autenticado pelo token configurado no painel (cabeçalho asaas-access-token).
  app.post('/v1/webhooks/asaas', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const expected = deps.config.ASAAS_WEBHOOK_TOKEN
    const received = request.headers['asaas-access-token']
    if (!expected || typeof received !== 'string' || !safeEqual(received, expected)) {
      throw new ApiError(401, 'invalid_webhook_token', 'Token do webhook inválido.')
    }
    const body = request.body
    if (!body || typeof body !== 'object') throw new ApiError(400, 'bad_request', 'Corpo inválido.')
    await billing.receiveWebhook(body as { id?: string; event?: string } & Record<string, unknown>)
    // Sempre 200 depois de registrado: falhas de processamento são refeitas pela reconciliação,
    // sem interromper a fila sequencial do Asaas.
    return reply.status(200).send({ received: true })
  })
}
