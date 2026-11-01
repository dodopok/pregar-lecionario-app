import { afterEach, describe, expect, it } from 'vitest'
import { bearer, createTestContext, json, login } from './helpers'
import type { TestContext } from './helpers'
import { grantDays } from '../src/modules/admin/plugin'
import { createAIRunner } from '../src/modules/ai/core-runner'

let context: TestContext
afterEach(async () => {
  await context?.close()
})

describe('executor de IA real', () => {
  it('pesquisa pelo provedor com a chave do servidor e registra o consumo informado', async () => {
    const overrides = { PERPLEXITY_API_KEY: 'pplx-chave-do-servidor-de-teste', AI_RESEARCH_PROVIDER: 'perplexity', AI_RESEARCH_MODEL: 'perplexity/sonar' }
    // O executor precisa do fetch falso do contexto; monta o contexto e troca o executor.
    context = await createTestContext(overrides, {
      review: async () => {
        throw new Error('não usado')
      },
      questions: async () => {
        throw new Error('não usado')
      },
      research: (request, signal) => createAIRunner(context.deps).research(request, signal),
    })
    const source = { title: 'Commentary on Romans 13:8-14', url: 'https://www.workingpreacher.org/commentaries/romans-138-14', date: '2026-09-01' }
    let sentBody: Record<string, unknown> | undefined
    context.fake.routes.push((url, init) => {
      if (url.host !== 'api.perplexity.ai') return undefined
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer pplx-chave-do-servidor-de-teste')
      sentBody = JSON.parse(String(init.body))
      return json({
        model: 'perplexity/sonar',
        usage: { input_tokens: 1200, output_tokens: 400 },
        output: [
          { type: 'search_results', results: [source] },
          { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', title: source.title, url: source.url }] }] },
        ],
      })
    })
    const token = await login(context)
    await grantDays(context.deps, 'pastor@example.com', 30)
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/ai/research',
      headers: bearer(token),
      payload: { reference: 'Romanos 13:8-14', occasion: 'Próprio 18 A' },
    })
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body.result.sources[0].url).toBe(source.url)
    expect(body.usage.used.research).toBe(1)
    expect(JSON.stringify(sentBody)).toContain('Romanos 13:8-14')
    const usage = await context.db.selectFrom('usage_events').selectAll().executeTakeFirstOrThrow()
    expect(usage).toMatchObject({ kind: 'research', status: 'ok', provider: 'perplexity', input_tokens: 1200, output_tokens: 400 })
    expect(Number(usage.cost_usd)).toBeGreaterThan(0)
  })

  it('responde 503 quando o servidor não tem a chave do provedor', async () => {
    context = await createTestContext({}, {
      review: (request, signal) => createAIRunner(context.deps).review(request, signal),
      questions: (request, signal) => createAIRunner(context.deps).questions(request, signal),
      research: (request, signal) => createAIRunner(context.deps).research(request, signal),
    })
    const token = await login(context)
    await grantDays(context.deps, 'pastor@example.com', 30)
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/ai/review',
      headers: bearer(token),
      payload: { mainReference: 'Romanos 13', manuscript: 'Texto', criteria: ['spelling'] },
    })
    expect(response.statusCode).toBe(503)
  })
})
