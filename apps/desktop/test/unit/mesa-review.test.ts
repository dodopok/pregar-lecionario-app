import { describe, expect, it } from 'vitest'
import type { SermonReviewFinding } from '@pregar/core/ai'
import { DEFAULT_PRO_LIMITS } from '@pregar/core/plans/contract'
import type { UsageSummary } from '@pregar/core/plans/contract'
import {
  closedSummary,
  criterionCounts,
  formatBytes,
  groupFindingsByCriterion,
  isQuotaError,
  newRequestId,
  operationForCriteria,
  questionsPayloadDescription,
  quotaExhausted,
  remainingLine,
  reviewPayloadDescription,
  sortedCriteria,
  usageLine,
} from '../../src/renderer/src/views/mesa/panels/review'

function finding(
  id: string,
  criterion: SermonReviewFinding['criterion'],
  extra: Partial<SermonReviewFinding> = {},
): SermonReviewFinding {
  return {
    id,
    criterion,
    severity: 'note',
    manuscriptQuote: 'trecho',
    observation: 'observação',
    correction: '',
    classification: '',
    evidenceQuote: '',
    status: 'open',
    ...extra,
  }
}

function usage(used: Partial<UsageSummary['used']> = {}, extra: Partial<UsageSummary> = {}): UsageSummary {
  return {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    used: { review: 0, structure: 0, questions: 0, research: 0, ...used },
    limits: DEFAULT_PRO_LIMITS,
    todayCalls: 0,
    costCapReached: false,
    ...extra,
  }
}

describe('apontamentos', () => {
  it('conta só os abertos por critério, na ordem do app', () => {
    const counts = criterionCounts({
      findings: [
        finding('1', 'tone'),
        finding('2', 'spelling'),
        finding('3', 'spelling', { status: 'resolved' }),
      ],
    })
    expect(counts.map((row) => [row.title, row.count])).toEqual([
      ['Ortografia', 1],
      ['Fidelidade', 0],
      ['Estrutura', 0],
      ['Clareza', 0],
      ['Tom', 1],
    ])
    expect(criterionCounts(null).every((row) => row.count === 0 && row.guidance.length > 0)).toBe(true)
  })

  it('agrupa por critério, com "verificar" antes das notas', () => {
    const groups = groupFindingsByCriterion([
      finding('a', 'clarity'),
      finding('b', 'fidelity'),
      finding('c', 'clarity', { severity: 'attention' }),
    ])
    expect(groups.map((group) => [group.title, group.findings.map((item) => item.id)])).toEqual([
      ['Fidelidade', ['b']],
      ['Clareza', ['c', 'a']],
    ])
  })

  it('resume os fechados', () => {
    expect(closedSummary([{ status: 'resolved' }, { status: 'resolved' }, { status: 'dismissed' }])).toBe(
      '2 resolvidos · 1 descartado',
    )
    expect(closedSummary([{ status: 'dismissed' }, { status: 'dismissed' }])).toBe('2 descartados')
    expect(closedSummary([{ status: 'resolved' }])).toBe('1 resolvido')
  })

  it('ordena critérios e distingue a checagem de estrutura', () => {
    expect(sortedCriteria(['tone', 'spelling', 'outro'])).toEqual(['spelling', 'tone'])
    expect(operationForCriteria(['structure'])).toBe('structure')
    expect(operationForCriteria(['structure', 'tone'])).toBe('review')
  })
})

describe('uso da assinatura', () => {
  it('escreve a linha compacta do painel', () => {
    expect(usageLine(usage({ review: 7 }))).toBe('Revisões: 7 de 40 este mês')
    expect(usageLine(usage({ review: 7, structure: 2 }), ['review', 'structure'])).toBe(
      'Revisões: 7 de 40 · Checagens de estrutura: 2 de 40 este mês',
    )
  })

  it('diz quanto resta, com concordância', () => {
    expect(remainingLine(usage({ review: 7 }), 'review')).toBe('restam 33 de 40 revisões este mês')
    expect(remainingLine(usage({ review: 39 }), 'review')).toBe('resta 1 de 40 revisões este mês')
    expect(remainingLine(usage({ review: 45 }), 'review')).toBe('nenhuma revisão restante este mês')
    expect(remainingLine(usage({ questions: 60 }), 'questions')).toBe(
      'nenhum pedido de perguntas restante este mês',
    )
  })

  it('bloqueia pela cota do mês, do dia ou pelo teto de custo', () => {
    expect(quotaExhausted(usage({ review: 40 }), 'review')).toBe(true)
    expect(quotaExhausted(usage({ review: 40 }), 'structure')).toBe(false)
    expect(quotaExhausted(usage({}, { todayCalls: 20 }), 'structure')).toBe(true)
    expect(quotaExhausted(usage({}, { costCapReached: true }), 'questions')).toBe(true)
    expect(quotaExhausted(null, 'review')).toBe(false)
  })

  it('reconhece os erros de cota do servidor', () => {
    expect(isQuotaError({ code: 'monthly_limit' })).toBe(true)
    expect(isQuotaError({ code: 'cost_cap' })).toBe(true)
    expect(isQuotaError({ code: 'ai_busy' })).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
})

describe('o que é enviado', () => {
  it('chaves próprias: texto do app Swift', () => {
    expect(
      reviewPayloadDescription({
        mode: 'byok',
        providerName: 'Claude',
        includesSources: true,
        hasMaterials: true,
      }),
    ).toBe(
      'O manuscrito, a leitura bíblica e as traduções disponíveis e os materiais marcados serão enviados diretamente a Claude ao clicar em Enviar revisão. A chamada usa sua chave, não passa pelo app Pregar, e nunca altera o manuscrito. Aplicam-se as regras de retenção do provedor.',
    )
    expect(
      reviewPayloadDescription({
        mode: 'byok',
        providerName: 'Gemini',
        includesSources: false,
        hasMaterials: true,
      }),
    ).toMatch(/^O manuscrito serão enviados diretamente a Gemini/)
  })

  it('assinatura: passa pelo servidor do Pregar, sem guardar o manuscrito', () => {
    const text = reviewPayloadDescription({
      mode: 'pro',
      providerName: 'Claude',
      includesSources: false,
      hasMaterials: false,
    })
    expect(text).toContain('servidor do Pregar')
    expect(text).toContain('não fica guardado')
    expect(text).not.toContain('sua chave')
  })

  it('perguntas listam o escopo incluído', () => {
    expect(
      questionsPayloadDescription({
        mode: 'byok',
        providerName: 'OpenAI',
        hasReference: true,
        hasBible: true,
        hasMaterials: false,
      }),
    ).toMatch(
      /^Manuscrito, leitura principal, traduções bíblicas carregadas serão enviados diretamente a OpenAI/,
    )
  })
})

describe('utilitários', () => {
  it('formata tamanhos', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(24_000)).toBe('23 KB')
    expect(formatBytes(1_300_000)).toBe('1,2 MB')
  })

  it('gera identificadores de pedido distintos', () => {
    expect(newRequestId()).not.toBe(newRequestId())
  })
})
