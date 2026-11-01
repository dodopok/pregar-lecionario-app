import { afterEach, describe, expect, it } from 'vitest'
import { formatDoctorReport, requiredWebhookEvents, runDoctor } from '../src/modules/admin/doctor'
import { createTestContext, json, type TestContext } from './helpers'

const PRODUCTION = {
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://api.pregar.test',
  RESEND_API_KEY: 're_chave_secreta_resend_123456',
  EMAIL_FROM: 'Pregar <nao-responda@pregar.test>',
  ASAAS_API_KEY: '$aact_prod_chave_secreta_asaas_123456',
  ASAAS_ENVIRONMENT: 'production',
  ANTHROPIC_API_KEY: 'sk-ant-chave-secreta-123456',
  PERPLEXITY_API_KEY: 'pplx-chave-secreta-123456',
}

let context: TestContext | null = null
afterEach(async () => {
  await context?.close()
  context = null
})

/** Serviços externos respondendo como numa conta pronta; cada teste estraga uma parte. */
function healthyServices(ctx: TestContext, mode: 'pix_automatico' | 'pix_assinatura') {
  const { fake } = ctx
  fake.on('GET', /^\/domains$/, () => ({ data: [{ name: 'pregar.test', status: 'verified' }] }))
  fake.on('GET', /\/finance\/balance$/, () => ({ balance: 0 }))
  fake.on('GET', /\/pix\/addressKeys$/, () => ({ data: [{ id: 'chave', status: 'ACTIVE' }] }))
  fake.on('GET', /\/webhooks$/, () => ({
    data: [{ url: 'https://api.pregar.test/v1/webhooks/asaas', enabled: true, interrupted: false, events: requiredWebhookEvents(mode) }],
  }))
  fake.on('GET', /\/pix\/automatic\/authorizations$/, () => ({ data: [] }))
  fake.on('GET', /^\/api\/v2\/prayer-books$/, () => ({ data: [] }))
  fake.on('GET', /^\/v1\/models\/claude-sonnet-5-5$/, () => ({ id: 'claude-sonnet-5-5', type: 'model', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }))
}

describe('admin doctor', () => {
  it('conta pronta: nenhuma falha, e o relatório não mostra segredos', async () => {
    context = await createTestContext({ ...PRODUCTION, BILLING_PIX_MODE: 'pix_automatico' })
    healthyServices(context, 'pix_automatico')
    const checks = await runDoctor(context.deps)
    expect(checks.filter((check) => check.status === 'falha')).toEqual([])
    expect(checks.find((check) => check.area === 'Asaas · Pix Automático')?.status).toBe('ok')
    expect(checks.find((check) => check.area === 'IA · revisão')?.detail).toContain('claude-sonnet-5-5')
    // Perplexity não tem verificação gratuita: aparece como aviso, não como falha.
    expect(checks.find((check) => check.area === 'IA · pesquisa')?.status).toBe('aviso')
    const report = formatDoctorReport(checks)
    expect(report).toContain('Pronto para produção')
    for (const secret of Object.values(PRODUCTION).filter((value) => value.includes('secreta'))) expect(report).not.toContain(secret)
    // As chaves vão só nos cabeçalhos de cada serviço.
    const asaasCall = context.fake.calls.find((call) => call.url.pathname.endsWith('/finance/balance'))!
    expect((asaasCall.init.headers as Record<string, string>).access_token).toBe(PRODUCTION.ASAAS_API_KEY)
    expect(asaasCall.url.host).toBe('api.asaas.com')
  })

  it('aponta cada problema de uma conta mal configurada', async () => {
    context = await createTestContext({
      ...PRODUCTION,
      ASAAS_API_KEY: '$aact_hmlg_chave_de_sandbox_123456',
      BILLING_PIX_MODE: 'pix_automatico',
      ESTEVAO_API_KEY: 'chave-estevao-errada',
    })
    const { fake } = context
    fake.on('GET', /^\/domains$/, () => ({ data: [{ name: 'pregar.test', status: 'pending' }] }))
    fake.on('GET', /\/finance\/balance$/, () => ({ balance: 0 }))
    fake.on('GET', /\/pix\/addressKeys$/, () => ({ data: [] }))
    fake.on('GET', /\/webhooks$/, () => ({
      data: [{ url: 'https://api.pregar.test/v1/webhooks/asaas', enabled: true, interrupted: false, events: ['PAYMENT_RECEIVED'] }],
    }))
    fake.on('GET', /\/pix\/automatic\/authorizations$/, () => ({ errors: [{ description: 'Recurso não habilitado' }] }), 403)
    fake.on('GET', /^\/api\/v2\/prayer-books$/, () => ({ error: 'unauthorized' }), 401)
    fake.on('GET', /^\/v1\/models\//, () => ({ type: 'error', error: { type: 'not_found_error', message: 'model not found' } }), 404)

    const checks = await runDoctor(context.deps)
    const failed = Object.fromEntries(checks.filter((check) => check.status === 'falha').map((check) => [check.area, check.detail]))
    expect(failed['Asaas']).toContain('chave é do outro ambiente')
    expect(failed['Asaas · chave Pix']).toContain('nenhuma chave Pix ativa')
    expect(failed['Asaas · webhook']).toContain('faltam eventos')
    expect(failed['Asaas · Pix Automático']).toContain('pix_assinatura')
    expect(failed['Email (Resend)']).toContain('ainda não verificado')
    expect(failed['Estêvão API']).toContain('401')
    expect(failed['IA · revisão']).toBeDefined()
    expect(formatDoctorReport(checks)).toMatch(/\d+ falha\(s\) a corrigir/)
  })

  it('sem chaves: diz qual variável falta, sem chamar os serviços', async () => {
    context = await createTestContext({ ASAAS_API_KEY: '', ESTEVAO_API_KEY: '', ASAAS_WEBHOOK_TOKEN: '' })
    const checks = await runDoctor(context.deps)
    const details = checks.map((check) => `${check.area}: ${check.detail}`).join('\n')
    expect(details).toContain('RESEND_API_KEY ausente')
    expect(details).toContain('ASAAS_API_KEY ausente')
    expect(details).toContain('ESTEVAO_API_KEY ausente')
    expect(details).toContain('chave de anthropic ausente')
    expect(context.fake.calls.filter((call) => !call.url.pathname.startsWith('/v1/models'))).toEqual([])
  })

  it('webhook ausente ou interrompido é falha', async () => {
    context = await createTestContext({ ...PRODUCTION })
    healthyServices(context, 'pix_assinatura')
    context.fake.routes.unshift((url) =>
      url.pathname.endsWith('/webhooks') ? json({ data: [{ url: 'https://api.pregar.test/v1/webhooks/asaas', enabled: true, interrupted: true, events: [] }] }) : undefined,
    )
    const checks = await runDoctor(context.deps)
    expect(checks.find((check) => check.area === 'Asaas · webhook')).toMatchObject({ status: 'falha', detail: expect.stringContaining('interrompida') })
  })
})
