import type { FastifyBaseLogger } from 'fastify'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

/** Envio pela API HTTP do Resend. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Resend respondeu HTTP ${response.status}: ${body.slice(0, 300)}`)
    }
  }
}

/** Sem provedor configurado: registra no log (somente desenvolvimento). */
export class LogEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = []

  /** Em produção o corpo (com o código de login) nunca vai para o log. */
  constructor(
    public log?: FastifyBaseLogger,
    public revealContent = true,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message)
    const body = this.revealContent ? `:\n${message.text}` : ' (conteúdo omitido em produção)'
    this.log?.warn({ subject: message.subject }, `Email não enviado (sem RESEND_API_KEY)${body}`)
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

export function loginCodeEmail(code: string, minutes: number): Omit<EmailMessage, 'to'> {
  const text = [
    `Seu código para entrar no Proper: ${code}`,
    '',
    `Ele vale por ${minutes} minutos. Digite-o no aplicativo para concluir a entrada.`,
    'Se você não pediu este código, ignore este email; ninguém entra na sua conta sem ele.',
  ].join('\n')
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2a24;background:#f6f4ef;padding:24px">
<div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 8px;font-size:15px">Seu código para entrar no Proper:</p>
<p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p>
<p style="margin:0 0 8px;font-size:14px;color:#4a5550">Ele vale por ${minutes} minutos. Digite-o no aplicativo para concluir a entrada.</p>
<p style="margin:0;font-size:13px;color:#6b746f">Se você não pediu este código, ignore este email; ninguém entra na sua conta sem ele.</p>
</div></body></html>`
  return { subject: `${code} é seu código do Proper`, text, html }
}
