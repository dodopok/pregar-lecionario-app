// Preferências, assinatura, Bíblia e boas-vindas de ponta a ponta, com capturas no claro e no escuro.
// Uso: xvfb-run -a node test/e2e/prefs.mjs [pasta-do-build] [pasta-das-capturas]
// Sobe uma API do Pregar falsa em 127.0.0.1 (conta gratuita → Pix pendente → assinatura ativa).
import { _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { watchMainErrors, describeMainErrors } from './main-errors.mjs'

const outDir = process.argv[2] ?? '.build-prefs'
const shots = process.argv[3] ?? 'screenshots/prefs'
mkdirSync(shots, { recursive: true })

// MARK: - QR code falso em PNG (só para a tela; não é um Pix de verdade)

function png(width, height, pixel) {
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = pixel(x, y)
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // profundidade
  header[9] = 0 // tons de cinza
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function fakeQR() {
  const size = 29
  const quiet = 4
  const scale = 6
  let seed = 7
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => random() > 0.52))
  const finder = (ox, oy) => {
    for (let y = -1; y < 8; y += 1)
      for (let x = -1; x < 8; x += 1) {
        const px = ox + x
        const py = oy + y
        if (px < 0 || py < 0 || px >= size || py >= size) continue
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
        modules[py][px] = ring !== 2 && ring !== 4 && x >= 0 && y >= 0 && x < 7 && y < 7
      }
  }
  finder(0, 0)
  finder(size - 7, 0)
  finder(0, size - 7)
  const total = (size + quiet * 2) * scale
  return png(total, total, (x, y) => {
    const mx = Math.floor(x / scale) - quiet
    const my = Math.floor(y / scale) - quiet
    return mx >= 0 && my >= 0 && mx < size && my < size && modules[my][mx] ? 0 : 255
  }).toString('base64')
}

// MARK: - API falsa com estado

const PIX_PAYLOAD =
  '00020101021226820014br.gov.bcb.pix2560qrpix.example.com/qr/v2/cobv/9d36b84f-c70b-478f-b95c-12729b90ca255204000053039865406019.905802BR5925PREGAR TECNOLOGIA LTDA6009SAO PAULO62070503***63041D3D'
const LIMITS = { monthly: { review: 40, structure: 40, questions: 60, research: 60 }, dailyAICalls: 20, monthlyCostCapUSD: 8 }
const TOKEN = 'prg_token_de_teste_prefs_123456'

function startPrefsAPI() {
  const qr = fakeQR()
  const now = () => new Date()
  const plusDays = (days) => new Date(Date.now() + days * 86_400_000)
  const brDate = (date) => date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const state = {
    paid: false,
    user: null,
    plan: 'free',
    subscription: null,
    payments: [],
    sessions: [
      { id: '6f9a1c52-6a3e-4c1f-9a51-111111111111', deviceName: 'Pregar · notebook-da-paroquia', platform: 'linux', createdAt: plusDays(-1).toISOString(), lastUsedAt: now().toISOString(), current: true },
      { id: '6f9a1c52-6a3e-4c1f-9a51-222222222222', deviceName: 'Pregar · MacBook do escritório', platform: 'darwin', createdAt: plusDays(-40).toISOString(), lastUsedAt: plusDays(-3).toISOString(), current: false },
    ],
  }
  const calls = []

  const subscriptionView = () => {
    const sub = state.subscription
    if (!sub) return null
    if (sub.status === 'pending' && state.paid) {
      sub.status = 'active'
      sub.currentPeriodEnd = plusDays(30).toISOString()
      sub.pendingCharge = null
      state.plan = 'pro'
      state.payments.unshift({ id: 'pay_2', status: 'RECEIVED', valueCents: sub.priceCents, dueDate: now().toISOString().slice(0, 10), paidAt: now().toISOString(), invoiceUrl: 'https://www.asaas.com/i/exemplo' })
    }
    const end = sub.currentPeriodEnd ? brDate(new Date(sub.currentPeriodEnd)) : null
    const statusMessage =
      sub.status === 'pending'
        ? 'Pague o Pix e autorize o débito automático no app do seu banco para ativar.'
        : sub.cancelAtPeriodEnd
          ? `Cancelada. O acesso continua até ${end}.`
          : `Ativa. Próxima renovação em ${end}.`
    return { ...sub, statusMessage }
  }

  const accountView = () => ({
    user: state.user,
    plan: state.plan,
    subscription: subscriptionView(),
    usage:
      state.plan === 'pro'
        ? {
            periodStart: now().toISOString(),
            periodEnd: plusDays(30).toISOString(),
            used: { review: 12, structure: 33, questions: 4, research: 7 },
            limits: LIMITS,
            todayCalls: 3,
            costCapReached: false,
          }
        : null,
    features: { aiProxy: state.plan === 'pro', estevaoProxy: state.plan === 'pro' },
  })

  const prayerBooks = [
    { code: 'loc_2027', name: 'REB - 2027', description: 'Livro de Oração Comum da Rede Episcopal Brasileira (2027)', language: 'pt-BR', jurisdiction: 'Rede Episcopal Brasileira', year: 2027, is_recommended: true, image_url: null, thumbnail_url: null },
    { code: 'loc_2015', name: 'LOC 2015', description: 'Livro de Oração Comum da Igreja Episcopal Anglicana do Brasil, edição de 2015.', language: 'pt-BR', jurisdiction: 'Igreja Episcopal Anglicana do Brasil', year: 2015, is_recommended: false, image_url: null, thumbnail_url: 'https://127.0.0.1:1/capa.png' },
    { code: 'bcp_2019', name: 'BCP 2019', description: 'Book of Common Prayer of the Anglican Church in North America.', language: 'en', jurisdiction: 'Anglican Church in North America', year: 2019, is_recommended: false, image_url: null, thumbnail_url: null },
    { code: 'bcp_1662', name: 'Book of Common Prayer 1662', description: null, language: 'en', jurisdiction: 'Church of England', year: 1662, is_recommended: false, image_url: null, thumbnail_url: null },
  ]
  const bibleVersions = [
    { code: 'nvt', name: 'NVT', full_name: 'Nova Versão Transformadora', language: 'pt-BR', is_recommended: false },
    { code: 'naa', name: 'NAA', full_name: 'Nova Almeida Atualizada', language: 'pt-BR', is_recommended: true },
    { code: 'ara', name: 'ARA', full_name: 'Almeida Revista e Atualizada', language: 'pt-BR', is_recommended: false },
    { code: 'nvi', name: 'NVI', full_name: 'Nova Versão Internacional', language: 'pt-BR', is_recommended: false },
    { code: 'kjv', name: 'KJV', full_name: 'King James Version', language: 'en', is_recommended: false },
  ]
  const TEXTS = {
    nvt: {
      16: 'Porque Deus amou tanto o mundo que deu o seu Filho único, para que todo o que nele crer não pereça, mas tenha a vida eterna.',
      17: 'Deus enviou seu Filho ao mundo não para condenar o mundo, mas para salvá-lo por meio dele.',
      18: 'Quem nele crê não é condenado, mas quem não crê já está condenado por não crer no Filho único de Deus.',
    },
    naa: {
      16: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito, para que todo o que nele crê não pereça, mas tenha a vida eterna.',
      18: 'Quem nele crê não é julgado; o que não crê já está julgado, porque não crê no nome do unigênito Filho de Deus.',
    },
  }
  const passage = (ref, bible) => {
    const crossChapter = /:\d+\s*[-–]\s*\d+:/.test(ref)
    if (crossChapter) {
      // Resposta antiga, sem capítulo por versículo: o app deve explicar em vez de alinhar.
      return { reference: ref, bible, text: { format: 'verses', verses: [{ number: 36, text: 'Quem crê no Filho tem a vida eterna.' }, { number: 1, text: 'Os fariseus ouviram dizer…' }] } }
    }
    const numbers = /:/.test(ref) ? [16, 17, 18] : Array.from({ length: 21 }, (_, index) => index + 1)
    const table = TEXTS[bible] ?? TEXTS.nvt
    const verses = numbers
      .map((number) => ({ chapter: bible === 'nvt' ? null : 3, number, text: table[number] ?? (bible === 'naa' && number === 17 ? null : `Versículo ${number} na ${bible.toUpperCase()}.`) }))
      .filter((verse) => verse.text)
    return { reference: ref, bible, text: { format: 'verses', verses } }
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const path = url.pathname
    calls.push(`${request.method} ${path}`)
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const send = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(value === undefined ? '' : JSON.stringify(value))
      }
      const fail = (status, code, message) => send(status, { error: { code, message } })
      if (path.startsWith('/legal/')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return response.end('<h1>Política de privacidade do Pregar</h1>')
      }
      if (path === '/v1/billing/plans') {
        return send(200, {
          method: 'pix_automatico',
          methodDescription:
            'Pix Automático: você autoriza uma vez no app do seu banco e as próximas cobranças são debitadas sozinhas. Cancele quando quiser.',
          offers: [
            { cycle: 'monthly', priceCents: 1990, label: 'Mensal', description: 'Revisão por IA e leituras sem configurar chaves.' },
            { cycle: 'yearly', priceCents: 19900, label: 'Anual', description: 'O mesmo plano, com desconto pelo ano inteiro.' },
          ],
          limits: LIMITS,
        })
      }
      if (path === '/v1/auth/start') return send(202, { ok: true, expiresInMinutes: 10 })
      if (path === '/v1/auth/verify') {
        if (body.code !== '123456') return fail(400, 'invalid_code', 'Código incorreto ou expirado. Peça um novo código.')
        state.user = { id: 'u-1', email: body.email, name: null, createdAt: now().toISOString() }
        return send(200, { token: TOKEN, sessionId: state.sessions[0].id, user: state.user })
      }
      if (request.headers.authorization !== `Bearer ${TOKEN}` || !state.user) return fail(401, 'unauthorized', 'Entre na sua conta para continuar.')
      if (path === '/v1/auth/logout') return send(204)
      if (path === '/v1/account' && request.method === 'GET') return send(200, accountView())
      if (path === '/v1/account' && request.method === 'PATCH') {
        state.user = { ...state.user, name: body.name }
        return send(200, accountView())
      }
      if (path === '/v1/account' && request.method === 'DELETE') {
        if (body.confirm !== 'APAGAR') return fail(400, 'bad_request', 'Digite APAGAR para confirmar.')
        state.user = null
        return send(204)
      }
      if (path === '/v1/account/sessions') return send(200, { sessions: state.sessions })
      if (path.startsWith('/v1/account/sessions/')) {
        state.sessions = state.sessions.filter((session) => !path.endsWith(session.id))
        return send(204)
      }
      if (path === '/v1/account/export') return send(200, { exportedAt: now().toISOString(), user: state.user })
      if (path === '/v1/billing/subscription') return send(200, { subscription: subscriptionView() })
      if (path === '/v1/billing/payments') return send(200, { payments: state.payments })
      if (path === '/v1/billing/checkout') {
        const digits = String(body.cpfCnpj ?? '').replace(/\D/g, '')
        if (digits.length !== 11 && digits.length !== 14) return fail(422, 'validation', 'CPF ou CNPJ inválido.')
        const price = body.cycle === 'yearly' ? 19900 : 1990
        state.user = { ...state.user, name: body.name }
        state.subscription = {
          id: 'sub-1',
          status: 'pending',
          cycle: body.cycle,
          method: 'pix_automatico',
          priceCents: price,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pendingCharge: { payload: PIX_PAYLOAD, image: qr, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), valueCents: price },
        }
        return send(200, { subscription: subscriptionView() })
      }
      if (path === '/v1/billing/cancel') {
        if (state.subscription) state.subscription.cancelAtPeriodEnd = true
        return send(200, { subscription: subscriptionView() })
      }
      if (path === '/v1/estevao/prayer-books') return send(200, { data: prayerBooks })
      if (path === '/v1/estevao/bible-versions') return send(200, { data: bibleVersions })
      if (path === '/v1/estevao/passages') return send(200, { data: passage(url.searchParams.get('ref') ?? '', url.searchParams.get('bible') ?? 'nvt') })
      if (path.startsWith('/v1/estevao/days/')) {
        return send(200, { data: { date: path.split('/').at(-1), sunday_name: 'Domingo de teste', color: 'purple', is_sunday: true, readings: [], collect: [] } })
      }
      if (path === '/v1/estevao/days') return send(200, { data: [] })
      return fail(404, 'not_found', 'Rota não encontrada.')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}`, server, state, calls })
    })
  })
}

// MARK: - Roteiro

const SECTIONS = [
  ['conta', 'Conta e assinatura'],
  ['estevao', 'Leituras e calendário'],
  ['ia', 'Revisão e pesquisa'],
  ['ritmo', 'Ritmo e duração'],
  ['aparencia', 'Aparência e texto'],
  ['pulpito', 'Levar para o púlpito'],
  ['drive', 'Google Drive'],
  ['biblioteca', 'Biblioteca'],
  ['fontes', 'Fontes'],
  ['sobre', 'Sobre'],
]

const api = await startPrefsAPI()
const userData = mkdtempSync(join(tmpdir(), 'pregar-prefs-'))
const env = { ...process.env }
delete env.NODE_OPTIONS
const app = await electron.launch({ args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
const mainErrors = watchMainErrors(app)
const failures = []
const notes = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

async function prepare(page, width, height) {
  await page.emulateMedia({ colorScheme: null })
  await page.setViewportSize({ width, height })
  page.on('pageerror', (error) => failures.push(`pageerror (${page.url().split('#')[1]}): ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource|net::/.test(message.text())) notes.push(`console: ${message.text()}`)
  })
}

const invoke = (page, channel, payload) => page.evaluate(([name, value]) => window.pregar.invoke(name, value), [channel, payload])
const settle = (page, ms = 350) => page.waitForTimeout(ms)
const setAppearance = async (page, appearance) => {
  await invoke(page, 'settings:update', { appearance })
  await settle(page, 500)
}

async function openSection(prefs, id, title) {
  await prefs.click(`a[href="#/preferencias/${id}"]`)
  await prefs.waitForSelector(`h1.prefs__title:text-is("${title}")`)
  await settle(prefs)
}

async function shootSections(prefs, suffix) {
  for (const [id, title] of SECTIONS) {
    await openSection(prefs, id, title)
    if (id === 'sobre') {
      await prefs.click('summary:has-text("Registros para o suporte")')
      await prefs.waitForSelector('.tail__view')
    }
    await prefs.screenshot({ path: join(shots, `prefs-${id}-${suffix}.png`) })
  }
}

async function scrollPrefs(prefs, top) {
  await prefs.evaluate((value) => {
    const scroller = document.querySelector('.prefs__scroll')
    if (scroller) scroller.scrollTop = value === 'end' ? scroller.scrollHeight : value
  }, top)
  await settle(prefs, 200)
}

try {
  const mesa = await app.firstWindow({ timeout: 20000 })
  await prepare(mesa, 1400, 900)
  await mesa.waitForLoadState('domcontentloaded')

  // Primeira abertura: tour de cinco passos sobre a Mesa; o último abre a folha Conectar.
  const tour = await mesa.waitForSelector('.tour', { timeout: 6000 }).catch(() => null)
  if (tour) {
    await settle(mesa)
    await mesa.screenshot({ path: join(shots, 'tour-passo-1.png') })
    for (let step = 2; step <= 5; step += 1) {
      await mesa.click('.tour button:has-text("Próximo")')
      await settle(mesa, 300)
      if (step === 3 || step === 5) await mesa.screenshot({ path: join(shots, `tour-passo-${step}.png`) })
    }
    await mesa.click('.tour button:has-text("Conectar agora")')
    await mesa.waitForSelector('.tour', { state: 'detached', timeout: 5000 }).catch(() => failures.push('o tour não fechou'))
    const afterTour = await invoke(mesa, 'settings:get')
    check(afterTour.value.onboarding.tourDone === true, `o tour não ficou marcado como concluído: ${JSON.stringify(afterTour.value.onboarding)}`)
  } else {
    notes.push('A Mesa não mostrou o tour da primeira abertura; capturas do tour puladas.')
  }
  const onboarding = await mesa.waitForSelector('.onboarding', { timeout: 6000 }).catch(() => null)
  if (onboarding) {
    await settle(mesa)
    await mesa.screenshot({ path: join(shots, 'onboarding-boas-vindas.png') })
    await mesa.click('button:has-text("Configurar minhas chaves")')
    await mesa.waitForSelector('h2:has-text("Chave da Estêvão API")')
    await mesa.screenshot({ path: join(shots, 'onboarding-passo-1.png') })
    await mesa.click('button:has-text("Pular por enquanto")')
    await mesa.waitForSelector('h2:has-text("Chave de inteligência artificial")')
    await mesa.screenshot({ path: join(shots, 'onboarding-passo-2.png') })
    await mesa.click('button:has-text("Pular por enquanto")')
    await mesa.waitForSelector('h2:has-text("Quase lá")')
    await mesa.screenshot({ path: join(shots, 'onboarding-resumo.png') })
    await mesa.click('button:has-text("Voltar")')
    await mesa.click('button:has-text("Voltar")')
    await mesa.click('button:has-text("Voltar")')
    await mesa.click('button:has-text("Decidir depois")')
    await mesa.waitForSelector('.onboarding', { state: 'detached', timeout: 5000 }).catch(() => failures.push('a folha de boas-vindas não fechou'))
    const saved = await invoke(mesa, 'settings:get')
    check(saved.value.onboarding.completed === true && saved.value.onboarding.path === 'later', `onboarding não salvou: ${JSON.stringify(saved.value.onboarding)}`)
  } else {
    notes.push('A folha Conectar não abriu depois do tour; capturas puladas.')
  }

  await invoke(mesa, 'settings:update', { apiBaseURL: api.url, appearance: 'light', onboarding: { completed: true, path: 'later', tourDone: true } })
  const opening = app.waitForEvent('window')
  await invoke(mesa, 'app:openWindow', { window: 'preferencias' })
  const prefs = await opening
  await prepare(prefs, 1120, 860)
  await prefs.waitForSelector('.prefs', { timeout: 15000 })
  await prefs.waitForSelector('h1.prefs__title:text-is("Conta e assinatura")')
  await prefs.waitForSelector('.offer, .hero__price', { timeout: 8000 }).catch(() => undefined)

  // 1. Todas as seções, sem conta, no claro e no escuro.
  await shootSections(prefs, 'claro')
  await setAppearance(prefs, 'dark')
  const dark = await prefs.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  check(dark, 'o escuro não foi aplicado à janela de Preferências')
  await shootSections(prefs, 'escuro')
  await setAppearance(prefs, 'light')

  // Fontes: editor de site com validação.
  await openSection(prefs, 'fontes', 'Fontes')
  const sitesCount = await prefs.locator('.item').count()
  check(sitesCount >= 4, `esperava as fontes iniciais, vieram ${sitesCount} itens`)
  await prefs.click('button:has-text("Adicionar site")')
  await prefs.waitForSelector('#site-title')
  await prefs.fill('#site-title', 'Sermões da Paróquia')
  await prefs.fill('#site-baseURL', 'http://paroquia.example.org')
  await prefs.click('.editor button[type="submit"]')
  await prefs.waitForSelector('.editor__error')
  await settle(prefs, 300)
  await prefs.screenshot({ path: join(shots, 'prefs-fontes-editor.png') })
  await prefs.click('.editor button:has-text("Cancelar")')

  // 2. Login por código.
  await openSection(prefs, 'conta', 'Conta e assinatura')
  await prefs.fill('#login-email', 'pastor@example.com')
  await prefs.click('button:has-text("Enviar código")')
  await prefs.waitForSelector('#login-code')
  await settle(prefs)
  await prefs.screenshot({ path: join(shots, 'conta-1-codigo.png') })
  const resend = await prefs.locator('.login__links button').first().textContent()
  check(/Reenviar código em \d:\d\d/.test(resend ?? ''), `temporizador do reenvio ausente: ${resend}`)
  await prefs.fill('#login-code', '000000')
  await prefs.waitForSelector('#login-error')
  const loginError = await prefs.textContent('#login-error')
  check(loginError?.includes('Código incorreto'), `erro do código: ${loginError}`)
  await prefs.screenshot({ path: join(shots, 'conta-2-codigo-errado.png') })
  await prefs.fill('#login-code', '123456')
  await prefs.waitForSelector('.account-card', { timeout: 10000 })
  await prefs.waitForSelector('.offer')
  await settle(prefs)
  await prefs.screenshot({ path: join(shots, 'conta-3-gratuita.png') })

  // 3. Assinar: CPF inválido, depois válido → QR do Pix.
  await prefs.fill('#sub-name', 'Ana Maria Souza')
  await prefs.fill('#sub-document', '52998224724')
  const masked = await prefs.inputValue('#sub-document')
  check(masked === '529.982.247-24', `máscara do CPF: ${masked}`)
  await prefs.click('button:has-text("Gerar Pix")')
  await prefs.waitForSelector('.subscribe__error')
  await scrollPrefs(prefs, 260)
  await prefs.screenshot({ path: join(shots, 'conta-4-cpf-invalido.png') })
  await prefs.fill('#sub-document', '52998224725')
  await prefs.click('button:has-text("Gerar Pix")')
  await prefs.waitForSelector('.pix img')
  const qrLoaded = await prefs.$eval('.pix img', (image) => image.complete && image.naturalWidth > 100)
  check(qrLoaded, 'o QR do Pix não carregou')
  await prefs.click('button:has-text("Copiar código Pix")')
  await settle(prefs, 300)
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  check(clipboard === PIX_PAYLOAD, 'o código Pix não foi copiado')
  await scrollPrefs(prefs, 230)
  await prefs.screenshot({ path: join(shots, 'conta-5-pix.png') })
  const countdown = await prefs.textContent('.pix__countdown')
  check(/\d+:\d\d/.test(countdown ?? ''), `contagem regressiva ausente: ${countdown}`)

  // 4. Pagamento confirmado: a consulta a cada 5 s mostra a assinatura ativa.
  const pollsBefore = api.calls.filter((call) => call === 'GET /v1/billing/subscription').length
  api.state.paid = true
  await prefs.waitForSelector('text=Assinatura ativa. Está tudo pronto!', { timeout: 15000 })
  const polls = api.calls.filter((call) => call === 'GET /v1/billing/subscription').length - pollsBefore
  check(polls >= 1, 'a assinatura não foi consultada depois do pagamento')
  await prefs.waitForSelector('.usage')
  await scrollPrefs(prefs, 0)
  await settle(prefs, 500)
  await prefs.screenshot({ path: join(shots, 'conta-6-ativa.png') })
  await scrollPrefs(prefs, 520)
  await prefs.screenshot({ path: join(shots, 'conta-7-uso.png') })
  await scrollPrefs(prefs, 'end')
  await prefs.screenshot({ path: join(shots, 'conta-8-sessoes.png') })
  const badge = await prefs.textContent('.plan-badge')
  check(badge?.trim() === 'Assinatura', `selo do plano: ${badge}`)

  // Nome editável.
  await scrollPrefs(prefs, 0)
  await prefs.click('button[aria-label="Editar nome"]')
  await prefs.fill('#account-name', 'Ana Maria Souza')
  await prefs.click('.account-card__edit button[type="submit"]')
  await prefs.waitForSelector('.account-card__name:text-is("Ana Maria Souza")')

  // Cancelamento e exclusão pedem confirmação.
  await prefs.click('button:has-text("Cancelar assinatura")')
  await prefs.waitForSelector('[role="dialog"]')
  await settle(prefs, 400)
  await prefs.screenshot({ path: join(shots, 'conta-9-cancelar.png') })
  await prefs.click('[role="dialog"] button:has-text("Manter assinatura")')
  await prefs.click('button:has-text("Apagar conta…")')
  await prefs.waitForSelector('[role="dialog"] input')
  const lockedBefore = await prefs.isDisabled('[role="dialog"] button[type="submit"]')
  await prefs.fill('[role="dialog"] input', 'APAGAR')
  const lockedAfter = await prefs.isDisabled('[role="dialog"] button[type="submit"]')
  check(lockedBefore && !lockedAfter, 'apagar conta deveria exigir APAGAR')
  await settle(prefs, 400)
  await prefs.screenshot({ path: join(shots, 'conta-10-apagar.png') })
  await prefs.click('[role="dialog"] button:has-text("Cancelar")')

  await setAppearance(prefs, 'dark')
  await scrollPrefs(prefs, 0)
  await prefs.screenshot({ path: join(shots, 'conta-11-ativa-escuro.png') })
  await setAppearance(prefs, 'light')

  // 5. Com a assinatura: leituras pelo servidor e seletor de livro de oração.
  await openSection(prefs, 'estevao', 'Leituras e calendário')
  await prefs.waitForSelector('text=As leituras vêm da sua assinatura')
  await prefs.screenshot({ path: join(shots, 'estevao-assinatura-claro.png') })
  await prefs.click('.book-button')
  await prefs.waitForSelector('.book-row')
  const firstBook = await prefs.textContent('.book-row .book-row__name')
  check(firstBook === 'REB - 2027', `recomendado deveria vir primeiro: ${firstBook}`)
  await settle(prefs, 600)
  await prefs.screenshot({ path: join(shots, 'estevao-livros-claro.png') })
  await prefs.fill('.picker__search input', 'north america')
  await prefs.waitForSelector('.book-row__name:text-is("BCP 2019")')
  await prefs.fill('.picker__search input', '')
  await setAppearance(prefs, 'dark')
  await prefs.screenshot({ path: join(shots, 'estevao-livros-escuro.png') })
  await prefs.click('.book-row:has-text("BCP 2019")')
  await prefs.waitForSelector('.book-button__name:text-is("BCP 2019")')
  await prefs.screenshot({ path: join(shots, 'estevao-assinatura-escuro.png') })
  const liturgy = (await invoke(prefs, 'settings:get')).value.liturgy
  check(liturgy.prayerBook === 'bcp_2019', `livro não salvo: ${liturgy.prayerBook}`)
  await invoke(prefs, 'settings:update', { liturgy: { prayerBook: 'loc_2027' } })
  await setAppearance(prefs, 'light')

  await openSection(prefs, 'ia', 'Revisão e pesquisa')
  await prefs.waitForSelector('.prefer-own')
  await prefs.screenshot({ path: join(shots, 'ia-assinatura-claro.png') })

  // 6. Bíblia: aberta com ?ref=, traduções alinhadas, capítulo e referência entre capítulos.
  const openingBible = app.waitForEvent('window')
  await invoke(prefs, 'app:openWindow', { window: 'biblia', route: '/biblia?ref=João 3:16-18' })
  const bible = await openingBible
  await prepare(bible, 1080, 760)
  await bible.waitForSelector('.verse__text', { timeout: 15000 })
  await bible.waitForSelector('.chip:has-text("NAA")', { timeout: 8000 }).catch(() => failures.push('a NAA recomendada não abriu ao lado'))
  await bible.waitForFunction(() => document.querySelectorAll('.verse__text').length >= 5, null, { timeout: 8000 }).catch(() => undefined)
  await settle(bible, 500)
  const rows = await bible.locator('.grid__row:has(.verse)').count()
  check(rows === 3, `esperava 3 linhas alinhadas (16, 17, 18), vieram ${rows}`)
  const missing = await bible.locator('.verse__missing:text-is("Versículo indisponível")').count()
  check(missing === 1, `a NAA não tem o 17; esperava 1 célula indisponível, vieram ${missing}`)
  const footer = await bible.textContent('.bible__status')
  check(footer === 'João 3:16-18 · 2 traduções · Estêvão API v2', `rodapé: ${footer}`)
  const columns = await bible.$$eval('.grid__head', (heads) => heads.map((head) => head.getBoundingClientRect().right))
  const viewport = bible.viewportSize()
  check(columns.length === 2 && columns.every((right) => right <= (viewport?.width ?? 0) + 1), `as duas colunas deveriam caber lado a lado: ${columns}`)
  await bible.screenshot({ path: join(shots, 'biblia-claro.png') })
  await bible.click('.tmenu__button')
  await bible.waitForSelector('.tmenu__item')
  await bible.screenshot({ path: join(shots, 'biblia-adicionar.png') })
  await bible.click('.tmenu__item:has-text("ARA")')
  await bible.waitForSelector('.chip:has-text("ARA")')
  await bible.waitForFunction(() => document.querySelectorAll('.grid__head').length === 3)
  await settle(bible, 500)
  await setAppearance(bible, 'dark')
  await bible.screenshot({ path: join(shots, 'biblia-escuro.png') })
  await setAppearance(bible, 'light')
  await bible.click('[role="radio"]:has-text("Capítulo 3")')
  await bible.waitForFunction(() => document.querySelectorAll('.grid__row:has(.verse)').length > 10, null, { timeout: 8000 }).catch(() => failures.push('o capítulo inteiro não carregou'))
  await bible.screenshot({ path: join(shots, 'biblia-capitulo.png') })
  await bible.click('[role="radio"]:has-text("Perícope")')
  await bible.fill('.bible__input', 'João 3:36-4:2')
  await bible.press('.bible__input', 'Enter')
  await bible.waitForSelector('text=não informa o capítulo de cada versículo', { timeout: 8000 }).catch(() => failures.push('faltou a explicação da referência entre capítulos'))
  await bible.screenshot({ path: join(shots, 'biblia-entre-capitulos.png') })
  const comparisons = (await invoke(bible, 'settings:get')).value.liturgy.comparisonBibles
  check(JSON.stringify(comparisons) === '["naa","ara"]', `comparações salvas: ${JSON.stringify(comparisons)}`)
} catch (error) {
  failures.push(String(error?.stack ?? error))
} finally {
  app.process().kill()
  api.server.close()
}

if (describeMainErrors(mainErrors)) failures.push(describeMainErrors(mainErrors))
for (const note of notes) console.warn(`nota: ${note}`)
console.warn(failures.length === 0 ? `PREFERÊNCIAS OK · capturas em ${shots}` : `FALHAS:\n- ${failures.join('\n- ')}`)
process.exit(failures.length === 0 ? 0 : 1)
