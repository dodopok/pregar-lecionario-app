/**
 * Regras sem interface da aba Revisão e das folhas de IA: contagens por critério, grupos de
 * apontamentos, resumo dos fechados, linha de uso da assinatura e textos sobre o que é enviado.
 * A IA só aponta e fundamenta; nenhum texto aqui oferece redação.
 */
import { CRITERION_GUIDANCE, CRITERION_TITLES, SERMON_REVIEW_CRITERIA } from '@pregar/core/ai'
import type {
  SermonReviewCriterion,
  SermonReviewFinding,
  SermonReviewFindingStatus,
  SermonReviewReport,
} from '@pregar/core/ai'
import type { AIOperationKind, UsageSummary } from '@pregar/core/plans/contract'

export interface CriterionCount {
  criterion: SermonReviewCriterion
  title: string
  guidance: string
  count: number
}

/** Uma linha por critério, com os apontamentos ainda abertos do relatório (zero sem relatório). */
export function criterionCounts(
  report: Pick<SermonReviewReport, 'findings'> | null | undefined,
): CriterionCount[] {
  return SERMON_REVIEW_CRITERIA.map((criterion) => ({
    criterion,
    title: CRITERION_TITLES[criterion],
    guidance: CRITERION_GUIDANCE[criterion],
    count:
      report?.findings.filter((finding) => finding.criterion === criterion && finding.status === 'open')
        .length ?? 0,
  }))
}

export interface FindingGroup {
  criterion: SermonReviewCriterion
  title: string
  findings: SermonReviewFinding[]
}

/**
 * Apontamentos agrupados por critério, na ordem do app (Ortografia → Tom); dentro do grupo, os que
 * pedem verificação vêm antes das notas, mantendo a ordem do relatório.
 */
export function groupFindingsByCriterion(findings: readonly SermonReviewFinding[]): FindingGroup[] {
  return SERMON_REVIEW_CRITERIA.map((criterion) => {
    const items = findings.filter((finding) => finding.criterion === criterion)
    const ordered = [
      ...items.filter((item) => item.severity === 'attention'),
      ...items.filter((item) => item.severity !== 'attention'),
    ]
    return { criterion, title: CRITERION_TITLES[criterion], findings: ordered }
  }).filter((group) => group.findings.length > 0)
}

/** "2 resolvidos · 1 descartado". */
export function closedSummary(findings: readonly Pick<SermonReviewFinding, 'status'>[]): string {
  const resolved = findings.filter((finding) => finding.status === 'resolved').length
  const dismissed = findings.filter((finding) => finding.status === 'dismissed').length
  return [
    resolved > 0 ? `${resolved} resolvido${resolved === 1 ? '' : 's'}` : null,
    dismissed > 0 ? `${dismissed} descartado${dismissed === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function sortedCriteria(criteria: Iterable<string>): SermonReviewCriterion[] {
  const chosen = new Set(criteria)
  return SERMON_REVIEW_CRITERIA.filter((criterion) => chosen.has(criterion))
}

/** A assinatura conta "Checar estrutura" à parte quando Estrutura é o único critério. */
export function operationForCriteria(
  criteria: readonly string[],
): Extract<AIOperationKind, 'review' | 'structure'> {
  return criteria.length === 1 && criteria[0] === 'structure' ? 'structure' : 'review'
}

const USAGE_LABELS: Record<AIOperationKind, string> = {
  review: 'Revisões',
  structure: 'Checagens de estrutura',
  questions: 'Perguntas de emergência',
  research: 'Pesquisas de materiais',
}

/** Singular, plural e "nenhum(a)" de cada operação. */
const USAGE_NOUNS: Record<AIOperationKind, [string, string, string]> = {
  review: ['revisão', 'revisões', 'nenhuma'],
  structure: ['checagem de estrutura', 'checagens de estrutura', 'nenhuma'],
  questions: ['pedido de perguntas', 'pedidos de perguntas', 'nenhum'],
  research: ['pesquisa de materiais', 'pesquisas de materiais', 'nenhuma'],
}

function usedAndLimit(usage: UsageSummary, kind: AIOperationKind): { used: number; limit: number } {
  return { used: usage.used[kind] ?? 0, limit: usage.limits.monthly[kind] ?? 0 }
}

/** Linha compacta do painel: "Revisões: 7 de 40 este mês" (várias operações separadas por "·"). */
export function usageLine(usage: UsageSummary, kinds: readonly AIOperationKind[] = ['review']): string {
  const parts = kinds.map((kind) => {
    const { used, limit } = usedAndLimit(usage, kind)
    return `${USAGE_LABELS[kind]}: ${used} de ${limit}`
  })
  return parts.length === 0 ? '' : `${parts.join(' · ')} este mês`
}

/** "restam 33 de 40 revisões este mês" ou "nenhuma revisão restante este mês". */
export function remainingLine(usage: UsageSummary, kind: AIOperationKind): string {
  const { used, limit } = usedAndLimit(usage, kind)
  const remaining = Math.max(0, limit - used)
  const [singular, plural, none] = USAGE_NOUNS[kind]
  if (remaining === 0) return `${none} ${singular} restante este mês`
  return `${remaining === 1 ? 'resta' : 'restam'} ${remaining} de ${limit} ${limit === 1 ? singular : plural} este mês`
}

/** A cota da operação acabou (o envio fica bloqueado e a folha oferece as chaves próprias). */
export function quotaExhausted(usage: UsageSummary | null | undefined, kind: AIOperationKind): boolean {
  if (!usage) return false
  const { used, limit } = usedAndLimit(usage, kind)
  return used >= limit || usage.costCapReached || usage.todayCalls >= usage.limits.dailyAICalls
}

/** Erros de cota do servidor (a mensagem do servidor é mostrada como veio). */
export function isQuotaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'monthly_limit' || code === 'daily_limit' || code === 'cost_cap'
}

export function isCanceledError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'canceled'
}

export type AIMode = 'pro' | 'byok' | 'none'

export interface PayloadInput {
  mode: AIMode
  providerName: string
  /** Fidelidade marcada: leitura bíblica, traduções e materiais entram. */
  includesSources: boolean
  hasMaterials: boolean
}

/** O que será enviado, e a quem, ao clicar em "Enviar revisão" (texto do app Swift para chaves próprias). */
export function reviewPayloadDescription({
  mode,
  providerName,
  includesSources,
  hasMaterials,
}: PayloadInput): string {
  const parts: string[] = []
  if (includesSources) {
    parts.push('a leitura bíblica e as traduções disponíveis')
    if (hasMaterials) parts.push('os materiais marcados')
  }
  const subject = parts.length === 0 ? 'O manuscrito' : `O manuscrito, ${parts.join(' e ')}`
  if (mode === 'pro') {
    return `${subject} serão enviados ao servidor do Proper ao clicar em Enviar revisão. O servidor consulta o modelo, confere os trechos citados e devolve só os apontamentos; o manuscrito não fica guardado lá e nunca é alterado.`
  }
  return `${subject} serão enviados diretamente a ${providerName} ao clicar em Enviar revisão. A chamada usa sua chave, não passa pelo app Proper, e nunca altera o manuscrito. Aplicam-se as regras de retenção do provedor.`
}

/** Escopo das perguntas de emergência (texto do app Swift para chaves próprias). */
export function questionsPayloadDescription(input: {
  mode: AIMode
  providerName: string
  hasReference: boolean
  hasBible: boolean
  hasMaterials: boolean
}): string {
  const included = ['manuscrito']
  if (input.hasReference) included.push('leitura principal')
  if (input.hasBible) included.push('traduções bíblicas carregadas')
  if (input.hasMaterials) included.push('materiais marcados no Leitor')
  const scope = included.join(', ')
  const capitalized = scope.charAt(0).toUpperCase() + scope.slice(1)
  if (input.mode === 'pro') {
    return `${capitalized} serão enviados ao servidor do Proper ao clicar em Pedir perguntas. Nada é guardado no servidor e nada é escrito no manuscrito.`
  }
  return `${capitalized} serão enviados diretamente a ${input.providerName} ao clicar em Pedir perguntas. A chamada usa sua chave, não passa pelo app Proper, e nada é escrito no manuscrito. Aplicam-se as regras de retenção do provedor.`
}

/** "12 KB", "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString('pt-BR')} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export const FINDING_STATUS_TEXT: Record<Exclude<SermonReviewFindingStatus, 'open'>, string> = {
  resolved: 'Marcar como resolvido',
  dismissed: 'Descartar este apontamento',
}

/** Identificador de pedido para acompanhar o progresso e cancelar. */
export function newRequestId(): string {
  const crypto = globalThis.crypto as Crypto | undefined
  if (crypto?.randomUUID) return crypto.randomUUID()
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
