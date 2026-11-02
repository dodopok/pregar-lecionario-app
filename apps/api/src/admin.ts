/**
 * Ferramenta de suporte: `npm run admin -- grant email@x.com 30`, `user email@x.com`, `reconcile` e
 * `doctor` (verificação de prontidão para produção; sai com código 1 se algo falhar).
 */
import { sql } from 'kysely'
import { loadConfig } from './config'
import { createDatabase } from './db'
import { LogEmailSender } from './lib/email'
import { systemClock } from './lib/context'
import type { AppDeps } from './lib/context'
import { grantDays } from './modules/admin/plugin'
import { BillingService } from './modules/billing/service'
import { QuotaService } from './modules/ai/quota'
import { formatDoctorReport, runDoctor } from './modules/admin/doctor'

const [command, ...args] = process.argv.slice(2)
const config = loadConfig()
const { db } = createDatabase({ connectionString: config.DATABASE_URL, ssl: config.DATABASE_SSL, max: 2 })
const deps: AppDeps = { config, db, clock: systemClock, fetch: globalThis.fetch, email: new LogEmailSender() }

try {
  if (command === 'grant' && args[0] && args[1]) {
    console.warn(JSON.stringify(await grantDays(deps, args[0].toLowerCase(), Number(args[1])), null, 2))
  } else if (command === 'user' && args[0]) {
    const user = await db.selectFrom('users').selectAll().where('email', '=', args[0].toLowerCase()).executeTakeFirst()
    if (!user) throw new Error('Usuário não encontrado')
    const billing = new BillingService(deps)
    const usage = await new QuotaService(deps).summary(user.id)
    // Custo real da IA (só para o suporte; o app do assinante não mostra valores em dólar).
    const recentCalls = await db
      .selectFrom('usage_events')
      .select(['created_at', 'kind', 'status', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'duration_ms'])
      .where('user_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .limit(10)
      .execute()
    const monthCost = await db
      .selectFrom('usage_events')
      .select(sql<string>`coalesce(sum(cost_usd), 0)`.as('cost'))
      .where('user_id', '=', user.id)
      .where('created_at', '>=', new Date(usage.periodStart))
      .executeTakeFirst()
    console.warn(
      JSON.stringify(
        {
          user,
          plan: await billing.planFor(user.id),
          usage,
          aiCostThisPeriodUSD: Number(monthCost?.cost ?? 0),
          recentAICalls: recentCalls.map((call) => ({ ...call, cost_usd: Number(call.cost_usd) })),
          subscription: await billing.view(await billing.latestSubscription(user.id)),
        },
        null,
        2,
      ),
    )
  } else if (command === 'doctor') {
    const checks = await runDoctor(deps)
    console.warn(formatDoctorReport(checks))
    if (checks.some((check) => check.status === 'falha')) process.exitCode = 1
  } else if (command === 'reconcile') {
    console.warn(JSON.stringify(await new BillingService(deps).reconcile(), null, 2))
  } else {
    console.warn('Uso: admin grant <email> <dias> | admin user <email> | admin reconcile | admin doctor')
    process.exitCode = 1
  }
} finally {
  await db.destroy()
}
