import { z } from 'zod'
import { silentIntegrationLog } from '../log/integration'
import { tryParseJSON } from '../util/http'
import { SermonReviewError } from './errors'
import { MAXIMUM_BYTES_PER_SOURCE, MAXIMUM_INPUT_BYTES, utf8ByteLength } from './materials'
import { REVIEW_SYSTEM_PROMPT } from './prompts'
import { acceptsModel, providerName } from './providers'
import {
  characterCount,
  CLAUDE_OUTPUT_TOKEN_BUDGETS,
  CLAUDE_STRUCTURED_TIMEOUT_MS,
  completedStructuredResponse,
  containsExact,
  makeStructuredRequest,
  outputText,
  responseDiagnostics,
} from './structured'
import type { AIConfiguration, JSONSchema, StructuredRequest } from './structured'
import { emptyUsage } from './usage'
import type { AIUsage } from './usage'

/** Porte da revisão por IA (`SermonReview.swift`), sem a interface. */

// Critérios, gravidade e estado

export type SermonReviewCriterion = 'spelling' | 'fidelity' | 'structure' | 'clarity' | 'tone'

/** Mesma ordem de `SermonReviewCriterion.allCases`. */
export const SERMON_REVIEW_CRITERIA: readonly SermonReviewCriterion[] = [
  'spelling',
  'fidelity',
  'structure',
  'clarity',
  'tone',
]

export const CRITERION_TITLES: Record<SermonReviewCriterion, string> = {
  spelling: 'Ortografia',
  fidelity: 'Fidelidade',
  structure: 'Estrutura',
  clarity: 'Clareza',
  tone: 'Tom',
}

/** O que cada critério examina, no vocabulário do workshop de pregação. */
export const CRITERION_GUIDANCE: Record<SermonReviewCriterion, string> = {
  spelling: 'Erros objetivos de grafia. Mostra a palavra e a forma correta, sem reescrever a frase.',
  fidelity:
    'Afirmações em tensão com a passagem e seu contexto, com evidência literal. Leitura que ninguém nunca fez é sinal de alerta.',
  structure:
    'Um texto, um foco, um ponto. Introdução com gancho, desenvolvimento a serviço da ideia dominante, conclusão com convite em crescente.',
  clarity:
    'Conexões que parecem óbvias mas não estão explicadas, termos teológicos sem explicação, erudição acima do texto, ilustrações difíceis para um público misto.',
  tone: 'Moralismo, abstração, informalidade excessiva e cuidado pastoral; citações longas ou em excesso que deslocam a voz de quem prega.',
}

export function isSermonReviewCriterion(value: unknown): value is SermonReviewCriterion {
  return typeof value === 'string' && (SERMON_REVIEW_CRITERIA as readonly string[]).includes(value)
}

export type SermonReviewSeverity = 'note' | 'attention'
export const SERMON_REVIEW_SEVERITIES: readonly SermonReviewSeverity[] = ['note', 'attention']

/** Marcação manual do autor sobre um apontamento. Uma nova revisão nunca muda este estado. */
export type SermonReviewFindingStatus = 'open' | 'resolved' | 'dismissed'
export const SERMON_REVIEW_FINDING_STATUSES: readonly SermonReviewFindingStatus[] = [
  'open',
  'resolved',
  'dismissed',
]

// Mapa do sermão

export type StructureVerdict = 'solid' | 'attention' | 'fragile'
export type StructureSectionKind = 'introduction' | 'development' | 'conclusion'
export type StructurePresence = 'fulfills' | 'partial' | 'missing'
export type StructureIdeaStatus = 'clear' | 'diffuse' | 'not_found'
export type StructureAnchorStatus = 'explicit' | 'implicit' | 'not_found'
export type StructurePageKind = 'problem_bible' | 'problem_today' | 'grace_bible' | 'grace_today'
export type StructurePageStatus = 'present' | 'brief' | 'not_found'

export const STRUCTURE_SECTION_KINDS: readonly StructureSectionKind[] = [
  'introduction',
  'development',
  'conclusion',
]
export const STRUCTURE_PAGE_KINDS: readonly StructurePageKind[] = [
  'problem_bible',
  'problem_today',
  'grace_bible',
  'grace_today',
]

export const STRUCTURE_VERDICT_TITLES: Record<StructureVerdict, string> = {
  solid: 'Estrutura sólida',
  attention: 'Estrutura pede atenção',
  fragile: 'Estrutura frágil',
}

export const STRUCTURE_SECTION_TITLES: Record<StructureSectionKind, string> = {
  introduction: 'Introdução',
  development: 'Desenvolvimento',
  conclusion: 'Conclusão',
}

/** A função que o workshop atribui a cada parte. */
export const STRUCTURE_SECTION_EXPECTATIONS: Record<StructureSectionKind, string> = {
  introduction: 'prende a atenção e apresenta o tópico',
  development: 'organiza o material a serviço da ideia dominante',
  conclusion: 'aplicação pessoal e convite ao compromisso, em crescente',
}

export const STRUCTURE_PRESENCE_TITLES: Record<StructurePresence, string> = {
  fulfills: 'cumpre a função',
  partial: 'cumpre em parte',
  missing: 'não localizada',
}

export const STRUCTURE_IDEA_STATUS_TITLES: Record<StructureIdeaStatus, string> = {
  clear: 'uma ideia dominante clara',
  diffuse: 'ideia dominante difusa',
  not_found: 'ideia dominante não localizada',
}

export const STRUCTURE_ANCHOR_STATUS_TITLES: Record<StructureAnchorStatus, string> = {
  explicit: 'anunciada explicitamente',
  implicit: 'apenas implícita',
  not_found: 'não localizada',
}

export const STRUCTURE_PAGE_TITLES: Record<StructurePageKind, string> = {
  problem_bible: 'Problema no mundo bíblico',
  problem_today: 'Problema no mundo de hoje',
  grace_bible: 'Graça de Deus no mundo bíblico',
  grace_today: 'Graça de Deus no mundo de hoje',
}

export const STRUCTURE_PAGE_SHORT_TITLES: Record<StructurePageKind, string> = {
  problem_bible: 'Problema · Bíblia',
  problem_today: 'Problema · hoje',
  grace_bible: 'Graça · Bíblia',
  grace_today: 'Graça · hoje',
}

export interface StructureSection {
  kind: StructureSectionKind
  assessment: StructurePresence
  startQuote: string
  note: string
}

export interface StructureCentralIdea {
  status: StructureIdeaStatus
  statement: string
  quote: string
  note: string
}

export interface StructureMovement {
  label: string
  startQuote: string
}

export interface StructureGospel {
  status: StructureAnchorStatus
  quote: string
  note: string
}

export interface StructurePage {
  page: StructurePageKind
  status: StructurePageStatus
  quote: string
}

/**
 * Mapa estrutural do sermão, devolvido em toda revisão e validado localmente. Descreve o que existe
 * no manuscrito segundo o referencial do workshop de pregação (Stott, Rutledge, Wilson).
 */
export interface SermonStructureAssessment {
  verdict: StructureVerdict
  summary: string
  centralIdea: StructureCentralIdea
  sections: StructureSection[]
  movements: StructureMovement[]
  gospel: StructureGospel
  fourPages: StructurePage[]
}

export function structureSection(
  structure: SermonStructureAssessment,
  kind: StructureSectionKind,
): StructureSection | undefined {
  return structure.sections.find((section) => section.kind === kind)
}

// Contexto, fontes e resultado

export interface SermonReviewSource {
  id: string
  title: string
  citation: string
  text: string
}

export interface SermonReviewContext {
  dateKey: string
  title: string
  mainReference: string
  manuscript: string
  criteria: SermonReviewCriterion[]
}

export type SermonReviewConfiguration = AIConfiguration

export interface SermonReviewFinding {
  id: string
  criterion: SermonReviewCriterion
  severity: SermonReviewSeverity
  manuscriptQuote: string
  observation: string
  correction: string
  classification: string
  evidenceQuote: string
  evidenceSourceTitle?: string
  evidenceCitation?: string
  status: SermonReviewFindingStatus
}

export type SermonReviewValidationFailure =
  'invalidFields' | 'manuscriptAnchor' | 'sourceEvidence' | 'orthography' | 'structureScope'

export const VALIDATION_FAILURE_NAMES: Record<SermonReviewValidationFailure, string> = {
  invalidFields: 'critério ou formato',
  manuscriptAnchor: 'citação do manuscrito',
  sourceEvidence: 'evidência da fonte',
  orthography: 'correção ortográfica',
  structureScope: 'mapa do sermão',
}

export interface SermonAIReviewResult {
  findings: SermonReviewFinding[]
  rejectedFindingCount: number
  rejectionReasons: SermonReviewValidationFailure[]
  structure?: SermonStructureAssessment
  /** Trechos ou notas do mapa ocultados por citação inválida ou tamanho acima do contrato. */
  structureAdjustmentCount: number
  /** Aviso exibido com o resultado; só contagens e categorias fixas, nunca o texto rejeitado. */
  validationNotice?: string
  usage: AIUsage
}

/** Aviso da validação local (`SermonAIReviewResult.validationNotice`). */
export function reviewValidationNotice(
  result: Pick<
    SermonAIReviewResult,
    'rejectedFindingCount' | 'rejectionReasons' | 'structureAdjustmentCount'
  >,
): string | undefined {
  const parts: string[] = []
  if (result.rejectedFindingCount > 0) {
    const count = result.rejectedFindingCount
    const subject = count === 1 ? '1 apontamento foi ocultado' : `${count} apontamentos foram ocultados`
    const reasons = [...new Set(result.rejectionReasons.map((reason) => VALIDATION_FAILURE_NAMES[reason]))]
      .sort()
      .join(', ')
    const reason = reasons ? ` (${reasons})` : ''
    parts.push(`${subject} após a validação local${reason}. Nenhum texto rejeitado foi exibido.`)
  }
  if (result.structureAdjustmentCount > 0) {
    const count = result.structureAdjustmentCount
    parts.push(
      count === 1
        ? 'No mapa do sermão, 1 trecho ou nota foi ocultado por não corresponder ao manuscrito.'
        : `No mapa do sermão, ${count} trechos ou notas foram ocultados por não corresponderem ao manuscrito.`,
    )
  }
  return parts.length === 0 ? undefined : parts.join(' ')
}

// Resposta bruta do provedor

const rawFindingSchema = z.object({
  criterion: z.string(),
  severity: z.string(),
  manuscript_quote: z.string(),
  observation: z.string(),
  correction: z.string(),
  classification: z.string(),
  evidence_source_id: z.string(),
  evidence_quote: z.string(),
})

const rawStructureSchema = z.object({
  verdict: z.string(),
  summary: z.string(),
  central_idea: z.object({ status: z.string(), statement: z.string(), quote: z.string(), note: z.string() }),
  sections: z.array(
    z.object({ kind: z.string(), assessment: z.string(), start_quote: z.string(), note: z.string() }),
  ),
  movements: z.array(z.object({ label: z.string(), start_quote: z.string() })),
  gospel: z.object({ status: z.string(), quote: z.string(), note: z.string() }),
  four_pages: z.array(z.object({ page: z.string(), status: z.string(), quote: z.string() })),
})

/** O bloco `structure` é opcional na leitura: respostas antigas ou provedores que o ignorem valem. */
const reviewPayloadSchema = z.object({
  findings: z.array(rawFindingSchema),
  structure: rawStructureSchema.nullish(),
})

/** Apontamento como chega do provedor, antes da validação local. */
export type AIReviewRawFinding = z.infer<typeof rawFindingSchema>
/** Mapa do sermão como chega do provedor (chaves do JSON), antes da validação local. */
export type AIReviewRawStructure = z.infer<typeof rawStructureSchema>

// Cliente

const FIDELITY_CLASSIFICATIONS = ['contradiction', 'tension', 'unsupported', 'interpretive']
const SPELLING_CORRECTION = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u

function inputSize(manuscript: string, sources: readonly SermonReviewSource[]): number {
  return (
    utf8ByteLength(manuscript) + sources.reduce((total, source) => total + utf8ByteLength(source.text), 0)
  )
}

/** Fontes no formato enviado ao provedor, sem campos extras que o chamador tenha anexado. */
export function providerSources(sources: readonly SermonReviewSource[]): SermonReviewSource[] {
  return sources.map(({ id, title, citation, text }) => ({ id, title, citation, text }))
}

/**
 * Executa uma revisão (`SermonAIReviewClient.review`). Data litúrgica e título ficam fora do pacote
 * enviado. Apontamentos inválidos são ocultados individualmente; o resultado traz o consumo.
 */
export async function reviewSermon(
  context: SermonReviewContext,
  sources: readonly SermonReviewSource[],
  configuration: SermonReviewConfiguration,
): Promise<SermonAIReviewResult> {
  if (!context.manuscript.trim()) throw new SermonReviewError('emptyManuscript')
  if (context.criteria.length === 0) throw new SermonReviewError('noCriteria')
  if (!acceptsModel(configuration.provider, configuration.model)) throw new SermonReviewError('invalidModel')
  if (!configuration.apiKey) throw new SermonReviewError('noKey')
  if (!sources.every((source) => utf8ByteLength(source.text) <= MAXIMUM_BYTES_PER_SOURCE)) {
    throw new SermonReviewError('contextTooLarge')
  }
  if (inputSize(context.manuscript, sources) > MAXIMUM_INPUT_BYTES)
    throw new SermonReviewError('contextTooLarge')
  if (sources.length === 0 && context.criteria.every((criterion) => criterion === 'fidelity')) {
    return {
      findings: [],
      rejectedFindingCount: 0,
      rejectionReasons: [],
      structureAdjustmentCount: 0,
      usage: emptyUsage(configuration.provider, configuration.model),
    }
  }

  const log = configuration.http.log ?? silentIntegrationLog
  const operation = `revisão · ${providerName(configuration.provider)} · ${configuration.model}`
  const response = await completedStructuredResponse(configuration, operation, (budget) =>
    buildReviewRequest(context, sources, configuration, budget),
  )
  const output = outputText(response.root, configuration.provider)
  const parsed = output === undefined ? undefined : reviewPayloadSchema.safeParse(tryParseJSON(output))
  if (!parsed?.success) {
    log.record({
      level: 'ERRO',
      integration: 'IA',
      operation,
      status: response.status,
      note: `${responseDiagnostics(response.root, configuration.provider, response.byteLength)} · JSON incompatível com o contrato`,
    })
    throw new SermonReviewError('unreadableResponse', { usage: response.usage })
  }
  const payload = parsed.data

  const sourceByID = new Map(sources.map((source) => [source.id, source]))
  const findings: SermonReviewFinding[] = []
  const rejected = new Map<SermonReviewValidationFailure, number>()
  for (const item of payload.findings) {
    const outcome = validateFinding(item, context, sourceByID)
    if (typeof outcome === 'string') rejected.set(outcome, (rejected.get(outcome) ?? 0) + 1)
    else findings.push(outcome)
  }
  let structure: SermonStructureAssessment | undefined
  let structureAdjustments = 0
  if (payload.structure) {
    const validated = validateStructure(payload.structure, context)
    structure = validated.assessment
    structureAdjustments = validated.adjustments
  }
  const rejectedCount = [...rejected.values()].reduce((total, value) => total + value, 0)
  if (rejectedCount > 0 || structureAdjustments > 0) {
    const reasons = [...rejected.keys()]
      .map((reason) => VALIDATION_FAILURE_NAMES[reason])
      .sort()
      .join(', ')
    log.record({
      level: 'AVISO',
      integration: 'IA',
      operation,
      note: `validação local: ${rejectedCount} apontamentos rejeitados (${reasons}) · ${structureAdjustments} ajustes no mapa`,
    })
  }
  const rejectionReasons = [...rejected.keys()].sort((left, right) =>
    VALIDATION_FAILURE_NAMES[left] < VALIDATION_FAILURE_NAMES[right]
      ? -1
      : VALIDATION_FAILURE_NAMES[left] > VALIDATION_FAILURE_NAMES[right]
        ? 1
        : 0,
  )
  const result: SermonAIReviewResult = {
    findings,
    rejectedFindingCount: rejectedCount,
    rejectionReasons,
    structureAdjustmentCount: structureAdjustments,
    usage: response.usage,
  }
  if (structure) result.structure = structure
  const notice = reviewValidationNotice(result)
  if (notice) result.validationNotice = notice
  return result
}

/** Monta o pedido de revisão sem enviá-lo (`SermonAIReviewClient.makeRequest`). */
export function buildReviewRequest(
  context: SermonReviewContext,
  sources: readonly SermonReviewSource[],
  configuration: SermonReviewConfiguration,
  maxOutputTokens?: number,
): StructuredRequest {
  const isClaude = configuration.provider === 'anthropic'
  const input = {
    context: {
      mainReference: context.mainReference,
      manuscript: context.manuscript,
      criteria: context.criteria,
    },
    sources: providerSources(sources),
  }
  const request = makeStructuredRequest({
    userText: JSON.stringify(input),
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    formatName: 'sermonreview',
    schema: sermonReviewSchema(context.criteria, sources, isClaude),
    maxOutputTokens: maxOutputTokens ?? (isClaude ? (CLAUDE_OUTPUT_TOKEN_BUDGETS[0] ?? 16_000) : 4_000),
    configuration,
  })
  if (isClaude) request.timeoutMs = CLAUDE_STRUCTURED_TIMEOUT_MS
  return request
}

type ValidationOutcome = SermonReviewFinding | SermonReviewValidationFailure

function validateFinding(
  item: AIReviewRawFinding,
  context: SermonReviewContext,
  sourceByID: Map<string, SermonReviewSource>,
): ValidationOutcome {
  const criterion = isSermonReviewCriterion(item.criterion) ? item.criterion : undefined
  const severity = (SERMON_REVIEW_SEVERITIES as readonly string[]).includes(item.severity)
    ? (item.severity as SermonReviewSeverity)
    : undefined
  if (
    !criterion ||
    !context.criteria.includes(criterion) ||
    !severity ||
    !item.observation.trim() ||
    characterCount(item.observation) > 800
  ) {
    return 'invalidFields'
  }
  const quote = item.manuscript_quote.trim()
  if (quote && !containsExact(quote, context.manuscript)) return 'manuscriptAnchor'
  if (criterion === 'spelling') {
    if (!quote || !SPELLING_CORRECTION.test(item.correction) || characterCount(item.correction) > 64) {
      return 'orthography'
    }
  } else if (item.correction) {
    return 'orthography'
  }

  let sourceTitle: string | undefined
  let sourceCitation: string | undefined
  let evidence = item.evidence_quote.trim()
  if (criterion === 'fidelity') {
    const source = sourceByID.get(item.evidence_source_id)
    if (
      !quote ||
      !source ||
      !evidence ||
      !containsExact(evidence, source.text) ||
      !FIDELITY_CLASSIFICATIONS.includes(item.classification)
    ) {
      return 'sourceEvidence'
    }
    sourceTitle = source.title
    sourceCitation = source.citation
  } else {
    evidence = ''
    if (item.evidence_source_id) return 'sourceEvidence'
    if (item.classification !== criterion) return 'invalidFields'
  }

  if (criterion !== 'spelling' && quote && characterCount(quote) > 420) return 'manuscriptAnchor'
  if ((criterion === 'spelling' || criterion === 'fidelity') && !quote) return 'manuscriptAnchor'
  const finding: SermonReviewFinding = {
    id: globalThis.crypto.randomUUID(),
    criterion,
    severity,
    manuscriptQuote: quote,
    observation: item.observation,
    correction: item.correction,
    classification: item.classification,
    evidenceQuote: evidence,
    status: 'open',
  }
  if (sourceTitle !== undefined) finding.evidenceSourceTitle = sourceTitle
  if (sourceCitation !== undefined) finding.evidenceCitation = sourceCitation
  return finding
}

// Esquemas

/**
 * Esquema da revisão. O Claude recebe um único formato de apontamento (`compactFindings`), que
 * evita compilar cinco objetos quase idênticos em uma união; os demais recebem `oneOf` por critério.
 */
export function sermonReviewSchema(
  criteria: readonly SermonReviewCriterion[],
  sources: readonly SermonReviewSource[],
  compactFindings = false,
): JSONSchema {
  const availableCriteria = criteria.filter((criterion) => criterion !== 'fidelity' || sources.length > 0)
  const findings: JSONSchema = { type: 'array' }
  if (availableCriteria.length === 0) {
    findings.maxItems = 0
  } else if (compactFindings) {
    findings.items = compactFindingSchema(availableCriteria, sources)
  } else {
    findings.items = { oneOf: availableCriteria.map((criterion) => findingSchema(criterion, sources)) }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: { findings, structure: structureSchema() },
    required: ['findings', 'structure'],
  }
}

/** As relações entre critério, correção e evidência continuam na validação local. */
function compactFindingSchema(
  criteria: readonly SermonReviewCriterion[],
  sources: readonly SermonReviewSource[],
): JSONSchema {
  const hasFidelity = criteria.includes('fidelity')
  const classifications = criteria.flatMap((criterion) =>
    criterion === 'fidelity' ? FIDELITY_CLASSIFICATIONS : [criterion],
  )
  const correction: JSONSchema = criteria.includes('spelling')
    ? {
        type: 'string',
        maxLength: 64,
        description:
          'Somente em spelling: uma palavra corrigida, sem reescrever a frase. Nos demais critérios, string vazia.',
      }
    : { type: 'string', enum: [''] }
  const evidence: JSONSchema = hasFidelity
    ? {
        type: 'string',
        description:
          'Em fidelity, evidência literal da fonte identificada. Nos demais critérios, string vazia.',
      }
    : { type: 'string', enum: [''] }
  const fields: Record<string, JSONSchema> = {
    criterion: { type: 'string', enum: [...criteria] },
    severity: { type: 'string', enum: [...SERMON_REVIEW_SEVERITIES] },
    manuscript_quote: {
      type: 'string',
      maxLength: 420,
      description: 'Trecho literal do manuscrito; obrigatório para spelling e fidelity.',
    },
    observation: { type: 'string', minLength: 1, maxLength: 800 },
    correction,
    classification: { type: 'string', enum: classifications },
    evidence_source_id: {
      type: 'string',
      enum: ['', ...(hasFidelity ? sources.map((source) => source.id) : [])],
      description: 'Somente fidelity usa o ID de uma fonte fornecida. Nos demais critérios, string vazia.',
    },
    evidence_quote: evidence,
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: fields,
    required: Object.keys(fields).sort(),
  }
}

function findingSchema(criterion: SermonReviewCriterion, sources: readonly SermonReviewSource[]): JSONSchema {
  const quote: JSONSchema = { type: 'string' }
  let correction: JSONSchema = { type: 'string', enum: [''] }
  let classification: JSONSchema
  let sourceID: JSONSchema = { type: 'string', enum: [''] }
  let evidence: JSONSchema = { type: 'string', enum: [''] }
  switch (criterion) {
    case 'spelling':
      correction = { type: 'string', minLength: 1, maxLength: 64 }
      classification = { type: 'string', enum: ['spelling'] }
      break
    case 'fidelity':
      quote.minLength = 1
      quote.maxLength = 420
      sourceID = { type: 'string', enum: sources.map((source) => source.id) }
      evidence = { type: 'string', minLength: 1 }
      classification = { type: 'string', enum: [...FIDELITY_CLASSIFICATIONS] }
      break
    case 'structure':
    case 'clarity':
    case 'tone':
      quote.maxLength = 420
      classification = { type: 'string', enum: [criterion] }
      break
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      criterion: { type: 'string', enum: [criterion] },
      severity: { type: 'string', enum: [...SERMON_REVIEW_SEVERITIES] },
      manuscript_quote: quote,
      observation: { type: 'string', minLength: 1, maxLength: 800 },
      correction,
      classification,
      evidence_source_id: sourceID,
      evidence_quote: evidence,
    },
    required: [
      'criterion',
      'severity',
      'manuscript_quote',
      'observation',
      'correction',
      'classification',
      'evidence_source_id',
      'evidence_quote',
    ],
  }
}

/** Esquema do mapa do sermão. Todos os trechos são literais do manuscrito e são conferidos localmente. */
function structureSchema(): JSONSchema {
  const quote = (): JSONSchema => ({ type: 'string', maxLength: 420 })
  const note = (): JSONSchema => ({ type: 'string', maxLength: 300 })
  const section: JSONSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: [...STRUCTURE_SECTION_KINDS] },
      assessment: { type: 'string', enum: ['fulfills', 'partial', 'missing'] },
      start_quote: quote(),
      note: note(),
    },
    required: ['kind', 'assessment', 'start_quote', 'note'],
  }
  const centralIdea: JSONSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['clear', 'diffuse', 'not_found'] },
      statement: { type: 'string', maxLength: 200 },
      quote: quote(),
      note: note(),
    },
    required: ['status', 'statement', 'quote', 'note'],
  }
  const movement: JSONSchema = {
    type: 'object',
    additionalProperties: false,
    properties: { label: { type: 'string', maxLength: 90 }, start_quote: quote() },
    required: ['label', 'start_quote'],
  }
  const gospel: JSONSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['explicit', 'implicit', 'not_found'] },
      quote: quote(),
      note: note(),
    },
    required: ['status', 'quote', 'note'],
  }
  const page: JSONSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'string', enum: [...STRUCTURE_PAGE_KINDS] },
      status: { type: 'string', enum: ['present', 'brief', 'not_found'] },
      quote: quote(),
    },
    required: ['page', 'status', 'quote'],
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      verdict: { type: 'string', enum: ['solid', 'attention', 'fragile'] },
      summary: { type: 'string', maxLength: 600 },
      central_idea: centralIdea,
      sections: { type: 'array', items: section, minItems: 3, maxItems: 3 },
      movements: { type: 'array', items: movement, maxItems: 8 },
      gospel,
      four_pages: { type: 'array', items: page, minItems: 4, maxItems: 4 },
    },
    required: ['verdict', 'summary', 'central_idea', 'sections', 'movements', 'gospel', 'four_pages'],
  }
}

// Validação do mapa

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/**
 * Confere o mapa do sermão: trechos precisam existir literalmente no manuscrito e notas respeitam o
 * tamanho do contrato. Um status que exige trecho é rebaixado quando o trecho não confere.
 */
export function validateStructure(
  raw: AIReviewRawStructure,
  context: Pick<SermonReviewContext, 'manuscript'>,
): { assessment: SermonStructureAssessment; adjustments: number } {
  const manuscript = context.manuscript
  let adjustments = 0

  const cleanQuote = (value: string): string => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (characterCount(trimmed) > 420 || !containsExact(trimmed, manuscript)) {
      adjustments += 1
      return ''
    }
    return trimmed
  }

  const cleanText = (value: string, limit: number): string => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (characterCount(trimmed) > limit) {
      adjustments += 1
      return ''
    }
    return trimmed
  }

  const sections: StructureSection[] = []
  for (const kind of STRUCTURE_SECTION_KINDS) {
    const rawSection = raw.sections.find((section) => section.kind === kind)
    if (!rawSection) {
      adjustments += 1
      sections.push({ kind, assessment: 'missing', startQuote: '', note: '' })
      continue
    }
    const startQuote = cleanQuote(rawSection.start_quote)
    let assessment = oneOf(rawSection.assessment, ['fulfills', 'partial', 'missing'] as const) ?? 'missing'
    if (assessment === 'fulfills' && !startQuote) {
      assessment = 'partial'
      adjustments += 1
    }
    sections.push({ kind, assessment, startQuote, note: cleanText(rawSection.note, 300) })
  }

  const ideaQuote = cleanQuote(raw.central_idea.quote)
  let ideaStatus = oneOf(raw.central_idea.status, ['clear', 'diffuse', 'not_found'] as const) ?? 'not_found'
  if (ideaStatus === 'clear' && !ideaQuote) {
    ideaStatus = 'diffuse'
    adjustments += 1
  }
  const statement = ideaStatus === 'not_found' ? '' : cleanText(raw.central_idea.statement, 200)
  const centralIdea: StructureCentralIdea = {
    status: ideaStatus,
    statement,
    quote: ideaQuote,
    note: cleanText(raw.central_idea.note, 300),
  }

  const movements: StructureMovement[] = []
  for (const rawMovement of raw.movements.slice(0, 8)) {
    const label = cleanText(rawMovement.label, 90)
    if (!label) continue
    const quote = cleanQuote(rawMovement.start_quote)
    if (!quote) {
      adjustments += 1
      continue
    }
    movements.push({ label, startQuote: quote })
  }

  const gospelQuote = cleanQuote(raw.gospel.quote)
  let gospelStatus = oneOf(raw.gospel.status, ['explicit', 'implicit', 'not_found'] as const) ?? 'not_found'
  if (gospelStatus === 'explicit' && !gospelQuote) {
    gospelStatus = 'implicit'
    adjustments += 1
  }
  const gospel: StructureGospel = {
    status: gospelStatus,
    quote: gospelQuote,
    note: cleanText(raw.gospel.note, 300),
  }

  const pages: StructurePage[] = []
  for (const kind of STRUCTURE_PAGE_KINDS) {
    const rawPage = raw.four_pages.find((page) => page.page === kind)
    if (!rawPage) {
      pages.push({ page: kind, status: 'not_found', quote: '' })
      continue
    }
    const pageQuote = cleanQuote(rawPage.quote)
    let status = oneOf(rawPage.status, ['present', 'brief', 'not_found'] as const) ?? 'not_found'
    if (status === 'present' && !pageQuote) {
      status = 'brief'
      adjustments += 1
    }
    pages.push({ page: kind, status, quote: pageQuote })
  }

  const assessment: SermonStructureAssessment = {
    verdict: oneOf(raw.verdict, ['solid', 'attention', 'fragile'] as const) ?? 'attention',
    summary: cleanText(raw.summary, 600),
    centralIdea,
    sections,
    movements,
    gospel,
    fourPages: pages,
  }
  return { assessment, adjustments }
}
