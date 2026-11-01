import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

export interface UsersTable {
  id: Generated<string>
  email: string
  name: string | null
  asaas_customer_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  deleted_at: NullableTimestamp
}

export interface LoginCodesTable {
  id: Generated<string>
  email: string
  code_hash: string
  attempts: Generated<number>
  ip: string | null
  expires_at: Timestamp
  consumed_at: NullableTimestamp
  created_at: Generated<Date>
}

export interface SessionsTable {
  id: Generated<string>
  user_id: string
  token_hash: string
  device_name: string
  platform: string | null
  created_at: Generated<Date>
  last_used_at: Generated<Date>
  expires_at: Timestamp
  revoked_at: NullableTimestamp
}

export interface SubscriptionsTable {
  id: Generated<string>
  user_id: string
  cycle: 'monthly' | 'yearly'
  method: 'pix_automatico' | 'pix_assinatura'
  status: 'pending' | 'active' | 'past_due' | 'canceled' | 'expired' | 'refused'
  price_cents: number
  asaas_customer_id: string
  asaas_authorization_id: string | null
  asaas_subscription_id: string | null
  current_period_end: NullableTimestamp
  cancel_at_period_end: Generated<boolean>
  pending_pix_payload: string | null
  pending_pix_image: string | null
  pending_pix_expires_at: NullableTimestamp
  pending_payment_id: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
  canceled_at: NullableTimestamp
}

export interface PaymentsTable {
  id: Generated<string>
  user_id: string
  subscription_id: string | null
  asaas_payment_id: string
  status: string
  value_cents: number
  due_date: string | null
  paid_at: NullableTimestamp
  invoice_url: string | null
  /** Momento em que este pagamento estendeu o período pago; garante aplicação única. */
  applied_at: NullableTimestamp
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface WebhookEventsTable {
  id: string
  event: string
  payload: ColumnType<unknown, string, string>
  received_at: Generated<Date>
  processed_at: NullableTimestamp
  attempts: Generated<number>
  error: string | null
}

export interface UsageEventsTable {
  id: Generated<string>
  user_id: string
  kind: 'review' | 'structure' | 'questions' | 'research'
  status: 'ok' | 'error' | 'rejected'
  provider: string | null
  model: string | null
  input_tokens: Generated<number>
  output_tokens: Generated<number>
  cost_usd: ColumnType<string, number | string | undefined, number | string>
  duration_ms: Generated<number>
  error_code: string | null
  created_at: Generated<Date>
}

export interface AIInflightTable {
  user_id: string
  started_at: Generated<Date>
}

export interface EstevaoCacheTable {
  key: string
  status: number
  body: string
  fetched_at: Generated<Date>
  expires_at: Timestamp
}

export interface Database {
  users: UsersTable
  login_codes: LoginCodesTable
  sessions: SessionsTable
  subscriptions: SubscriptionsTable
  payments: PaymentsTable
  webhook_events: WebhookEventsTable
  usage_events: UsageEventsTable
  ai_inflight: AIInflightTable
  estevao_cache: EstevaoCacheTable
}

export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type Session = Selectable<SessionsTable>
export type Subscription = Selectable<SubscriptionsTable>
export type SubscriptionUpdate = Updateable<SubscriptionsTable>
export type Payment = Selectable<PaymentsTable>
