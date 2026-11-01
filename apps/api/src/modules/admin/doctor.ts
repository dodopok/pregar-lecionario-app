import Anthropic from '@anthropic-ai/sdk'
import { sql } from 'kysely'
import type { AppDeps } from '../../lib/context'

/**
 * Verificação de prontidão (`admin doctor`): confere, com chamadas reais e sem custo, tudo o que
 * a API precisa em produção: banco, email, Asaas (chave, chave Pix, webhook e Pix Automático),
 * Estêvão e os provedores de IA. Nenhum segredo aparece no relatório.
 */

export type CheckStatus = 'ok' | 'aviso' | 'falha' | 'ignorado'

export interface DoctorCheck {
  area: string
  status: CheckStatus
  detail: string
}

const TIMEOUT_MS = 15_000

interface JsonResponse {
  status: number
  body: unknown
}

async function getJSON(deps: AppDeps, url: string, headers: Record<string, string>): Promise<JsonResponse> {
  const response = await deps.fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text.slice(0, 200)
  }
  return { status: response.status, body }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'sem resposta em 15 s' : error.message
  return String(error)
}

async function safely(area: string, run: () => Promise<DoctorCheck | DoctorCheck[]>): Promise<DoctorCheck[]> {
  try {
    const result = await run()
    return Array.isArray(result) ? result : [result]
  } catch (error) {
    return [{ area, status: 'falha', detail: describeError(error) }]
  }
}

function emailDomain(from: string): string | null {
  const match = /@([^>\s]+)>?\s*$/.exec(from)
  return match ? match[1]!.toLowerCase() : null
}

/** Eventos do webhook do Asaas que a cobrança usa, por modo. */
export function requiredWebhookEvents(mode: 'pix_automatico' | 'pix_assinatura'): string[] {
  const common = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED']
  return mode === 'pix_automatico'
    ? [...common, 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED']
    : [...common, 'PAYMENT_CREATED', 'SUBSCRIPTION_DELETED']
}

function configChecks(deps: AppDeps): DoctorCheck[] {
  const { config } = deps
  const checks: DoctorCheck[] = []
  checks.push(
    config.isProduction
      ? { area: 'Configuração', status: 'ok', detail: 'NODE_ENV=production' }
      : { area: 'Configuração', status: 'aviso', detail: `NODE_ENV=${config.NODE_ENV}: use production na Railway` },
  )
  checks.push(
    config.PUBLIC_BASE_URL.startsWith('https://')
      ? { area: 'Endereço público', status: 'ok', detail: config.PUBLIC_BASE_URL }
      : { area: 'Endereço público', status: config.isProduction ? 'falha' : 'aviso', detail: `${config.PUBLIC_BASE_URL} não usa https` },
  )
  checks.push(
    config.TRUST_PROXY
      ? { area: 'Proxy reverso', status: 'ok', detail: 'TRUST_PROXY ligado (IP real nos limites por IP)' }
      : { area: 'Proxy reverso', status: 'aviso', detail: 'TRUST_PROXY desligado: atrás da Railway todos os pedidos parecem vir do mesmo IP' },
  )
  return checks
}

async function databaseChecks(deps: AppDeps): Promise<DoctorCheck[]> {
  return safely('Banco de dados', async () => {
    await sql`select 1`.execute(deps.db)
    const tables = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(deps.db).catch(() => ({ rows: [] }))
    return tables.rows.length > 0
      ? { area: 'Banco de dados', status: 'ok', detail: `conectado; migrações aplicadas: ${tables.rows.map((row) => row.name).join(', ')}` }
      : { area: 'Banco de dados', status: 'falha', detail: 'conectado, mas sem migrações aplicadas (o servidor as aplica ao iniciar)' }
  })
}

async function emailChecks(deps: AppDeps): Promise<DoctorCheck[]> {
  const { config } = deps
  if (!config.RESEND_API_KEY) return [{ area: 'Email (Resend)', status: 'falha', detail: 'RESEND_API_KEY ausente: os códigos de login não serão enviados' }]
  const domain = emailDomain(config.EMAIL_FROM)
  return safely('Email (Resend)', async () => {
    const response = await getJSON(deps, 'https://api.resend.com/domains', { Authorization: `Bearer ${config.RESEND_API_KEY}` })
    if (response.status === 401 || response.status === 403) {
      const restricted = JSON.stringify(response.body).includes('restricted')
      return restricted
        ? { area: 'Email (Resend)', status: 'aviso', detail: `chave só de envio: confira no painel da Resend que ${domain ?? 'o domínio do remetente'} está verificado` }
        : { area: 'Email (Resend)', status: 'falha', detail: 'a Resend recusou a chave' }
    }
    if (response.status !== 200) return { area: 'Email (Resend)', status: 'falha', detail: `a Resend respondeu HTTP ${response.status}` }
    const domains = ((response.body as { data?: { name?: string; status?: string }[] })?.data ?? []).map((item) => ({ name: (item.name ?? '').toLowerCase(), status: item.status ?? '' }))
    const match = domains.find((item) => item.name === domain)
    if (!match) return { area: 'Email (Resend)', status: 'falha', detail: `o domínio ${domain ?? '(sem domínio em EMAIL_FROM)'} não está cadastrado na Resend` }
    return match.status === 'verified'
      ? { area: 'Email (Resend)', status: 'ok', detail: `${domain} verificado` }
      : { area: 'Email (Resend)', status: 'falha', detail: `${domain} ainda não verificado (status ${match.status})` }
  })
}

async function asaasChecks(deps: AppDeps): Promise<DoctorCheck[]> {
  const { config } = deps
  if (!config.ASAAS_API_KEY) return [{ area: 'Asaas', status: 'falha', detail: 'ASAAS_API_KEY ausente: o checkout responde que a assinatura não está disponível' }]
  const headers = { access_token: config.ASAAS_API_KEY, 'User-Agent': 'pregar-api' }
  const base = config.asaasBaseURL
  const checks: DoctorCheck[] = []

  const keyLooksProduction = config.ASAAS_API_KEY.startsWith('$aact_prod_')
  const keyLooksSandbox = config.ASAAS_API_KEY.startsWith('$aact_hmlg_')
  if ((config.ASAAS_ENVIRONMENT === 'production' && keyLooksSandbox) || (config.ASAAS_ENVIRONMENT === 'sandbox' && keyLooksProduction)) {
    checks.push({ area: 'Asaas', status: 'falha', detail: `ASAAS_ENVIRONMENT=${config.ASAAS_ENVIRONMENT}, mas a chave é do outro ambiente` })
  }

  checks.push(
    ...(await safely('Asaas', async () => {
      const balance = await getJSON(deps, `${base}/finance/balance`, headers)
      if (balance.status === 401) return { area: 'Asaas', status: 'falha', detail: 'o Asaas recusou a chave' }
      if (balance.status !== 200) return { area: 'Asaas', status: 'falha', detail: `o Asaas respondeu HTTP ${balance.status}` }
      return { area: 'Asaas', status: config.ASAAS_ENVIRONMENT === 'production' ? 'ok' : 'aviso', detail: `chave aceita (${config.ASAAS_ENVIRONMENT})` }
    })),
  )

  checks.push(
    ...(await safely('Asaas · chave Pix', async () => {
      const keys = await getJSON(deps, `${base}/pix/addressKeys?status=ACTIVE&limit=10`, headers)
      if (keys.status !== 200) return { area: 'Asaas · chave Pix', status: 'falha', detail: `não foi possível listar as chaves Pix (HTTP ${keys.status})` }
      const count = ((keys.body as { data?: unknown[] })?.data ?? []).length
      return count > 0
        ? { area: 'Asaas · chave Pix', status: 'ok', detail: `${count} chave(s) Pix ativa(s)` }
        : { area: 'Asaas · chave Pix', status: 'falha', detail: 'nenhuma chave Pix ativa: sem ela o Asaas não gera QR Code' }
    })),
  )

  checks.push(
    ...(await safely('Asaas · webhook', async () => {
      if (!config.ASAAS_WEBHOOK_TOKEN) return { area: 'Asaas · webhook', status: 'falha', detail: 'ASAAS_WEBHOOK_TOKEN ausente: a API recusa todos os webhooks' }
      const expectedURL = `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/v1/webhooks/asaas`
      const list = await getJSON(deps, `${base}/webhooks`, headers)
      if (list.status !== 200) return { area: 'Asaas · webhook', status: 'aviso', detail: `não foi possível listar webhooks (HTTP ${list.status}); confira no painel: ${expectedURL}` }
      type Hook = { url?: string; enabled?: boolean; interrupted?: boolean; events?: string[] }
      const hooks = ((list.body as { data?: Hook[] })?.data ?? []).filter((hook) => hook.url === expectedURL)
      if (hooks.length === 0) return { area: 'Asaas · webhook', status: 'falha', detail: `nenhum webhook aponta para ${expectedURL}` }
      const hook = hooks.find((item) => item.enabled !== false) ?? hooks[0]!
      if (hook.enabled === false) return { area: 'Asaas · webhook', status: 'falha', detail: 'o webhook está desativado' }
      if (hook.interrupted) return { area: 'Asaas · webhook', status: 'falha', detail: 'a fila do webhook está interrompida: reative no painel do Asaas' }
      const events = new Set(hook.events ?? [])
      const missing = requiredWebhookEvents(config.BILLING_PIX_MODE).filter((event) => !events.has(event))
      return missing.length === 0
        ? { area: 'Asaas · webhook', status: 'ok', detail: `ativo em ${expectedURL}` }
        : { area: 'Asaas · webhook', status: 'falha', detail: `faltam eventos: ${missing.join(', ')}` }
    })),
  )

  if (config.BILLING_PIX_MODE === 'pix_automatico') {
    checks.push(
      ...(await safely('Asaas · Pix Automático', async () => {
        const probe = await getJSON(deps, `${base}/pix/automatic/authorizations?limit=1`, headers)
        return probe.status === 200
          ? { area: 'Asaas · Pix Automático', status: 'ok', detail: 'conta habilitada' }
          : {
              area: 'Asaas · Pix Automático',
              status: 'falha',
              detail: `conta não habilitada (HTTP ${probe.status}); use BILLING_PIX_MODE=pix_assinatura até a liberação`,
            }
      })),
    )
  } else {
    checks.push({ area: 'Asaas · modo', status: 'ok', detail: 'Pix mensal (pix_assinatura)' })
  }
  return checks
}

async function estevaoChecks(deps: AppDeps): Promise<DoctorCheck[]> {
  const { config } = deps
  if (!config.ESTEVAO_API_KEY) return [{ area: 'Estêvão API', status: 'falha', detail: 'ESTEVAO_API_KEY ausente: assinantes ficam sem leituras' }]
  return safely('Estêvão API', async () => {
    const response = await getJSON(deps, new URL('/api/v2/prayer-books', config.ESTEVAO_API_URL).toString(), { 'X-API-Key': config.ESTEVAO_API_KEY! })
    return response.status === 200
      ? { area: 'Estêvão API', status: 'ok', detail: 'chave aceita' }
      : { area: 'Estêvão API', status: 'falha', detail: `a Estêvão API respondeu HTTP ${response.status}` }
  })
}

type Provider = 'anthropic' | 'openai' | 'google' | 'perplexity'

function providerKey(deps: AppDeps, provider: Provider): string | undefined {
  const { config } = deps
  return { anthropic: config.ANTHROPIC_API_KEY, openai: config.OPENAI_API_KEY, google: config.GOOGLE_AI_API_KEY, perplexity: config.PERPLEXITY_API_KEY }[provider]
}

async function modelCheck(deps: AppDeps, use: string, provider: Provider, model: string): Promise<DoctorCheck[]> {
  const area = `IA · ${use}`
  const key = providerKey(deps, provider)
  if (!key) return [{ area, status: 'falha', detail: `chave de ${provider} ausente para ${model}` }]
  return safely(area, async () => {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key, fetch: deps.fetch, maxRetries: 0, timeout: TIMEOUT_MS })
      const info = await client.models.retrieve(model)
      return { area, status: 'ok', detail: `anthropic · ${info.id}` }
    }
    if (provider === 'openai') {
      const response = await getJSON(deps, `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { Authorization: `Bearer ${key}` })
      return response.status === 200
        ? { area, status: 'ok', detail: `openai · ${model}` }
        : { area, status: 'falha', detail: `openai respondeu HTTP ${response.status} para ${model}` }
    }
    if (provider === 'google') {
      const response = await getJSON(deps, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { 'x-goog-api-key': key })
      return response.status === 200
        ? { area, status: 'ok', detail: `google · ${model}` }
        : { area, status: 'falha', detail: `google respondeu HTTP ${response.status} para ${model}` }
    }
    // A Perplexity não tem consulta gratuita de chave ou modelo; a primeira pesquisa real confirma.
    return { area, status: 'aviso', detail: `perplexity · ${model}: chave presente, não verificada sem custo` }
  })
}

async function aiChecks(deps: AppDeps): Promise<DoctorCheck[]> {
  const { config } = deps
  const review = await modelCheck(deps, 'revisão', config.AI_REVIEW_PROVIDER, config.AI_REVIEW_MODEL)
  const research = await modelCheck(deps, 'pesquisa', config.AI_RESEARCH_PROVIDER, config.AI_RESEARCH_MODEL)
  return [...review, ...research]
}

export async function runDoctor(deps: AppDeps): Promise<DoctorCheck[]> {
  const groups = await Promise.all([databaseChecks(deps), emailChecks(deps), asaasChecks(deps), estevaoChecks(deps), aiChecks(deps)])
  return [...configChecks(deps), ...groups.flat()]
}

const SYMBOL: Record<CheckStatus, string> = { ok: 'OK    ', aviso: 'AVISO ', falha: 'FALHA ', ignorado: '—     ' }

/** Texto para o terminal; nenhum segredo é incluído (só nomes de variáveis, domínios e modelos). */
export function formatDoctorReport(checks: DoctorCheck[]): string {
  const width = Math.max(...checks.map((check) => check.area.length))
  const lines = checks.map((check) => `${SYMBOL[check.status]}${check.area.padEnd(width)}  ${check.detail}`)
  const failures = checks.filter((check) => check.status === 'falha').length
  const warnings = checks.filter((check) => check.status === 'aviso').length
  lines.push('', failures === 0 ? `Pronto para produção${warnings ? ` (${warnings} aviso(s))` : ''}.` : `${failures} falha(s) a corrigir antes de abrir para assinantes.`)
  return lines.join('\n')
}
