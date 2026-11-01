import type { FastifyInstance, FastifyRequest } from 'fastify'
import { startLoginSchema, verifyLoginSchema } from '@pregar/core/plans/contract'
import type { AppDeps } from '../../lib/context'
import { errors } from '../../lib/errors'
import { parseInput } from '../../lib/validate'
import type { AuthContext } from './service'
import { AuthService } from './service'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1] ?? null
}

export function makeRequireAuth(service: AuthService) {
  return async function requireAuth(request: FastifyRequest): Promise<void> {
    const token = bearerToken(request)
    if (!token) throw errors.unauthorized()
    const context = await service.authenticate(token)
    if (!context) throw errors.unauthorized()
    request.auth = context
  }
}

export function authRoutes(app: FastifyInstance, deps: AppDeps, service: AuthService): void {
  const requireAuth = makeRequireAuth(service)

  app.post(
    '/v1/auth/start',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const input = parseInput(startLoginSchema, request.body)
      await service.startLogin(input.email, request.ip ?? null)
      return reply.status(202).send({ ok: true, expiresInMinutes: deps.config.LOGIN_CODE_TTL_MINUTES })
    },
  )

  app.post(
    '/v1/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => {
      const input = parseInput(verifyLoginSchema, request.body)
      const { token, user, session } = await service.verifyLogin(input)
      return {
        token,
        sessionId: session.id,
        user: { id: user.id, email: user.email, name: user.name, createdAt: user.created_at.toISOString() },
      }
    },
  )

  app.post('/v1/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!
    await service.revokeSession(auth.user.id, auth.session.id)
    return reply.status(204).send()
  })
}
