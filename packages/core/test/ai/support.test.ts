import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { providerErrorDetail } from '../../src/ai/errors'
import {
  assertSourceWithinLimit,
  MAXIMUM_BYTES_PER_SOURCE,
  MAXIMUM_INPUT_BYTES,
  MAXIMUM_PAGES_PER_SOURCE,
  SermonReviewMaterialError,
} from '../../src/ai/materials'
import { estimateCostUSD, modelPrice } from '../../src/ai/pricing'
import { QUESTION_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, SCOPE_GUIDANCE } from '../../src/ai/prompts'
import {
  decodeReport,
  decodeReports,
  isReportStale,
  makeSermonReviewReport,
  manuscriptFingerprint,
  MAXIMUM_REPORTS_PER_DATE,
  MemorySermonReviewReportPersistence,
  openFindings,
  closedFindings,
  setFindingStatus,
  SermonReviewReportStore,
} from '../../src/ai/report'
import type { SermonReviewReport } from '../../src/ai/report'
import type { SermonReviewFinding } from '../../src/ai/review'
import { reviewSermon } from '../../src/ai/review'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  AnthropicHTTPError,
  claudeFallbackParams,
  loggingFetch,
  runAnthropicCall,
} from '../../src/ai/transport'
import { combineUsage, usageFromResponse } from '../../src/ai/usage'
import { HttpTimeoutError } from '../../src/util/http'
import { claudeStream, fakeFetch, memoryLog, rejection, reviewContext, testConfiguration } from './helpers'

/** Lê um literal de várias linhas do Swift e remove o recuo, como o compilador. */
function swiftLiteral(source: string[], opening: string): string {
  const start = source.findIndex((line) => line.includes(opening) && line.trimEnd().endsWith('"""'))
  expect(start).toBeGreaterThanOrEqual(0)
  const lines: string[] = []
  for (let index = start + 1; source[index]?.trim() !== '"""'; index += 1) {
    lines.push((source[index] ?? '').replace(/^ {4}/, ''))
  }
  return lines.join('\n').replace('\\(SermonAIScopePrompt.guidance)', SCOPE_GUIDANCE)
}

describe('instruções enviadas aos provedores', () => {
  it('são cópias literais das instruções do app Swift', () => {
    const path = fileURLToPath(new URL('../../../../Pregar/SermonReview.swift', import.meta.url))
    const source = readFileSync(path, 'utf8').split('\n')
    expect(swiftLiteral(source, 'static let guidance = """')).toBe(SCOPE_GUIDANCE)
    const systems = source
      .map((line, index) => (line.includes('static let system = """') ? index : -1))
      .filter((index) => index >= 0)
    expect(systems).toHaveLength(2)
    const review = swiftLiteral(source.slice(systems[0]), 'static let system = """')
    const questions = swiftLiteral(source.slice(systems[1]), 'static let system = """')
    expect(review).toBe(REVIEW_SYSTEM_PROMPT)
    expect(questions).toBe(QUESTION_SYSTEM_PROMPT)
    expect(REVIEW_SYSTEM_PROMPT.startsWith('Você é um revisor limitado de sermões já escritos.')).toBe(true)
    expect(QUESTION_SYSTEM_PROMPT).toContain(SCOPE_GUIDANCE)
  })
})

describe('tarifas', () => {
  it('usa a tabela por milhão de tokens com leitura de cache quando informada', () => {
    expect(
      estimateCostUSD({
        model: 'claude-opus-5-5',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      }),
    ).toEqual({
      costUSD: 24.2,
      estimated: false,
    })
    expect(
      estimateCostUSD({ model: 'claude-fable-5-1', inputTokens: 1_000_000, outputTokens: 0 }).costUSD,
    ).toBe(10)
    expect(
      estimateCostUSD({ model: 'claude-haiku-5-5', inputTokens: 2_000_000, outputTokens: 2_000_000 }).costUSD,
    ).toBe(1.2)
    expect(
      estimateCostUSD({ model: 'perplexity/sonar', inputTokens: 20_000, outputTokens: 5_000 }).costUSD,
    ).toBeCloseTo(0.0175, 9)
    expect(
      estimateCostUSD({ model: 'gpt-6-sol', inputTokens: 20_000, outputTokens: 5_000 }).costUSD,
    ).toBeCloseTo(0.09, 9)
    // Sem tarifa de cache, a leitura de cache é cobrada como entrada comum.
    expect(
      estimateCostUSD({ model: 'claude-opus-5', inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })
        .costUSD,
    ).toBe(5)
  })

  it('aplica a mudança de tarifa do Gemini 3.8 Flash em 2027', () => {
    expect(modelPrice('gemini-3.8-flash', new Date('2026-12-31T23:59:59Z'))).toEqual({
      input: 0.75,
      output: 3.75,
    })
    expect(modelPrice('gemini-3.8-flash', new Date('2027-01-01T00:00:00Z'))).toEqual({
      input: 1.5,
      output: 7.5,
    })
    const before = estimateCostUSD(
      { model: 'gemini-3.8-flash', inputTokens: 20_000, outputTokens: 5_000 },
      new Date('2026-11-01'),
    )
    const after = estimateCostUSD(
      { model: 'gemini-3.8-flash', inputTokens: 20_000, outputTokens: 5_000 },
      new Date('2027-02-01'),
    )
    expect(before.costUSD).toBeCloseTo(0.03375, 9)
    expect(after.costUSD).toBeCloseTo(0.0675, 9)
  })

  it('reconhece versões datadas e usa reserva conservadora para modelos desconhecidos', () => {
    expect(modelPrice('claude-sonnet-5-5-20261001')).toEqual(modelPrice('claude-sonnet-5-5'))
    expect(modelPrice('gpt-6-sol-2026-08-01')).toEqual(modelPrice('gpt-6-sol'))
    expect(modelPrice('models/gemini-3.8-flash', new Date('2026-11-01'))).toEqual({
      input: 0.75,
      output: 3.75,
    })
    expect(modelPrice('sonar')).toEqual(modelPrice('perplexity/sonar'))
    expect(modelPrice('claude-opus-5-1')).toBeUndefined()
    expect(modelPrice('gpt-6-luna')).toBeUndefined()
    expect(estimateCostUSD({ model: 'gpt-6-luna', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toEqual(
      {
        costUSD: 60,
        estimated: true,
      },
    )
  })
})

describe('consumo informado por provedor', () => {
  const date = new Date('2026-11-01T12:00:00Z')

  it('lê a Responses API da OpenAI separando tokens em cache', () => {
    const usage = usageFromResponse(
      'openai',
      {
        model: 'gpt-6-sol-2026-08-01',
        usage: { input_tokens: 10_000, input_tokens_details: { cached_tokens: 4_000 }, output_tokens: 2_000 },
      },
      'gpt-6-sol',
      date,
    )
    expect(usage).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-sol-2026-08-01',
      inputTokens: 6_000,
      cacheReadTokens: 4_000,
      outputTokens: 2_000,
      requests: 1,
    })
    expect(usage.costUSD).toBeCloseTo((6_000 * 2 + 4_000 * 2 + 2_000 * 10) / 1e6, 9)
    expect(usage.estimated).toBeUndefined()
  })

  it('lê a Agent API da Perplexity', () => {
    const usage = usageFromResponse(
      'perplexity',
      { model: 'perplexity/sonar', usage: { input_tokens: 1_000, output_tokens: 500 } },
      'perplexity/sonar',
      date,
    )
    expect(usage).toMatchObject({ model: 'perplexity/sonar', inputTokens: 1_000, outputTokens: 500 })
    expect(usage.costUSD).toBeCloseTo(0.00025 + 0.00125, 9)
  })

  it('lê o Gemini nos formatos Interactions e generateContent, somando o raciocínio à saída', () => {
    const interactions = usageFromResponse(
      'google',
      {
        model: 'gemini-3.8-flash',
        usage: {
          total_input_tokens: 1_000,
          total_cached_tokens: 200,
          total_output_tokens: 300,
          total_thought_tokens: 100,
        },
      },
      'gemini-3.8-flash',
      date,
    )
    expect(interactions).toMatchObject({ inputTokens: 800, cacheReadTokens: 200, outputTokens: 400 })
    const generate = usageFromResponse(
      'google',
      {
        modelVersion: 'gemini-3.8-flash',
        usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 300, thoughtsTokenCount: 50 },
      },
      'gemini-3.8-flash',
      date,
    )
    expect(generate).toMatchObject({ inputTokens: 1_000, outputTokens: 350 })
  })

  it('marca como estimado o consumo ausente', () => {
    const usage = usageFromResponse('google', { output_text: '{}' }, 'gemini-3.8-flash', date)
    expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0, costUSD: 0, estimated: true, requests: 1 })
  })

  it('no Claude, cobra cada iteração pela tarifa do modelo quando o servidor troca de modelo', () => {
    const usage = usageFromResponse(
      'anthropic',
      {
        model: 'claude-opus-5',
        usage: {
          input_tokens: 1_000,
          output_tokens: 600,
          iterations: [
            {
              type: 'message',
              model: 'claude-opus-5-5',
              input_tokens: 1_000,
              output_tokens: 100,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            {
              type: 'fallback_message',
              model: 'claude-opus-5',
              input_tokens: 1_000,
              output_tokens: 500,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          ],
        },
      },
      'claude-opus-5-5',
      date,
    )
    expect(usage.model).toBe('claude-opus-5')
    expect(usage.inputTokens).toBe(2_000)
    expect(usage.outputTokens).toBe(600)
    expect(usage.costUSD).toBeCloseTo((1_000 * 4 + 100 * 20 + 1_000 * 5 + 500 * 25) / 1e6, 9)
  })

  it('soma tentativas mantendo o último modelo servido', () => {
    const first = usageFromResponse(
      'anthropic',
      { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 20 } },
      'claude-sonnet-5-5',
      date,
    )
    const second = usageFromResponse(
      'anthropic',
      {
        model: 'claude-sonnet-5',
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
      },
      'claude-sonnet-5-5',
      date,
    )
    expect(combineUsage(first, second)).toMatchObject({
      model: 'claude-sonnet-5',
      inputTokens: 20,
      outputTokens: 40,
      cacheReadTokens: 5,
      requests: 2,
    })
  })

  it('a revisão do Claude informa o modelo que efetivamente atendeu após a troca do servidor', async () => {
    const { fetch } = fakeFetch(() =>
      claudeStream({
        model: 'claude-opus-5-5',
        content: [
          {
            type: 'fallback',
            from: { model: 'claude-opus-5-5' },
            to: { model: 'claude-opus-5' },
            trigger: { type: 'refusal', category: null },
          },
          { type: 'text', text: '{"findings":[]}' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    )
    const result = await reviewSermon(
      reviewContext(['tone'], 'Texto.'),
      [],
      testConfiguration('anthropic', fetch, { model: 'claude-opus-5-5' }),
    )
    expect(result.usage.model).toBe('claude-opus-5')
  })
})

describe('transporte do Claude', () => {
  it('pede a troca de modelo do servidor só nos modelos previstos', () => {
    expect(claudeFallbackParams('claude-opus-5-5')).toEqual({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    expect(claudeFallbackParams('claude-haiku-4-5')).toEqual({})
    expect(claudeFallbackParams('claude-sonnet-5-5', false)).toEqual({})
  })

  it('registra o código e a duração sem consumir o corpo das respostas bem-sucedidas', async () => {
    const log = memoryLog()
    const wrapped = loggingFetch(
      { fetch: async () => new Response('corpo longo', { status: 200 }), log },
      { operation: 'teste', secrets: ['secret-key'] },
    )
    const response = await wrapped('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer secret-key' },
    })
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe('corpo longo')
    expect(log.entries[0]).toMatchObject({
      level: 'OK',
      integration: 'IA',
      operation: 'teste',
      status: 200,
      method: 'POST',
    })
    expect(log.entries[0]?.body).toBeUndefined()
  })

  it('clona só os corpos de erro e remove segredos do registro', async () => {
    const log = memoryLog()
    const wrapped = loggingFetch(
      { fetch: async () => new Response('{"error":{"message":"bad key secret-key"}}', { status: 401 }), log },
      { operation: 'teste', secrets: ['secret-key'] },
    )
    const response = await wrapped('https://api.anthropic.com/v1/models', {
      headers: { authorization: 'Bearer secret-key' },
    })
    expect(await response.text()).toContain('bad key')
    expect(log.lines[0]).toContain('ERRO · IA · teste · GET api.anthropic.com/v1/models · HTTP 401')
    expect(log.lines[0]).toContain('bad key')
    expect(log.lines[0]).not.toContain('secret-key')
  })

  it('registra falhas de rede e as repassa', async () => {
    const log = memoryLog()
    const wrapped = loggingFetch(
      { fetch: async () => Promise.reject(new TypeError('fetch failed')), log },
      { operation: 'teste' },
    )
    await expect(wrapped('https://api.anthropic.com/v1/messages')).rejects.toThrow('fetch failed')
    expect(log.entries[0]?.level).toBe('ERRO')
  })

  it('traduz o prazo esgotado e o cancelamento do chamador', async () => {
    const hanging = fakeFetch(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const controller = new AbortController()
    const pending = rejection(
      reviewSermon(
        reviewContext(['tone'], 'Texto.'),
        [],
        testConfiguration('anthropic', hanging.fetch, {
          http: { fetch: hanging.fetch, signal: controller.signal },
        }),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()
    const cancelled = await pending
    expect((cancelled as Error).name).toBe('AbortError')
    expect(cancelled).not.toBeInstanceOf(HttpTimeoutError)

    // O prazo vale para a chamada inteira, inclusive a leitura do fluxo.
    const timedOut = await rejection(
      runAnthropicCall({ fetch: hanging.fetch }, 20, ({ signal }) => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new APIUserAbortError()))
        })
      }),
    )
    expect(timedOut).toBeInstanceOf(HttpTimeoutError)
  })

  it('mapeia erros que chegam dentro de um fluxo já aberto para o código documentado', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const error = await rejection(
      reviewSermon(reviewContext(['tone'], 'Texto.'), [], testConfiguration('anthropic', fetch)),
    )
    expect((error as Error).message).toBe('O provedor recusou a revisão (HTTP 529). Overloaded')
    expect(new AnthropicHTTPError(500, null).status).toBe(500)
  })

  it('o detalhe da recusa remove a chave e corta em 600 caracteres', () => {
    expect(providerErrorDetail({ error: { message: `${'a'.repeat(700)}` } }, 'k')?.length).toBe(600)
    expect(providerErrorDetail('{"error":{"message":"  "}}', 'k')).toBeUndefined()
    expect(providerErrorDetail('not json', 'k')).toBeUndefined()
    expect(providerErrorDetail({ error: 'texto' }, 'k')).toBeUndefined()
    expect(
      providerErrorDetail({ error: { message: 'chave minha-chave sk-proj_abc-123' } }, 'minha-chave'),
    ).toBe('chave [chave removida] [chave removida]')
  })
})

describe('materiais da revisão', () => {
  it('mantém limites e mensagens do app', () => {
    expect(MAXIMUM_BYTES_PER_SOURCE).toBe(24_000)
    expect(MAXIMUM_INPUT_BYTES).toBe(120_000)
    expect(MAXIMUM_PAGES_PER_SOURCE).toBe(36)
    expect(new SermonReviewMaterialError('pageStillLoading').message).toBe(
      'Uma página marcada para revisão ainda está carregando. Aguarde e tente novamente.',
    )
    expect(new SermonReviewMaterialError('pageUnavailable').message).toBe(
      'Não foi possível extrair o texto da página marcada para revisão.',
    )
    expect(new SermonReviewMaterialError('sourceUnavailable', 'Wright').message).toBe(
      'Não foi possível abrir o material “Wright” marcado para revisão.',
    )
    expect(new SermonReviewMaterialError('sectionNotFound', 'Wright').message).toBe(
      'Não encontrei uma seção legível em “Wright”. Desmarque-a ou escolha a seção no Leitor.',
    )
    expect(new SermonReviewMaterialError('sourceTooLarge', 'Wright').message).toBe(
      'A extração de “Wright” excede os limites e não será enviada parcialmente. Desmarque esta aba para continuar.',
    )
    expect(() => assertSourceWithinLimit('Página', 'x'.repeat(MAXIMUM_BYTES_PER_SOURCE))).not.toThrow()
    expect(() => assertSourceWithinLimit('Página', 'x'.repeat(MAXIMUM_BYTES_PER_SOURCE + 1))).toThrow(
      SermonReviewMaterialError,
    )
  })
})

describe('relatórios de revisão', () => {
  function finding(overrides: Partial<SermonReviewFinding> = {}): SermonReviewFinding {
    return {
      id: 'f-1',
      criterion: 'clarity',
      severity: 'note',
      manuscriptQuote: '',
      observation: 'O termo aparece sem explicação.',
      correction: '',
      classification: 'clarity',
      evidenceQuote: '',
      status: 'open',
      ...overrides,
    }
  }

  it('o estado do apontamento vai e volta e relatórios antigos sem estado são lidos como abertos', () => {
    const resolved = finding({ status: 'resolved' })
    const report: SermonReviewReport = {
      id: 'r-1',
      createdAt: '2026-10-04T10:00:00.000Z',
      dateKey: '2026-10-04',
      title: 'Mateus 21',
      mainReference: 'Mateus 21.33-46',
      provider: 'openai',
      model: 'gpt-6-sol',
      manuscriptFingerprint: 'abc',
      criteria: ['clarity'],
      findings: [resolved],
    }
    const roundTrip = decodeReport(JSON.parse(JSON.stringify(report)))
    expect(roundTrip).toEqual(report)

    const legacy = JSON.parse(JSON.stringify(report)) as { findings: Record<string, unknown>[] }
    delete legacy.findings[0]!.status
    const decoded = decodeReport(legacy)
    expect(decoded.findings[0]?.status).toBe('open')
    expect(decoded.findings[0]?.observation).toBe(resolved.observation)
    expect(openFindings(decoded)).toHaveLength(1)
    expect(closedFindings(setFindingStatus(decoded, 'f-1', 'dismissed'))).toHaveLength(1)
  })

  it('persiste sem guardar o manuscrito e fica antigo após edições', async () => {
    const manuscript = 'Manuscrito privado com erro de grafia.'
    const context = {
      dateKey: '2026-10-04',
      title: 'Mateus 21',
      mainReference: 'Mateus 21.33-46',
      manuscript,
      criteria: ['spelling' as const],
    }
    const report = await makeSermonReviewReport(context, 'openai', 'gpt-6-sol', {
      findings: [
        finding({
          criterion: 'spelling',
          severity: 'attention',
          manuscriptQuote: 'erro de grafia',
          observation: 'A grafia desta palavra merece conferência.',
          correction: 'manuscrito',
          classification: 'spelling',
        }),
      ],
      validationNotice:
        '1 apontamento foi ocultado após a validação local (escopo). Nenhum texto rejeitado foi exibido.',
    })
    expect(report.manuscriptFingerprint).toBe(await manuscriptFingerprint(manuscript))
    expect(report.manuscriptFingerprint).toMatch(/^[0-9a-f]{64}$/)

    const persistence = new MemorySermonReviewReportPersistence()
    await new SermonReviewReportStore(persistence).save(report)
    const loaded = await new SermonReviewReportStore(persistence).reports('2026-10-04')
    expect(loaded).toEqual([report])
    expect(loaded[0]?.validationNotice).toBe(report.validationNotice)
    expect(await isReportStale(loaded[0]!, manuscript, 'Mateus 21.33-46')).toBe(false)
    expect(await isReportStale(loaded[0]!, manuscript, '')).toBe(false)
    expect(await isReportStale(loaded[0]!, `${manuscript} mudou`, 'Mateus 21.33-46')).toBe(true)
    expect(await isReportStale(loaded[0]!, manuscript, 'Mateus 22')).toBe(true)
    const persisted = persistence.data.get('2026-10-04')!
    expect(persisted).not.toContain(manuscript)

    const legacyPayload = JSON.parse(persisted) as Record<string, unknown>[]
    delete legacyPayload[0]!.validationNotice
    expect(decodeReports(legacyPayload)[0]?.validationNotice).toBeUndefined()
  })

  it('guarda até 30 relatórios por data, em ordem, e regrava pelo ID', async () => {
    const persistence = new MemorySermonReviewReportPersistence()
    const store = new SermonReviewReportStore(persistence)
    const context = {
      dateKey: '2026-10-04',
      title: 'T',
      mainReference: 'R',
      manuscript: 'M',
      criteria: ['tone' as const],
    }
    let last: SermonReviewReport | undefined
    for (let index = 0; index < MAXIMUM_REPORTS_PER_DATE + 2; index += 1) {
      last = await makeSermonReviewReport(
        context,
        'anthropic',
        'claude-sonnet-5-5',
        { findings: [] },
        {
          id: `r-${index}`,
          createdAt: new Date(Date.UTC(2026, 9, 4, 0, index)),
        },
      )
      await store.save(last)
    }
    let reports = await store.reports('2026-10-04')
    expect(reports).toHaveLength(MAXIMUM_REPORTS_PER_DATE)
    expect(reports[0]?.id).toBe('r-2')
    expect(reports.at(-1)?.id).toBe(`r-${MAXIMUM_REPORTS_PER_DATE + 1}`)
    reports = await store.update({ ...last!, title: 'Alterado' })
    expect(reports).toHaveLength(MAXIMUM_REPORTS_PER_DATE)
    expect(reports.at(-1)?.title).toBe('Alterado')
    expect(await store.reports('2026-10-05')).toEqual([])
  })
})
