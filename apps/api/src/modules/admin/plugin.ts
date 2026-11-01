import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { emailSchema } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { safeEqual } from '../../lib/crypto'
import { ApiError, errors } from '../../lib/errors'
import { parseInput } from '../../lib/validate'
import type { BillingService } from '../billing/service'
import type { QuotaService } from '../ai/quota'

const grantSchema = z.object({
  email: emailSchema,
  days: z.number().int().min(1).max(3660),
  note: z.string().max(200).optional(),
})

/** Rotas de suporte, protegidas por ADMIN_TOKEN. Sem token configurado, não existem. */
export function adminRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  services: { billing: BillingService; quota: QuotaService },
): void {
  const token = deps.config.ADMIN_TOKEN
  if (!token) return

  async function requireAdmin(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization ?? ''
    const received = header.replace(/^Bearer\s+/i, '')
    if (!received || !safeEqual(received, token!)) throw new ApiError(401, 'unauthorized', 'Acesso negado.')
  }

  app.post('/v1/admin/grant', { preHandler: requireAdmin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const input = parseInput(grantSchema, request.body)
    return grantDays(deps, input.email, input.days)
  })

  app.get('/v1/admin/users/:email', { preHandler: requireAdmin }, async (request) => {
    const email = parseInput(emailSchema, (request.params as { email: string }).email)
    const user = await deps.db.selectFrom('users').selectAll().where('email', '=', email).where('deleted_at', 'is', null).executeTakeFirst()
    if (!user) throw errors.notFound('Usuário')
    const subscriptions = await deps.db.selectFrom('subscriptions').selectAll().where('user_id', '=', user.id).orderBy('created_at', 'desc').execute()
    return {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at },
      plan: await services.billing.planFor(user.id),
      usage: await services.quota.summary(user.id),
      subscriptions: subscriptions.map(({ pending_pix_image: _image, ...rest }) => rest),
    }
  })
}

/** Concede dias de plano pago (cortesia, teste ou correção manual). */
export async function grantDays(deps: AppDeps, email: string, days: number): Promise<{ email: string; until: string }> {
  const now = deps.clock.now()
  let user = await deps.db.selectFrom('users').selectAll().where('email', '=', email).where('deleted_at', 'is', null).executeTakeFirst()
  if (!user) {
    user = await deps.db.insertInto('users').values({ email, created_at: now, updated_at: now }).returningAll().executeTakeFirstOrThrow()
  }
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  await deps.db
    .insertInto('subscriptions')
    .values({
      user_id: user.id,
      cycle: 'monthly',
      method: deps.config.BILLING_PIX_MODE,
      status: 'active',
      price_cents: 0,
      asaas_customer_id: user.asaas_customer_id ?? 'cortesia',
      current_period_end: until,
      cancel_at_period_end: true,
      created_at: now,
      updated_at: now,
    })
    .execute()
  return { email, until: until.toISOString() }
}
