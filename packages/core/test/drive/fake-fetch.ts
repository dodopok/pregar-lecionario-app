import { MemoryIntegrationLog } from '../../src/log/integration'
import type { HttpContext } from '../../src/util/http'

export interface RecordedRequest {
  url: URL
  method: string
  headers: Headers
  body: string
  /** Parâmetro de busca da URL, ou `undefined`. */
  query(name: string): string | undefined
  json<T = Record<string, unknown>>(): T
  form(): URLSearchParams
}

export interface FakeResponse {
  status: number
  body?: string | Uint8Array
  headers?: Record<string, string>
}

export type FakeHandler = (request: RecordedRequest) => FakeResponse | Promise<FakeResponse>

export interface FakeHttp {
  http: HttpContext
  log: MemoryIntegrationLog
  requests: RecordedRequest[]
  setHandler(handler: FakeHandler): void
}

/** `fetch` falso: registra cada requisição e responde com o manipulador atual. */
export function fakeHttp(handler: FakeHandler): FakeHttp {
  let current = handler
  const requests: RecordedRequest[] = []
  const log = new MemoryIntegrationLog()
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const body = typeof init?.body === 'string' ? init.body : ''
    const request: RecordedRequest = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body,
      query: (name) => url.searchParams.get(name) ?? undefined,
      json: <T>() => JSON.parse(body) as T,
      form: () => new URLSearchParams(body),
    }
    requests.push(request)
    const response = await current(request)
    return new Response(response.body as BodyInit | undefined, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...response.headers },
    })
  }
  return {
    http: { fetch, log },
    log,
    requests,
    setHandler(next) {
      current = next
    },
  }
}

export function json(status: number, value: unknown): FakeResponse {
  return { status, body: typeof value === 'string' ? value : JSON.stringify(value) }
}

/** Documento do Docs com um único parágrafo de texto. */
export function docsDocument(revisionId: string, text: string): FakeResponse {
  return json(200, {
    revisionId,
    body: {
      content: [
        { startIndex: 0, endIndex: 1 },
        {
          startIndex: 1,
          endIndex: 1 + text.length,
          paragraph: { elements: [{ textRun: { content: text } }] },
        },
      ],
    },
  })
}
