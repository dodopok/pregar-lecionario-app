import { describe, expect, it } from 'vitest'
import { GoogleDriveError } from '../../src/drive/errors'
import {
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_LOOPBACK_NOT_FOUND_TEXT,
  GOOGLE_LOOPBACK_SUCCESS_TEXT,
  authorizationCodeFromCallback,
  googleAuthorizationURL,
  authorizeGoogleDrive,
  pkceCodeChallenge,
  exchangeGoogleAuthorizationCode,
  handleLoopbackRequest,
  isRejectedRefreshToken,
  loopbackRedirectURI,
  parseLoopbackQuery,
  randomOAuthState,
  randomPKCEVerifier,
  refreshGoogleAccessToken,
} from '../../src/drive/oauth'
import type { LoopbackReceiver, LoopbackResponse } from '../../src/drive/oauth'
import { fakeHttp, json } from './fake-fetch'

const clientId = 'desktop-client.apps.googleusercontent.com'

async function expectDriveError(
  promise: Promise<unknown>,
  code: GoogleDriveError['code'],
): Promise<GoogleDriveError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(GoogleDriveError)
  expect((error as GoogleDriveError).code).toBe(code)
  return error as GoogleDriveError
}

describe('OAuth do Google para desktop', () => {
  it('usa PKCE S256 e o escopo restrito drive.file', async () => {
    const verifier = randomPKCEVerifier()
    const state = randomOAuthState()
    const redirect = loopbackRedirectURI(49152)
    const url = new URL(await googleAuthorizationURL({ clientId, redirectUri: redirect, state, verifier }))
    const items = Object.fromEntries(url.searchParams)

    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(items.client_id).toBe(clientId)
    expect(items.redirect_uri).toBe('http://127.0.0.1:49152')
    expect(items.response_type).toBe('code')
    expect(items.scope).toBe('https://www.googleapis.com/auth/drive.file')
    expect(items.scope).toBe(GOOGLE_DRIVE_SCOPE)
    expect(items.access_type).toBe('offline')
    expect(items.prompt).toBe('consent')
    expect(items.code_challenge_method).toBe('S256')
    expect(items.code_challenge).toBe(await pkceCodeChallenge(verifier))
    expect(items.state).toBe(state)
    expect(url.toString()).not.toContain(verifier)
    expect(url.toString().toLowerCase()).not.toContain('client_secret')
    await expectDriveError(
      googleAuthorizationURL({ clientId: 'not-a-google-client', redirectUri: redirect, state, verifier }),
      'invalidClientID',
    )
  })

  it('gera verificador e state aleatórios em base64url e o desafio da RFC 7636', async () => {
    const verifier = randomPKCEVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(randomOAuthState()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomPKCEVerifier()).not.toBe(verifier)
    expect(await pkceCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('troca o código pelos tokens sem registrar segredos', async () => {
    const fake = fakeHttp(() =>
      json(200, {
        access_token: 'ya29.access-token-123456',
        refresh_token: '1//refresh-token-123456',
        expires_in: 3599,
      }),
    )
    const tokens = await exchangeGoogleAuthorizationCode(fake.http, {
      code: '4/auth-code-123456',
      client: { clientId, clientSecret: 'desktop-secret-123' },
      redirectUri: 'http://127.0.0.1:49152',
      verifier: 'verifier-value-123456',
    })

    expect(tokens).toEqual({
      accessToken: 'ya29.access-token-123456',
      refreshToken: '1//refresh-token-123456',
      expiresIn: 3599,
    })
    const request = fake.requests[0]!
    expect(request.url.toString()).toBe('https://oauth2.googleapis.com/token')
    expect(request.method).toBe('POST')
    expect(request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded')
    const form = request.form()
    expect(form.get('code')).toBe('4/auth-code-123456')
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code_verifier')).toBe('verifier-value-123456')
    expect(form.get('redirect_uri')).toBe('http://127.0.0.1:49152')
    expect(form.get('client_id')).toBe(clientId)
    expect(form.get('client_secret')).toBe('desktop-secret-123')
    expect(fake.log.entries[0]?.integration).toBe('Google Drive')
    expect(fake.log.entries[0]?.operation).toBe('OAuth · token')
  })

  it('renova o access token e omite o segredo quando não configurado', async () => {
    const fake = fakeHttp(() => json(200, { access_token: 'ya29.new-access-123456', expires_in: 3600 }))
    const tokens = await refreshGoogleAccessToken(fake.http, {
      refreshToken: '1//refresh-abcdef',
      client: { clientId },
    })
    const form = fake.requests[0]!.form()

    expect(tokens.accessToken).toBe('ya29.new-access-123456')
    expect(tokens.refreshToken).toBeUndefined()
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('1//refresh-abcdef')
    expect(form.has('client_secret')).toBe(false)
  })

  it('mostra a descrição do erro OAuth e reconhece o refresh token recusado', async () => {
    const fake = fakeHttp(() =>
      json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
    )
    const error = await expectDriveError(
      refreshGoogleAccessToken(fake.http, { refreshToken: 'refresh-secret-value', client: { clientId } }),
      'api',
    )

    expect(error.status).toBe(400)
    expect(error.message).toBe('Google Drive (HTTP 400): Token has been expired or revoked.')
    expect(error.oauthError).toBe('invalid_grant')
    expect(isRejectedRefreshToken(error)).toBe(true)
    expect(isRejectedRefreshToken(GoogleDriveError.api(400, 'Bad Request'))).toBe(false)
    expect(fake.log.lines.join('\n')).not.toContain('refresh-secret-value')

    fake.setHandler(() => json(500, 'not json'))
    const fallback = await expectDriveError(
      refreshGoogleAccessToken(fake.http, { refreshToken: 'refresh-secret-value', client: { clientId } }),
      'api',
    )
    expect(fallback.detail).toBe('Confira o OAuth Client ID e as APIs ativadas no Google Cloud.')

    fake.setHandler(() => json(200, { token_type: 'Bearer' }))
    await expectDriveError(
      refreshGoogleAccessToken(fake.http, { refreshToken: 'refresh-secret-value', client: { clientId } }),
      'invalidOAuthResponse',
    )
  })
})

describe('retorno por loopback', () => {
  it('aceita apenas o retorno com state e code ou error', () => {
    const accepted = handleLoopbackRequest('/?state=abc&code=4%2Fcode&scope=x')
    expect(accepted.status).toBe(200)
    expect(accepted.callback).toEqual({ state: 'abc', code: '4/code', scope: 'x' })
    expect(accepted.body).toContain(GOOGLE_LOOPBACK_SUCCESS_TEXT)
    expect(accepted.body).toContain('<meta charset="utf-8">')
    expect(accepted.headers['Content-Type']).toBe('text/html; charset=utf-8')

    const denied = handleLoopbackRequest('/?state=abc&error=access_denied')
    expect(denied.status).toBe(200)
    expect(denied.callback?.error).toBe('access_denied')

    for (const target of [
      '/favicon.ico',
      '/?code=only-code',
      '/?state=abc',
      'http://evil/?state=a&code=b',
      '/?state=%E0%A4&code=x',
    ]) {
      const response = handleLoopbackRequest(target)
      expect(response.status, target).toBe(404)
      expect(response.callback).toBeUndefined()
      expect(response.body).toContain(GOOGLE_LOOPBACK_NOT_FOUND_TEXT)
    }
  })

  it('lê a query como o URLComponents: primeiro valor vale e itens sem "=" são ignorados', () => {
    expect(parseLoopbackQuery('/?state=one&state=two&code&error=')).toEqual({ state: 'one', error: '' })
    expect(parseLoopbackQuery('/callback')).toEqual({})
    expect(parseLoopbackQuery('/?a=b#fragment')).toEqual({ a: 'b' })
  })

  it('confere o state antes de aceitar o código ou a recusa', () => {
    expect(authorizationCodeFromCallback({ state: 's1', code: 'c1' }, 's1')).toBe('c1')
    expect(() => authorizationCodeFromCallback({ state: 'other', code: 'c1' }, 's1')).toThrow(
      GoogleDriveError,
    )
    try {
      authorizationCodeFromCallback({ state: 's1', error: 'access_denied' }, 's1')
      expect.unreachable()
    } catch (error) {
      expect((error as GoogleDriveError).code).toBe('authorizationDenied')
      expect((error as GoogleDriveError).message).toBe('A autorização do Google foi recusada: access_denied')
    }
    expect(() => authorizationCodeFromCallback({ state: 's1' }, 's1')).toThrow(
      'O Google não concluiu a autorização. Tente conectar novamente.',
    )
  })

  class FakeReceiver implements LoopbackReceiver {
    handler?: (target: string) => LoopbackResponse
    stopped = 0
    responses: LoopbackResponse[] = []

    async start(onRequest: (target: string) => LoopbackResponse): Promise<number> {
      this.handler = onRequest
      return 49152
    }

    stop(): void {
      this.stopped += 1
    }

    hit(target: string): void {
      this.responses.push(this.handler!(target))
    }
  }

  it('conclui o fluxo completo com o servidor local do app', async () => {
    const receiver = new FakeReceiver()
    const fake = fakeHttp(() =>
      json(200, { access_token: 'ya29.flow-access', refresh_token: '1//flow-refresh', expires_in: 3600 }),
    )
    let opened: URL | undefined

    const tokens = await authorizeGoogleDrive({
      http: fake.http,
      client: { clientId },
      receiver,
      openBrowser: async (url) => {
        opened = new URL(url)
        const state = opened.searchParams.get('state')!
        setTimeout(() => {
          receiver.hit('/favicon.ico')
          receiver.hit(`/?state=${encodeURIComponent(state)}&code=4%2Fgranted`)
        }, 0)
        return true
      },
    })

    expect(tokens.refreshToken).toBe('1//flow-refresh')
    expect(opened?.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152')
    expect(receiver.responses.map((response) => response.status)).toEqual([404, 200])
    expect(receiver.stopped).toBe(1)
    const form = fake.requests[0]!.form()
    expect(form.get('code')).toBe('4/granted')
    expect(form.get('redirect_uri')).toBe('http://127.0.0.1:49152')
    expect(await pkceCodeChallenge(form.get('code_verifier')!)).toBe(
      opened?.searchParams.get('code_challenge'),
    )
  })

  it('recusa state diferente, navegador que não abre e espera expirada', async () => {
    const fake = fakeHttp(() => json(500, {}))
    const wrongState = new FakeReceiver()
    await expectDriveError(
      authorizeGoogleDrive({
        http: fake.http,
        client: { clientId },
        receiver: wrongState,
        openBrowser: () => {
          setTimeout(() => wrongState.hit('/?state=forged&code=stolen'), 0)
        },
      }),
      'invalidOAuthResponse',
    )
    expect(wrongState.stopped).toBe(1)

    const closed = new FakeReceiver()
    await expectDriveError(
      authorizeGoogleDrive({
        http: fake.http,
        client: { clientId },
        receiver: closed,
        openBrowser: () => false,
      }),
      'invalidOAuthResponse',
    )
    expect(closed.stopped).toBe(1)

    const silent = new FakeReceiver()
    const timeout = await expectDriveError(
      authorizeGoogleDrive({
        http: fake.http,
        client: { clientId },
        receiver: silent,
        openBrowser: () => true,
        timeoutMs: 5,
      }),
      'authorizationTimedOut',
    )
    expect(timeout.message).toBe('A autorização expirou. Volte ao app e conecte o Google Drive novamente.')
    expect(silent.stopped).toBe(1)
    expect(fake.requests).toHaveLength(0)
  })
})
