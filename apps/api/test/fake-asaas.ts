import type { FakeFetch } from './helpers'

/** Asaas falso com o mínimo de estado para os fluxos de assinatura. */
export class FakeAsaas {
  customers = new Map<string, { id: string; name: string; cpfCnpj: string; email: string }>()
  authorizations = new Map<string, { id: string; status: string; customerId: string; value: number; subscriptionId: string | null; contractId: string; startDate: string; frequency: string }>()
  subscriptions = new Map<string, { id: string; customer: string; value: number; cycle: string; externalReference: string; deleted: boolean }>()
  payments = new Map<string, { id: string; customer: string; subscription: string | null; value: number; status: string; dueDate: string }>()
  private counter = 0

  constructor(fake: FakeFetch) {
    const next = (prefix: string) => `${prefix}_${(this.counter += 1).toString().padStart(6, '0')}`
    fake.on('POST', /\/v3\/customers$/, (_url, body) => {
      const input = body as { name: string; cpfCnpj: string; email: string }
      const customer = { id: next('cus'), ...input }
      this.customers.set(customer.id, customer)
      return customer
    })
    fake.on('PUT', /\/v3\/customers\/[^/]+$/, (url, body) => {
      const id = url.pathname.split('/').at(-1)!
      const customer = this.customers.get(id)!
      Object.assign(customer, body)
      return customer
    })
    fake.on('POST', /\/v3\/pix\/automatic\/authorizations$/, (_url, body) => {
      const input = body as { customerId: string; value: number; contractId: string; startDate: string; frequency: string; paymentCreationMode: string }
      if (input.paymentCreationMode !== 'SUBSCRIPTION') throw new Error('modo inesperado')
      const authorization = {
        id: `auth-${(this.counter += 1)}`,
        status: 'CREATED',
        customerId: input.customerId,
        value: input.value,
        subscriptionId: null as string | null,
        contractId: input.contractId,
        startDate: input.startDate,
        frequency: input.frequency,
      }
      this.authorizations.set(authorization.id, authorization)
      return {
        ...authorization,
        payload: '00020101021226830014br.gov.bcb.pix-automatico',
        encodedImage: 'iVBORw0KGgoQRAUTOMATICO',
        immediateQrCode: { conciliationIdentifier: 'CONC', expirationDate: '2026-11-01 13:00:00' },
      }
    })
    fake.on('GET', /\/v3\/pix\/automatic\/authorizations\/[^/]+$/, (url) => this.authorizations.get(url.pathname.split('/').at(-1)!))
    fake.on('DELETE', /\/v3\/pix\/automatic\/authorizations\/[^/]+$/, (url) => {
      const authorization = this.authorizations.get(url.pathname.split('/').at(-1)!)!
      authorization.status = 'CANCELLED'
      return authorization
    })
    fake.on('POST', /\/v3\/subscriptions$/, (_url, body) => {
      const input = body as { customer: string; value: number; cycle: string; externalReference: string; nextDueDate: string; billingType: string }
      if (input.billingType !== 'PIX') throw new Error('billingType inesperado')
      const subscription = { id: next('sub'), customer: input.customer, value: input.value, cycle: input.cycle, externalReference: input.externalReference, deleted: false }
      this.subscriptions.set(subscription.id, subscription)
      const payment = { id: next('pay'), customer: input.customer, subscription: subscription.id, value: input.value, status: 'PENDING', dueDate: input.nextDueDate }
      this.payments.set(payment.id, payment)
      return subscription
    })
    fake.on('DELETE', /\/v3\/subscriptions\/[^/]+$/, (url) => {
      const subscription = this.subscriptions.get(url.pathname.split('/').at(-1)!)!
      subscription.deleted = true
      return { deleted: true, id: subscription.id }
    })
    fake.on('GET', /\/v3\/subscriptions\/[^/]+\/payments$/, (url) => {
      const id = url.pathname.split('/').at(-2)!
      return { data: [...this.payments.values()].filter((payment) => payment.subscription === id) }
    })
    fake.on('GET', /\/v3\/payments\/[^/]+\/pixQrCode$/, (url) => ({
      encodedImage: `iVBORw0KGgoQR${url.pathname.split('/').at(-2)}`,
      payload: `00020101-pix-${url.pathname.split('/').at(-2)}`,
      expirationDate: '2026-12-31 23:59:59',
    }))
    fake.on('GET', /\/v3\/payments\/[^/]+$/, (url) => this.payments.get(url.pathname.split('/').at(-1)!))
  }

  addPayment(input: { customer: string; subscription: string | null; value: number; status: string; dueDate: string }) {
    const payment = { id: `pay_extra_${(this.counter += 1)}`, ...input }
    this.payments.set(payment.id, payment)
    return payment
  }
}
