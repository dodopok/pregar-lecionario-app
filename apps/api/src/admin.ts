/** Ferramenta de suporte: `npm run admin -- grant email@x.com 30`, `user email@x.com`, `reconcile`. */
import { loadConfig } from './config'
import { createDatabase } from './db'
import { LogEmailSender } from './lib/email'
import { systemClock } from './lib/context'
import type { AppDeps } from './lib/context'
import { grantDays } from './modules/admin/plugin'
import { BillingService } from './modules/billing/service'
import { QuotaService } from './modules/ai/quota'

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
    console.warn(
      JSON.stringify(
        {
          user,
          plan: await billing.planFor(user.id),
          usage: await new QuotaService(deps).summary(user.id),
          subscription: await billing.view(await billing.latestSubscription(user.id)),
        },
        null,
        2,
      ),
    )
  } else if (command === 'reconcile') {
    console.warn(JSON.stringify(await new BillingService(deps).reconcile(), null, 2))
  } else {
    console.warn('Uso: admin grant <email> <dias> | admin user <email> | admin reconcile')
    process.exitCode = 1
  }
} finally {
  await db.destroy()
}
