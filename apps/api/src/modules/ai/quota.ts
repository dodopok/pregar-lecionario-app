import { sql } from 'kysely'
import type { AIOperationKind, UsageSummary } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { ApiError } from '../../lib/errors'

const INFLIGHT_STALE_MS = 6 * 60 * 1000

/** Período de cobrança do uso: mês civil no fuso de Brasília. */
export function usagePeriod(now: Date): { start: Date; end: Date; dayStart: Date } {
  const offsetMs = 3 * 60 * 60 * 1000
  const local = new Date(now.getTime() - offsetMs)
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + offsetMs)
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) + offsetMs)
  const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs)
  return { start, end, dayStart }
}

export interface UsageRecord {
  userId: string
  kind: AIOperationKind
  status: 'ok' | 'error' | 'rejected'
  provider?: string | null
  model?: string | null
  inputTokens?: number
  outputTokens?: number
  costUSD?: number
  durationMs?: number
  errorCode?: string | null
}

export class QuotaService {
  constructor(private readonly deps: AppDeps) {}

  async summary(userId: string): Promise<UsageSummary> {
    const { db, clock, config } = this.deps
    const now = clock.now()
    const { start, end, dayStart } = usagePeriod(now)
    const rows = await db
      .selectFrom('usage_events')
      .select(['kind', sql<number>`count(*)::int`.as('count')])
      .where('user_id', '=', userId)
      .where('status', '=', 'ok')
      .where('created_at', '>=', start)
      .groupBy('kind')
      .execute()
    const used: Record<AIOperationKind, number> = { review: 0, structure: 0, questions: 0, research: 0 }
    for (const row of rows) used[row.kind] = row.count
    const totals = await db
      .selectFrom('usage_events')
      .select([
        sql<string>`coalesce(sum(cost_usd), 0)`.as('cost'),
        sql<number>`count(*) filter (where created_at >= ${dayStart})::int`.as('today'),
      ])
      .where('user_id', '=', userId)
      .where('created_at', '>=', start)
      .executeTakeFirst()
    return {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      used,
      limits: config.limits,
      todayCalls: totals?.today ?? 0,
      costCapReached: Number(totals?.cost ?? 0) >= config.limits.monthlyCostCapUSD,
    }
  }

  /** Confere os limites e reserva a vaga de chamada simultânea. Devolve a função que libera a vaga. */
  async acquire(userId: string, kind: AIOperationKind): Promise<() => Promise<void>> {
    const { db, clock, config } = this.deps
    const summary = await this.summary(userId)
    const limit = config.limits.monthly[kind]
    if (summary.used[kind] >= limit) {
      throw new ApiError(
        429,
        'monthly_limit',
        `Você usou ${summary.used[kind]} de ${limit} neste mês. O limite renova no dia 1º. Enquanto isso, é possível usar suas próprias chaves.`,
        { kind, used: summary.used[kind], limit },
      )
    }
    if (summary.todayCalls >= config.limits.dailyAICalls) {
      throw new ApiError(429, 'daily_limit', 'Limite diário de chamadas de IA atingido. Tente de novo amanhã.')
    }
    if (summary.costCapReached) {
      throw new ApiError(
        429,
        'cost_cap',
        'O uso de IA deste mês chegou ao teto da assinatura. O limite renova no dia 1º.',
      )
    }
    const now = clock.now()
    await db
      .deleteFrom('ai_inflight')
      .where('user_id', '=', userId)
      .where('started_at', '<', new Date(now.getTime() - INFLIGHT_STALE_MS))
      .execute()
    const reserved = await db
      .insertInto('ai_inflight')
      .values({ user_id: userId, started_at: now })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .returning('user_id')
      .executeTakeFirst()
    if (!reserved) {
      throw new ApiError(409, 'ai_busy', 'Já há uma análise em andamento nesta conta. Aguarde ela terminar.')
    }
    return async () => {
      await db.deleteFrom('ai_inflight').where('user_id', '=', userId).execute()
    }
  }

  async record(record: UsageRecord): Promise<void> {
    await this.deps.db
      .insertInto('usage_events')
      .values({
        user_id: record.userId,
        kind: record.kind,
        status: record.status,
        provider: record.provider ?? null,
        model: record.model ?? null,
        input_tokens: record.inputTokens ?? 0,
        output_tokens: record.outputTokens ?? 0,
        cost_usd: (record.costUSD ?? 0).toFixed(6),
        duration_ms: Math.round(record.durationMs ?? 0),
        error_code: record.errorCode ?? null,
        created_at: this.deps.clock.now(),
      })
      .execute()
  }
}
