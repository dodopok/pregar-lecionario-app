import { z } from 'zod'
import { DEFAULT_PRO_LIMITS } from '@pregar/core/plans/contract'
import type { UsageLimits } from '@pregar/core/plans/contract'

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes')

const int = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** URL pública da API, usada nos links das páginas legais e no webhook. */
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default(false),
  DATABASE_POOL_MAX: int(10),
  /** Segredo de 32+ caracteres para HMAC dos códigos de login. */
  AUTH_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: int(180),
  LOGIN_CODE_TTL_MINUTES: int(10),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Pregar <nao-responda@pregar.app>'),

  ESTEVAO_API_URL: z.url().default('https://api.caminhoanglicano.com.br'),
  /** Identificador interno enviado no header X-App-Internal-Id, como no Ordo. */
  ESTEVAO_APP_INTERNAL_ID: z.string().optional(),
  /** Libera o proxy da Estêvão API também para contas sem assinatura. */
  ESTEVAO_PROXY_FOR_FREE: bool.default(false),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  AI_REVIEW_PROVIDER: z.enum(['anthropic', 'openai', 'google', 'perplexity']).default('anthropic'),
  AI_REVIEW_MODEL: z.string().default('claude-sonnet-5-5'),
  AI_RESEARCH_PROVIDER: z.enum(['anthropic', 'openai', 'google', 'perplexity']).default('perplexity'),
  AI_RESEARCH_MODEL: z.string().default('perplexity/sonar'),

  ASAAS_API_KEY: z.string().optional(),
  ASAAS_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
  /** pix_automatico exige conta PJ elegível no Asaas; pix_assinatura funciona em qualquer conta. */
  BILLING_PIX_MODE: z.enum(['pix_automatico', 'pix_assinatura']).default('pix_assinatura'),
  PLAN_MONTHLY_PRICE_CENTS: int(1990),
  PLAN_YEARLY_PRICE_CENTS: int(19900),
  /** Dias de tolerância após o vencimento antes de suspender o plano pago. */
  BILLING_GRACE_DAYS: int(5),
  RECONCILE_INTERVAL_MINUTES: int(15),

  LIMIT_REVIEWS_PER_MONTH: int(DEFAULT_PRO_LIMITS.monthly.review),
  LIMIT_STRUCTURE_PER_MONTH: int(DEFAULT_PRO_LIMITS.monthly.structure),
  LIMIT_QUESTIONS_PER_MONTH: int(DEFAULT_PRO_LIMITS.monthly.questions),
  LIMIT_RESEARCH_PER_MONTH: int(DEFAULT_PRO_LIMITS.monthly.research),
  LIMIT_AI_CALLS_PER_DAY: int(DEFAULT_PRO_LIMITS.dailyAICalls),
  LIMIT_MONTHLY_COST_USD: z.coerce.number().nonnegative().default(DEFAULT_PRO_LIMITS.monthlyCostCapUSD),
  LIMIT_ESTEVAO_PER_MINUTE: int(120),

  ADMIN_TOKEN: z.string().min(32).optional(),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  LEGAL_OPERATOR_NAME: z.string().default('Pregar'),
  LEGAL_OPERATOR_DOCUMENT: z.string().default(''),
  LEGAL_CONTACT_EMAIL: z.string().default('contato@pregar.app'),
})

export type RawConfig = z.infer<typeof schema>

export interface AppConfig extends RawConfig {
  limits: UsageLimits
  corsOrigins: string[]
  asaasBaseURL: string
  isProduction: boolean
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new Error(`Configuração inválida:\n${issues}`)
  }
  const raw = parsed.data
  if (raw.NODE_ENV === 'production') {
    const missing = (['ASAAS_API_KEY', 'ASAAS_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'ESTEVAO_APP_INTERNAL_ID'] as const).filter(
      (key) => !raw[key],
    )
    if (missing.length > 0) {
      // Não impede o boot: o serviço sobe e as rotas dependentes respondem 503 com a explicação.
      console.warn(`Variáveis ausentes em produção: ${missing.join(', ')}`)
    }
  }
  return {
    ...raw,
    limits: {
      monthly: {
        review: raw.LIMIT_REVIEWS_PER_MONTH,
        structure: raw.LIMIT_STRUCTURE_PER_MONTH,
        questions: raw.LIMIT_QUESTIONS_PER_MONTH,
        research: raw.LIMIT_RESEARCH_PER_MONTH,
      },
      dailyAICalls: raw.LIMIT_AI_CALLS_PER_DAY,
      monthlyCostCapUSD: raw.LIMIT_MONTHLY_COST_USD,
    },
    corsOrigins: raw.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    asaasBaseURL: raw.ASAAS_ENVIRONMENT === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3',
    isProduction: raw.NODE_ENV === 'production',
  }
}
