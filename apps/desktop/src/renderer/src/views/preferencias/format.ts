/**
 * Funções puras das Preferências (máscaras, datas, valores, validações). Sem Vue nem IPC, para
 * poderem ser testadas isoladamente.
 */
import type {
  AIOperationKind,
  BillingCycle,
  PlanOffer,
  SubscriptionStatus,
  UsageSummary,
} from '@pregar/core/plans/contract'

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Máscara progressiva de CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00). Até 11 dígitos é CPF;
 * do 12º em diante passa a CNPJ. Dígitos além de 14 são descartados.
 */
export function formatCpfCnpj(value: string): string {
  const digits = onlyDigits(value).slice(0, 14)
  if (digits.length <= 11) {
    const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean)
    const check = digits.slice(9, 11)
    return parts.join('.') + (check ? `-${check}` : '')
  }
  const head = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8)].join('.')
  const branch = digits.slice(8, 12)
  const check = digits.slice(12, 14)
  return `${head}/${branch}${check ? `-${check}` : ''}`
}

/** "CPF", "CNPJ" ou null enquanto o número está incompleto. */
export function cpfCnpjKind(value: string): 'CPF' | 'CNPJ' | null {
  const length = onlyDigits(value).length
  if (length === 11) return 'CPF'
  if (length === 14) return 'CNPJ'
  return null
}

/** Milissegundos restantes até `expiresAt` (nunca negativo); null quando não há prazo. */
export function remainingMs(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null
  const end = Date.parse(expiresAt)
  if (Number.isNaN(end)) return null
  return Math.max(0, end - now)
}

/** Contagem regressiva: "9:05", "0:42" ou "1:02:03". Arredonda para cima para não mostrar 0:00 antes da hora. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}

/** Texto para leitores de tela: "9 minutos e 5 segundos". */
export function describeCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  const parts: string[] = []
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`)
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`)
  return parts.join(' e ')
}

/** "R$ 29,90" (espaço comum, para copiar e testar sem surpresas). */
export function formatBRL(cents: number): string {
  const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
  return value.replace(/\s/g, ' ')
}

export function cycleLabel(cycle: BillingCycle): string {
  return cycle === 'yearly' ? 'por ano' : 'por mês'
}

/** Preço anual dividido por 12 e a economia em relação a 12 mensalidades. */
export function yearlySavings(offers: readonly PlanOffer[]): { monthlyEquivalentCents: number; percent: number } | null {
  const monthly = offers.find((offer) => offer.cycle === 'monthly')
  const yearly = offers.find((offer) => offer.cycle === 'yearly')
  if (!monthly || !yearly || monthly.priceCents <= 0) return null
  const monthlyEquivalentCents = Math.round(yearly.priceCents / 12)
  const percent = Math.round((1 - yearly.priceCents / (monthly.priceCents * 12)) * 100)
  return { monthlyEquivalentCents, percent: Math.max(0, percent) }
}

/** Data curta em português, no fuso de São Paulo: "05/11/2026". Aceita "2026-11-05" sem hora. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** "5 de novembro de 2026". */
export function formatLongDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
}

/** "há 5 minutos", "hoje às 14:20" e afins, para a lista de sessões. */
export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return '—'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return '—'
  const minutes = Math.round((now - time) / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
  return formatDate(value)
}

const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  pending: 'Aguardando pagamento',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
  expired: 'Vencida',
  refused: 'Autorização recusada',
}

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status
}

/** Status das cobranças do Asaas em português. */
export function paymentStatusLabel(status: string): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  switch (status.toUpperCase()) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return { label: 'Pago', tone: 'success' }
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return { label: 'Aguardando', tone: 'warning' }
    case 'OVERDUE':
      return { label: 'Vencido', tone: 'danger' }
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return { label: 'Estornado', tone: 'muted' }
    case 'DELETED':
    case 'CANCELED':
      return { label: 'Cancelado', tone: 'muted' }
    default:
      return { label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' '), tone: 'muted' }
  }
}

export interface UsageRow {
  kind: AIOperationKind
  label: string
  used: number
  limit: number
  /** 0 a 1. */
  ratio: number
  state: 'ok' | 'near' | 'full'
}

const OPERATION_ORDER: AIOperationKind[] = ['review', 'structure', 'questions', 'research']

export function usageRows(usage: UsageSummary, labels: Record<AIOperationKind, string>): UsageRow[] {
  return OPERATION_ORDER.map((kind) => {
    const used = usage.used[kind] ?? 0
    const limit = usage.limits.monthly[kind] ?? 0
    const ratio = limit > 0 ? Math.min(1, used / limit) : 1
    const state: UsageRow['state'] = used >= limit ? 'full' : ratio >= 0.8 ? 'near' : 'ok'
    return { kind, label: labels[kind], used, limit, ratio, state }
  })
}

/** Avisos de uso: limite diário e teto de custo do mês. */
export function usageNotices(usage: UsageSummary): string[] {
  const notices: string[] = []
  if (usage.todayCalls >= usage.limits.dailyAICalls) {
    notices.push(
      `Você usou as ${usage.limits.dailyAICalls} chamadas de IA de hoje. Amanhã o limite diário volta ao normal.`,
    )
  } else if (usage.todayCalls >= Math.ceil(usage.limits.dailyAICalls * 0.8)) {
    notices.push(`Hoje você já usou ${usage.todayCalls} de ${usage.limits.dailyAICalls} chamadas de IA.`)
  }
  if (usage.costCapReached) {
    notices.push(
      'Este mês chegou ao teto de uso da IA da sua assinatura. As revisões voltam no próximo período, ou você pode usar suas próprias chaves.',
    )
  }
  return notices
}

/** Erro de canal ainda não implementado no processo principal. */
export function isNotImplemented(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const message = (error as { message?: unknown } | null)?.message
  return code === 'unknown_channel' || (typeof message === 'string' && message.startsWith('Canal desconhecido'))
}

/** URL https com host de verdade (com ponto), sem usuário e senha. */
export function isHttpsURL(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password
  } catch {
    return false
  }
}

/** Valida o endereço da API do Pregar. Vazio usa o padrão; http só em 127.0.0.1/localhost. */
export function validateApiBaseURL(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'Digite um endereço completo, começando com https://.'
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return 'O endereço precisa começar com https://.'
  }
  if (url.username || url.password) return 'O endereço não pode conter usuário ou senha.'
  if (url.search || url.hash) return 'Use só o endereço, sem parâmetros.'
  return null
}

export function normalizeApiBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

/** Iniciais para o avatar da conta. */
export function accountInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.split('@')[0] || '?'
  const words = source.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters = words.length >= 2 ? [words[0], words[words.length - 1]] : [words[0] ?? source]
  return letters
    .map((word) => Array.from(word ?? '')[0] ?? '')
    .join('')
    .toUpperCase()
}

/** Código de 6 dígitos: só números, no máximo 6. */
export function sanitizeLoginCode(value: string): string {
  return onlyDigits(value).slice(0, 6)
}

export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}
