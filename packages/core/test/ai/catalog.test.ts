import { describe, expect, it } from 'vitest'
import { decodeModelOptions, encodeModelOptions, fetchClaudeModels } from '../../src/ai/catalog'
import { AIModelCatalogError } from '../../src/ai/errors'
import {
  acceptsModel,
  AI_PROVIDERS,
  defaultResearchChoice,
  defaultReviewChoice,
  modelDisplayName,
  modelOptions,
  providerModels,
  providerName,
  suggestedModel,
  usableClaudeModels,
} from '../../src/ai/providers'
import { fakeFetch, jsonResponse, memoryLog, rejection } from './helpers'

describe('catálogo de modelos do Claude', () => {
  it('pagina com autenticação, mantém modelos novos e descarta duplicados e aposentados', async () => {
    const { fetch, calls } = fakeFetch((request) => {
      const isFirstPage = !request.url.searchParams.has('after_id')
      const models = isFirstPage
        ? [
            { id: 'claude-opus-6-1', display_name: 'Claude Opus 6.1' },
            { id: 'claude-retired-test', display_name: 'Retired', lifecycle: 'retired' },
          ]
        : [
            { id: 'claude-opus-6-1', display_name: 'Duplicate' },
            { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
            { id: 'gpt-other-provider', display_name: 'Other' },
          ]
      return jsonResponse(200, { data: models, has_more: isFirstPage, last_id: 'claude-opus-6-1' })
    })
    const log = memoryLog()
    const models = await fetchClaudeModels('secret-key', { fetch, log })
    expect(models.map((model) => model.id)).toEqual(['claude-opus-6-1', 'claude-sonnet-5-5'])
    expect(models[0]?.displayName).toBe('Claude Opus 6.1')
    expect(calls).toHaveLength(2)
    for (const request of calls) {
      expect(request.method).toBe('GET')
      expect(request.url.host).toBe('api.anthropic.com')
      expect(request.url.pathname).toBe('/v1/models')
      expect(request.url.searchParams.get('limit')).toBe('1000')
      expect(request.headers.get('authorization')).toBe('Bearer secret-key')
      expect(request.headers.get('anthropic-version')).toBeTruthy()
      expect(request.url.toString()).not.toContain('secret-key')
    }
    expect(calls.at(-1)?.url.searchParams.get('after_id')).toBe('claude-opus-6-1')
    expect(log.lines).toHaveLength(2)
    expect(log.lines.every((line) => line.includes('OK · IA · catálogo de modelos Claude'))).toBe(true)
    expect(log.lines.join('\n')).not.toContain('secret-key')
  })

  it('rejeita erros do servidor e cursores de paginação repetidos', async () => {
    const refused = fakeFetch(() => new Response('', { status: 401 }))
    const error = (await rejection(
      fetchClaudeModels('secret-key', { fetch: refused.fetch }),
    )) as AIModelCatalogError
    expect(error).toBeInstanceOf(AIModelCatalogError)
    expect(error.kind).toBe('provider')
    expect(error.status).toBe(401)
    expect(error.message).toBe(
      'Não foi possível atualizar os modelos do Claude (HTTP 401). Verifique a chave e tente novamente.',
    )

    const looping = fakeFetch(() =>
      jsonResponse(200, {
        data: [{ id: 'claude-opus-5-5', display_name: 'Opus' }],
        has_more: true,
        last_id: 'same',
      }),
    )
    const loop = (await rejection(
      fetchClaudeModels('secret-key', { fetch: looping.fetch }),
    )) as AIModelCatalogError
    expect(loop.kind).toBe('unreadableResponse')
    expect(looping.calls).toHaveLength(2)
  })

  it('exige chave, modelos válidos e página legível', async () => {
    const { fetch, calls } = fakeFetch(() =>
      jsonResponse(200, { data: [{ id: 'claude-x' }], has_more: false }),
    )
    expect(((await rejection(fetchClaudeModels('', { fetch }))) as AIModelCatalogError).kind).toBe('noKey')
    expect(calls).toHaveLength(0)
    expect(((await rejection(fetchClaudeModels('secret-key', { fetch }))) as AIModelCatalogError).kind).toBe(
      'unreadableResponse',
    )
    const empty = fakeFetch(() =>
      jsonResponse(200, { data: [{ id: 'gpt-6-sol', display_name: 'GPT' }], has_more: false }),
    )
    expect(
      ((await rejection(fetchClaudeModels('secret-key', { fetch: empty.fetch }))) as AIModelCatalogError)
        .kind,
    ).toBe('unreadableResponse')
  })

  it('grava e lê o cache no formato do app', () => {
    const options = [{ id: 'claude-opus-6-1', displayName: 'Claude Opus 6.1', lifecycle: 'active' }]
    expect(encodeModelOptions(options)).toEqual([
      { id: 'claude-opus-6-1', display_name: 'Claude Opus 6.1', lifecycle: 'active' },
    ])
    expect(decodeModelOptions(encodeModelOptions(options))).toEqual(options)
    expect(decodeModelOptions([{ id: 'x' }])).toBeUndefined()
  })
})

describe('provedores e preferências', () => {
  it('mantém nomes, modelos e IDs do app', () => {
    expect(AI_PROVIDERS).toEqual(['openai', 'anthropic', 'google', 'perplexity'])
    expect(AI_PROVIDERS.map(providerName)).toEqual(['OpenAI', 'Claude', 'Gemini', 'Perplexity'])
    expect(AI_PROVIDERS.map(suggestedModel)).toEqual([
      'gpt-6-sol',
      'claude-sonnet-5-5',
      'gemini-3.8-flash',
      'perplexity/sonar',
    ])
    expect(providerModels('anthropic')).toContain('claude-haiku-4-5')
    expect(modelDisplayName('perplexity', 'perplexity/sonar')).toBe('Sonar · Agent API')
    expect(modelDisplayName('openai', 'gpt-6-sol')).toBe('gpt-6-sol')
  })

  it('aceita qualquer ID de Claude bem formado e só a lista fixa nos demais', () => {
    expect(acceptsModel('anthropic', 'claude-opus-6-1')).toBe(true)
    expect(acceptsModel('anthropic', 'gpt-6-sol')).toBe(false)
    expect(acceptsModel('anthropic', 'claude-unsafe/identifier')).toBe(false)
    expect(acceptsModel('anthropic', 'claude-')).toBe(false)
    expect(acceptsModel('anthropic', `claude-${'a'.repeat(120)}`)).toBe(true)
    expect(acceptsModel('anthropic', `claude-${'a'.repeat(121)}`)).toBe(false)
    expect(acceptsModel('openai', 'gpt-6-luna')).toBe(true)
    expect(acceptsModel('perplexity', 'sonar')).toBe(false)
  })

  it('seleção dinâmica do Claude e catálogo em cache sobrevivem a recarregar as preferências', () => {
    const cached = [{ id: 'claude-opus-6-1', displayName: 'Claude Opus 6.1' }]
    expect(defaultReviewChoice('anthropic', 'claude-opus-6-1')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-6-1',
    })
    expect(defaultResearchChoice('anthropic', 'claude-opus-6-1')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-6-1',
    })
    expect(modelOptions('anthropic', { claudeModels: cached })).toEqual(cached)
    expect(
      modelOptions('anthropic', { claudeModels: cached, selectedModel: 'claude-sonnet-5' }).at(-1),
    ).toEqual({
      id: 'claude-sonnet-5',
      displayName: 'claude-sonnet-5 · seleção salva',
    })
    expect(
      usableClaudeModels([...cached, { id: 'claude-old', displayName: 'Old', lifecycle: 'retired' }]),
    ).toEqual(cached)
  })

  it('usa os padrões do app para preferências ausentes ou inválidas', () => {
    expect(defaultReviewChoice()).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(defaultResearchChoice()).toEqual({ provider: 'perplexity', model: 'perplexity/sonar' })
    expect(defaultReviewChoice('openai', 'claude-sonnet-5')).toEqual({
      provider: 'openai',
      model: 'gpt-6-sol',
    })
    expect(defaultReviewChoice('desconhecido', null)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    })
    expect(modelOptions('perplexity')).toEqual([{ id: 'perplexity/sonar', displayName: 'Sonar · Agent API' }])
    expect(modelOptions('openai', { selectedModel: 'gpt-6-luna' })).toHaveLength(2)
  })
})
