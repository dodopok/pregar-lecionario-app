import { MemoryIntegrationLog } from '../../src/log/integration'
import type { FetchLike } from '../../src/util/http'
import { suggestedModel } from '../../src/ai/providers'
import type { AIProvider } from '../../src/ai/providers'
import type {
  SermonReviewConfiguration,
  SermonReviewContext,
  SermonReviewCriterion,
  SermonReviewSource,
} from '../../src/ai/review'
import type { SermonQuestionContext } from '../../src/ai/questions'

/** Requisição capturada pelo `fetch` simulado. */
export interface CapturedRequest {
  url: URL
  method: string
  headers: Headers
  bodyText: string
  body: Record<string, unknown> | undefined
  signal: AbortSignal | undefined
}

export type FakeHandler = (request: CapturedRequest, index: number) => Response | Promise<Response>

export interface FakeFetch {
  fetch: FetchLike
  calls: CapturedRequest[]
}

/** `fetch` simulado que registra cada chamada; o padrão falha para revelar chamadas inesperadas. */
export function fakeFetch(handler: FakeHandler = () => jsonResponse(500, {})): FakeFetch {
  const calls: CapturedRequest[] = []
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    )
    const bodyText = typeof init.body === 'string' ? init.body : ''
    let body: Record<string, unknown> | undefined
    try {
      body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : undefined
    } catch {
      body = undefined
    }
    const captured: CapturedRequest = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      bodyText,
      body,
      signal: init.signal ?? undefined,
    }
    calls.push(captured)
    return handler(captured, calls.length - 1)
  }
  return { fetch, calls }
}

export function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(text, { status, headers: { 'content-type': 'application/json' } })
}

/** Mensagem final do Claude, convertida em eventos SSE como o endpoint de fluxo envia. */
export interface ClaudeMessage {
  model?: string
  stop_reason?: string | null
  content: Record<string, unknown>[]
  usage?: Record<string, unknown>
}

export function claudeStream(message: ClaudeMessage): Response {
  const usage: Record<string, unknown> = { input_tokens: 0, output_tokens: 0, ...(message.usage ?? {}) }
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: message.model ?? 'claude-sonnet-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { ...usage, output_tokens: 1 },
        },
      },
    ],
  ]
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push([
        'content_block_start',
        { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      ])
      events.push([
        'content_block_delta',
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: String(block.text ?? '') } },
      ])
    } else if (block.type === 'thinking') {
      events.push([
        'content_block_start',
        {
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        },
      ])
      events.push([
        'content_block_delta',
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking_delta', thinking: String(block.thinking ?? '') },
        },
      ])
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: block }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  const finalUsage: Record<string, unknown> = { output_tokens: usage.output_tokens }
  if (usage.iterations !== undefined) finalUsage.iterations = usage.iterations
  events.push([
    'message_delta',
    {
      type: 'message_delta',
      delta: {
        stop_reason: message.stop_reason === undefined ? 'end_turn' : message.stop_reason,
        stop_sequence: null,
        stop_details: null,
      },
      usage: finalUsage,
    },
  ])
  events.push(['message_stop', { type: 'message_stop' }])
  const text = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Resposta de cada provedor com o JSON estruturado, como `responseData` dos testes Swift. */
export function providerResponse(json: string, provider: AIProvider): Response {
  switch (provider) {
    case 'openai':
      return jsonResponse(200, { output: [{ content: [{ type: 'output_text', text: json }] }] })
    case 'perplexity':
      return jsonResponse(200, {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: json }],
          },
        ],
      })
    case 'anthropic':
      return claudeStream({ content: [{ type: 'text', text: json }] })
    case 'google':
      return jsonResponse(200, { output_text: json })
  }
}

export function testConfiguration(
  provider: AIProvider,
  fetch: FetchLike,
  overrides: Partial<SermonReviewConfiguration> = {},
): SermonReviewConfiguration {
  return { provider, model: suggestedModel(provider), apiKey: 'secret-key', http: { fetch }, ...overrides }
}

export function reviewContext(
  criteria: SermonReviewCriterion[],
  manuscript = 'MANUSCRITO_PRIVADO',
): SermonReviewContext {
  return { dateKey: '2026-10-04', title: 'Mateus 21', mainReference: 'João 3:16', manuscript, criteria }
}

export function questionContext(manuscript = 'MANUSCRITO_PRIVADO'): SermonQuestionContext {
  return { dateKey: '2026-10-04', title: 'Mateus 21', mainReference: 'João 3:16', manuscript }
}

export function bibleSource(): SermonReviewSource {
  return { id: 'bible:nvt', title: 'NVT', citation: 'João 3:16 · NVT', text: 'Jesus chorou.' }
}

export const EXPECTED_HOSTS: Record<AIProvider, string> = {
  openai: 'api.openai.com',
  anthropic: 'api.anthropic.com',
  google: 'generativelanguage.googleapis.com',
  perplexity: 'api.perplexity.ai',
}

export const EXPECTED_PATHS: Record<AIProvider, string> = {
  openai: '/v1/responses',
  anthropic: '/v1/messages',
  google: '/v1beta/interactions',
  perplexity: '/v1/agent',
}

/** Confere a autenticação de cada provedor; o Claude usa o cabeçalho que o SDK monta. */
export function expectedAuthorization(provider: AIProvider, headers: Headers): boolean {
  switch (provider) {
    case 'openai':
    case 'perplexity':
      return headers.get('authorization') === 'Bearer secret-key'
    case 'anthropic':
      return headers.get('authorization') === 'Bearer secret-key' && !!headers.get('anthropic-version')
    case 'google':
      return headers.get('x-goog-api-key') === 'secret-key'
  }
}

export function memoryLog(): MemoryIntegrationLog {
  return new MemoryIntegrationLog()
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('A operação deveria ter falhado.')
}
