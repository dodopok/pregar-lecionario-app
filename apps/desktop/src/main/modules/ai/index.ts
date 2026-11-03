import { z } from 'zod'
import { SERMON_KEY_PATTERN } from '@pregar/core/util/dates'
import {
  AI_PROVIDERS,
  fetchClaudeModels,
  generateSermonQuestions,
  makeSermonReviewReport,
  providerName,
  reviewSermon,
  searchResearchSources,
  setFindingStatus,
  SermonReviewReportStore,
  isSermonReviewCriterion,
} from '@pregar/core/ai'
import type {
  AIProvider,
  AIResearchSource,
  SermonAIQuestion,
  SermonReviewSource,
  SermonStructureAssessment,
  SermonReviewFinding,
} from '@pregar/core/ai'
import { favoriteAuthorsFromData } from '@pregar/core/sources'
import type { UsageSummary } from '@pregar/core/plans/contract'
import type { AIAccess, ReviewSourceSummary } from '@shared/ipc-ai'
import type { WebContents } from 'electron'
import type { MainContext } from '../../context'
import { handle, UserFacingError } from '../../ipc/router'
import { ReviewReportRepository } from '../../storage/reviews'

const MAX_SOURCE_BYTES = 24_000
const MAX_TOTAL_BYTES = 120_000
const SOURCE_CACHE_MS = 15 * 60 * 1000
const AI_TIMEOUT_MS = 6 * 60 * 1000

const dateKey = z.string().regex(SERMON_KEY_PATTERN)
const providerSchema = z.enum(AI_PROVIDERS as unknown as [AIProvider, ...AIProvider[]])

interface CachedSources {
  at: number
  sources: Map<string, SermonReviewSource & { kind: ReviewSourceSummary['kind'] }>
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function registerAI(context: MainContext): void {
  const reports = new SermonReviewReportStore(new ReviewReportRepository(context.database))
  const controllers = new Map<string, AbortController>()
  const sourceCache = new Map<string, CachedSources>()
  const research = context.kv('research')

  function useServer(): boolean {
    return context.account.isPro() && !context.currentSettings().ai.preferOwnKeys
  }

  function access(purpose: 'review' | 'research'): AIAccess {
    const settings = context.currentSettings().ai
    const provider = purpose === 'review' ? settings.reviewProvider : settings.researchProvider
    const model = purpose === 'review' ? settings.reviewModel : settings.researchModel
    const usage = context.account.current().account?.usage ?? null
    if (useServer()) {
      return {
        mode: 'pro',
        provider,
        model,
        label: 'Assinatura do Pregar',
        message: 'As análises usam a sua assinatura; nenhuma chave é necessária.',
        usage,
      }
    }
    if (context.secrets.get(provider)) {
      return {
        mode: 'byok',
        provider,
        model,
        label: `${providerName(provider)} · ${model}`,
        message: `As análises usam a sua chave do ${providerName(provider)}; o consumo é cobrado na sua conta do provedor.`,
        usage: null,
      }
    }
    return {
      mode: 'none',
      provider,
      model,
      label: providerName(provider),
      message: `Assine o Pregar ou salve a chave do ${providerName(provider)} em Preferências › Inteligência artificial.`,
      usage: null,
    }
  }

  function begin(requestId: string, sender: WebContents): AbortController {
    controllers.get(requestId)?.abort()
    const controller = new AbortController()
    controllers.set(requestId, controller)
    const timer = setTimeout(() => controller.abort(new Error('timeout')), AI_TIMEOUT_MS)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    sender.once('destroyed', () => controller.abort())
    return controller
  }

  function progress(
    sender: WebContents,
    requestId: string,
    stage: 'preparing' | 'sending' | 'waiting' | 'validating',
    message: string,
  ): void {
    if (!sender.isDestroyed()) sender.send('pregar:event', 'ai:progress', { requestId, stage, message })
  }

  function byokConfig(purpose: 'review' | 'research', signal: AbortSignal) {
    const current = access(purpose)
    if (current.mode !== 'byok') throw new UserFacingError(current.message, 'ai_unavailable')
    return {
      provider: current.provider,
      model: current.model,
      apiKey: context.secrets.get(current.provider) ?? '',
      http: context.http(signal),
    }
  }

  async function refreshUsage(): Promise<UsageSummary | null> {
    try {
      return (await context.account.refresh(true)).account?.usage ?? null
    } catch {
      return null
    }
  }

  function selectedSources(key: string, ids: string[]): SermonReviewSource[] {
    if (ids.length === 0) return []
    const cached = sourceCache.get(key)
    if (!cached || Date.now() - cached.at > SOURCE_CACHE_MS) {
      throw new UserFacingError(
        'Os materiais selecionados precisam ser conferidos de novo. Reabra a folha de revisão.',
      )
    }
    const chosen = ids
      .map((id) => cached.sources.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const total = chosen.reduce((sum, item) => sum + bytes(item.text), 0)
    if (chosen.some((item) => bytes(item.text) > MAX_SOURCE_BYTES) || total > MAX_TOTAL_BYTES) {
      throw new UserFacingError(
        'O conjunto selecionado excede o limite desta revisão. Desmarque alguns materiais e tente novamente.',
      )
    }
    return chosen.map(({ id, title, citation, text }) => ({ id, title, citation, text }))
  }

  handle('ai:access', ({ purpose }) => access(z.enum(['review', 'research']).parse(purpose)))

  handle('ai:reviewSources', async ({ dateKey: key, mainReference, bibles, includeMaterials }) => {
    const day = dateKey.parse(key)
    const reference = z.string().trim().max(200).parse(mainReference)
    const codes = z.array(z.string().trim().min(1).max(20)).max(6).parse(bibles)
    const sources = new Map<string, SermonReviewSource & { kind: ReviewSourceSummary['kind'] }>()
    let blockedReason: string | null = null
    if (reference) {
      for (const code of codes) {
        try {
          const passage = await context.liturgy.passage(reference, code)
          const text = passage.verses?.length
            ? passage.verses
                .map((verse) => `${verse.chapter ? `${verse.chapter}:` : ''}${verse.number} ${verse.text}`)
                .join('\n')
            : (passage.content ?? '')
          if (text.trim()) {
            sources.set(`bible:${code}`, {
              id: `bible:${code}`,
              kind: 'bible',
              title: `${reference} (${code.toUpperCase()})`,
              citation: `Estêvão API v2 · ${code.toUpperCase()}`,
              text,
            })
          }
        } catch (error) {
          blockedReason =
            error instanceof Error ? error.message : 'Não foi possível carregar o texto bíblico.'
        }
      }
    }
    if (includeMaterials && context.modules.reviewMaterials) {
      try {
        for (const material of await context.modules.reviewMaterials.collect(day, reference)) {
          sources.set(material.id, { ...material, kind: material.id.startsWith('web') ? 'web' : 'pdf' })
        }
      } catch (error) {
        blockedReason =
          error instanceof Error ? error.message : 'Não foi possível extrair os materiais marcados.'
      }
    }
    sourceCache.set(day, { at: Date.now(), sources })
    const summaries = [...sources.values()].map((source) => ({
      id: source.id,
      kind: source.kind,
      title: source.title,
      citation: source.citation,
      bytes: bytes(source.text),
    }))
    const totalBytes = summaries.reduce((sum, item) => sum + item.bytes, 0)
    if (
      !blockedReason &&
      (summaries.some((item) => item.bytes > MAX_SOURCE_BYTES) || totalBytes > MAX_TOTAL_BYTES)
    ) {
      blockedReason =
        'O conjunto selecionado excede o limite desta revisão. Desmarque alguns materiais e tente novamente.'
    }
    return { sources: summaries, totalBytes, blockedReason }
  })

  handle('ai:review', async (request, event) => {
    const day = dateKey.parse(request.dateKey)
    const criteria = z.array(z.string()).min(1).max(5).parse(request.criteria).filter(isSermonReviewCriterion)
    if (criteria.length === 0) throw new UserFacingError('Selecione ao menos um critério de revisão.')
    const reviewContext = {
      dateKey: day,
      title: z.string().max(500).parse(request.title),
      mainReference: z.string().max(200).parse(request.mainReference),
      manuscript: z
        .string()
        .max(200_000, 'O manuscrito é longo demais para uma revisão.')
        .parse(request.manuscript),
      criteria,
    }
    const sources = selectedSources(day, z.array(z.string()).max(30).parse(request.sourceIds))
    const controller = begin(request.requestId, event.sender)
    try {
      progress(event.sender, request.requestId, 'sending', 'Enviando o manuscrito para análise…')
      let result: {
        findings: SermonReviewFinding[]
        structure?: SermonStructureAssessment
        validationNotice?: string
      }
      let provider: AIProvider
      let model: string
      let usage: UsageSummary | null = null
      if (useServer()) {
        const response = await context.api.request<{
          result: typeof result
          model: string
          provider: AIProvider
          usage: UsageSummary
        }>('POST', '/v1/ai/review', {
          body: {
            mainReference: reviewContext.mainReference,
            manuscript: reviewContext.manuscript,
            criteria,
            sources,
          },
          timeoutMs: AI_TIMEOUT_MS,
          signal: controller.signal,
          operation: 'revisão · assinatura',
        })
        result = response.result
        provider = response.provider
        model = response.model
        usage = response.usage
      } else {
        const config = byokConfig('review', controller.signal)
        progress(event.sender, request.requestId, 'waiting', 'Aguardando a resposta do provedor…')
        const outcome = await reviewSermon(reviewContext, sources, config)
        result = outcome
        provider = config.provider
        model = outcome.usage.model || config.model
      }
      progress(event.sender, request.requestId, 'validating', 'Conferindo os trechos citados…')
      const report = await makeSermonReviewReport(reviewContext, provider, model, result)
      const saved = await reports.save(report)
      if (useServer()) void refreshUsage()
      return { report, reports: saved, validationNotice: result.validationNotice ?? null, usage }
    } finally {
      controllers.delete(request.requestId)
    }
  })

  handle('ai:questions', async (request, event) => {
    const day = dateKey.parse(request.dateKey)
    const questionContext = {
      dateKey: day,
      title: z.string().max(500).parse(request.title),
      mainReference: z.string().max(200).parse(request.mainReference),
      manuscript: z.string().max(200_000).parse(request.manuscript),
    }
    const sources = selectedSources(day, z.array(z.string()).max(30).parse(request.sourceIds))
    const controller = begin(request.requestId, event.sender)
    try {
      progress(event.sender, request.requestId, 'sending', 'Preparando perguntas sobre o texto…')
      if (useServer()) {
        const response = await context.api.request<{
          result: { questions: SermonAIQuestion[]; validationNotice?: string }
          usage: UsageSummary
        }>('POST', '/v1/ai/questions', {
          body: {
            mainReference: questionContext.mainReference,
            manuscript: questionContext.manuscript,
            sources,
          },
          timeoutMs: AI_TIMEOUT_MS,
          signal: controller.signal,
          operation: 'perguntas · assinatura',
        })
        return {
          questions: response.result.questions,
          validationNotice: response.result.validationNotice ?? null,
          usage: response.usage,
        }
      }
      const outcome = await generateSermonQuestions(
        questionContext,
        sources,
        byokConfig('review', controller.signal),
      )
      return { questions: outcome.questions, validationNotice: outcome.validationNotice ?? null, usage: null }
    } finally {
      controllers.delete(request.requestId)
    }
  })

  function researchKey(reference: string, occasion: string | null, day: string): string {
    return `${reference.trim()}|${occasion?.trim() ?? ''}|${day}`
  }

  handle(
    'ai:researchCached',
    ({ reference, occasion, dateKey: day }) =>
      research.get<{ sources: AIResearchSource[]; searchedAt: string }>(
        researchKey(reference, occasion, dateKey.parse(day)),
      ) ?? null,
  )

  handle('ai:research', async (request, event) => {
    const day = dateKey.parse(request.dateKey)
    const reference = z.string().trim().min(1).max(200).parse(request.reference)
    const occasion = request.occasion ? z.string().max(200).parse(request.occasion) : null
    const authors = favoriteAuthorsFromData(
      context.kv('sources').get<string>('profiles.authors') ?? null,
    ).map((author) => author.name)
    const controller = begin(request.requestId, event.sender)
    try {
      let sources: AIResearchSource[]
      let usage: UsageSummary | null = null
      if (useServer()) {
        const response = await context.api.request<{
          result: { sources: AIResearchSource[] }
          usage: UsageSummary
        }>('POST', '/v1/ai/research', {
          body: {
            reference,
            occasion: occasion ?? undefined,
            dateKey: day,
            preferredAuthors: authors.slice(0, 30),
          },
          timeoutMs: AI_TIMEOUT_MS,
          signal: controller.signal,
          operation: 'pesquisa · assinatura',
        })
        sources = response.result.sources
        usage = response.usage
      } else {
        const outcome = await searchResearchSources(reference, occasion, {
          ...byokConfig('research', controller.signal),
          priorityAuthors: authors,
        })
        sources = outcome.sources
      }
      const searchedAt = new Date().toISOString()
      research.set(researchKey(reference, occasion, day), { sources, searchedAt })
      return { sources, searchedAt, usage }
    } finally {
      controllers.delete(request.requestId)
    }
  })

  handle('ai:cancel', ({ requestId }) => {
    controllers.get(z.string().parse(requestId))?.abort()
  })

  handle('ai:claudeModels', async () => {
    const key = context.secrets.get('anthropic')
    if (!key) return []
    return fetchClaudeModels(key, context.http())
  })

  handle('reviews:list', ({ dateKey: day }) => reports.reports(dateKey.parse(day)))
  handle('reviews:setFindingStatus', async ({ dateKey: day, reportId, findingId, status }) => {
    const list = await reports.reports(dateKey.parse(day))
    const report = list.find((item) => item.id === reportId)
    if (!report) throw new UserFacingError('Este relatório de revisão não existe mais.')
    return reports.update(
      setFindingStatus(report, findingId, z.enum(['open', 'resolved', 'dismissed']).parse(status)),
    )
  })
  handle('reviews:delete', async ({ dateKey: day, reportId }) => {
    const key = dateKey.parse(day)
    const repository = new ReviewReportRepository(context.database)
    const list = (await reports.reports(key)).filter((item) => item.id !== reportId)
    await repository.save(key, list)
    return list
  })

  void providerSchema
}
