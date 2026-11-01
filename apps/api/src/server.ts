import { sql } from 'kysely'
import { loadConfig } from './config'
import { createDatabase, migrateToLatest } from './db'
import { buildApp } from './app'
import { LogEmailSender, ResendEmailSender } from './lib/email'
import { systemClock } from './lib/context'
import type { AppDeps } from './lib/context'
import { createAIRunner } from './modules/ai/core-runner'

const config = loadConfig()
const { db } = createDatabase({ connectionString: config.DATABASE_URL, ssl: config.DATABASE_SSL, max: config.DATABASE_POOL_MAX })

const deps: AppDeps = {
  config,
  db,
  clock: systemClock,
  fetch: globalThis.fetch,
  email: config.RESEND_API_KEY ? new ResendEmailSender(config.RESEND_API_KEY, config.EMAIL_FROM) : new LogEmailSender(),
}

const applied = await migrateToLatest(db)
const { app, services } = await buildApp(deps, createAIRunner(deps))
if (deps.email instanceof LogEmailSender) {
  if (config.isProduction) app.log.error('RESEND_API_KEY ausente: os códigos de login não serão enviados.')
  deps.email.log = app.log
  deps.email.revealContent = !config.isProduction
}
if (applied.length > 0) app.log.info({ applied }, 'Migrações aplicadas')

/** Executa uma tarefa periódica com trava do Postgres, para não duplicar em réplicas. */
async function withLock(id: number, task: () => Promise<unknown>): Promise<void> {
  const locked = await sql<{ locked: boolean }>`select pg_try_advisory_lock(${id}) as locked`.execute(db)
  if (!locked.rows[0]?.locked) return
  try {
    await task()
  } finally {
    await sql`select pg_advisory_unlock(${id})`.execute(db)
  }
}

const timers: NodeJS.Timeout[] = []
if (config.RECONCILE_INTERVAL_MINUTES > 0) {
  timers.push(
    setInterval(() => {
      withLock(71001, async () => {
        const result = await services.billing.reconcile()
        if (result.reprocessed || result.refreshed || result.expired) app.log.info(result, 'Reconciliação da cobrança')
      }).catch((error) => app.log.error({ err: error }, 'Falha na reconciliação'))
    }, config.RECONCILE_INTERVAL_MINUTES * 60 * 1000),
  )
}
timers.push(
  setInterval(
    () => {
      withLock(71002, async () => {
        await services.auth.purgeExpired()
        await services.estevao.purgeExpired()
      }).catch((error) => app.log.error({ err: error }, 'Falha na limpeza periódica'))
    },
    60 * 60 * 1000,
  ),
)

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Encerrando')
  for (const timer of timers) clearInterval(timer)
  await app.close()
  await db.destroy()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ port: config.PORT, host: config.HOST })
