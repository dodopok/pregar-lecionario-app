import { afterEach, describe, expect, it } from 'vitest'
import { bearer, createTestContext, login } from './helpers'
import type { TestContext } from './helpers'
import { FakeAsaas } from './fake-asaas'

let context: TestContext
const DAY = 24 * 60 * 60 * 1000
const CPF = '529.982.247-25'

afterEach(async () => {
  await context?.close()
})

async function webhook(payload: Record<string, unknown>, token = context.config.ASAAS_WEBHOOK_TOKEN!) {
  return context.app.inject({ method: 'POST', url: '/v1/webhooks/asaas', headers: { 'asaas-access-token': token }, payload })
}

async function account(token: string) {
  return (await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(token) })).json()
}

describe('assinatura com Pix mensal (assinatura Asaas)', () => {
  it('cria cobrança com QR, ativa no pagamento, ignora webhook repetido e renova', async () => {
    context = await createTestContext({ BILLING_PIX_MODE: 'pix_assinatura', PLAN_MONTHLY_PRICE_CENTS: '1990' })
    const asaas = new FakeAsaas(context.fake)
    const token = await login(context)

    const invalid = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: '111.111.111-11' },
    })
    expect(invalid.statusCode).toBe(400)

    const checkout = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    expect(checkout.statusCode).toBe(200)
    const subscription = checkout.json().subscription
    expect(subscription).toMatchObject({ status: 'pending', method: 'pix_assinatura', priceCents: 1990 })
    expect(subscription.pendingCharge.payload).toMatch(/^00020101-pix-pay_/)
    expect([...asaas.customers.values()][0]).toMatchObject({ name: 'Ana Pastora', cpfCnpj: '52998224725' })
    const remote = [...asaas.subscriptions.values()][0]!
    expect(remote.value).toBe(19.9)

    // Repetir o checkout logo em seguida devolve a mesma cobrança.
    const again = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    expect(again.json().subscription.id).toBe(subscription.id)
    expect(asaas.subscriptions.size).toBe(1)

    const payment = [...asaas.payments.values()][0]!
    payment.status = 'RECEIVED'
    const event = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { ...payment, paymentDate: '2026-11-01' } }
    expect((await webhook(event, 'token-errado-com-trinta-e-dois-caracteres-xx')).statusCode).toBe(401)
    expect((await webhook(event)).statusCode).toBe(200)
    expect((await webhook(event)).statusCode).toBe(200)

    const active = await account(token)
    expect(active.plan).toBe('pro')
    expect(active.subscription.status).toBe('active')
    expect(active.subscription.pendingCharge).toBeNull()
    const firstEnd = new Date(active.subscription.currentPeriodEnd)
    expect(Math.round((firstEnd.getTime() - context.clock.now().getTime()) / DAY)).toBe(30)
    expect(active.usage.limits.monthly.review).toBe(40)

    // Próxima mensalidade criada pelo Asaas: QR fica disponível no app.
    context.clock.advance(28 * DAY)
    const renewal = asaas.addPayment({ customer: payment.customer, subscription: remote.id, value: 19.9, status: 'PENDING', dueDate: '2026-12-01' })
    await webhook({ id: 'evt_2', event: 'PAYMENT_CREATED', payment: renewal })
    const withPending = await account(token)
    expect(withPending.subscription.pendingCharge.payload).toContain(renewal.id)
    expect(withPending.subscription.statusMessage).toContain('mensalidade em aberto')

    renewal.status = 'RECEIVED'
    await webhook({ id: 'evt_3', event: 'PAYMENT_RECEIVED', payment: renewal })
    const renewed = await account(token)
    expect(new Date(renewed.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(firstEnd.getTime() + 27 * DAY)
    expect(renewed.subscription.pendingCharge).toBeNull()

    const payments = await context.app.inject({ method: 'GET', url: '/v1/billing/payments', headers: bearer(token) })
    expect(payments.json().payments).toHaveLength(2)
  })

  it('cancela mantendo o acesso até o fim do período e expira depois da tolerância', async () => {
    context = await createTestContext({ BILLING_PIX_MODE: 'pix_assinatura', BILLING_GRACE_DAYS: '3' })
    const asaas = new FakeAsaas(context.fake)
    const token = await login(context)
    await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    const payment = [...asaas.payments.values()][0]!
    payment.status = 'CONFIRMED'
    await webhook({ id: 'evt_c1', event: 'PAYMENT_CONFIRMED', payment })
    const cancel = await context.app.inject({ method: 'POST', url: '/v1/billing/cancel', headers: bearer(token) })
    expect(cancel.statusCode).toBe(200)
    expect(cancel.json().subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true })
    expect([...asaas.subscriptions.values()][0]!.deleted).toBe(true)
    expect((await account(token)).plan).toBe('pro')

    context.clock.advance(32 * DAY)
    expect((await account(token)).plan).toBe('pro')
    context.clock.advance(3 * DAY)
    await context.services.billing.reconcile()
    const ended = await account(token)
    expect(ended.plan).toBe('free')
    expect(ended.subscription.status).toBe('canceled')
  })

  it('reconcilia pagamento sem webhook', async () => {
    context = await createTestContext({ BILLING_PIX_MODE: 'pix_assinatura' })
    const asaas = new FakeAsaas(context.fake)
    const token = await login(context)
    await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'yearly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    ;[...asaas.payments.values()][0]!.status = 'RECEIVED'
    context.clock.advance(10 * 60 * 1000)
    await context.services.billing.reconcile()
    const view = await account(token)
    expect(view.plan).toBe('pro')
    expect(Math.round((new Date(view.subscription.currentPeriodEnd).getTime() - context.clock.now().getTime()) / DAY)).toBeGreaterThan(360)
  })
})

describe('assinatura com Pix Automático', () => {
  it('ativa pelo pagamento inicial, vincula a assinatura gerada e estende nas cobranças seguintes', async () => {
    context = await createTestContext({ BILLING_PIX_MODE: 'pix_automatico' })
    const asaas = new FakeAsaas(context.fake)
    const token = await login(context)
    const checkout = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    const view = checkout.json().subscription
    expect(view).toMatchObject({ status: 'pending', method: 'pix_automatico' })
    expect(view.pendingCharge.payload).toContain('pix-automatico')
    const authorization = [...asaas.authorizations.values()][0]!
    expect(authorization.contractId).toHaveLength(32)
    expect(authorization.startDate).toBe('2026-12-01')

    const customer = authorization.customerId
    await webhook({ id: 'evt_a1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_init', customer, value: 19.9, status: 'RECEIVED' } })
    authorization.status = 'ACTIVE'
    authorization.subscriptionId = 'sub_auto_1'
    await webhook({ id: 'evt_a2', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization })
    const active = await account(token)
    expect(active).toMatchObject({ plan: 'pro', subscription: { status: 'active', pendingCharge: null } })
    const firstEnd = new Date(active.subscription.currentPeriodEnd).getTime()

    context.clock.advance(30 * DAY)
    await webhook({
      id: 'evt_a3',
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_rec_1', customer, subscription: 'sub_auto_1', value: 19.9, status: 'RECEIVED', dueDate: '2026-12-01' },
    })
    const renewed = await account(token)
    expect(new Date(renewed.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(firstEnd + 27 * DAY)

    await webhook({
      id: 'evt_a4',
      event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
      authorization: { ...authorization, status: 'CANCELLED', cancellationReason: 'REQUESTED_BY_PAYER_USER' },
    })
    const canceled = await account(token)
    expect(canceled.subscription.cancelAtPeriodEnd).toBe(true)
    expect(canceled.plan).toBe('pro')
  })

  it('marca recusa quando o banco não autoriza antes do pagamento', async () => {
    context = await createTestContext({ BILLING_PIX_MODE: 'pix_automatico' })
    const asaas = new FakeAsaas(context.fake)
    const token = await login(context)
    await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    const authorization = [...asaas.authorizations.values()][0]!
    await webhook({ id: 'evt_r1', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', authorization: { ...authorization, status: 'REFUSED' } })
    const refused = await account(token)
    expect(refused).toMatchObject({ plan: 'free', subscription: { status: 'refused' } })
    // Pode gerar um novo código.
    const retry = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    expect(retry.statusCode).toBe(200)
    expect(asaas.authorizations.size).toBe(2)
  })

  it('responde 503 sem chave do Asaas', async () => {
    context = await createTestContext({ ASAAS_API_KEY: '' })
    const token = await login(context)
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(token),
      payload: { cycle: 'monthly', name: 'Ana Pastora', cpfCnpj: CPF },
    })
    expect(response.statusCode).toBe(503)
  })
})
