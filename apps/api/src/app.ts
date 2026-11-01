import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import cors from '@fastify/cors'
import type { AppDeps } from './lib/context'
import { ApiError, sendError } from './lib/errors'
import { AuthService } from './modules/auth/service'
import { authRoutes, makeRequireAuth } from './modules/auth/plugin'
import { BillingService } from './modules/billing/service'
import { billingRoutes } from './modules/billing/plugin'
import { QuotaService } from './modules/ai/quota'
import { aiRoutes } from './modules/ai/plugin'
import type { AIRunner } from './modules/ai/runner'
import { EstevaoProxy, estevaoRoutes } from './modules/estevao/proxy'
import { accountRoutes } from './modules/account/plugin'
import { legalRoutes } from './modules/legal/pages'
import { adminRoutes } from './modules/admin/plugin'

export interface AppServices {
  auth: AuthService
  billing: BillingService
  quota: QuotaService
  estevao: EstevaoProxy
  runner: AIRunner
}

export interface BuiltApp {
  app: FastifyInstance
  services: AppServices
}

export async function buildApp(deps: AppDeps, runner: AIRunner, options: { logger?: boolean } = {}): Promise<BuiltApp> {
  const { config } = deps
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            // Nunca registrar credenciais nem corpos de requisição.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["asaas-access-token"]',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
              ],
              censor: '[removido]',
            },
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  })
  deps.log ??= app.log

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
  await app.register(cors, {
    // O app desktop chama a API pelo processo principal, sem origem de navegador.
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: {
        code: 'rate_limited',
        message: `Muitas requisições em pouco tempo. Tente de novo em ${Math.ceil(context.ttl / 1000)} segundos.`,
      },
    }),
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return sendError(reply, error)
    const status = (error as { statusCode?: number }).statusCode
    if (status === 429) {
      return reply.status(429).send((error as unknown as { error?: unknown }).error ? error : { error: { code: 'rate_limited', message: 'Muitas requisições.' } })
    }
    if (status && status >= 400 && status < 500) {
      const code = status === 413 ? 'payload_too_large' : 'bad_request'
      const message = status === 413 ? 'O conteúdo enviado é grande demais.' : 'Requisição inválida.'
      return reply.status(status).send({ error: { code, message } })
    }
    request.log.error({ err: error }, 'Erro inesperado')
    return reply.status(500).send({ error: { code: 'internal', message: 'Erro inesperado no servidor. Tente novamente.' } })
  })
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Rota não encontrada.' } }),
  )

  const auth = new AuthService(deps)
  const billing = new BillingService(deps)
  const quota = new QuotaService(deps)
  const estevao = new EstevaoProxy(deps)
  const requireAuth = makeRequireAuth(auth)

  app.get('/health', async (_request, reply) => {
    try {
      await deps.db.selectNoFrom((eb) => eb.val(1).as('ok')).execute()
      return { ok: true }
    } catch {
      return reply.status(503).send({ ok: false })
    }
  })
  app.get('/', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pregar API</title><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Pregar API</h1><p>Serviço do aplicativo Pregar.</p><p><a href="/legal/privacidade">Privacidade</a> · <a href="/legal/termos">Termos</a></p></body></html>',
    ),
  )

  authRoutes(app, deps, auth)
  accountRoutes(app, deps, { auth, billing, quota }, requireAuth)
  billingRoutes(app, deps, billing, requireAuth)
  estevaoRoutes(app, deps, estevao, billing, requireAuth)
  aiRoutes(app, deps, { billing, quota, runner }, requireAuth)
  adminRoutes(app, deps, { billing, quota })
  legalRoutes(app, deps)

  return { app, services: { auth, billing, quota, estevao, runner } }
}
