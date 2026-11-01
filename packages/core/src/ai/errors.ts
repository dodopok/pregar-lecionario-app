import type { AIUsage } from './usage'

/**
 * Erros das operações de IA com as mensagens do app Swift. `kind` identifica o caso; `usage`
 * acompanha falhas que aconteceram depois de uma resposta cobrada (truncamento, recusa, JSON
 * fora do contrato), para que a cota registre o gasto mesmo sem resultado.
 */

interface ErrorOptions {
  status?: number
  detail?: string | null
  usage?: AIUsage
  cause?: unknown
}

abstract class AIOperationError<Kind extends string> extends Error {
  readonly kind: Kind
  readonly status?: number
  readonly detail?: string
  usage?: AIUsage

  protected constructor(kind: Kind, message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.kind = kind
    if (options.status !== undefined) this.status = options.status
    if (options.detail) this.detail = options.detail
    if (options.usage) this.usage = options.usage
  }
}

const PROVIDER_FALLBACK = 'Verifique a chave, o modelo e os limites da conta.'

// Revisão

export type SermonReviewErrorKind =
  | 'emptyManuscript'
  | 'noCriteria'
  | 'noKey'
  | 'invalidModel'
  | 'contextTooLarge'
  | 'provider'
  | 'incompleteResponse'
  | 'refusedResponse'
  | 'unreadableResponse'

function sermonReviewMessage(kind: SermonReviewErrorKind, status?: number, detail?: string | null): string {
  switch (kind) {
    case 'emptyManuscript':
      return 'Escreva algum texto antes de solicitar uma revisão.'
    case 'noCriteria':
      return 'Selecione ao menos um critério de revisão.'
    case 'noKey':
      return 'A chave deste provedor não está disponível no Acesso às Chaves.'
    case 'invalidModel':
      return 'O modelo escolhido não pertence ao provedor selecionado.'
    case 'contextTooLarge':
      return 'O conjunto selecionado excede o limite desta revisão. Desmarque alguns materiais e tente novamente.'
    case 'provider':
      return `O provedor recusou a revisão (HTTP ${status ?? 0}). ${detail ?? PROVIDER_FALLBACK}`
    case 'incompleteResponse':
      return 'A revisão foi interrompida pelo limite de saída do modelo. Tente revisar menos critérios por vez.'
    case 'refusedResponse':
      return 'O modelo recusou a solicitação de revisão.'
    case 'unreadableResponse':
      return 'A resposta do provedor não pôde ser validada. Nenhuma observação foi exibida.'
  }
}

export class SermonReviewError extends AIOperationError<SermonReviewErrorKind> {
  constructor(kind: SermonReviewErrorKind, options: ErrorOptions = {}) {
    super(kind, sermonReviewMessage(kind, options.status, options.detail), options)
    this.name = 'SermonReviewError'
  }
}

// Perguntas de emergência

export type SermonAIQuestionErrorKind =
  | 'emptyManuscript'
  | 'noKey'
  | 'invalidModel'
  | 'contextTooLarge'
  | 'provider'
  | 'incompleteResponse'
  | 'refusedResponse'
  | 'unreadableResponse'
  | 'invalidQuestion'

function questionMessage(kind: SermonAIQuestionErrorKind, status?: number, detail?: string | null): string {
  switch (kind) {
    case 'emptyManuscript':
      return 'Escreva algum texto antes de pedir perguntas.'
    case 'noKey':
      return 'A chave deste provedor não está disponível no Acesso às Chaves.'
    case 'invalidModel':
      return 'O modelo escolhido não pertence ao provedor selecionado.'
    case 'contextTooLarge':
      return 'O conjunto selecionado excede o limite desta ação. Desmarque alguns materiais e tente novamente.'
    case 'provider':
      return `O provedor recusou a solicitação (HTTP ${status ?? 0}). ${detail ?? PROVIDER_FALLBACK}`
    case 'incompleteResponse':
      return 'As perguntas foram interrompidas pelo limite de saída do modelo. Tente novamente.'
    case 'refusedResponse':
      return 'O modelo recusou a solicitação de perguntas.'
    case 'unreadableResponse':
      return 'A resposta do provedor não pôde ser validada. Nenhuma pergunta foi exibida.'
    case 'invalidQuestion':
      return 'As perguntas recebidas não passaram pela conferência de formato e citações. Tente novamente.'
  }
}

export class SermonAIQuestionError extends AIOperationError<SermonAIQuestionErrorKind> {
  constructor(kind: SermonAIQuestionErrorKind, options: ErrorOptions = {}) {
    super(kind, questionMessage(kind, options.status, options.detail), options)
    this.name = 'SermonAIQuestionError'
  }
}

// Pesquisa de materiais

export type AIResearchErrorKind =
  'emptyReference' | 'noKey' | 'invalidModel' | 'provider' | 'unreadableResponse'

function researchMessage(kind: AIResearchErrorKind, status?: number, detail?: string | null): string {
  switch (kind) {
    case 'emptyReference':
      return 'Escolha uma passagem antes de pesquisar materiais.'
    case 'noKey':
      return 'A chave do provedor de pesquisa não está salva no Acesso às Chaves.'
    case 'invalidModel':
      return 'O modelo escolhido não pertence ao provedor de pesquisa.'
    case 'provider':
      return `O provedor recusou a pesquisa (HTTP ${status ?? 0}). ${detail ?? 'Verifique a chave, o modelo e os créditos disponíveis.'}`
    case 'unreadableResponse':
      return 'O provedor não retornou fontes verificáveis. Tente novamente ou abra as fontes favoritas.'
  }
}

export class AIResearchError extends AIOperationError<AIResearchErrorKind> {
  constructor(kind: AIResearchErrorKind, options: ErrorOptions = {}) {
    super(kind, researchMessage(kind, options.status, options.detail), options)
    this.name = 'AIResearchError'
  }
}

// Catálogo de modelos do Claude

export type AIModelCatalogErrorKind = 'noKey' | 'provider' | 'unreadableResponse'

function catalogMessage(kind: AIModelCatalogErrorKind, status?: number): string {
  switch (kind) {
    case 'noKey':
      return 'Salve a chave do Claude para consultar os modelos disponíveis.'
    case 'provider':
      return `Não foi possível atualizar os modelos do Claude (HTTP ${status ?? 0}). Verifique a chave e tente novamente.`
    case 'unreadableResponse':
      return 'A lista de modelos do Claude não pôde ser lida. Tente novamente.'
  }
}

export class AIModelCatalogError extends AIOperationError<AIModelCatalogErrorKind> {
  constructor(kind: AIModelCatalogErrorKind, options: ErrorOptions = {}) {
    super(kind, catalogMessage(kind, options.status), options)
    this.name = 'AIModelCatalogError'
  }
}

// Detalhe das recusas do provedor

const KEY_PATTERN = /sk-[A-Za-z0-9_-]+/g

function characters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('')
}

/**
 * Mensagem `error.message` do corpo de erro do provedor, sem a chave do usuário e cortada em 600
 * caracteres (`AIProviderResponseError.detail`). Aceita o texto do corpo ou o JSON já decodificado.
 */
export function providerErrorDetail(body: unknown, apiKey: string): string | undefined {
  let root = body
  if (typeof body === 'string') {
    try {
      root = JSON.parse(body)
    } catch {
      return undefined
    }
  } else if (body instanceof Uint8Array) {
    try {
      root = JSON.parse(new TextDecoder().decode(body))
    } catch {
      return undefined
    }
  }
  if (root === null || typeof root !== 'object') return undefined
  const error = (root as { error?: unknown }).error
  if (error === null || typeof error !== 'object') return undefined
  const rawMessage = (error as { message?: unknown }).message
  if (typeof rawMessage !== 'string') return undefined
  let message = rawMessage
  if (apiKey) message = message.split(apiKey).join('[chave removida]')
  message = message.replace(KEY_PATTERN, '[chave removida]')
  const detail = characters(message, 600).trim()
  return detail ? detail : undefined
}
