import { z } from 'zod'
import { silentIntegrationLog } from '../log/integration'
import { tryParseJSON } from '../util/http'
import { SermonAIQuestionError, SermonReviewError } from './errors'
import { MAXIMUM_BYTES_PER_SOURCE, MAXIMUM_INPUT_BYTES, utf8ByteLength } from './materials'
import { QUESTION_SYSTEM_PROMPT } from './prompts'
import { acceptsModel, providerName } from './providers'
import { providerSources } from './review'
import type { SermonReviewConfiguration, SermonReviewSource } from './review'
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
import type { JSONSchema, StructuredRequest, StructuredResponse } from './structured'
import type { AIUsage } from './usage'

/**
 * Perguntas de emergência (`SermonAIQuestionClient`): até três perguntas redigidas pelo modelo,
 * ancoradas em trechos literais do manuscrito. Resultado temporário; nada é salvo no sermão.
 */

export interface SermonQuestionContext {
  dateKey: string
  title: string
  mainReference: string
  manuscript: string
}

export interface SermonAIQuestion {
  id: string
  question: string
  manuscriptQuote: string
  relatedManuscriptQuote?: string
  evidenceQuote: string
  evidenceSourceTitle?: string
  evidenceCitation?: string
}

export interface SermonAIQuestionResult {
  questions: SermonAIQuestion[]
  rejectedQuestionCount: number
  validationNotice?: string
  usage: AIUsage
}

export const MAXIMUM_QUESTIONS = 3
/** Saída padrão das perguntas fora do Claude. */
export const QUESTION_OUTPUT_TOKENS = 1_400

export function questionValidationNotice(rejectedQuestionCount: number): string | undefined {
  if (rejectedQuestionCount <= 0) return undefined
  return rejectedQuestionCount === 1
    ? 'Uma pergunta foi descartada por formato ou citação inválida.'
    : `${rejectedQuestionCount} perguntas foram descartadas por formato ou citação inválida.`
}

type QuestionValidationFailure = 'fields' | 'manuscriptAnchor' | 'sourceEvidence' | 'excess'

const rawQuestionSchema = z.object({
  question: z.string().nullish(),
  manuscript_quote: z.string(),
  related_manuscript_quote: z.string().nullish(),
  evidence_source_id: z.string(),
  evidence_quote: z.string(),
})

const questionResponseSchema = z.object({ questions: z.array(rawQuestionSchema) })

type RawQuestion = z.infer<typeof rawQuestionSchema>

function questionErrorFrom(error: SermonReviewError): SermonAIQuestionError {
  const usage = error.usage ? { usage: error.usage } : {}
  switch (error.kind) {
    case 'provider':
      return new SermonAIQuestionError('provider', {
        status: error.status ?? 0,
        detail: error.detail ?? null,
        ...usage,
      })
    case 'incompleteResponse':
      return new SermonAIQuestionError('incompleteResponse', usage)
    case 'refusedResponse':
      return new SermonAIQuestionError('refusedResponse', usage)
    case 'contextTooLarge':
      return new SermonAIQuestionError('contextTooLarge', usage)
    default:
      return new SermonAIQuestionError('unreadableResponse', usage)
  }
}

/** Pede as perguntas e confere cada uma; itens inválidos são descartados individualmente. */
export async function generateSermonQuestions(
  context: SermonQuestionContext,
  sources: readonly SermonReviewSource[],
  configuration: SermonReviewConfiguration,
): Promise<SermonAIQuestionResult> {
  const log = configuration.http.log ?? silentIntegrationLog
  const operation = `perguntas de emergência · ${providerName(configuration.provider)} · ${configuration.model}`
  let response: StructuredResponse
  try {
    response = await completedStructuredResponse(
      configuration,
      operation,
      (budget) => buildQuestionRequest(context, sources, configuration, budget),
      QUESTION_OUTPUT_TOKENS,
    )
  } catch (error) {
    if (error instanceof SermonReviewError) throw questionErrorFrom(error)
    throw error
  }
  const output = outputText(response.root, configuration.provider)
  const parsed = output === undefined ? undefined : questionResponseSchema.safeParse(tryParseJSON(output))
  if (!parsed?.success) {
    log.record({
      level: 'ERRO',
      integration: 'IA',
      operation,
      status: response.status,
      note: `${responseDiagnostics(response.root, configuration.provider, response.byteLength)} · JSON incompatível com o contrato de perguntas`,
    })
    throw new SermonAIQuestionError('unreadableResponse', { usage: response.usage })
  }
  const received = parsed.data.questions

  const sourceByID = new Map(sources.map((source) => [source.id, source]))
  const accepted: SermonAIQuestion[] = []
  const rejected = new Map<QuestionValidationFailure, number>()
  for (const item of received) {
    if (accepted.length >= MAXIMUM_QUESTIONS) {
      rejected.set('excess', (rejected.get('excess') ?? 0) + 1)
      continue
    }
    const outcome = validateQuestion(item, context, sourceByID)
    if (typeof outcome === 'string') rejected.set(outcome, (rejected.get(outcome) ?? 0) + 1)
    else accepted.push(outcome)
  }
  const rejectedCount = [...rejected.values()].reduce((total, value) => total + value, 0)
  if (rejectedCount > 0) {
    const counts = [...rejected.keys()]
      .sort()
      .map((reason) => `${reason}=${rejected.get(reason) ?? 0}`)
      .join(',')
    log.record({
      level: 'AVISO',
      integration: 'IA',
      operation,
      note: `validação local: aceitas=${accepted.length} · descartadas=${rejectedCount} · ${counts}`,
    })
  }
  if (received.length > 0 && accepted.length === 0) {
    throw new SermonAIQuestionError('invalidQuestion', { usage: response.usage })
  }
  const result: SermonAIQuestionResult = {
    questions: accepted,
    rejectedQuestionCount: rejectedCount,
    usage: response.usage,
  }
  const notice = questionValidationNotice(rejectedCount)
  if (notice) result.validationNotice = notice
  return result
}

/**
 * Monta o pedido de perguntas sem enviá-lo. Confere manuscrito, modelo, chave e limites antes de
 * qualquer chamada; data litúrgica e título não entram no pacote.
 */
export function buildQuestionRequest(
  context: SermonQuestionContext,
  sources: readonly SermonReviewSource[],
  configuration: SermonReviewConfiguration,
  maxOutputTokens?: number,
): StructuredRequest {
  if (!context.manuscript.trim()) throw new SermonAIQuestionError('emptyManuscript')
  if (!acceptsModel(configuration.provider, configuration.model))
    throw new SermonAIQuestionError('invalidModel')
  if (!configuration.apiKey) throw new SermonAIQuestionError('noKey')
  if (!sources.every((source) => utf8ByteLength(source.text) <= MAXIMUM_BYTES_PER_SOURCE)) {
    throw new SermonAIQuestionError('contextTooLarge')
  }
  const size =
    utf8ByteLength(context.manuscript) +
    sources.reduce((total, source) => total + utf8ByteLength(source.text), 0)
  if (size > MAXIMUM_INPUT_BYTES) throw new SermonAIQuestionError('contextTooLarge')

  const isClaude = configuration.provider === 'anthropic'
  const payload = {
    context: { mainReference: context.mainReference, manuscript: context.manuscript },
    sources: providerSources(sources),
  }
  const request = makeStructuredRequest({
    userText: JSON.stringify(payload),
    systemPrompt: QUESTION_SYSTEM_PROMPT,
    formatName: 'sermonquestions',
    schema: questionSchema(sources),
    maxOutputTokens:
      maxOutputTokens ?? (isClaude ? (CLAUDE_OUTPUT_TOKEN_BUDGETS[0] ?? 16_000) : QUESTION_OUTPUT_TOKENS),
    configuration,
  })
  if (isClaude) request.timeoutMs = CLAUDE_STRUCTURED_TIMEOUT_MS
  return request
}

function validateQuestion(
  item: RawQuestion,
  context: SermonQuestionContext,
  sourceByID: Map<string, SermonReviewSource>,
): SermonAIQuestion | QuestionValidationFailure {
  const quote = item.manuscript_quote.trim()
  if (!quote || characterCount(quote) > 240 || !containsExact(quote, context.manuscript))
    return 'manuscriptAnchor'
  if (item.question === null || item.question === undefined) return 'fields'
  const question = item.question.trim()
  if (!question || characterCount(question) > 400) return 'fields'
  const related = (item.related_manuscript_quote ?? '').trim()
  let relatedQuote: string | undefined
  if (related) {
    if (characterCount(related) > 240 || related === quote || !containsExact(related, context.manuscript)) {
      return 'manuscriptAnchor'
    }
    relatedQuote = related
  }

  const evidence = item.evidence_quote.trim()
  let sourceTitle: string | undefined
  let sourceCitation: string | undefined
  if (!(item.evidence_source_id === '' && evidence === '')) {
    const source = sourceByID.get(item.evidence_source_id)
    if (!source || !evidence || !containsExact(evidence, source.text)) return 'sourceEvidence'
    sourceTitle = source.title
    sourceCitation = source.citation
  }
  const result: SermonAIQuestion = {
    id: globalThis.crypto.randomUUID(),
    question,
    manuscriptQuote: quote,
    evidenceQuote: evidence,
  }
  if (relatedQuote !== undefined) result.relatedManuscriptQuote = relatedQuote
  if (sourceTitle !== undefined) result.evidenceSourceTitle = sourceTitle
  if (sourceCitation !== undefined) result.evidenceCitation = sourceCitation
  return result
}

function questionSchema(sources: readonly SermonReviewSource[]): JSONSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        maxItems: MAXIMUM_QUESTIONS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            question: { type: 'string', minLength: 1, maxLength: 400 },
            manuscript_quote: { type: 'string', minLength: 1, maxLength: 240 },
            related_manuscript_quote: {
              type: 'string',
              maxLength: 240,
              description:
                'Segundo trecho literal quando a pergunta relaciona duas partes existentes; string vazia nos demais casos.',
            },
            evidence_source_id: { type: 'string', enum: ['', ...sources.map((source) => source.id)] },
            evidence_quote: { type: 'string' },
          },
          required: [
            'question',
            'manuscript_quote',
            'related_manuscript_quote',
            'evidence_source_id',
            'evidence_quote',
          ],
        },
      },
    },
    required: ['questions'],
  }
}
