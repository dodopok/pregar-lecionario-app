import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bearer, createTestContext, lastCode, login } from './helpers'
import type { TestContext } from './helpers'

let context: TestContext

beforeEach(async () => {
  context = await createTestContext()
})
afterEach(async () => {
  await context.close()
})

describe('login por código', () => {
  it('envia código, recusa código errado e entra com o certo', async () => {
    const start = await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: 'Pastor@Example.com ' } })
    expect(start.statusCode).toBe(202)
    expect(context.email.sent).toHaveLength(1)
    expect(context.email.sent[0]?.to).toBe('pastor@example.com')
    const code = lastCode(context.email)

    const wrong = await context.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { email: 'pastor@example.com', code: code === '000000' ? '111111' : '000000' },
    })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().error.code).toBe('invalid_code')

    const ok = await context.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { email: 'pastor@example.com', code, deviceName: 'MacBook', platform: 'darwin' },
    })
    expect(ok.statusCode).toBe(200)
    const token = ok.json().token as string
    expect(token.startsWith('prg_')).toBe(true)

    const reuse = await context.app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { email: 'pastor@example.com', code },
    })
    expect(reuse.statusCode).toBe(400)

    const account = await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(token) })
    expect(account.statusCode).toBe(200)
    expect(account.json()).toMatchObject({ user: { email: 'pastor@example.com' }, plan: 'free', subscription: null, usage: null })

    const stored = await context.db.selectFrom('sessions').select('token_hash').executeTakeFirstOrThrow()
    expect(stored.token_hash).not.toContain(token)
  })

  it('bloqueia o código após cinco tentativas erradas', async () => {
    await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: 'a@example.com' } })
    const code = lastCode(context.email)
    const wrongCode = code === '123456' ? '654321' : '123456'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await context.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { email: 'a@example.com', code: wrongCode } })
    }
    const right = await context.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { email: 'a@example.com', code } })
    expect(right.statusCode).toBe(400)
  })

  it('limita reenvio imediato e expira o código', async () => {
    await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: 'b@example.com' } })
    const again = await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: 'b@example.com' } })
    expect(again.statusCode).toBe(429)
    const code = lastCode(context.email)
    context.clock.advance(11 * 60 * 1000)
    const late = await context.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { email: 'b@example.com', code } })
    expect(late.statusCode).toBe(400)
  })

  it('valida email e rejeita token desconhecido', async () => {
    const invalid = await context.app.inject({ method: 'POST', url: '/v1/auth/start', payload: { email: 'não é email' } })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('invalid_input')
    const unknown = await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer('prg_inexistente_inexistente') })
    expect(unknown.statusCode).toBe(401)
    const none = await context.app.inject({ method: 'GET', url: '/v1/account' })
    expect(none.statusCode).toBe(401)
  })

  it('encerra a sessão no logout e lista dispositivos', async () => {
    const first = await login(context)
    const second = await login(context)
    const sessions = await context.app.inject({ method: 'GET', url: '/v1/account/sessions', headers: bearer(first) })
    expect(sessions.json().sessions).toHaveLength(2)
    expect(sessions.json().sessions.filter((item: { current: boolean }) => item.current)).toHaveLength(1)
    const logout = await context.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(second) })
    expect(logout.statusCode).toBe(204)
    const after = await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(second) })
    expect(after.statusCode).toBe(401)
    const still = await context.app.inject({ method: 'GET', url: '/v1/account', headers: bearer(first) })
    expect(still.statusCode).toBe(200)
  })
})
