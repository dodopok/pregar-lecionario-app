import { describe, expect, it } from 'vitest'
import { AI_OPERATION_LABELS, DEFAULT_PRO_LIMITS, isValidCpfCnpj } from '@pregar/core/plans/contract'
import type { UsageSummary } from '@pregar/core/plans/contract'
import {
  accountInitials,
  cpfCnpjKind,
  describeCountdown,
  formatBRL,
  formatCountdown,
  formatCpfCnpj,
  formatDate,
  isNotImplemented,
  paymentStatusLabel,
  remainingMs,
  sanitizeLoginCode,
  usageNotices,
  usageRows,
  validateApiBaseURL,
  yearlySavings,
} from '../../src/renderer/src/views/preferencias/format'

describe('máscara de CPF/CNPJ', () => {
  it('formata o CPF progressivamente', () => {
    expect(formatCpfCnpj('')).toBe('')
    expect(formatCpfCnpj('123')).toBe('123')
    expect(formatCpfCnpj('1234')).toBe('123.4')
    expect(formatCpfCnpj('1234567')).toBe('123.456.7')
    expect(formatCpfCnpj('123456789')).toBe('123.456.789')
    expect(formatCpfCnpj('1234567890')).toBe('123.456.789-0')
    expect(formatCpfCnpj('52998224725')).toBe('529.982.247-25')
  })

  it('passa a CNPJ a partir do 12º dígito e descarta o excesso', () => {
    expect(formatCpfCnpj('112223330001')).toBe('11.222.333/0001')
    expect(formatCpfCnpj('11222333000181')).toBe('11.222.333/0001-81')
    expect(formatCpfCnpj('11.222.333/0001-8199')).toBe('11.222.333/0001-81')
  })

  it('ignora caracteres digitados que não são números', () => {
    expect(formatCpfCnpj('529.982.247-25')).toBe('529.982.247-25')
    expect(formatCpfCnpj('abc529x982')).toBe('529.982')
  })

  it('o valor mascarado continua válido para o contrato', () => {
    expect(isValidCpfCnpj(formatCpfCnpj('52998224725'))).toBe(true)
    expect(isValidCpfCnpj(formatCpfCnpj('11222333000181'))).toBe(true)
    expect(isValidCpfCnpj(formatCpfCnpj('52998224724'))).toBe(false)
    expect(cpfCnpjKind('529.982.247-25')).toBe('CPF')
    expect(cpfCnpjKind('11.222.333/0001-81')).toBe('CNPJ')
    expect(cpfCnpjKind('529.982')).toBeNull()
  })
})

describe('contagem regressiva', () => {
  it('formata minutos e segundos', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5000)).toBe('0:00')
    expect(formatCountdown(42_000)).toBe('0:42')
    expect(formatCountdown(9 * 60_000 + 5_000)).toBe('9:05')
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
  })

  it('arredonda para cima para não mostrar 0:00 antes de vencer', () => {
    expect(formatCountdown(100)).toBe('0:01')
    expect(formatCountdown(59_001)).toBe('1:00')
  })

  it('calcula o tempo restante a partir do vencimento', () => {
    const now = Date.parse('2026-11-01T12:00:00Z')
    expect(remainingMs('2026-11-01T12:30:00Z', now)).toBe(30 * 60_000)
    expect(remainingMs('2026-11-01T11:00:00Z', now)).toBe(0)
    expect(remainingMs(null, now)).toBeNull()
    expect(remainingMs('não é data', now)).toBeNull()
  })

  it('descreve o tempo para leitores de tela', () => {
    expect(describeCountdown(65_000)).toBe('1 minuto e 5 segundos')
    expect(describeCountdown(120_000)).toBe('2 minutos')
    expect(describeCountdown(0)).toBe('0 segundos')
  })
})

describe('valores e datas', () => {
  it('formata reais', () => {
    expect(formatBRL(2990)).toBe('R$ 29,90')
    expect(formatBRL(29900)).toBe('R$ 299,00')
    expect(formatBRL(123456)).toBe('R$ 1.234,56')
  })

  it('calcula o equivalente mensal e a economia do plano anual', () => {
    const offers = [
      { cycle: 'monthly' as const, priceCents: 2990, label: 'Mensal', description: '' },
      { cycle: 'yearly' as const, priceCents: 29900, label: 'Anual', description: '' },
    ]
    expect(yearlySavings(offers)).toEqual({ monthlyEquivalentCents: 2492, percent: 17 })
    expect(yearlySavings(offers.slice(0, 1))).toBeNull()
  })

  it('mostra datas no fuso de São Paulo', () => {
    expect(formatDate('2026-12-01T02:00:00Z')).toBe('30/11/2026')
    expect(formatDate('2026-12-01')).toBe('01/12/2026')
    expect(formatDate(null)).toBe('—')
  })

  it('traduz o status das cobranças', () => {
    expect(paymentStatusLabel('RECEIVED')).toEqual({ label: 'Pago', tone: 'success' })
    expect(paymentStatusLabel('PENDING').label).toBe('Aguardando')
    expect(paymentStatusLabel('OVERDUE').tone).toBe('danger')
    expect(paymentStatusLabel('SOMETHING_NEW').label).toBe('Something new')
  })
})

describe('uso da assinatura', () => {
  const usage: UsageSummary = {
    periodStart: '2026-11-01T00:00:00Z',
    periodEnd: '2026-12-01T00:00:00Z',
    used: { review: 40, structure: 33, questions: 2, research: 0 },
    limits: DEFAULT_PRO_LIMITS,
    todayCalls: 20,
    costCapReached: true,
  }

  it('monta um medidor por operação, na ordem do contrato', () => {
    const rows = usageRows(usage, AI_OPERATION_LABELS)
    expect(rows.map((row) => row.label)).toEqual([
      'Revisões completas',
      'Checagens de estrutura',
      'Perguntas de emergência',
      'Pesquisas de materiais',
    ])
    expect(rows[0]).toMatchObject({ used: 40, limit: 40, ratio: 1, state: 'full' })
    expect(rows[1]?.state).toBe('near')
    expect(rows[2]?.state).toBe('ok')
  })

  it('avisa sobre o limite diário e o teto de custo', () => {
    const notices = usageNotices(usage)
    expect(notices).toHaveLength(2)
    expect(notices[0]).toContain('20 chamadas de IA de hoje')
    expect(notices[1]).toContain('teto de uso')
    expect(usageNotices({ ...usage, todayCalls: 3, costCapReached: false })).toEqual([])
  })
})

describe('outros', () => {
  it('valida o endereço da API', () => {
    expect(validateApiBaseURL('')).toBeNull()
    expect(validateApiBaseURL('https://api.pregar.app')).toBeNull()
    expect(validateApiBaseURL('http://127.0.0.1:4010')).toBeNull()
    expect(validateApiBaseURL('http://api.pregar.app')).toBe('O endereço precisa começar com https://.')
    expect(validateApiBaseURL('api.pregar.app')).toContain('https://')
    expect(validateApiBaseURL('https://user:pw@api.pregar.app')).toContain('usuário')
  })

  it('reconhece canais ainda não implementados', () => {
    expect(isNotImplemented({ code: 'unknown_channel', message: 'Canal desconhecido: drive:status' })).toBe(true)
    expect(isNotImplemented(new Error('Canal desconhecido: x'))).toBe(true)
    expect(isNotImplemented(new Error('Sem conexão'))).toBe(false)
    expect(isNotImplemented(null)).toBe(false)
  })

  it('limpa o código de login e gera iniciais', () => {
    expect(sanitizeLoginCode(' 12 34-567 ')).toBe('123456')
    expect(accountInitials('Ana Maria Souza', 'a@b.com')).toBe('AS')
    expect(accountInitials(null, 'joao.silva@example.com')).toBe('JS')
    expect(accountInitials('', 'pregador@example.com')).toBe('P')
  })
})
