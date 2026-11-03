/**
 * Contrato entre o app e a API do Proper. Os mesmos esquemas validam a entrada no servidor e
 * tipam as respostas no app. Mensagens de erro para o usuário ficam em português.
 */
import { z } from 'zod'

export type PlanId = 'free' | 'pro'
export type BillingCycle = 'monthly' | 'yearly'
export type BillingMethod = 'pix_automatico' | 'pix_assinatura'
export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired' | 'refused'
export type AIOperationKind = 'review' | 'structure' | 'questions' | 'research'

export const AI_OPERATION_LABELS: Record<AIOperationKind, string> = {
  review: 'Revisões completas',
  structure: 'Checagens de estrutura',
  questions: 'Perguntas de emergência',
  research: 'Pesquisas de materiais',
}

export interface UsageLimits {
  monthly: Record<AIOperationKind, number>
  dailyAICalls: number
  monthlyCostCapUSD: number
}

export const DEFAULT_PRO_LIMITS: UsageLimits = {
  monthly: { review: 40, structure: 40, questions: 60, research: 60 },
  dailyAICalls: 20,
  monthlyCostCapUSD: 8,
}

export interface UsageSummary {
  periodStart: string
  periodEnd: string
  used: Record<AIOperationKind, number>
  limits: UsageLimits
  todayCalls: number
  costCapReached: boolean
}

export interface PixCharge {
  /** Código "copia e cola". */
  payload: string
  /** PNG em base64, sem prefixo data:. */
  image: string
  expiresAt: string | null
  valueCents: number
}

export interface SubscriptionView {
  id: string
  status: SubscriptionStatus
  cycle: BillingCycle
  method: BillingMethod
  priceCents: number
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** Cobrança Pix em aberto (primeira ativação ou mensalidade na modalidade assinatura). */
  pendingCharge: PixCharge | null
  /** Mensagem curta em português sobre o estado da assinatura. */
  statusMessage: string
}

export interface AccountView {
  user: { id: string; email: string; name: string | null; createdAt: string }
  plan: PlanId
  subscription: SubscriptionView | null
  usage: UsageSummary | null
  features: { aiProxy: boolean; estevaoProxy: boolean }
}

export interface PlanOffer {
  cycle: BillingCycle
  priceCents: number
  label: string
  description: string
}

export interface PlansView {
  method: BillingMethod
  methodDescription: string
  offers: PlanOffer[]
  limits: UsageLimits
}

export interface SessionView {
  id: string
  deviceName: string
  platform: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

export interface PaymentView {
  id: string
  status: string
  valueCents: number
  dueDate: string | null
  paidAt: string | null
  invoiceUrl: string | null
}

/** Formato de erro de todas as rotas. */
export interface APIErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Informe um email válido.' }))

export const startLoginSchema = z.object({ email: emailSchema })

export const verifyLoginSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, { message: 'O código tem 6 dígitos.' }),
  deviceName: z.string().trim().min(1).max(80).default('Computador'),
  platform: z.enum(['darwin', 'win32', 'linux', 'web']).optional(),
})

/** Valida CPF ou CNPJ pelos dígitos verificadores. Aceita com ou sem pontuação. */
export function isValidCpfCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11) return isValidCpf(digits)
  if (digits.length === 14) return isValidCnpj(digits)
  return false
}

function isValidCpf(cpf: string): boolean {
  if (/^(\d)\1{10}$/.test(cpf)) return false
  const numbers = cpf.split('').map(Number)
  for (const length of [9, 10]) {
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += (numbers[index] ?? 0) * (length + 1 - index)
    const digit = ((sum * 10) % 11) % 10
    if (digit !== numbers[length]) return false
  }
  return true
}

function isValidCnpj(cnpj: string): boolean {
  if (/^(\d)\1{13}$/.test(cnpj)) return false
  const numbers = cnpj.split('').map(Number)
  const weights = [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ]
  for (const [position, weightList] of weights.entries()) {
    const length = 12 + position
    let sum = 0
    for (let index = 0; index < length; index += 1) sum += (numbers[index] ?? 0) * (weightList[index] ?? 0)
    const remainder = sum % 11
    const digit = remainder < 2 ? 0 : 11 - remainder
    if (digit !== numbers[length]) return false
  }
  return true
}

export const checkoutSchema = z.object({
  cycle: z.enum(['monthly', 'yearly']),
  name: z.string().trim().min(3, { message: 'Informe o nome completo.' }).max(120),
  cpfCnpj: z
    .string()
    .trim()
    .refine(isValidCpfCnpj, { message: 'CPF ou CNPJ inválido.' })
    .transform((value) => value.replace(/\D/g, '')),
})

export const reviewSourceSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(400),
  citation: z.string().max(600),
  text: z.string().max(24_000),
})

export const aiCriteriaSchema = z.array(z.enum(['spelling', 'fidelity', 'structure', 'clarity', 'tone'])).min(1).max(5)

/** Limites de entrada aplicados pelo servidor, iguais aos do app. */
export const AI_INPUT_LIMITS = {
  manuscriptChars: 200_000,
  sourcesTotalBytes: 120_000,
  sourcesCount: 20,
}

export const PREGAR_API_DEFAULT_URL = 'https://api.pregar.app'
