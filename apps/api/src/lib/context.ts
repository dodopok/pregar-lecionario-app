import type { Kysely } from 'kysely'
import type { FastifyBaseLogger } from 'fastify'
import type { AppConfig } from '../config'
import type { Database } from '../db/schema'
import type { EmailSender } from './email'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

/** Dependências injetáveis do servidor (os testes trocam rede, email e relógio). */
export interface AppDeps {
  config: AppConfig
  db: Kysely<Database>
  email: EmailSender
  clock: Clock
  /** fetch usado nas chamadas externas (Asaas, Estêvão, provedores de IA). */
  fetch: typeof fetch
  log?: FastifyBaseLogger
}
