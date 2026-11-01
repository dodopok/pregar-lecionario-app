import { describe, expect, it } from 'vitest'
import { SermonAIQuestionError } from '../../src/ai/errors'
import { MAXIMUM_INPUT_BYTES } from '../../src/ai/materials'
import { QUESTION_SYSTEM_PROMPT } from '../../src/ai/prompts'
import { AI_PROVIDERS } from '../../src/ai/providers'
import { buildQuestionRequest, generateSermonQuestions } from '../../src/ai/questions'
import {
  bibleSource,
  claudeStream,
  EXPECTED_HOSTS,
  fakeFetch,
  jsonResponse,
  memoryLog,
  providerResponse,
  questionContext,
  rejection,
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

describe('perguntas de emergência', () => {
  it('preserva a redação contextual sem moldes fixos nem comparação de vocabulário', async () => {
    const manuscript = 'Explique o temor. A confiança sustenta o testemunho. O exemplo retoma a confiança.'
    const questions = [
      {
        question: 'Que efeito a fala “Explique o temor.” tem nessa conversa?',
        manuscript_quote: 'Explique o temor.',
        related_manuscript_quote: '',
        evidence_source_id: '',
        evidence_quote: '',
      },
      {
        question: 'O que a retomada da confiança esclarece no exemplo já narrado?',
        manuscript_quote: 'O exemplo retoma a confiança.',
        related_manuscript_quote: '',
        evidence_source_id: '',
        evidence_quote: '',
      },
      {
        question: 'Como a confiança descrita no testemunho se relaciona com o exemplo já apresentado?',
        manuscript_quote: 'A confiança sustenta o testemunho.',
        related_manuscript_quote: 'O exemplo retoma a confiança.',
        evidence_source_id: '',
        evidence_quote: '',
      },
    ]
    const { fetch } = fakeFetch(() => providerResponse(JSON.stringify({ questions }), 'anthropic'))
    const result = await generateSermonQuestions(
      questionContext(manuscript),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.questions.map((item) => item.question)).toEqual(questions.map((item) => item.question))
    expect(result.questions[0]?.relatedManuscriptQuote).toBeUndefined()
    expect(result.questions[2]?.relatedManuscriptQuote).toBe('O exemplo retoma a confiança.')
    expect(result.rejectedQuestionCount).toBe(0)
    expect(result.validationNotice).toBeUndefined()
  })

  it('mantém perguntas válidas e informa as descartadas', async () => {
    const json =
      '{"questions":[{"question":"O que você quis dizer com “distante”?","manuscript_quote":"distante","related_manuscript_quote":"","evidence_source_id":"","evidence_quote":""},{"question":"O que liga os dois parágrafos?","manuscript_quote":"trecho inexistente","related_manuscript_quote":"","evidence_source_id":"","evidence_quote":""}]}'
    const { fetch } = fakeFetch(() => providerResponse(json, 'anthropic'))
    const log = memoryLog()
    const result = await generateSermonQuestions(
      questionContext('A promessa parece distante.'),
      [],
      testConfiguration('anthropic', fetch, { http: { fetch, log } }),
    )
    expect(result.questions.map((item) => item.question)).toEqual(['O que você quis dizer com “distante”?'])
    expect(result.rejectedQuestionCount).toBe(1)
    expect(result.validationNotice).toBe('Uma pergunta foi descartada por formato ou citação inválida.')
    expect(result.validationNotice).not.toContain('inexistente')
    const warning = log.lines.find((line) => line.includes('AVISO'))
    expect(warning).toContain('validação local: aceitas=1 · descartadas=1 · manuscriptAnchor=1')
    expect(warning).not.toContain('inexistente')
  })

  it('valida as duas âncoras e os tamanhos sem classificar palavras', async () => {
    const longQuote = 'a'.repeat(241)
    const manuscript = `A promessa parece distante. A confiança sustenta a vida. ${longQuote}`
    const base = {
      question: 'Como a distância da promessa se relaciona com a confiança descrita?',
      manuscript_quote: 'A promessa parece distante.',
      related_manuscript_quote: 'A confiança sustenta a vida.',
      evidence_source_id: '',
      evidence_quote: '',
    }
    const items: JSONObject[] = []
    for (const related of ['trecho inexistente', 'A promessa parece distante.', longQuote]) {
      items.push({ ...base, related_manuscript_quote: related })
    }
    items.push({ ...base, manuscript_quote: longQuote })
    for (const question of ['  ', 'q'.repeat(401)]) items.push({ ...base, question })
    items.push(base)
    const { fetch } = fakeFetch(() => providerResponse(JSON.stringify({ questions: items }), 'anthropic'))
    const result = await generateSermonQuestions(
      questionContext(manuscript),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.questions).toHaveLength(1)
    expect(result.rejectedQuestionCount).toBe(6)
    expect(result.questions[0]?.relatedManuscriptQuote).toBe('A confiança sustenta a vida.')
    expect(result.validationNotice).toBe('6 perguntas foram descartadas por formato ou citação inválida.')
  })

  it('exige fontes fornecidas e evidência literal', async () => {
    const source = bibleSource()
    const valid = {
      question: 'O que você quis dizer com “distante”?',
      manuscript_quote: 'distante',
      related_manuscript_quote: '',
      evidence_source_id: source.id,
      evidence_quote: source.text,
    }
    const missingSource = { ...valid, evidence_source_id: 'unknown' }
    const inventedEvidence = { ...valid, evidence_quote: 'evidência inexistente' }
    const json = JSON.stringify({ questions: [missingSource, inventedEvidence, valid] })
    const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
    const result = await generateSermonQuestions(
      questionContext('A promessa parece distante.'),
      [source],
      testConfiguration('openai', fetch),
    )
    expect(result.questions).toHaveLength(1)
    expect(result.rejectedQuestionCount).toBe(2)
    expect(result.questions[0]?.evidenceQuote).toBe(source.text)
    expect(result.questions[0]?.evidenceSourceTitle).toBe(source.title)
    expect(result.questions[0]?.evidenceCitation).toBe(source.citation)
  })

  it('nunca exibe mais de três perguntas validadas', async () => {
    const question = {
      question: 'O que você quis dizer com “distante”?',
      manuscript_quote: 'distante',
      related_manuscript_quote: '',
      evidence_source_id: '',
      evidence_quote: '',
    }
    const json = JSON.stringify({ questions: [question, question, question, question] })
    const { fetch } = fakeFetch(() => providerResponse(json, 'anthropic'))
    const result = await generateSermonQuestions(
      questionContext('A promessa parece distante.'),
      [],
      testConfiguration('anthropic', fetch),
    )
    expect(result.questions).toHaveLength(3)
    expect(result.rejectedQuestionCount).toBe(1)
    expect(new Set(result.questions.map((item) => item.id)).size).toBe(3)
  })

  it('usa no Claude o mesmo tratamento limitado de truncamento', async () => {
    const { fetch, calls } = fakeFetch(() =>
      claudeStream({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"questions":[]}' }] }),
    )
    const error = (await rejection(
      generateSermonQuestions(questionContext(), [], testConfiguration('anthropic', fetch)),
    )) as SermonAIQuestionError
    expect(error).toBeInstanceOf(SermonAIQuestionError)
    expect(error.kind).toBe('incompleteResponse')
    expect(error.message).toBe(
      'As perguntas foram interrompidas pelo limite de saída do modelo. Tente novamente.',
    )
    expect(error.usage?.requests).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.body?.max_tokens)).toEqual([16_000, 32_000])
    const request = buildQuestionRequest(questionContext(), [], testConfiguration('anthropic', fetch))
    expect(request.body.max_tokens).toBe(16_000)
    expect(request.timeoutMs).toBe(300_000)
  })

  it('traduz recusa, contexto excedido e erro HTTP para os erros das perguntas', async () => {
    const cases: [() => Response, string][] = [
      [() => claudeStream({ stop_reason: 'refusal', content: [] }), 'refusedResponse'],
      [() => claudeStream({ stop_reason: 'model_context_window_exceeded', content: [] }), 'contextTooLarge'],
      [() => jsonResponse(401, { error: { message: 'invalid x-api-key secret-key' } }), 'provider'],
    ]
    for (const [handler, kind] of cases) {
      const { fetch } = fakeFetch(handler)
      const error = (await rejection(
        generateSermonQuestions(questionContext(), [], testConfiguration('anthropic', fetch)),
      )) as SermonAIQuestionError
      expect(error).toBeInstanceOf(SermonAIQuestionError)
      expect(error.kind).toBe(kind)
      if (kind === 'provider') {
        expect(error.message).toBe(
          'O provedor recusou a solicitação (HTTP 401). invalid x-api-key [chave removida]',
        )
      }
    }
  })

  it('o esquema permite a redação do modelo com âncoras verificáveis', () => {
    const source = bibleSource()
    const { fetch } = fakeFetch()
    const request = buildQuestionRequest(questionContext(), [source], testConfiguration('anthropic', fetch))
    const schema = at(request.body, 'output_config', 'format', 'schema') as JSONObject
    const item = at(schema, 'properties', 'questions', 'items') as JSONObject
    const fields = item.properties as JSONObject
    expect(at(fields, 'question', 'type')).toBe('string')
    expect(at(fields, 'question', 'enum')).toBeUndefined()
    expect(fields.kind).toBeUndefined()
    expect(at(fields, 'evidence_source_id', 'enum')).toEqual(['', source.id])
    expect(new Set(item.required as string[])).toEqual(new Set(Object.keys(fields)))
    expect(item.additionalProperties).toBe(false)
    expect(item.anyOf).toBeUndefined()
    expect(String(at(fields, 'manuscript_quote', 'description'))).toContain('240')
    expect(request.body.system).toBe(QUESTION_SYSTEM_PROMPT)
  })

  it('usa todos os provedores sem enviar data nem título', async () => {
    const context = questionContext('A promessa parece distante.')
    const json =
      '{"questions":[{"question":"O que você quis dizer com “distante”?","manuscript_quote":"distante","related_manuscript_quote":"","evidence_source_id":"","evidence_quote":""}]}'
    for (const provider of AI_PROVIDERS) {
      const { fetch, calls } = fakeFetch(() => providerResponse(json, provider))
      const built = buildQuestionRequest(context, [], testConfiguration(provider, fetch))
      const result = await generateSermonQuestions(context, [], testConfiguration(provider, fetch))
      expect(result.questions.map((item) => item.question)).toEqual(['O que você quis dizer com “distante”?'])
      expect(calls[0]?.url.host).toBe(EXPECTED_HOSTS[provider])
      expect(calls[0]?.url.toString()).not.toContain('secret-key')
      const body = JSON.stringify(built.body)
      expect(body).not.toContain('2026-10-04')
      expect(body).not.toContain('Mateus 21')
      expect(calls[0]?.bodyText).not.toContain('2026-10-04')
      if (provider !== 'anthropic') expect(built.body.max_output_tokens ?? 1_400).toBe(1_400)
      if (provider === 'perplexity') {
        const schemaName = at(built.body, 'response_format', 'json_schema', 'name') as string
        expect(schemaName).toBe('sermonquestions')
        expect(schemaName).toMatch(/^[A-Za-z0-9]{1,64}$/)
      }
    }
  })

  it('rejeita âncoras não verificáveis e perguntas ausentes', async () => {
    const invalidResults = [
      '{"questions":[{"question":"Que relação há entre esses trechos?","manuscript_quote":"trecho inexistente","related_manuscript_quote":"","evidence_source_id":"","evidence_quote":""}]}',
      '{"questions":[{"manuscript_quote":"A promessa parece distante.","related_manuscript_quote":"","evidence_source_id":"","evidence_quote":""}]}',
      '{"questions":[{"question":"  ","manuscript_quote":"A promessa parece distante.","evidence_source_id":"","evidence_quote":""}]}',
      '{"questions":[{"question":"O que liga os dois parágrafos?","manuscript_quote":"A promessa parece distante.","related_manuscript_quote":"Outra parte inventada.","evidence_source_id":"","evidence_quote":""}]}',
    ]
    for (const json of invalidResults) {
      const { fetch } = fakeFetch(() => providerResponse(json, 'openai'))
      const error = (await rejection(
        generateSermonQuestions(
          questionContext('A promessa parece distante.'),
          [],
          testConfiguration('openai', fetch),
        ),
      )) as SermonAIQuestionError
      expect(error).toBeInstanceOf(SermonAIQuestionError)
      expect(error.kind).toBe('invalidQuestion')
      expect(error.usage?.requests).toBe(1)
    }
  })

  it('aceita lista vazia como resultado válido', async () => {
    const { fetch } = fakeFetch(() => providerResponse('{"questions":[]}', 'google'))
    const result = await generateSermonQuestions(
      questionContext('Texto.'),
      [],
      testConfiguration('google', fetch),
    )
    expect(result.questions).toEqual([])
    expect(result.validationNotice).toBeUndefined()
  })

  it('não lê JSON fora do contrato como perguntas', async () => {
    const { fetch } = fakeFetch(() => providerResponse('{"questions":[{"question":"Sem âncora"}]}', 'openai'))
    const log = memoryLog()
    const error = (await rejection(
      generateSermonQuestions(
        questionContext('Texto.'),
        [],
        testConfiguration('openai', fetch, { http: { fetch, log } }),
      ),
    )) as SermonAIQuestionError
    expect(error.kind).toBe('unreadableResponse')
    expect(log.lines.some((line) => line.includes('JSON incompatível com o contrato de perguntas'))).toBe(
      true,
    )
  })

  it('valida manuscrito, modelo, chave e limites antes da rede', async () => {
    const { fetch, calls } = fakeFetch()
    const kind = async (promise: Promise<unknown>) =>
      ((await rejection(promise)) as SermonAIQuestionError).kind
    expect(
      await kind(generateSermonQuestions(questionContext(' '), [], testConfiguration('openai', fetch))),
    ).toBe('emptyManuscript')
    expect(
      await kind(
        generateSermonQuestions(
          questionContext(),
          [],
          testConfiguration('perplexity', fetch, { model: 'sonar-pro' }),
        ),
      ),
    ).toBe('invalidModel')
    expect(
      await kind(
        generateSermonQuestions(questionContext(), [], testConfiguration('openai', fetch, { apiKey: '' })),
      ),
    ).toBe('noKey')
    expect(
      await kind(
        generateSermonQuestions(
          questionContext('x'.repeat(MAXIMUM_INPUT_BYTES + 1)),
          [],
          testConfiguration('openai', fetch),
        ),
      ),
    ).toBe('contextTooLarge')
    expect(calls).toHaveLength(0)
  })
})
