import { sql } from 'kysely'
import type { AppDeps } from '../../lib/context'
import { hashLoginCode, hashToken, newLoginCode, newSessionToken, safeEqual } from '../../lib/crypto'
import { ApiError, errors } from '../../lib/errors'
import { loginCodeEmail } from '../../lib/email'
import type { Session, User } from '../../db/schema'

const MAX_ATTEMPTS = 5
const RESEND_INTERVAL_SECONDS = 45
const CODES_PER_EMAIL_PER_HOUR = 6
const CODES_PER_IP_PER_HOUR = 30
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface AuthContext {
  user: User
  session: Session
}

export class AuthService {
  constructor(private readonly deps: AppDeps) {}

  /** Envia o código. Responde igual para emails com e sem conta (não revela cadastro). */
  async startLogin(email: string, ip: string | null): Promise<void> {
    const { db, config, clock } = this.deps
    const now = clock.now()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const recent = await db
      .selectFrom('login_codes')
      .select(['created_at'])
      .where('email', '=', email)
      .where('created_at', '>', hourAgo)
      .orderBy('created_at', 'desc')
      .execute()
    const last = recent[0]
    if (last && now.getTime() - last.created_at.getTime() < RESEND_INTERVAL_SECONDS * 1000) {
      throw errors.rateLimited('Já enviamos um código há poucos segundos. Confira sua caixa de entrada e o spam.')
    }
    if (recent.length >= CODES_PER_EMAIL_PER_HOUR) throw errors.rateLimited()
    if (ip) {
      const fromIp = await db
        .selectFrom('login_codes')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('ip', '=', ip)
        .where('created_at', '>', hourAgo)
        .executeTakeFirst()
      if ((fromIp?.count ?? 0) >= CODES_PER_IP_PER_HOUR) throw errors.rateLimited()
    }
    const code = newLoginCode()
    // Um novo código invalida os anteriores ainda não usados.
    await db
      .updateTable('login_codes')
      .set({ consumed_at: now })
      .where('email', '=', email)
      .where('consumed_at', 'is', null)
      .execute()
    await db
      .insertInto('login_codes')
      .values({
        email,
        code_hash: hashLoginCode(config.AUTH_SECRET, email, code),
        ip,
        created_at: now,
        expires_at: new Date(now.getTime() + config.LOGIN_CODE_TTL_MINUTES * 60 * 1000),
      })
      .execute()
    const message = loginCodeEmail(code, config.LOGIN_CODE_TTL_MINUTES)
    try {
      await this.deps.email.send({ to: email, ...message })
    } catch (error) {
      this.deps.log?.error({ err: error }, 'Falha ao enviar o código de login')
      throw errors.unavailable('Não foi possível enviar o email agora. Tente novamente em alguns minutos.')
    }
  }

  async verifyLogin(input: {
    email: string
    code: string
    deviceName: string
    platform?: string | undefined
  }): Promise<{ token: string; user: User; session: Session }> {
    const { db, config, clock } = this.deps
    const now = clock.now()
    const row = await db
      .selectFrom('login_codes')
      .selectAll()
      .where('email', '=', input.email)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .orderBy('created_at', 'desc')
      .executeTakeFirst()
    const invalid = new ApiError(400, 'invalid_code', 'Código incorreto ou expirado. Peça um novo código.')
    if (!row) throw invalid
    if (row.attempts >= MAX_ATTEMPTS) throw invalid
    const expected = hashLoginCode(config.AUTH_SECRET, input.email, input.code)
    if (!safeEqual(expected, row.code_hash)) {
      const attempts = row.attempts + 1
      await db
        .updateTable('login_codes')
        .set({ attempts, consumed_at: attempts >= MAX_ATTEMPTS ? now : null })
        .where('id', '=', row.id)
        .execute()
      throw invalid
    }
    return db.transaction().execute(async (trx) => {
      const consumed = await trx
        .updateTable('login_codes')
        .set({ consumed_at: now })
        .where('id', '=', row.id)
        .where('consumed_at', 'is', null)
        .returning('id')
        .executeTakeFirst()
      if (!consumed) throw invalid
      let user = await trx
        .selectFrom('users')
        .selectAll()
        .where('email', '=', input.email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
      if (!user) {
        user = await trx
          .insertInto('users')
          .values({ email: input.email, created_at: now, updated_at: now })
          .returningAll()
          .executeTakeFirstOrThrow()
      }
      const token = newSessionToken()
      const session = await trx
        .insertInto('sessions')
        .values({
          user_id: user.id,
          token_hash: hashToken(token),
          device_name: input.deviceName.slice(0, 80),
          platform: input.platform ?? null,
          created_at: now,
          last_used_at: now,
          expires_at: new Date(now.getTime() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      return { token, user, session }
    })
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    const { db, config, clock } = this.deps
    if (!token.startsWith('prg_') || token.length < 20 || token.length > 200) return null
    const now = clock.now()
    const row = await db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .selectAll('sessions')
      .select([
        'users.email as u_email',
        'users.name as u_name',
        'users.asaas_customer_id as u_asaas',
        'users.created_at as u_created',
        'users.updated_at as u_updated',
        'users.deleted_at as u_deleted',
      ])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.revoked_at', 'is', null)
      .where('sessions.expires_at', '>', now)
      .where('users.deleted_at', 'is', null)
      .executeTakeFirst()
    if (!row) return null
    const { u_email, u_name, u_asaas, u_created, u_updated, u_deleted, ...session } = row
    if (now.getTime() - session.last_used_at.getTime() > SESSION_TOUCH_INTERVAL_MS) {
      const expires = new Date(now.getTime() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
      await db.updateTable('sessions').set({ last_used_at: now, expires_at: expires }).where('id', '=', session.id).execute()
      session.last_used_at = now
      session.expires_at = expires
    }
    const user: User = {
      id: session.user_id,
      email: u_email,
      name: u_name,
      asaas_customer_id: u_asaas,
      created_at: u_created,
      updated_at: u_updated,
      deleted_at: u_deleted,
    }
    return { user, session }
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.deps.db
      .updateTable('sessions')
      .set({ revoked_at: this.deps.clock.now() })
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) > 0
  }

  /** Limpeza periódica de códigos e sessões vencidas. */
  async purgeExpired(): Promise<void> {
    const now = this.deps.clock.now()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    await this.deps.db.deleteFrom('login_codes').where('created_at', '<', dayAgo).execute()
    await this.deps.db
      .deleteFrom('sessions')
      .where((eb) => eb.or([eb('expires_at', '<', now), eb('revoked_at', '<', dayAgo)]))
      .execute()
  }
}
