import type { FastifyInstance } from 'fastify'
import { previewWindow } from '@pregar/core/liturgy/client'
import type { PreviewStatus, PreviewWindow } from '@pregar/core/liturgy/client'
import type { AppDeps } from '../../lib/context'
import { ApiError, errors } from '../../lib/errors'
import { WindowLimiter } from '../../lib/window-limiter'
import type { EstevaoProxy } from './proxy'

/** Só o calendário entra na degustação: um dia (`days/aaaa-mm-dd`) ou um intervalo (`days?from&to`). */
const SINGLE_DAY = /^days\/(\d{4}-\d{2}-\d{2})$/
const RANGE = /^days$/

/** Confere se a chave aaaa-mm-dd é um dia de calendário real (em UTC). */
function isCalendarDate(key: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** 2026-11-08 → 08/11/2026, para as mensagens. */
function brazilianDate(key: string): string {
  return key.split('-').reverse().join('/')
}

function outsideWindow(window: PreviewWindow): ApiError {
  return new ApiError(
    400,
    'preview_window',
    `A degustação mostra só as leituras entre ${brazilianDate(window.from)} e ${brazilianDate(window.to)}.`,
    window,
  )
}

function queryValue(query: Record<string, unknown>, name: string): string | undefined {
  const raw = query[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Restringe a consulta à janela da degustação. Um dia fora dela é recusado; um intervalo é recortado
 * para caber nela (e recusado se nada sobrar). Qualquer outro caminho não existe para quem não tem conta.
 * Os demais parâmetros seguem para o proxy, que aplica a mesma lista de permitidos dos assinantes.
 */
export function restrictToWindow(
  path: string,
  query: Record<string, unknown>,
  window: PreviewWindow,
): { path: string; query: Record<string, unknown> } {
  const normalized = path.replace(/^\/+/, '')
  const rest = Object.fromEntries(Object.entries(query).filter(([name]) => name !== 'from' && name !== 'to'))
  const day = SINGLE_DAY.exec(normalized)?.[1]
  if (day !== undefined) {
    if (!isCalendarDate(day)) throw errors.badRequest('Data inválida. Use o formato AAAA-MM-DD.')
    if (day < window.from || day > window.to) throw outsideWindow(window)
    return { path: normalized, query: rest }
  }
  if (RANGE.test(normalized)) {
    const from = queryValue(query, 'from') ?? window.from
    const to = queryValue(query, 'to') ?? window.to
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      throw errors.badRequest('Data inválida. Use o formato AAAA-MM-DD.')
    }
    if (from > to) throw errors.badRequest('O início do intervalo precisa vir antes do fim.')
    const clampedFrom = from < window.from ? window.from : from
    const clampedTo = to > window.to ? window.to : to
    if (clampedFrom > clampedTo) throw outsideWindow(window)
    return { path: normalized, query: { ...rest, from: clampedFrom, to: clampedTo } }
  }
  throw new ApiError(404, 'not_found', 'Rota não encontrada.')
}

/**
 * Degustação: leituras das próximas semanas sem conta, para quem acabou de instalar o app.
 * Reaproveita o proxy dos assinantes (cache e tratamento de erros iguais), mas sem autenticação,
 * com limite por endereço IP e só dentro da janela de datas configurada.
 */
export function estevaoPublicRoutes(app: FastifyInstance, deps: AppDeps, proxy: EstevaoProxy): void {
  const { config, clock } = deps
  const limiter = new WindowLimiter(config.LIMIT_ESTEVAO_PREVIEW_PER_MINUTE, 60_000)
  const currentWindow = () => previewWindow(clock.now(), config.ESTEVAO_PREVIEW_DAYS)

  app.get('/v1/public/preview', async (_request, reply): Promise<PreviewStatus> => {
    reply.header('cache-control', 'public, max-age=300')
    if (!config.ESTEVAO_PUBLIC_PREVIEW) return { enabled: false, days: 0, from: null, to: null }
    return { enabled: true, days: config.ESTEVAO_PREVIEW_DAYS, ...currentWindow() }
  })

  app.get('/v1/public/estevao/*', async (request, reply) => {
    if (!config.ESTEVAO_PUBLIC_PREVIEW)
      throw new ApiError(404, 'preview_disabled', 'A degustação está desativada.')
    // Sem conta, o limite é por endereço: request.ip já respeita X-Forwarded-For quando TRUST_PROXY está ligado.
    if (!limiter.take(request.ip, clock.now().getTime())) {
      throw errors.rateLimited('Muitas consultas às leituras em pouco tempo. Aguarde um instante.')
    }
    const requested = (request.params as { '*': string })['*'] ?? ''
    const { path, query } = restrictToWindow(
      requested,
      request.query as Record<string, unknown>,
      currentWindow(),
    )
    const result = await proxy.get(path, query)
    if (result.status >= 500)
      throw new ApiError(502, 'upstream_error', 'A Estêvão API respondeu com erro. Tente de novo.')
    return (
      reply
        .status(result.status)
        .header('content-type', 'application/json; charset=utf-8')
        .header('x-pregar-cache', result.cache)
        // Dados litúrgicos públicos: qualquer cache no caminho pode guardar por uma hora.
        .header('cache-control', result.status === 200 ? 'public, max-age=3600' : 'no-store')
        .send(result.body)
    )
  })
}
