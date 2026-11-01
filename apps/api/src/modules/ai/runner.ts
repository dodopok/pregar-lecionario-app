import type { z } from 'zod'
import type { aiQuestionsRequestSchema, aiResearchRequestSchema, aiReviewRequestSchema } from './schemas'

export interface AIUsage {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUSD: number
}

export interface AIRunResult<T = unknown> {
  result: T
  usage: AIUsage
}

/** Falha do provedor com tokens já consumidos (por exemplo, resposta truncada). */
export class AIRunError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly usage?: AIUsage,
  ) {
    super(message)
    this.name = 'AIRunError'
  }
}

export type AIReviewRequest = z.infer<typeof aiReviewRequestSchema>
export type AIQuestionsRequest = z.infer<typeof aiQuestionsRequestSchema>
export type AIResearchRequest = z.infer<typeof aiResearchRequestSchema>

/** Executa as operações de IA com as chaves do servidor. A implementação real usa @pregar/core/ai. */
export interface AIRunner {
  review(request: AIReviewRequest, signal: AbortSignal): Promise<AIRunResult>
  questions(request: AIQuestionsRequest, signal: AbortSignal): Promise<AIRunResult>
  research(request: AIResearchRequest, signal: AbortSignal): Promise<AIRunResult>
}
