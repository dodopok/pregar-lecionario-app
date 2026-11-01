import type { FastifyReply } from 'fastify'
import type { ZodError } from 'zod'

/** Erro com código estável para o app e mensagem em português para a pessoa. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const errors = {
  unauthorized: () => new ApiError(401, 'unauthorized', 'Entre na sua conta para continuar.'),
  forbiddenPlan: () =>
    new ApiError(402, 'subscription_required', 'Este recurso faz parte da assinatura do Pregar.'),
  notFound: (what = 'Recurso') => new ApiError(404, 'not_found', `${what} não encontrado.`),
  rateLimited: (message = 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.') =>
    new ApiError(429, 'rate_limited', message),
  unavailable: (message: string) => new ApiError(503, 'unavailable', message),
  badRequest: (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details),
}

export function sendError(reply: FastifyReply, error: ApiError): FastifyReply {
  return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } })
}

export function validationError(error: ZodError): ApiError {
  const first = error.issues[0]
  return new ApiError(400, 'invalid_input', first?.message ?? 'Dados inválidos.', {
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  })
}
