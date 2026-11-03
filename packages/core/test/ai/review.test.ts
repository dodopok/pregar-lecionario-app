import { describe, expect, it } from 'vitest'
import { SermonReviewError } from '../../src/ai/errors'
import { MAXIMUM_BYTES_PER_SOURCE, MAXIMUM_INPUT_BYTES } from '../../src/ai/materials'
import { REVIEW_SYSTEM_PROMPT, LANGUAGE_REVIEW_SYSTEM_PROMPT } from '../../src/ai/prompts'
import { AI_PROVIDERS, suggestedModel } from '../../src/ai/providers'
import {
  buildReviewRequest,
  reviewSermon,
  SERMON_REVIEW_CRITERIA,
  structureSection,
} from '../../src/ai/review'
import type { SermonReviewCriterion, SermonReviewSource } from '../../src/ai/review'
import { adaptSchemaForClaude, outputText, responseDiagnostics } from '../../src/ai/structured'
import {
  bibleSource,
  claudeStream,
  EXPECTED_HOSTS,
  EXPECTED_PATHS,
  expectedAuthorization,
  fakeFetch,
  jsonResponse,
  memoryLog,
  providerResponse,
  rejection,
  reviewContext,
  testConfiguration,
} from './helpers'

type JSONObject = Record<string, unknown>

function at(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

function claudeSchema(criteria: SermonReviewCriterion[], sources: SermonReviewSource[]): JSONObject {
  const { fetch } = fakeFetch()
  const request = buildReviewRequest(reviewContext(criteria), sources, testConfiguration('anthropic', fetch))
  return at(request.body, 'output_config', 'format', 'schema') as JSONObject
}

describe('revisão: limite de saída e leitura do Claude', () => {
  it('reserva saída para o pensamento e o relatório, sem orçamento de pensamento nem amostragem', () => {
    const { fetch } = fakeFetch()
    const request = buildReviewRequest(
      reviewContext([...SERMON_REVIEW_CRITERIA]),
      [bibleSource()],
      testConfiguration('anthropic', fetch),
    )
    expect(request.body.max_tokens).toBe(16_000)
    expect(request.body.thinking).toBeUndefined()
    expect(request.body.temperature).toBeUndefined()
    expect(request.body.top_p).toBeUndefined()
    expect(request.body.top_k).toBeUndefined()
    expect(request.timeoutMs).toBeGreaterThanOrEqual(300_000)
  })

  it('repete uma vez com mais espaço após max_tokens sem usar o JSON parcial', async () => {
    const budgets: number[] = []
    const { fetch, calls } = fakeFetch((request) => {
      budgets.push(request.body?.max_tokens as number)
      const reason = budgets.length === 1 ? 'max_tokens' : 'end_turn'
      // Mesmo um JSON válido não vale se o provedor diz que a resposta foi cortada.
      return claudeStream({
        stop_reason: reason,
        usage: { input_tokens: 1_000, output_tokens: 16_000 },
        content: [{ type: 'text', text: '{"findings":[]}' }],
      })
    })
    const log = memoryLog()
    const result = await reviewSermon(
      reviewContext(['spelling']),
      [],
      testConfiguration('anthropic', fetch, { http: { fetch, log } }),
    )
    expect(result.findings).toEqual([])
    expect(budgets).toEqual([16_000, 32_000])
    expect(calls.every((call) => call.body?.stream === true)).toBe(true)
    expect(result.usage.requests).toBe(2)
    expect(result.usage.inputTokens).toBe(2_000)
    expect(result.usage.outputTokens).toBe(32_000)
    expect(
      log.lines.some((line) => line.includes('AVISO · IA · revisão') && line.includes('tentativa 1/2')),
    ).toBe(true)
  })

  it('para após duas respostas cortadas com erro específico', async () => {
    const { fetch, calls } = fakeFetch(() =>
      claudeStream({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"findings":[' }] }),
    )
    const error = await rejection(
      reviewSermon(reviewContext(['spelling']), [], testConfiguration('anthropic', fetch)),
    )
    expect(error).toBeInstanceOf(SermonReviewError)
    expect((error as SermonReviewError).kind).toBe('incompleteResponse')
    expect((error as SermonReviewError).usage?.requests).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('não repete recusas nem respostas concluídas mal formadas', async () => {
    for (const reason of ['refusal', 'end_turn']) {
      const { fetch, calls } = fakeFetch(() =>
        claudeStream({ stop_reason: reason, content: [{ type: 'text', text: 'not JSON' }] }),
      )
      const error = await rejection(
        reviewSermon(reviewContext(['spelling']), [], testConfiguration('anthropic', fetch)),
      )
      expect(error).toBeInstanceOf(SermonReviewError)
      expect((error as SermonReviewError).kind).toBe(
        reason === 'refusal' ? 'refusedResponse' : 'unreadableResponse',
      )
      expect(calls).toHaveLength(1)
    }
  })

  it('trata contexto excedido e motivos desconhecidos sem repetir', async () => {
    for (const [reason, kind] of [
      ['model_context_window_exceeded', 'contextTooLarge'],
      ['pause_turn', 'unreadableResponse'],
    ]) {
      const { fetch, calls } = fakeFetch(() =>
        claudeStream({ stop_reason: reason, content: [{ type: 'text', text: '{"findings":[]}' }] }),
      )
      const error = await rejection(
        reviewSermon(reviewContext(['spelling']), [], testConfiguration('anthropic', fetch)),
      )
      expect((error as SermonReviewError).kind).toBe(kind)
      expect(calls).toHaveLength(1)
    }
  })

  it('extrai só blocos de texto e não expõe pensamento nem conteúdo nos diagnósticos', () => {
    const blocks = [
      { type: 'thinking', thinking: 'PRIVATE_THINKING', text: 'PRIVATE_FAKE_TEXT' },
      { type: 'text', text: 'PRIVATE_REPORT' },
    ]
    const data = JSON.stringify({
      stop_reason: 'max_tokens',
      usage: { output_tokens: 4_000 },
      content: blocks,
    })
    expect(outputText(data, 'anthropic')).toBe('PRIVATE_REPORT')
    const diagnostics = responseDiagnostics(data, 'anthropic')
    expect(diagnostics).toContain('stop_reason=max_tokens')
    expect(diagnostics).toContain('output_tokens=4000')
    expect(diagnostics).not.toContain('PRIVATE')
    expect(outputText({ content: [blocks[0]] }, 'anthropic')).toBeUndefined()
    expect(responseDiagnostics('not json', 'openai')).toBe('resposta não JSON · 8 bytes')
  })

  it('ignora o texto do modelo que recusou antes de uma troca de modelo do servidor', () => {
    const message = {
      content: [
        { type: 'text', text: '{"findings":[' },
        { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
        { type: 'text', text: '{"findings":[]}' },
      ],
    }
    expect(outputText(message, 'anthropic')).toBe('{"findings":[]}')
  })
})

describe('revisão: esquema compacto do Claude', () => {
  it('usa um único formato de apontamento com campos obrigatórios, critérios e fontes permitidos', () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({
      id: `source-${index}`,
      title: 'Fonte',
      citation: 'Teste',
      text: 'Uma fonte de teste.',
    }))
    const cases: SermonReviewCriterion[][] = [
      [...SERMON_REVIEW_CRITERIA],
      ['spelling'],
      ['fidelity', 'clarity'],
    ]
    for (const criteria of cases) {
      const schema = claudeSchema(criteria, sources)
      const properties = schema.properties as JSONObject
      const item = at(properties, 'findings', 'items') as JSONObject
      const fields = item.properties as JSONObject
      expect(item.type).toBe('object')
      expect(item.oneOf).toBeUndefined()
      expect(item.anyOf).toBeUndefined()
      expect(new Set(item.required as string[])).toEqual(new Set(Object.keys(fields)))
      expect(item.additionalProperties).toBe(false)
      expect(at(fields, 'criterion', 'enum')).toEqual(criteria)
      const expectedSources = [
        '',
        ...(criteria.includes('fidelity') ? sources.map((source) => source.id) : []),
      ]
      expect(at(fields, 'evidence_source_id', 'enum')).toEqual(expectedSources)
      const observation = fields.observation as JSONObject
      expect(observation.maxLength).toBeUndefined()
      expect(String(observation.description)).toContain('800')
      expect(Boolean(properties.structure)).toBe(criteria.length !== 1 || criteria[0] !== 'spelling')
    }
  })

  it('continua rejeitando critérios, correções e evidências incompatíveis', async () => {
    const json = `{"findings":[
      {"criterion":"spelling","severity":"note","manuscript_quote":"excessão","observation":"Grafia incorreta da palavra.","correction":"exceção","classification":"spelling","evidence_source_id":"","evidence_quote":""},
      {"criterion":"fidelity","severity":"attention","manuscript_quote":"Jesus chorou.","observation":"Afirmação em tensão com a fonte.","correction":"exceção","classification":"tension","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."},
      {"criterion":"clarity","severity":"note","manuscript_quote":"Jesus chorou.","observation":"Termo sem explicação.","correction":"","classification":"contradiction","evidence_source_id":"","evidence_quote":""},
      {"criterion":"fidelity","severity":"attention","manuscript_quote":"Jesus chorou.","observation":"Afirmação em tensão com a fonte.","correction":"","classification":"tension","evidence_source_id":"","evidence_quote":"Jesus chorou."},
      {"criterion":"spelling","severity":"note","manuscript_quote":"excessão","observation":"Grafia incorreta da palavra.","correction":"exceção","classification":"spelling","evidence_source_id":"bible:nvt","evidence_quote":""}
    ]}`
    const { fetch } = fakeFetch(() => providerResponse(json, 'anthropic'))
    const result = await reviewSermon(
      reviewContext([...SERMON_REVIEW_CRITERIA], 'A excessão aparece aqui. Jesus chorou.'),
      [bibleSource()],
      testConfiguration('anthropic', fetch),
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.correction).toBe('exceção')
    expect(result.rejectedFindingCount).toBe(4)
  })

  it('não trata nomes de propriedades como palavras-chave do esquema', () => {
    const input = {
      type: 'object',
      properties: {
        oneOf: { type: 'string', maxLength: 3 },
        maxLength: { type: 'string', enum: ['oneOf'] },
      },
    }
    const properties = adaptSchemaForClaude(input).properties as JSONObject
    expect(properties.oneOf).toBeDefined()
    expect(properties.maxLength).toBeDefined()
    expect(at(properties, 'maxLength', 'enum')).toEqual(['oneOf'])
    expect(at(properties, 'oneOf', 'description')).toBe('maxLength: 3')
  })

  it('converte oneOf em anyOf e descreve limites removidos', () => {
    const adapted = adaptSchemaForClaude({
      type: 'array',
      minItems: 3,
      maxItems: 3,
      description: 'Partes',
      oneOf: [{ type: 'string', minLength: 1 }],
    })
    expect(adapted.oneOf).toBeUndefined()
    expect(adapted.anyOf).toEqual([{ type: 'string', description: 'minLength: 1' }])
    expect(adapted.description).toBe('Partes. maxItems: 3. minItems: 3')
    expect(adapted.items).toEqual({ type: 'string' })
    expect(adaptSchemaForClaude({ type: 'array', minItems: 1 }).minItems).toBe(1)
  })

  it('resolve Fidelidade sem fontes localmente, sem chamada inútil', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(400, {}))
    const result = await reviewSermon(reviewContext(['fidelity']), [], testConfiguration('anthropic', fetch))
    expect(result.findings).toEqual([])
    expect(calls).toHaveLength(0)
    expect(result.usage.requests).toBe(0)
    expect(result.usage.costUSD).toBe(0)
  })

  it('pede a troca de modelo do servidor só nos modelos previstos', async () => {
    const { fetch, calls } = fakeFetch(() => providerResponse('{"findings":[]}', 'anthropic'))
    for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5']) {
      await reviewSermon(
        reviewContext(['spelling'], 'Texto.'),
        [],
        testConfiguration('anthropic', fetch, { model }),
      )
      const call = calls.at(-1)
      expect(call?.body?.fallbacks).toBe('default')
      expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    }
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5']) {
      await reviewSermon(
        reviewContext(['spelling'], 'Texto.'),
        [],
        testConfiguration('anthropic', fetch, { model }),
      )
      const call = calls.at(-1)
      expect(call?.body?.fallbacks).toBeUndefined()
      expect(call?.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback')
    }
    await reviewSermon(
      reviewContext(['spelling'], 'Texto.'),
      [],
      testConfiguration('anthropic', fetch, { model: 'claude-opus-5-5', serverSideFallbacks: false }),
    )
    expect(calls.at(-1)?.body?.fallbacks).toBeUndefined()
    for (const call of calls) {
      expect(call.body?.temperature).toBeUndefined()
      expect(call.body?.top_p).toBeUndefined()
      expect(call.body?.top_k).toBeUndefined()
      expect(call.body?.thinking).toBeUndefined()
      expect(at(call.body, 'output_config', 'format', 'type')).toBe('json_schema')
      expect(call.body?.system).toBe(LANGUAGE_REVIEW_SYSTEM_PROMPT)
    }
  })
})

describe('revisão: erros do provedor', () => {
  it('registra a falha sem expor chave, token do corpo ou manuscrito', async () => {
    const body = {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Your credit balance is too low. token sk-abcdefghijklmnop',
      },
    }
    const { fetch } = fakeFetch(() => jsonResponse(400, body))
    const log = memoryLog()
    const error = await rejection(
      reviewSermon(
        reviewContext(['structure']),
        [],
        testConfiguration('anthropic', fetch, { http: { fetch, log } }),
      ),
    )
    expect(String((error as Error).message)).toContain('HTTP 400')
    const text = log.lines.join('\n')
    expect(text).toContain('ERRO · IA · revisão')
    expect(text).toContain('HTTP 400')
    expect(text).toContain('credit balance')
    expect(text).not.toContain('secret-key')
    expect(text).not.toContain('sk-abcdefghijklmnop')
    expect(text).not.toContain('MANUSCRITO_PRIVADO')
  })

  it('mostra o motivo da recusa sem expor credenciais', async () => {
    const data = { error: { message: "Schema type 'oneOf' is not supported. secret-key sk-ant-test-secret" } }
    const { fetch } = fakeFetch(() => jsonResponse(400, data))
    const error = (await rejection(
      reviewSermon(reviewContext(['spelling']), [], testConfiguration('anthropic', fetch)),
    )) as SermonReviewError
    expect(error.kind).toBe('provider')
    expect(error.status).toBe(400)
    expect(error.message).toContain('oneOf')
    expect(error.message).toContain('400')
    expect(error.message).not.toContain('secret-key')
    expect(error.message).not.toContain('sk-ant-test-secret')
  })

  it('usa a mensagem padrão quando o corpo não traz detalhe', async () => {
    for (const provider of AI_PROVIDERS) {
      const { fetch } = fakeFetch(() => jsonResponse(503, 'indisponível'))
      const error = (await rejection(
        reviewSermon(reviewContext(['structure']), [], testConfiguration(provider, fetch)),
      )) as SermonReviewError
      expect(error.message).toBe(
        'O provedor recusou a revisão (HTTP 503). Verifique a chave, o modelo e os limites da conta.',
      )
    }
  })
})

describe('revisão: endpoints e contratos de cada provedor', () => {
  it('usa o endpoint estruturado e a autenticação de cada provedor', async () => {
    const context = reviewContext(['fidelity'])
    const source = bibleSource()
    for (const provider of AI_PROVIDERS) {
      const { fetch, calls } = fakeFetch(() => providerResponse('{"findings":[]}', provider))
      const configuration = testConfiguration(provider, fetch)
      const built = buildReviewRequest(context, [source], configuration)
      const result = await reviewSermon(context, [source], configuration)

      expect(result.findings).toEqual([])
      expect(result.rejectedFindingCount).toBe(0)
      expect(calls).toHaveLength(1)
      const request = calls[0]!
      expect(request.method).toBe('POST')
      expect(request.url.host).toBe(EXPECTED_HOSTS[provider])
      expect(request.url.pathname).toBe(EXPECTED_PATHS[provider])
      expect(request.url.toString()).not.toContain('secret-key')
      expect(expectedAuthorization(provider, request.headers)).toBe(true)

      const body = JSON.stringify(built.body)
      expect(built.body.model).toBe(suggestedModel(provider))
      expect(body).toContain('MANUSCRITO_PRIVADO')
      expect(body).not.toContain('2026-10-04')
      expect(body).not.toContain('Mateus 21')
      expect(request.bodyText).toContain('MANUSCRITO_PRIVADO')
      expect(request.bodyText).not.toContain('2026-10-04')
      if (provider === 'openai' || provider === 'perplexity') expect(built.body.store).toBe(false)
      if (provider === 'perplexity') {
        expect(built.body.tools).toEqual([])
        expect(built.body.instructions).toBe(REVIEW_SYSTEM_PROMPT)
        expect(typeof built.body.input).toBe('string')
        const format = built.body.response_format as JSONObject
        expect(format.type).toBe('json_schema')
        const schemaName = at(format, 'json_schema', 'name') as string
        expect(schemaName).toBe('sermonreview')
        expect(schemaName).toMatch(/^[A-Za-z0-9]{1,64}$/)
        const alternatives = at(
          format,
          'json_schema',
          'schema',
          'properties',
          'findings',
          'items',
          'oneOf',
        ) as JSONObject[]
        expect(alternatives).toHaveLength(1)
        expect(at(alternatives[0], 'properties', 'evidence_source_id', 'enum')).toEqual([source.id])
        expect(at(alternatives[0], 'properties', 'correction', 'enum')).toEqual([''])
      }
      if (provider === 'openai') {
        expect(at(built.body, 'text', 'format', 'type')).toBe('json_schema')
        expect(at(built.body, 'text', 'format', 'strict')).toBe(true)
        expect(at(built.body, 'input', 0, 'content')).toBe(REVIEW_SYSTEM_PROMPT)
        expect(built.body.max_output_tokens).toBe(4_000)
      }
      if (provider === 'google') {
        expect(String(built.body.input)).toContain('Dados de entrada (JSON):')
        expect(at(built.body, 'response_format', 'mime_type')).toBe('application/json')
      }
    }
  })

  it('lê e valida a mensagem estruturada da Agent API da Perplexity contra as fontes', async () => {
    const json =
      '{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"A promessa parece distante.","observation":"A passagem citada registra que Jesus chorou, sem explicitar a afirmação do manuscrito.","correction":"","classification":"unsupported","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."}]}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'perplexity'))
    const result = await reviewSermon(
      reviewContext(['fidelity'], 'A promessa parece distante.'),
      [bibleSource()],
      testConfiguration('perplexity', fetch),
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.criterion).toBe('fidelity')
    expect(result.findings[0]?.manuscriptQuote).toBe('A promessa parece distante.')
    expect(result.findings[0]?.evidenceQuote).toBe('Jesus chorou.')
    expect(result.findings[0]?.evidenceSourceTitle).toBe('NVT')
    expect(result.findings[0]?.evidenceCitation).toBe('João 3:16 · NVT')
    expect(result.findings[0]?.status).toBe('open')
    expect(result.validationNotice).toBeUndefined()
  })

  it('a Agent API só lê blocos output_text de mensagens', () => {
    const response = {
      output: [
        { type: 'search_results', results: [{ text: 'ignorado' }] },
        {
          type: 'message',
          content: [
            { type: 'reasoning', text: 'ignorado' },
            { type: 'output_text', text: '{"a":' },
          ],
        },
        { type: 'message', content: [{ type: 'output_text', text: '1}' }] },
      ],
    }
    expect(outputText(response, 'perplexity')).toBe('{"a":1}')
    expect(outputText({ output: [{ type: 'message', content: [] }] }, 'perplexity')).toBeUndefined()
    expect(
      outputText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }, 'google'),
    ).toBe('ab')
  })

  it('filtra apontamentos com âncoras e evidências não verificáveis', async () => {
    const cases = [
      '{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"frase inventada","observation":"A afirmação não aparece no trecho.","correction":"","classification":"unsupported","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."}]}',
      '{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"MANUSCRITO_PRIVADO","observation":"O texto atribui a ação a outra pessoa.","correction":"","classification":"tension","evidence_source_id":"fonte inexistente","evidence_quote":"Jesus chorou."}]}',
      '{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"MANUSCRITO_PRIVADO","observation":"A formulação difere da fonte.","correction":"","classification":"tension","evidence_source_id":"bible:nvt","evidence_quote":"citação inventada"}]}',
    ]
    for (const json of cases) {
      const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
      const result = await reviewSermon(
        reviewContext(['fidelity', 'structure']),
        [bibleSource()],
        testConfiguration('openai', fetch),
      )
      expect(result.findings).toEqual([])
      expect(result.rejectedFindingCount).toBe(1)
      expect(result.validationNotice).toBeDefined()
    }
  })

  it('mantém análise de hipótese e de imperativo citado', async () => {
    const manuscript =
      'Poderia haver uma resposta. O narrador diz: “Explique o temor.” Depois, o texto trata essa resposta como certa.'
    const json =
      '{"findings":[{"criterion":"clarity","severity":"note","manuscript_quote":"Poderia haver uma resposta.","observation":"O verbo “Poderia” apresenta uma hipótese que o parágrafo seguinte trata como certeza.","correction":"","classification":"clarity","evidence_source_id":"","evidence_quote":""},{"criterion":"clarity","severity":"note","manuscript_quote":"Explique o temor.","observation":"A fala “Explique o temor.” é citada sem identificar o interlocutor.","correction":"","classification":"clarity","evidence_source_id":"","evidence_quote":""}]}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'anthropic'))
    const result = await reviewSermon(
      reviewContext(['clarity'], manuscript),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]?.manuscriptQuote).toBe('Poderia haver uma resposta.')
    expect(result.findings.at(-1)?.observation).toBe(
      'A fala “Explique o temor.” é citada sem identificar o interlocutor.',
    )
    expect(result.rejectedFindingCount).toBe(0)
    expect(result.validationNotice).toBeUndefined()
  })

  it('mantém apontamentos válidos e informa só a contagem dos rejeitados', async () => {
    const json =
      '{"findings":[{"criterion":"structure","severity":"note","manuscript_quote":"O início apresenta a tese.","observation":"A tese aparece antes de o contexto que a sustenta ser apresentado.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""},{"criterion":"structure","severity":"attention","manuscript_quote":"Citação ausente.","observation":"Este apontamento não tem âncora real.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""}]}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'perplexity'))
    const log = memoryLog()
    const result = await reviewSermon(
      reviewContext(['structure'], 'O início apresenta a tese. Depois o texto a desenvolve.'),
      [],
      testConfiguration('perplexity', fetch, { http: { fetch, log } }),
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.observation).toBe(
      'A tese aparece antes de o contexto que a sustenta ser apresentado.',
    )
    expect(result.rejectedFindingCount).toBe(1)
    expect(result.rejectionReasons).toEqual(['manuscriptAnchor'])
    expect(result.validationNotice).toBe(
      '1 apontamento foi ocultado após a validação local (citação do manuscrito). Nenhum texto rejeitado foi exibido.',
    )
    expect(result.validationNotice).not.toContain('Este apontamento')
    const warning = log.lines.find((line) => line.includes('AVISO'))
    expect(warning).toContain(
      'validação local: 1 apontamentos rejeitados (citação do manuscrito) · 0 ajustes no mapa',
    )
    expect(warning).not.toContain('Este apontamento')
  })

  it('aceita correções linguísticas com mais de uma palavra', async () => {
    const json =
      '{"findings":[{"criterion":"spelling","severity":"attention","manuscript_quote":"excessão","observation":"A grafia desta palavra não corresponde à forma padrão.","correction":"exceção","classification":"spelling","evidence_source_id":"","evidence_quote":""},{"criterion":"spelling","severity":"attention","manuscript_quote":"excessão","observation":"Grafia.","correction":"a exceção","classification":"spelling","evidence_source_id":"","evidence_quote":""}]}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'anthropic'))
    const result = await reviewSermon(
      reviewContext(['spelling'], 'A excessão confirma a regra.'),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]?.manuscriptQuote).toBe('excessão')
    expect(result.findings[0]?.correction).toBe('exceção')
    expect(result.findings[0]?.evidenceSourceTitle).toBeUndefined()
    expect(result.rejectionReasons).toEqual([])
  })

  it('confere citações com espaços colapsados e rejeita trechos longos fora da ortografia', async () => {
    const longQuote = 'a'.repeat(421)
    const manuscript = `Uma frase\n  com quebras.  ${longQuote}`
    const json = JSON.stringify({
      findings: [
        {
          criterion: 'tone',
          severity: 'note',
          manuscript_quote: 'frase com quebras.',
          observation: 'Tom.',
          correction: '',
          classification: 'tone',
          evidence_source_id: '',
          evidence_quote: '',
        },
        {
          criterion: 'tone',
          severity: 'note',
          manuscript_quote: longQuote,
          observation: 'Tom.',
          correction: '',
          classification: 'tone',
          evidence_source_id: '',
          evidence_quote: '',
        },
        {
          criterion: 'tone',
          severity: 'urgent',
          manuscript_quote: '',
          observation: 'Tom.',
          correction: '',
          classification: 'tone',
          evidence_source_id: '',
          evidence_quote: '',
        },
        {
          criterion: 'tone',
          severity: 'note',
          manuscript_quote: '',
          observation: 'x'.repeat(801),
          correction: '',
          classification: 'tone',
          evidence_source_id: '',
          evidence_quote: '',
        },
        {
          criterion: 'clarity',
          severity: 'note',
          manuscript_quote: '',
          observation: 'Critério não pedido.',
          correction: '',
          classification: 'clarity',
          evidence_source_id: '',
          evidence_quote: '',
        },
      ],
    })
    const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
    const result = await reviewSermon(
      reviewContext(['tone'], manuscript),
      [],
      testConfiguration('openai', fetch),
    )
    expect(result.findings.map((finding) => finding.manuscriptQuote)).toEqual(['frase com quebras.'])
    expect(result.rejectedFindingCount).toBe(4)
    expect(result.rejectionReasons).toEqual(['manuscriptAnchor', 'invalidFields'])
    expect(result.validationNotice).toBe(
      '4 apontamentos foram ocultados após a validação local (citação do manuscrito, critério ou formato). Nenhum texto rejeitado foi exibido.',
    )
  })

  it('não aceita JSON fora do contrato como revisão concluída', async () => {
    for (const json of ['{"findings":[{"criterion":"tone"}]}', '{"outra":[]}', '[]']) {
      const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
      const log = memoryLog()
      const error = (await rejection(
        reviewSermon(
          reviewContext(['tone']),
          [],
          testConfiguration('openai', fetch, { http: { fetch, log } }),
        ),
      )) as SermonReviewError
      expect(error.kind).toBe('unreadableResponse')
      expect(error.usage?.requests).toBe(1)
      expect(log.lines.some((line) => line.includes('JSON incompatível com o contrato'))).toBe(true)
      expect(log.lines.join('\n')).not.toContain('tone')
    }
  })
})

describe('revisão: mapa do sermão', () => {
  it('mantém notas contextuais e valida as âncoras do mapa', async () => {
    const manuscript =
      'Pergunto se poderia haver esperança. O texto diz que Jesus chorou. Termino com um convite.'
    const json =
      '{"findings":[],"structure":{"verdict":"solid","summary":"O sermão pergunta se poderia haver esperança, passa pelo texto e termina com um convite.","central_idea":{"status":"clear","statement":"Jesus chora com quem chora.","quote":"Jesus chorou","note":""},"sections":[{"kind":"introduction","assessment":"fulfills","start_quote":"Pergunto se poderia haver esperança.","note":"O verbo “poderia” apresenta uma hipótese na introdução."},{"kind":"development","assessment":"fulfills","start_quote":"O texto diz","note":""},{"kind":"conclusion","assessment":"fulfills","start_quote":"frase inexistente","note":"O convite encerra o texto sem explicar a relação com a hipótese."}],"movements":[{"label":"Pergunta com “poderia”","start_quote":"Pergunto"},{"label":"Movimento sem trecho","start_quote":""}],"gospel":{"status":"explicit","quote":"Termino com um convite.","note":""},"four_pages":[{"page":"problem_bible","status":"not_found","quote":""},{"page":"problem_today","status":"not_found","quote":""},{"page":"grace_bible","status":"present","quote":"Jesus chorou"},{"page":"grace_today","status":"present","quote":"trecho que não existe"}]}}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
    const result = await reviewSermon(
      reviewContext(['structure'], manuscript),
      [],
      testConfiguration('openai', fetch),
    )

    const structure = result.structure!
    expect(structure).toBeDefined()
    expect(result.rejectedFindingCount).toBe(0)
    expect(structure.verdict).toBe('solid')
    expect(structure.sections.map((section) => section.kind)).toEqual([
      'introduction',
      'development',
      'conclusion',
    ])
    expect(structureSection(structure, 'introduction')?.assessment).toBe('fulfills')
    expect(structureSection(structure, 'introduction')?.startQuote).toBe(
      'Pergunto se poderia haver esperança.',
    )
    expect(structureSection(structure, 'conclusion')?.assessment).toBe('partial')
    expect(structureSection(structure, 'conclusion')?.startQuote).toBe('')
    expect(structureSection(structure, 'introduction')?.note).toBe(
      'O verbo “poderia” apresenta uma hipótese na introdução.',
    )
    expect(structureSection(structure, 'conclusion')?.note).toBe(
      'O convite encerra o texto sem explicar a relação com a hipótese.',
    )
    expect(structure.summary).toContain('poderia')
    expect(structure.centralIdea.status).toBe('clear')
    expect(structure.centralIdea.statement).toBe('Jesus chora com quem chora.')
    expect(structure.movements.map((movement) => movement.label)).toEqual(['Pergunta com “poderia”'])
    expect(structure.gospel.status).toBe('explicit')
    expect(structure.fourPages.find((page) => page.page === 'grace_bible')?.status).toBe('present')
    expect(structure.fourPages.find((page) => page.page === 'grace_today')?.status).toBe('brief')
    expect(result.structureAdjustmentCount).toBe(5)
    expect(result.validationNotice).toContain('mapa do sermão')
    expect(result.validationNotice).not.toContain('Sugiro')
  })

  it('rebaixa status sem trecho e completa partes e páginas ausentes', async () => {
    const json = JSON.stringify({
      findings: [],
      structure: {
        verdict: 'inventado',
        summary: 'x'.repeat(601),
        central_idea: { status: 'clear', statement: 'Ideia.', quote: 'inexistente', note: '' },
        sections: [{ kind: 'introduction', assessment: 'fulfills', start_quote: '', note: '' }],
        movements: [],
        gospel: { status: 'explicit', quote: '', note: '' },
        four_pages: [],
      },
    })
    const { fetch } = fakeFetch(() => providerResponse(json, 'google'))
    const result = await reviewSermon(
      reviewContext(['structure'], 'Texto do sermão.'),
      [],
      testConfiguration('google', fetch),
    )
    const structure = result.structure!
    expect(structure.verdict).toBe('attention')
    expect(structure.summary).toBe('')
    expect(structure.centralIdea.status).toBe('diffuse')
    expect(structure.centralIdea.statement).toBe('Ideia.')
    expect(structure.sections.map((section) => section.assessment)).toEqual(['partial', 'missing', 'missing'])
    expect(structure.gospel.status).toBe('implicit')
    expect(structure.fourPages.map((page) => page.status)).toEqual([
      'not_found',
      'not_found',
      'not_found',
      'not_found',
    ])
    // resumo longo, citação da ideia, ideia rebaixada, introdução rebaixada, duas partes ausentes e Boa Nova rebaixada
    expect(result.structureAdjustmentCount).toBe(7)
    expect(result.validationNotice).toBe(
      'No mapa do sermão, 7 trechos ou notas foram ocultados por não corresponderem ao manuscrito.',
    )
  })

  it('dedica a revisão exclusiva de língua às correções, sem mapa homilético', () => {
    const { fetch } = fakeFetch()
    const request = buildReviewRequest(reviewContext(['spelling']), [], testConfiguration('anthropic', fetch))
    expect(request.body.system).toBe(LANGUAGE_REVIEW_SYSTEM_PROMPT)
    const schema = at(request.body, 'output_config', 'format', 'schema') as JSONObject
    expect(schema.required).toEqual(['findings'])
    expect(at(schema, 'properties', 'structure')).toBeUndefined()
  })

  it('pede o mapa nas revisões de conteúdo', () => {
    const { fetch } = fakeFetch()
    const request = buildReviewRequest(reviewContext(['clarity']), [], testConfiguration('openai', fetch))
    const schema = at(request.body, 'text', 'format', 'schema') as JSONObject
    expect(new Set(schema.required as string[])).toEqual(new Set(['findings', 'structure']))
    const structure = at(schema, 'properties', 'structure') as JSONObject
    expect(structure.additionalProperties).toBe(false)
    const properties = structure.properties as JSONObject
    expect(at(properties, 'sections', 'minItems')).toBe(3)
    expect(properties.central_idea).toBeDefined()
    expect(properties.gospel).toBeDefined()
    expect(properties.four_pages).toBeDefined()
    expect(REVIEW_SYSTEM_PROMPT).toContain('Mapa do sermão')
    expect(REVIEW_SYSTEM_PROMPT).toContain('Um texto, um foco, um ponto')
  })
})

describe('revisão: limites antes da rede', () => {
  it('bloqueia contexto acima do limite antes de qualquer requisição', async () => {
    const { fetch, calls } = fakeFetch()
    const tooLarge = (await rejection(
      reviewSermon(
        reviewContext(['structure'], 'x'.repeat(MAXIMUM_INPUT_BYTES + 1)),
        [],
        testConfiguration('openai', fetch),
      ),
    )) as SermonReviewError
    expect(tooLarge.kind).toBe('contextTooLarge')
    const largeSource = (await rejection(
      reviewSermon(
        reviewContext(['fidelity']),
        [
          {
            id: 'reader:large',
            title: 'Material grande',
            citation: 'Seção',
            text: 'x'.repeat(MAXIMUM_BYTES_PER_SOURCE + 1),
          },
        ],
        testConfiguration('openai', fetch),
      ),
    )) as SermonReviewError
    expect(largeSource.kind).toBe('contextTooLarge')
    expect(calls).toHaveLength(0)
  })

  it('conta o limite em bytes UTF-8, não em caracteres', async () => {
    const { fetch, calls } = fakeFetch()
    const error = (await rejection(
      reviewSermon(
        reviewContext(['structure'], 'ç'.repeat(MAXIMUM_INPUT_BYTES / 2 + 1)),
        [],
        testConfiguration('openai', fetch),
      ),
    )) as SermonReviewError
    expect(error.kind).toBe('contextTooLarge')
    expect(calls).toHaveLength(0)
  })

  it('valida manuscrito, critérios, modelo e chave na ordem do app', async () => {
    const { fetch, calls } = fakeFetch()
    const kind = async (promise: Promise<unknown>) => ((await rejection(promise)) as SermonReviewError).kind
    expect(
      await kind(reviewSermon(reviewContext(['tone'], '  \n'), [], testConfiguration('openai', fetch))),
    ).toBe('emptyManuscript')
    expect(await kind(reviewSermon(reviewContext([]), [], testConfiguration('openai', fetch)))).toBe(
      'noCriteria',
    )
    expect(
      await kind(
        reviewSermon(
          reviewContext(['tone']),
          [],
          testConfiguration('openai', fetch, { model: 'claude-sonnet-5' }),
        ),
      ),
    ).toBe('invalidModel')
    expect(
      await kind(
        reviewSermon(
          reviewContext(['tone']),
          [],
          testConfiguration('anthropic', fetch, { model: 'claude-unsafe/identifier' }),
        ),
      ),
    ).toBe('invalidModel')
    expect(
      await kind(
        reviewSermon(reviewContext(['tone']), [], testConfiguration('openai', fetch, { apiKey: '' })),
      ),
    ).toBe('noKey')
    expect(calls).toHaveLength(0)
  })

  it('respeita o cancelamento do chamador', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch, calls } = fakeFetch(() => providerResponse('{"findings":[]}', 'openai'))
    const error = await rejection(
      reviewSermon(
        reviewContext(['tone']),
        [],
        testConfiguration('openai', fetch, { http: { fetch, signal: controller.signal } }),
      ),
    )
    expect((error as Error).name).toBe('AbortError')
    expect(calls).toHaveLength(0)
  })
})

describe('revisão: mensagens de erro', () => {
  it('mantém os textos do app', () => {
    expect(new SermonReviewError('emptyManuscript').message).toBe(
      'Escreva algum texto antes de solicitar uma revisão.',
    )
    expect(new SermonReviewError('noCriteria').message).toBe('Selecione ao menos um critério de revisão.')
    expect(new SermonReviewError('incompleteResponse').message).toBe(
      'A revisão foi interrompida pelo limite de saída do modelo. Tente revisar menos critérios por vez.',
    )
    expect(new SermonReviewError('provider', { status: 429, detail: 'Limite.' }).message).toBe(
      'O provedor recusou a revisão (HTTP 429). Limite.',
    )
  })
})

describe('revisão: resposta do Claude em fluxo', () => {
  it('lê o JSON de uma resposta em fluxo com pensamento antes do texto', async () => {
    const { fetch } = fakeFetch(() =>
      claudeStream({
        content: [
          { type: 'thinking', thinking: 'PRIVATE_THINKING' },
          { type: 'text', text: '{"findings":[]}' },
        ],
        usage: { input_tokens: 5_000, output_tokens: 1_200 },
      }),
    )
    const result = await reviewSermon(
      reviewContext(['tone'], 'Texto.'),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.findings).toEqual([])
    expect(result.usage).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 5_000,
      outputTokens: 1_200,
      requests: 1,
    })
    expect(result.usage.costUSD).toBeCloseTo(0.022, 9)
  })
})
