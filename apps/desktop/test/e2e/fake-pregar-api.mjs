// API do Proper falsa para testes ponta a ponta: login, conta assinante, proxy da Estêvão e IA.
import { createServer } from 'node:http'

const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const usage = () => ({
  periodStart: '2026-11-01T03:00:00.000Z',
  periodEnd: '2026-12-01T03:00:00.000Z',
  used: { review: 3, structure: 1, questions: 0, research: 2 },
  limits: { monthly: { review: 40, structure: 40, questions: 60, research: 60 }, dailyAICalls: 20, monthlyCostCapUSD: 8 },
  todayCalls: 1,
  costCapReached: false,
})

const account = {
  user: { id: 'u1', email: 'pastor@example.com', name: 'Ana Pastora', createdAt: '2026-10-01T00:00:00.000Z' },
  plan: 'pro',
  subscription: {
    id: 's1', status: 'active', cycle: 'monthly', method: 'pix_automatico', priceCents: 1990,
    currentPeriodEnd: '2026-12-01T12:00:00.000Z', cancelAtPeriodEnd: false, pendingCharge: null,
    statusMessage: 'Ativa. Próxima renovação em 01/12/2026.',
  },
  usage: usage(),
  features: { aiProxy: true, estevaoProxy: true },
}

const verses = [
  { chapter: 13, number: 8, text: 'Não devam nada a ninguém, a não ser o amor que devem uns aos outros.' },
  { chapter: 13, number: 9, text: 'Pois os mandamentos se resumem neste: Ame o seu próximo como a si mesmo.' },
  { chapter: 13, number: 10, text: 'O amor não faz mal ao próximo. Portanto, o amor é o cumprimento da lei.' },
]

function day(date) {
  return {
    date,
    day_of_week: 'sunday',
    sunday_name: '23º Domingo depois de Pentecostes',
    season: { slug: 'ordinary', name: 'Tempo Comum' },
    color: 'green',
    is_sunday: true,
    celebration: { name: '23º Domingo depois de Pentecostes', color: 'green' },
    readings: [
      { slot: 'first_reading', reference: 'Ezequiel 33:7-11', text: { format: 'verses', verses: [{ chapter: 33, number: 7, text: 'Filho do homem, eu o fiz sentinela.' }] } },
      { slot: 'psalm', reference: 'Salmo 119:33-40', text: { format: 'verses', verses: [{ chapter: 119, number: 33, text: 'Ensina-me, Senhor, o caminho dos teus decretos.' }] } },
      { slot: 'second_reading', reference: 'Romanos 13:8-14', text: { format: 'verses', verses } },
      { slot: 'gospel', reference: 'Mateus 18:15-20', text: { format: 'verses', verses: [{ chapter: 18, number: 15, text: 'Se o seu irmão pecar contra você, vá e mostre-lhe o erro.' }] } },
    ],
    collect: [{ title: 'Coleta', text: 'Ó Deus, que nos ensinaste a guardar todos os teus mandamentos amando a ti e ao próximo, concede-nos a graça do teu Espírito.' }],
  }
}

export function startFakeAPI() {
  const calls = []
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    calls.push(`${request.method} ${url.pathname}`)
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const send = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      const auth = request.headers.authorization === 'Bearer prg_token_de_teste_valido_123456'
      const path = url.pathname
      // Degustação pública (sem conta): estado e leituras de uma janela de datas.
      if (path === '/v1/public/preview') {
        const today = new Date()
        const from = new Date(today)
        from.setDate(today.getDate() - 7)
        const to = new Date(today)
        to.setDate(today.getDate() + 35)
        return send(200, { enabled: true, days: 35, from: key(from), to: key(to) })
      }
      if (path.startsWith('/v1/public/estevao/days/')) return send(200, { data: day(path.split('/').at(-1)) })
      if (path === '/v1/auth/start') return send(202, { ok: true, expiresInMinutes: 10 })
      if (path === '/v1/auth/verify') return send(200, { token: 'prg_token_de_teste_valido_123456', sessionId: 'x', user: account.user })
      if (!auth && !path.startsWith('/v1/billing/plans')) return send(401, { error: { code: 'unauthorized', message: 'Entre na sua conta para continuar.' } })
      if (path === '/v1/account') return send(200, account)
      if (path === '/v1/billing/subscription') return send(200, { subscription: account.subscription })
      if (path.startsWith('/v1/estevao/days/')) return send(200, { data: day(path.split('/').at(-1)) })
      if (path === '/v1/estevao/days') {
        const from = new Date(`${url.searchParams.get('from')}T12:00:00`)
        const list = []
        for (let index = 0; index < 50; index += 1) {
          const date = new Date(from)
          date.setDate(from.getDate() + index)
          if (date.getDay() === 0) list.push({ date: key(date), sunday_name: `${index + 1}º Domingo do teste`, is_sunday: true })
        }
        return send(200, { data: list })
      }
      if (path === '/v1/estevao/passages') return send(200, { data: { reference: url.searchParams.get('ref'), bible: url.searchParams.get('bible'), text: { format: 'verses', verses } } })
      if (path === '/v1/estevao/bible-versions') return send(200, { data: [{ code: 'nvt', name: 'NVT' }, { code: 'naa', name: 'NAA' }] })
      if (path === '/v1/estevao/prayer-books') return send(200, { data: [{ code: 'loc_2027', name: 'LOC 2027', jurisdiction: 'IEAB', year: 2027 }] })
      if (path === '/v1/ai/review') {
        const input = JSON.parse(body)
        const quote = input.manuscript.split(/[.!?]/)[0].trim()
        return send(200, {
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          usage: { ...usage(), used: { ...usage().used, review: 4 } },
          result: {
            findings: [
              { id: '8a1c2f0e-0000-4000-8000-000000000001', criterion: 'clarity', severity: 'attention', manuscriptQuote: quote, observation: 'A relação entre a dívida e o amor fica implícita; o ouvinte precisa de um passo a mais para acompanhar.', status: 'open' },
            ],
            rejectedFindingCount: 0,
            rejectionReasons: [],
            structureAdjustmentCount: 0,
          },
        })
      }
      if (path === '/v1/ai/research') return send(200, { usage: usage(), result: { sources: [] } })
      return send(404, { error: { code: 'not_found', message: 'Rota não encontrada.' } })
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })))
}
