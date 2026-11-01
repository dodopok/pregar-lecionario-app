import type { FastifyInstance, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import type { AccountView, SessionView } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { ApiError, errors } from '../../lib/errors'
import { parseInput } from '../../lib/validate'
import type { AuthService } from '../auth/service'
import type { BillingService } from '../billing/service'
import type { QuotaService } from '../ai/quota'

const deleteSchema = z.object({ confirm: z.literal('APAGAR', { message: 'Digite APAGAR para confirmar.' }) })
const nameSchema = z.object({ name: z.string().trim().min(1).max(120) })

export async function accountView(
  deps: AppDeps,
  billing: BillingService,
  quota: QuotaService,
  userId: string,
): Promise<AccountView> {
  const user = await deps.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow()
  const plan = await billing.planFor(userId)
  const subscription = await billing.view(await billing.latestSubscription(userId))
  return {
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at.toISOString() },
    plan,
    subscription,
    usage: plan === 'pro' ? await quota.summary(userId) : null,
    features: {
      aiProxy: plan === 'pro',
      estevaoProxy: plan === 'pro' || deps.config.ESTEVAO_PROXY_FOR_FREE,
    },
  }
}

export function accountRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  services: { auth: AuthService; billing: BillingService; quota: QuotaService },
  requireAuth: preHandlerHookHandler,
): void {
  const { db, clock } = deps

  app.get('/v1/account', { preHandler: requireAuth }, async (request) =>
    accountView(deps, services.billing, services.quota, request.auth!.user.id),
  )

  app.patch('/v1/account', { preHandler: requireAuth }, async (request) => {
    const input = parseInput(nameSchema, request.body)
    await db.updateTable('users').set({ name: input.name, updated_at: clock.now() }).where('id', '=', request.auth!.user.id).execute()
    return accountView(deps, services.billing, services.quota, request.auth!.user.id)
  })

  app.get('/v1/account/sessions', { preHandler: requireAuth }, async (request) => {
    const auth = request.auth!
    const rows = await db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', auth.user.id)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', clock.now())
      .orderBy('last_used_at', 'desc')
      .execute()
    const sessions: SessionView[] = rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      platform: row.platform,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at.toISOString(),
      current: row.id === auth.session.id,
    }))
    return { sessions }
  })

  app.delete('/v1/account/sessions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw errors.notFound('Sessão')
    const revoked = await services.auth.revokeSession(request.auth!.user.id, id)
    if (!revoked) throw errors.notFound('Sessão')
    return reply.status(204).send()
  })

  // LGPD: cópia dos dados da conta.
  app.get('/v1/account/export', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.user.id
    const [user, sessions, subscriptions, payments, usage] = await Promise.all([
      db.selectFrom('users').select(['id', 'email', 'name', 'created_at']).where('id', '=', userId).executeTakeFirst(),
      db.selectFrom('sessions').select(['device_name', 'platform', 'created_at', 'last_used_at']).where('user_id', '=', userId).execute(),
      db
        .selectFrom('subscriptions')
        .select(['id', 'cycle', 'method', 'status', 'price_cents', 'current_period_end', 'created_at', 'canceled_at'])
        .where('user_id', '=', userId)
        .execute(),
      db.selectFrom('payments').select(['status', 'value_cents', 'due_date', 'paid_at', 'created_at']).where('user_id', '=', userId).execute(),
      db
        .selectFrom('usage_events')
        .select(['kind', 'status', 'provider', 'model', 'input_tokens', 'output_tokens', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(5000)
        .execute(),
    ])
    return reply
      .header('content-disposition', 'attachment; filename="pregar-conta.json"')
      .send({
        exportedAt: clock.now().toISOString(),
        note: 'Manuscritos, biblioteca e preferências ficam no seu computador e não estão no servidor.',
        user,
        sessions,
        subscriptions,
        payments,
        usage,
      })
  })

  // LGPD: exclusão da conta. Cancela a cobrança e remove os dados pessoais.
  app.delete('/v1/account', { preHandler: requireAuth }, async (request, reply) => {
    parseInput(deleteSchema, request.body)
    const user = request.auth!.user
    const latest = await services.billing.latestSubscription(user.id)
    if (latest && ['pending', 'active', 'past_due'].includes(latest.status) && !latest.cancel_at_period_end) {
      try {
        await services.billing.cancel(user)
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'no_subscription') throw error
      }
    }
    const now = clock.now()
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('sessions').where('user_id', '=', user.id).execute()
      await trx.deleteFrom('login_codes').where('email', '=', user.email).execute()
      await trx.deleteFrom('usage_events').where('user_id', '=', user.id).execute()
      // Pagamentos ficam por obrigação fiscal, desvinculados de email e nome.
      await trx
        .updateTable('users')
        .set({ email: `apagado+${user.id}@pregar.invalid`, name: null, deleted_at: now, updated_at: now })
        .where('id', '=', user.id)
        .execute()
    })
    return reply.status(204).send()
  })
}
