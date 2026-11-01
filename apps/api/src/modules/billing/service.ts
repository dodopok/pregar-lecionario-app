import { sql } from 'kysely'
import type {
  BillingCycle,
  PaymentView,
  PlanId,
  PlansView,
  SubscriptionStatus,
  SubscriptionView,
} from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { ApiError, errors } from '../../lib/errors'
import type { Subscription, User } from '../../db/schema'
import type { AsaasPayment, AsaasPixAutomaticAuthorization } from './asaas'
import { AsaasClient, AsaasError, centsToReais, reaisToCents } from './asaas'

const DAY_MS = 24 * 60 * 60 * 1000
const QR_EXPIRATION_SECONDS = 4 * 60 * 60
const PENDING_REUSE_MS = 30 * 60 * 1000
const PENDING_ABANDON_MS = 2 * DAY_MS
const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'])

function addCycle(date: Date, cycle: BillingCycle): Date {
  const result = new Date(date)
  if (cycle === 'yearly') result.setUTCFullYear(result.getUTCFullYear() + 1)
  else result.setUTCMonth(result.getUTCMonth() + 1)
  return result
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Datas do Asaas ("2026-07-10 14:32:18") vêm no horário de Brasília. */
function parseAsaasDateTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(' ', 'T')}-03:00` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export class BillingService {
  constructor(private readonly deps: AppDeps) {}

  private get asaas(): AsaasClient {
    const { config } = this.deps
    if (!config.ASAAS_API_KEY) {
      throw errors.unavailable('A assinatura ainda não está disponível. Use suas próprias chaves enquanto isso.')
    }
    return new AsaasClient({
      baseURL: config.asaasBaseURL,
      apiKey: config.ASAAS_API_KEY,
      fetch: this.deps.fetch,
      log: this.deps.log,
    })
  }

  priceFor(cycle: BillingCycle): number {
    return cycle === 'yearly' ? this.deps.config.PLAN_YEARLY_PRICE_CENTS : this.deps.config.PLAN_MONTHLY_PRICE_CENTS
  }

  plans(): PlansView {
    const { config } = this.deps
    const automatic = config.BILLING_PIX_MODE === 'pix_automatico'
    return {
      method: config.BILLING_PIX_MODE,
      methodDescription: automatic
        ? 'Pix Automático: você autoriza uma vez no app do seu banco e as próximas cobranças são debitadas sozinhas. Cancele quando quiser.'
        : 'Pix mensal: a cada vencimento enviamos um novo código Pix por email e no app. Sem fidelidade.',
      offers: [
        {
          cycle: 'monthly',
          priceCents: config.PLAN_MONTHLY_PRICE_CENTS,
          label: 'Mensal',
          description: 'Revisão por IA e leituras sem configurar chaves.',
        },
        {
          cycle: 'yearly',
          priceCents: config.PLAN_YEARLY_PRICE_CENTS,
          label: 'Anual',
          description: 'O mesmo plano, com desconto pelo ano inteiro.',
        },
      ],
      limits: config.limits,
    }
  }

  // MARK: - Direitos de uso

  async planFor(userId: string): Promise<PlanId> {
    const now = this.deps.clock.now()
    const grace = this.deps.config.BILLING_GRACE_DAYS * DAY_MS
    const row = await this.deps.db
      .selectFrom('subscriptions')
      .select(sql<Date | null>`max(current_period_end)`.as('until'))
      .where('user_id', '=', userId)
      .where('status', '<>', 'refused')
      .executeTakeFirst()
    const until = row?.until ? new Date(row.until) : null
    return until && until.getTime() + grace > now.getTime() ? 'pro' : 'free'
  }

  async latestSubscription(userId: string): Promise<Subscription | undefined> {
    return this.deps.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
  }

  async view(subscription: Subscription | undefined): Promise<SubscriptionView | null> {
    if (!subscription) return null
    const now = this.deps.clock.now()
    let pending = null as SubscriptionView['pendingCharge']
    if (subscription.pending_pix_payload && subscription.pending_pix_image) {
      const expires = subscription.pending_pix_expires_at
      if (!expires || expires.getTime() > now.getTime()) {
        pending = {
          payload: subscription.pending_pix_payload,
          image: subscription.pending_pix_image,
          expiresAt: expires ? expires.toISOString() : null,
          valueCents: subscription.price_cents,
        }
      }
    }
    return {
      id: subscription.id,
      status: subscription.status,
      cycle: subscription.cycle,
      method: subscription.method,
      priceCents: subscription.price_cents,
      currentPeriodEnd: subscription.current_period_end ? subscription.current_period_end.toISOString() : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      pendingCharge: pending,
      statusMessage: this.statusMessage(subscription, pending !== null),
    }
  }

  private statusMessage(subscription: Subscription, hasPendingCharge: boolean): string {
    const end = subscription.current_period_end
    const endText = end ? end.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null
    switch (subscription.status) {
      case 'pending':
        return hasPendingCharge
          ? subscription.method === 'pix_automatico'
            ? 'Pague o Pix e autorize o débito automático no app do seu banco para ativar.'
            : 'Pague o Pix para ativar a assinatura.'
          : 'O código Pix expirou. Gere um novo para assinar.'
      case 'active':
        if (subscription.cancel_at_period_end) return endText ? `Cancelada. O acesso continua até ${endText}.` : 'Cancelada.'
        if (subscription.method === 'pix_assinatura' && hasPendingCharge) return 'Há uma mensalidade em aberto. Pague o Pix abaixo.'
        return endText ? `Ativa. Próxima renovação em ${endText}.` : 'Ativa.'
      case 'past_due':
        return 'O último pagamento não foi confirmado. O acesso continua por alguns dias enquanto aguardamos.'
      case 'canceled':
        return 'Assinatura encerrada.'
      case 'expired':
        return 'Assinatura vencida. Assine de novo para voltar a usar.'
      case 'refused':
        return 'O banco não confirmou a autorização do Pix Automático. Gere um novo código para tentar de novo.'
    }
  }

  // MARK: - Checkout

  async checkout(user: User, input: { cycle: BillingCycle; name: string; cpfCnpj: string }): Promise<SubscriptionView> {
    const { db, clock, config } = this.deps
    const now = clock.now()
    const latest = await this.latestSubscription(user.id)
    if (latest && (latest.status === 'active' || latest.status === 'past_due') && !latest.cancel_at_period_end) {
      throw new ApiError(409, 'already_subscribed', 'Sua assinatura já está ativa.')
    }
    if (
      latest &&
      latest.status === 'pending' &&
      latest.cycle === input.cycle &&
      now.getTime() - latest.created_at.getTime() < PENDING_REUSE_MS &&
      latest.pending_pix_expires_at &&
      latest.pending_pix_expires_at.getTime() > now.getTime() + 5 * 60 * 1000
    ) {
      return (await this.view(latest))!
    }
    const asaas = this.asaas
    let customerId = user.asaas_customer_id
    try {
      if (!customerId) {
        const customer = await asaas.createCustomer({
          name: input.name,
          cpfCnpj: input.cpfCnpj,
          email: user.email,
          externalReference: user.id,
        })
        customerId = customer.id
        await db
          .updateTable('users')
          .set({ asaas_customer_id: customerId, name: input.name, updated_at: now })
          .where('id', '=', user.id)
          .execute()
      } else {
        await asaas.updateCustomer(customerId, { name: input.name, cpfCnpj: input.cpfCnpj })
        if (user.name !== input.name) {
          await db.updateTable('users').set({ name: input.name, updated_at: now }).where('id', '=', user.id).execute()
        }
      }
      // Assinaturas pendentes anteriores deixam de valer.
      await db
        .updateTable('subscriptions')
        .set({ status: 'expired', pending_pix_payload: null, pending_pix_image: null, updated_at: now })
        .where('user_id', '=', user.id)
        .where('status', '=', 'pending')
        .execute()
      const price = this.priceFor(input.cycle)
      const subscription = await db
        .insertInto('subscriptions')
        .values({
          user_id: user.id,
          cycle: input.cycle,
          method: config.BILLING_PIX_MODE,
          status: 'pending',
          price_cents: price,
          asaas_customer_id: customerId,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      const description = input.cycle === 'yearly' ? 'Pregar · plano anual' : 'Pregar · plano mensal'
      if (config.BILLING_PIX_MODE === 'pix_automatico') {
        const authorization = await asaas.createPixAutomaticAuthorization({
          customerId,
          contractId: subscription.id.replace(/-/g, ''),
          frequency: input.cycle === 'yearly' ? 'ANNUALLY' : 'MONTHLY',
          startDate: isoDate(addCycle(now, input.cycle)),
          value: centsToReais(price),
          description,
          immediateQrCode: {
            expirationSeconds: QR_EXPIRATION_SECONDS,
            originalValue: centsToReais(price),
            description: `${description} · primeiro período`,
          },
        })
        const expiresAt =
          parseAsaasDateTime(authorization.immediateQrCode?.expirationDate) ??
          new Date(now.getTime() + QR_EXPIRATION_SECONDS * 1000)
        const updated = await db
          .updateTable('subscriptions')
          .set({
            asaas_authorization_id: authorization.id,
            asaas_subscription_id: authorization.subscriptionId ?? null,
            pending_pix_payload: authorization.payload ?? null,
            pending_pix_image: authorization.encodedImage ?? null,
            pending_pix_expires_at: expiresAt,
            updated_at: now,
          })
          .where('id', '=', subscription.id)
          .returningAll()
          .executeTakeFirstOrThrow()
        return (await this.view(updated))!
      }
      const remote = await asaas.createSubscription({
        customer: customerId,
        value: centsToReais(price),
        nextDueDate: isoDate(now),
        cycle: input.cycle === 'yearly' ? 'YEARLY' : 'MONTHLY',
        description,
        externalReference: subscription.id,
      })
      await db
        .updateTable('subscriptions')
        .set({ asaas_subscription_id: remote.id, updated_at: now })
        .where('id', '=', subscription.id)
        .execute()
      const payments = await asaas.listSubscriptionPayments(remote.id)
      const first = payments.data.find((payment) => !PAID_STATUSES.has(payment.status))
      if (first) await this.attachPendingCharge(subscription.id, first)
      const fresh = await db.selectFrom('subscriptions').selectAll().where('id', '=', subscription.id).executeTakeFirstOrThrow()
      return (await this.view(fresh))!
    } catch (error) {
      if (error instanceof AsaasError) {
        throw new ApiError(error.status >= 500 || error.status === 0 ? 503 : 422, 'payment_provider', error.message)
      }
      throw error
    }
  }

  private async attachPendingCharge(subscriptionId: string, payment: AsaasPayment): Promise<void> {
    const qr = await this.asaas.getPixQrCode(payment.id)
    await this.deps.db
      .updateTable('subscriptions')
      .set({
        pending_payment_id: payment.id,
        pending_pix_payload: qr.payload,
        pending_pix_image: qr.encodedImage,
        pending_pix_expires_at: parseAsaasDateTime(qr.expirationDate) ?? null,
        updated_at: this.deps.clock.now(),
      })
      .where('id', '=', subscriptionId)
      .execute()
  }

  async cancel(user: User): Promise<SubscriptionView | null> {
    const { db, clock } = this.deps
    const now = clock.now()
    const subscription = await this.latestSubscription(user.id)
    if (!subscription || ['canceled', 'expired', 'refused'].includes(subscription.status)) {
      throw new ApiError(409, 'no_subscription', 'Não há assinatura ativa para cancelar.')
    }
    try {
      if (subscription.asaas_authorization_id) {
        await this.asaas.cancelPixAutomaticAuthorization(subscription.asaas_authorization_id)
      } else if (subscription.asaas_subscription_id) {
        await this.asaas.deleteSubscription(subscription.asaas_subscription_id)
      }
    } catch (error) {
      if (!(error instanceof AsaasError) || error.status !== 404) {
        throw new ApiError(503, 'payment_provider', error instanceof Error ? error.message : 'Falha ao cancelar.')
      }
    }
    const paid = subscription.current_period_end !== null && subscription.current_period_end.getTime() > now.getTime()
    const updated = await db
      .updateTable('subscriptions')
      .set({
        status: paid ? subscription.status : 'canceled',
        cancel_at_period_end: true,
        canceled_at: now,
        pending_pix_payload: null,
        pending_pix_image: null,
        pending_payment_id: null,
        updated_at: now,
      })
      .where('id', '=', subscription.id)
      .returningAll()
      .executeTakeFirstOrThrow()
    return this.view(updated)
  }

  async payments(userId: string): Promise<PaymentView[]> {
    const rows = await this.deps.db
      .selectFrom('payments')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute()
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      valueCents: row.value_cents,
      dueDate: row.due_date,
      paidAt: row.paid_at ? row.paid_at.toISOString() : null,
      invoiceUrl: row.invoice_url,
    }))
  }

  // MARK: - Webhook

  /** Registra o evento uma vez (idempotência pelo id) e processa. Devolve falso se já processado. */
  async receiveWebhook(payload: { id?: string; event?: string } & Record<string, unknown>): Promise<boolean> {
    const { db, clock } = this.deps
    if (!payload.id || !payload.event) throw errors.badRequest('Evento sem id.')
    const inserted = await db
      .insertInto('webhook_events')
      .values({ id: payload.id, event: payload.event, payload: JSON.stringify(payload) })
      .onConflict((oc) => oc.column('id').doNothing())
      .returning('id')
      .executeTakeFirst()
    if (!inserted) {
      const existing = await db.selectFrom('webhook_events').select(['processed_at']).where('id', '=', payload.id).executeTakeFirst()
      if (existing?.processed_at) return false
    }
    try {
      await this.processEvent(payload)
      await db
        .updateTable('webhook_events')
        .set({ processed_at: clock.now(), error: null, attempts: sql`attempts + 1` })
        .where('id', '=', payload.id)
        .execute()
    } catch (error) {
      this.deps.log?.error({ err: error, event: payload.event, id: payload.id }, 'Falha ao processar webhook do Asaas')
      await db
        .updateTable('webhook_events')
        .set({ error: error instanceof Error ? error.message.slice(0, 500) : String(error), attempts: sql`attempts + 1` })
        .where('id', '=', payload.id)
        .execute()
    }
    return true
  }

  async processEvent(payload: Record<string, unknown>): Promise<void> {
    const event = String(payload.event)
    if (event.startsWith('PAYMENT_') && payload.payment) {
      await this.handlePaymentEvent(event, payload.payment as AsaasPayment)
      return
    }
    if (event.startsWith('PIX_AUTOMATIC_RECURRING_AUTHORIZATION_') && payload.authorization) {
      await this.handleAuthorization(payload.authorization as AsaasPixAutomaticAuthorization)
      return
    }
    if ((event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') && payload.subscription) {
      const remote = payload.subscription as { id: string }
      await this.markRemoteEnded({ asaasSubscriptionId: remote.id })
    }
  }

  private async findSubscriptionFor(payment: AsaasPayment): Promise<Subscription | undefined> {
    const { db } = this.deps
    if (payment.pixAutomaticAuthorizationId) {
      const byAuthorization = await db
        .selectFrom('subscriptions')
        .selectAll()
        .where('asaas_authorization_id', '=', payment.pixAutomaticAuthorizationId)
        .executeTakeFirst()
      if (byAuthorization) return byAuthorization
    }
    if (payment.subscription) {
      const bySubscription = await db
        .selectFrom('subscriptions')
        .selectAll()
        .where('asaas_subscription_id', '=', payment.subscription)
        .executeTakeFirst()
      if (bySubscription) return bySubscription
    }
    if (payment.externalReference && /^[0-9a-f-]{36}$/i.test(payment.externalReference)) {
      const byReference = await db
        .selectFrom('subscriptions')
        .selectAll()
        .where('id', '=', payment.externalReference)
        .executeTakeFirst()
      if (byReference) return byReference
    }
    // Primeira cobrança do Pix Automático: vinculada pelo cliente à assinatura mais recente.
    return db
      .selectFrom('subscriptions')
      .selectAll()
      .where('asaas_customer_id', '=', payment.customer)
      .where('status', 'in', ['pending', 'active', 'past_due'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst()
  }

  async handlePaymentEvent(event: string, payment: AsaasPayment): Promise<void> {
    const { db, clock } = this.deps
    const now = clock.now()
    const subscription = await this.findSubscriptionFor(payment)
    const userId =
      subscription?.user_id ??
      (await db.selectFrom('users').select('id').where('asaas_customer_id', '=', payment.customer).executeTakeFirst())?.id
    if (!userId) {
      this.deps.log?.warn({ payment: payment.id, customer: payment.customer }, 'Pagamento sem usuário correspondente')
      return
    }
    const paidAt =
      parseAsaasDateTime(payment.confirmedDate ?? payment.clientPaymentDate ?? payment.paymentDate) ??
      (PAID_STATUSES.has(payment.status) ? now : null)
    const stored = await db
      .insertInto('payments')
      .values({
        user_id: userId,
        subscription_id: subscription?.id ?? null,
        asaas_payment_id: payment.id,
        status: payment.status,
        value_cents: reaisToCents(payment.value),
        due_date: payment.dueDate ?? null,
        paid_at: paidAt,
        invoice_url: payment.invoiceUrl ?? null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column('asaas_payment_id').doUpdateSet({
          status: payment.status,
          value_cents: reaisToCents(payment.value),
          due_date: payment.dueDate ?? null,
          paid_at: paidAt,
          invoice_url: payment.invoiceUrl ?? null,
          subscription_id: subscription?.id ?? null,
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow()
    if (!subscription) return

    const paid = PAID_STATUSES.has(payment.status) || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED'
    if (paid && !stored.applied_at) {
      await db.transaction().execute(async (trx) => {
        const claimed = await trx
          .updateTable('payments')
          .set({ applied_at: now })
          .where('id', '=', stored.id)
          .where('applied_at', 'is', null)
          .returning('id')
          .executeTakeFirst()
        if (!claimed) return
        const latest = await trx
          .selectFrom('subscriptions')
          .select(sql<Date | null>`max(current_period_end)`.as('until'))
          .where('user_id', '=', subscription.user_id)
          .where('status', '<>', 'refused')
          .executeTakeFirst()
        const base = latest?.until && new Date(latest.until).getTime() > now.getTime() ? new Date(latest.until) : now
        const periodEnd = addCycle(base, subscription.cycle)
        const clearPending = subscription.pending_payment_id === payment.id || subscription.status === 'pending'
        await trx
          .updateTable('subscriptions')
          .set({
            status: 'active',
            current_period_end: periodEnd,
            updated_at: now,
            ...(clearPending
              ? { pending_pix_payload: null, pending_pix_image: null, pending_pix_expires_at: null, pending_payment_id: null }
              : {}),
          })
          .where('id', '=', subscription.id)
          .execute()
      })
      return
    }
    if (event === 'PAYMENT_CREATED' && subscription.method === 'pix_assinatura' && !paid) {
      // Nova mensalidade: o QR fica disponível no app até ser paga.
      try {
        await this.attachPendingCharge(subscription.id, payment)
      } catch (error) {
        this.deps.log?.warn({ err: error }, 'Não foi possível obter o QR da nova mensalidade')
      }
      return
    }
    if (event === 'PAYMENT_OVERDUE' && subscription.status === 'active') {
      await db.updateTable('subscriptions').set({ status: 'past_due', updated_at: now }).where('id', '=', subscription.id).execute()
      return
    }
    if ((event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED') && stored.applied_at) {
      await db
        .updateTable('subscriptions')
        .set({ status: 'canceled', current_period_end: now, cancel_at_period_end: true, updated_at: now })
        .where('id', '=', subscription.id)
        .execute()
    }
  }

  async handleAuthorization(authorization: AsaasPixAutomaticAuthorization): Promise<void> {
    const { db, clock } = this.deps
    const now = clock.now()
    const subscription = await db
      .selectFrom('subscriptions')
      .selectAll()
      .where('asaas_authorization_id', '=', authorization.id)
      .executeTakeFirst()
    if (!subscription) return
    switch (authorization.status) {
      case 'ACTIVE':
        await db
          .updateTable('subscriptions')
          .set({
            asaas_subscription_id: authorization.subscriptionId ?? subscription.asaas_subscription_id,
            status: subscription.current_period_end ? 'active' : subscription.status,
            updated_at: now,
          })
          .where('id', '=', subscription.id)
          .execute()
        return
      case 'REFUSED':
        await db
          .updateTable('subscriptions')
          .set({
            status: subscription.current_period_end ? 'active' : 'refused',
            cancel_at_period_end: true,
            pending_pix_payload: null,
            pending_pix_image: null,
            updated_at: now,
          })
          .where('id', '=', subscription.id)
          .execute()
        return
      case 'CANCELLED':
      case 'EXPIRED':
        await this.markRemoteEnded({ authorizationId: authorization.id })
        return
      default:
        return
    }
  }

  private async markRemoteEnded(match: { authorizationId?: string; asaasSubscriptionId?: string }): Promise<void> {
    const { db, clock } = this.deps
    const now = clock.now()
    let query = db.updateTable('subscriptions').set({
      cancel_at_period_end: true,
      canceled_at: now,
      pending_pix_payload: null,
      pending_pix_image: null,
      updated_at: now,
    })
    if (match.authorizationId) query = query.where('asaas_authorization_id', '=', match.authorizationId)
    else if (match.asaasSubscriptionId) query = query.where('asaas_subscription_id', '=', match.asaasSubscriptionId)
    else return
    await query.execute()
  }

  // MARK: - Reconciliação

  /** Recupera webhooks perdidos e atualiza estados vencidos. Seguro para rodar repetidamente. */
  async reconcile(): Promise<{ reprocessed: number; refreshed: number; expired: number }> {
    const { db, clock, config } = this.deps
    const now = clock.now()
    let reprocessed = 0
    const failed = await db
      .selectFrom('webhook_events')
      .selectAll()
      .where('processed_at', 'is', null)
      .where('attempts', '<', 10)
      .orderBy('received_at')
      .limit(50)
      .execute()
    for (const event of failed) {
      try {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload
        await this.processEvent(payload as Record<string, unknown>)
        await db
          .updateTable('webhook_events')
          .set({ processed_at: now, error: null, attempts: sql`attempts + 1` })
          .where('id', '=', event.id)
          .execute()
        reprocessed += 1
      } catch (error) {
        await db
          .updateTable('webhook_events')
          .set({ error: error instanceof Error ? error.message.slice(0, 500) : String(error), attempts: sql`attempts + 1` })
          .where('id', '=', event.id)
          .execute()
      }
    }

    let refreshed = 0
    if (config.ASAAS_API_KEY) {
      const pending = await db
        .selectFrom('subscriptions')
        .selectAll()
        .where('status', '=', 'pending')
        .where('created_at', '<', new Date(now.getTime() - 5 * 60 * 1000))
        .where('created_at', '>', new Date(now.getTime() - PENDING_ABANDON_MS))
        .limit(50)
        .execute()
      for (const subscription of pending) {
        try {
          if (subscription.asaas_authorization_id) {
            const authorization = await this.asaas.getPixAutomaticAuthorization(subscription.asaas_authorization_id)
            await this.handleAuthorization(authorization)
          } else if (subscription.pending_payment_id) {
            const payment = await this.asaas.getPayment(subscription.pending_payment_id)
            if (PAID_STATUSES.has(payment.status)) await this.handlePaymentEvent('PAYMENT_RECEIVED', payment)
          }
          refreshed += 1
        } catch (error) {
          this.deps.log?.warn({ err: error, subscription: subscription.id }, 'Reconciliação falhou')
        }
      }
      // Renovações próximas na modalidade assinatura: confere se já houve pagamento.
      const renewing = await db
        .selectFrom('subscriptions')
        .selectAll()
        .where('status', 'in', ['active', 'past_due'])
        .where('cancel_at_period_end', '=', false)
        .where('asaas_subscription_id', 'is not', null)
        .where('current_period_end', '<', new Date(now.getTime() + 2 * DAY_MS))
        .limit(50)
        .execute()
      for (const subscription of renewing) {
        try {
          const payments = await this.asaas.listSubscriptionPayments(subscription.asaas_subscription_id!)
          for (const payment of payments.data) {
            if (PAID_STATUSES.has(payment.status)) await this.handlePaymentEvent('PAYMENT_RECEIVED', payment)
          }
          refreshed += 1
        } catch (error) {
          this.deps.log?.warn({ err: error, subscription: subscription.id }, 'Reconciliação da renovação falhou')
        }
      }
    }

    const graceLimit = new Date(now.getTime() - config.BILLING_GRACE_DAYS * DAY_MS)
    const ended = await db
      .updateTable('subscriptions')
      .set((eb) => ({
        status: eb.case().when('cancel_at_period_end', '=', true).then('canceled').else('expired').end() as never,
        updated_at: now,
      }))
      .where('status', 'in', ['active', 'past_due'])
      .where('current_period_end', '<', graceLimit)
      .executeTakeFirst()
    await db
      .updateTable('subscriptions')
      .set({ status: 'past_due', updated_at: now })
      .where('status', '=', 'active')
      .where('cancel_at_period_end', '=', false)
      .where('current_period_end', '<', now)
      .execute()
    await db
      .updateTable('subscriptions')
      .set({ status: 'expired', pending_pix_payload: null, pending_pix_image: null, updated_at: now })
      .where('status', '=', 'pending')
      .where('created_at', '<', new Date(now.getTime() - PENDING_ABANDON_MS))
      .execute()
    return { reprocessed, refreshed, expired: Number(ended.numUpdatedRows) }
  }

  statusLabel(status: SubscriptionStatus): string {
    return {
      pending: 'Aguardando pagamento',
      active: 'Ativa',
      past_due: 'Pagamento pendente',
      canceled: 'Cancelada',
      expired: 'Vencida',
      refused: 'Autorização recusada',
    }[status]
  }
}
