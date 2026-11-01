import { sql } from 'kysely'
import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db)

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('name', 'text')
    .addColumn('asaas_customer_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute()
  await sql`create unique index users_email_active on users (email) where deleted_at is null`.execute(db)
  await sql`create unique index users_asaas_customer on users (asaas_customer_id) where asaas_customer_id is not null`.execute(db)

  await db.schema
    .createTable('login_codes')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('code_hash', 'text', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('ip', 'text')
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('login_codes_email_created').on('login_codes').columns(['email', 'created_at']).execute()
  await db.schema.createIndex('login_codes_ip_created').on('login_codes').columns(['ip', 'created_at']).execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('device_name', 'text', (col) => col.notNull())
    .addColumn('platform', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .execute()
  await db.schema.createIndex('sessions_user').on('sessions').column('user_id').execute()

  await db.schema
    .createTable('subscriptions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('cycle', 'text', (col) => col.notNull().check(sql`cycle in ('monthly','yearly')`))
    .addColumn('method', 'text', (col) => col.notNull().check(sql`method in ('pix_automatico','pix_assinatura')`))
    .addColumn('status', 'text', (col) =>
      col.notNull().check(sql`status in ('pending','active','past_due','canceled','expired','refused')`),
    )
    .addColumn('price_cents', 'integer', (col) => col.notNull())
    .addColumn('asaas_customer_id', 'text', (col) => col.notNull())
    .addColumn('asaas_authorization_id', 'text', (col) => col.unique())
    .addColumn('asaas_subscription_id', 'text', (col) => col.unique())
    .addColumn('current_period_end', 'timestamptz')
    .addColumn('cancel_at_period_end', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('pending_pix_payload', 'text')
    .addColumn('pending_pix_image', 'text')
    .addColumn('pending_pix_expires_at', 'timestamptz')
    .addColumn('pending_payment_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('canceled_at', 'timestamptz')
    .execute()
  await db.schema.createIndex('subscriptions_user').on('subscriptions').columns(['user_id', 'created_at']).execute()

  await db.schema
    .createTable('payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('subscription_id', 'uuid', (col) => col.references('subscriptions.id').onDelete('set null'))
    .addColumn('asaas_payment_id', 'text', (col) => col.notNull().unique())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('value_cents', 'integer', (col) => col.notNull())
    .addColumn('due_date', 'text')
    .addColumn('paid_at', 'timestamptz')
    .addColumn('invoice_url', 'text')
    .addColumn('applied_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('payments_user').on('payments').columns(['user_id', 'created_at']).execute()

  await db.schema
    .createTable('webhook_events')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('event', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .execute()

  await db.schema
    .createTable('usage_events')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (col) => col.notNull().check(sql`kind in ('review','structure','questions','research')`))
    .addColumn('status', 'text', (col) => col.notNull().check(sql`status in ('ok','error','rejected')`))
    .addColumn('provider', 'text')
    .addColumn('model', 'text')
    .addColumn('input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('cost_usd', 'numeric(12, 6)', (col) => col.notNull().defaultTo(0))
    .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error_code', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await db.schema.createIndex('usage_events_user_created').on('usage_events').columns(['user_id', 'created_at']).execute()

  await db.schema
    .createTable('ai_inflight')
    .addColumn('user_id', 'uuid', (col) => col.primaryKey().references('users.id').onDelete('cascade'))
    .addColumn('started_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('estevao_cache')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('status', 'integer', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addColumn('fetched_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    'estevao_cache',
    'ai_inflight',
    'usage_events',
    'webhook_events',
    'payments',
    'subscriptions',
    'sessions',
    'login_codes',
    'users',
  ]) {
    await db.schema.dropTable(table).ifExists().execute()
  }
}
