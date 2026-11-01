import type { UsageSummary } from '@pregar/core/plans/contract'
import type {
  AIModelOption,
  AIResearchSource,
  SermonAIQuestion,
  SermonReviewCriterion,
  SermonReviewFindingStatus,
  SermonReviewReport,
} from '@pregar/core/ai'
import type { AIProviderId } from './types'

/** Como a IA será chamada agora: assinatura (servidor), chaves próprias ou indisponível. */
export interface AIAccess {
  mode: 'pro' | 'byok' | 'none'
  provider: AIProviderId
  model: string
  /** "Claude · claude-sonnet-5-5" ou "Assinatura do Pregar". */
  label: string
  message: string
  usage: UsageSummary | null
}

export interface ReviewSourceSummary {
  id: string
  kind: 'bible' | 'pdf' | 'web'
  title: string
  citation: string
  bytes: number
}

export interface ReviewRequestBase {
  /** Identificador escolhido pela janela para poder cancelar. */
  requestId: string
  dateKey: string
  title: string
  mainReference: string
  manuscript: string
  sourceIds: string[]
}

export interface AIInvokeChannels {
  'ai:access': { req: { purpose: 'review' | 'research' }; res: AIAccess }
  'ai:reviewSources': {
    req: { dateKey: string; mainReference: string; bibles: string[]; includeMaterials: boolean }
    res: { sources: ReviewSourceSummary[]; totalBytes: number; blockedReason: string | null }
  }
  'ai:review': {
    req: ReviewRequestBase & { criteria: SermonReviewCriterion[] }
    res: { report: SermonReviewReport; reports: SermonReviewReport[]; validationNotice: string | null; usage: UsageSummary | null }
  }
  'ai:questions': {
    req: ReviewRequestBase
    res: { questions: SermonAIQuestion[]; validationNotice: string | null; usage: UsageSummary | null }
  }
  'ai:research': {
    req: { requestId: string; reference: string; occasion: string | null; dateKey: string }
    res: { sources: AIResearchSource[]; searchedAt: string; usage: UsageSummary | null }
  }
  'ai:researchCached': {
    req: { reference: string; occasion: string | null; dateKey: string }
    res: { sources: AIResearchSource[]; searchedAt: string } | null
  }
  'ai:cancel': { req: { requestId: string }; res: void }
  'ai:claudeModels': { req: void; res: AIModelOption[] }
  'reviews:list': { req: { dateKey: string }; res: SermonReviewReport[] }
  'reviews:setFindingStatus': {
    req: { dateKey: string; reportId: string; findingId: string; status: SermonReviewFindingStatus }
    res: SermonReviewReport[]
  }
  'reviews:delete': { req: { dateKey: string; reportId: string }; res: SermonReviewReport[] }
}

export interface AIEventChannels {
  'ai:progress': { requestId: string; stage: 'preparing' | 'sending' | 'waiting' | 'validating'; message: string }
}
