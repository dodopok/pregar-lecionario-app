// Uso: xvfb-run -a node test/e2e/mesa.mjs [pasta-do-build] [pasta-das-capturas]
import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeAPI } from './fake-pregar-api.mjs'
import { watchMainErrors, describeMainErrors } from './main-errors.mjs'

const outDir = process.argv[2] ?? 'out'
const shots = process.argv[3] ?? 'screenshots'
mkdirSync(shots, { recursive: true })
const api = await startFakeAPI()
const userData = mkdtempSync(join(tmpdir(), 'pregar-mesa-'))
const env = { ...process.env }
delete env.NODE_OPTIONS
const app = await electron.launch({
  args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'],
  env,
  timeout: 30000,
})
const mainErrors = watchMainErrors(app)
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}
try {
  const window = await app.firstWindow({ timeout: 20000 })
  // O Playwright força o tema claro por padrão; o app decide o tema pelas Preferências.
  await window.emulateMedia({ colorScheme: null })
  await window.setViewportSize({ width: 1500, height: 940 })
  window.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`))
  await window.waitForSelector('.mesa', { timeout: 15000 })
  // Conta assinante pela API falsa: leituras e IA pelo servidor, sem chaves.
  await window.evaluate(async (base) => {
    await window.pregar.invoke('settings:update', {
      apiBaseURL: base,
      onboarding: { completed: true, path: 'pro', tourDone: true },
    })
    await window.pregar.invoke('account:startLogin', { email: 'pastor@example.com' })
    await window.pregar.invoke('account:verifyLogin', { email: 'pastor@example.com', code: '123456' })
  }, api.url)
  await window.reload()
  await window.waitForSelector('.reading', { timeout: 15000 })
  const readings = await window.locator('.reading').count()
  check(readings === 4, `esperava 4 leituras, vieram ${readings}`)
  // Escolhe Romanos como texto principal e escreve.
  await window.locator('.reading', { hasText: 'Romanos 13:8-14' }).locator('.reading__choose').click()
  await window.waitForSelector('.main:has-text("Romanos 13:8-14")')
  check(
    (await window.locator('.reading--primary .reading__badge').count()) === 1,
    'o selo "Texto principal" não apareceu na leitura escolhida',
  )
  check((await window.locator('.reading__text').count()) >= 4, 'as leituras não abriram todas com o texto')
  await window.locator('.manuscript-editor').click()
  await window.keyboard.type('O amor cumpre a lei. ')
  await window.keyboard.type('Devemos amar como quem paga uma dívida que nunca termina.')
  await window.waitForTimeout(2600)
  // A Mesa abre no próximo dia de pregar (domingo), não em hoje: a data aberta fica em settings.mesa.lastDateKey.
  const saved = await window.evaluate(async () => {
    const settings = (await window.pregar.invoke('settings:get')).value
    return (await window.pregar.invoke('sermons:get', { dateKey: settings.mesa.lastDateKey })).value
  })
  check(
    saved !== null,
    'a preparação aberta não foi encontrada pela data guardada em settings.mesa.lastDateKey',
  )
  if (!saved) throw new Error('sem preparação aberta')
  check(saved?.plainText?.includes('O amor cumpre a lei'), 'texto não foi salvo')
  check(saved?.mainReadingReference === 'Romanos 13:8-14', 'leitura principal não foi salva')
  check(saved?.title === 'Romanos 13:8-14', 'título não acompanhou a leitura principal')
  await window.screenshot({ path: join(shots, 'mesa-claro.png') })
  // Em janela larga, recolher o calendário deixa a faixa "Calendário" (como as leituras) e solta o botão de data.
  check(
    (await window.locator('.head .date[aria-pressed="true"]').count()) === 1,
    'o botão de data não aparece pressionado com o calendário atracado',
  )
  await window.locator('.calendar__collapse').click()
  await window.waitForSelector('.strip:has-text("Calendário")', { timeout: 5000 })
  check(
    (await window.locator('.mesa__calendar').count()) === 0,
    'o calendário continuou atracado depois de recolher',
  )
  check(
    (await window.locator('.head .date[aria-pressed="true"]').count()) === 0,
    'o botão de data continuou pressionado com o calendário recolhido',
  )
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(shots, 'mesa-calendario-recolhido.png') })
  await window.locator('.strip:has-text("Calendário")').click()
  await window.waitForSelector('.mesa__calendar', { timeout: 5000 })
  check(
    (await window.locator('.strip:has-text("Calendário")').count()) === 0,
    'a faixa do calendário não sumiu ao reabrir',
  )
  // Leituras em tela cheia e ensaio em tela cheia abrem e fecham com Esc.
  await window.locator('.scripture [aria-label="Ler em tela cheia"]').click()
  await window.waitForSelector('.reading-view', { timeout: 5000 })
  await window.waitForTimeout(400)
  await window.screenshot({ path: join(shots, 'leituras-tela-cheia.png') })
  await window.keyboard.press('Escape')
  await window.waitForSelector('.reading-view', { state: 'detached', timeout: 5000 })
  await window.locator('.head button', { hasText: 'Ensaio' }).click()
  await window.waitForSelector('.rehearsal', { timeout: 5000 })
  await window.waitForTimeout(400)
  await window.screenshot({ path: join(shots, 'ensaio.png') })
  await window.keyboard.press('Escape')
  await window.waitForSelector('.rehearsal', { state: 'detached', timeout: 5000 })
  // Ideia local: guarda e aparece na aba Ideias.
  await window.locator('#resource-tab-ideas').click()
  await window.locator('#idea-box').fill('Começar pela dívida que nunca termina')
  await window.keyboard.press('Enter')
  await window.waitForSelector('.idea', { timeout: 5000 })
  const ideas = await window.evaluate(
    async (dateKey) => (await window.pregar.invoke('ideas:list', { dateKey })).value,
    saved.dateKey,
  )
  check(
    ideas?.length === 1 && ideas[0].text.includes('dívida'),
    `ideia não foi guardada: ${JSON.stringify(ideas)}`,
  )
  await window.screenshot({ path: join(shots, 'ideias.png') })
  await window.locator('#resource-tab-materials').click()
  // Janela estreita: trilho compacto e materiais em gaveta.
  await window.setViewportSize({ width: 1024, height: 680 })
  await window.waitForTimeout(400)
  check((await window.locator('.rail--compact').count()) === 1, 'o trilho não ficou compacto a 1024 px')
  await window.screenshot({ path: join(shots, 'mesa-1024.png') })
  await window.setViewportSize({ width: 1500, height: 940 })
  await window.waitForTimeout(400)
  // Preparação avulsa: criada pelo menu Mais, abre na Mesa com a ocasião no cabeçalho e entra no Arquivo.
  await window.locator('.head [aria-label="Mais ações"]').click()
  await window.locator('.menu__item', { hasText: 'Nova preparação avulsa' }).click()
  await window.locator('#free-occasion').fill('Casamento de Ana e Pedro')
  await window.locator('#free-reference').fill('1 Coríntios 13:1-13')
  await window.locator('button', { hasText: 'Criar preparação' }).click()
  await window.waitForSelector('.head .title__name:has-text("Casamento de Ana e Pedro")', { timeout: 8000 })
  const free = await window.evaluate(async () => {
    const settings = (await window.pregar.invoke('settings:get')).value
    const list = (await window.pregar.invoke('sermons:list')).value
    return {
      key: settings.mesa.lastDateKey,
      inList: list.some((item) => item.dateKey === settings.mesa.lastDateKey),
    }
  })
  check(/^\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/.test(free.key), `a chave da avulsa não tem sufixo: ${free.key}`)
  check(free.inList, 'a preparação avulsa não apareceu na lista do Arquivo')
  check(
    (await window.locator('.main:has-text("1 Coríntios 13:1-13")').count()) === 1,
    'a passagem livre não virou texto principal',
  )
  await window.screenshot({ path: join(shots, 'avulsa.png') })
  await window.evaluate(
    (dateKey) => window.pregar.invoke('app:openWindow', { window: 'mesa', route: `/mesa?date=${dateKey}` }),
    saved.dateKey,
  )
  await window.waitForSelector('.main:has-text("Romanos 13:8-14")', { timeout: 8000 })
  // Revisão pelo servidor (canal direto, sem depender da folha).
  const review = await window.evaluate(async (dateKey) => {
    const sources = await window.pregar.invoke('ai:reviewSources', {
      dateKey,
      mainReference: 'Romanos 13:8-14',
      bibles: ['nvt'],
      includeMaterials: false,
    })
    const result = await window.pregar.invoke('ai:review', {
      requestId: 'r1',
      dateKey,
      title: 'Romanos 13:8-14',
      mainReference: 'Romanos 13:8-14',
      manuscript: 'O amor cumpre a lei. Devemos amar como quem paga uma dívida que nunca termina.',
      criteria: ['clarity'],
      sourceIds: sources.value.sources.map((item) => item.id),
    })
    return { sources: sources.value, result: result.ok ? result.value.report.findings.length : result.error }
  }, saved.dateKey)
  check(review.sources.sources.length === 1, `fontes bíblicas: ${JSON.stringify(review.sources)}`)
  check(review.result === 1, `revisão falhou: ${JSON.stringify(review.result)}`)
  await window.evaluate(() => window.pregar.invoke('settings:update', { appearance: 'dark' }))
  await window.waitForTimeout(500)
  await window.screenshot({ path: join(shots, 'mesa-escuro.png') })
  await window.evaluate(() =>
    window.pregar.invoke('settings:update', { appearance: 'light', panels: { focusMode: false } }),
  )
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F')
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(shots, 'mesa-foco.png') })
  check(
    api.calls.some((call) => call.startsWith('GET /v1/estevao/days/')),
    'leituras não passaram pelo proxy',
  )
  check(api.calls.includes('POST /v1/ai/review'), 'revisão não passou pelo servidor')
} catch (error) {
  failures.push(String(error?.stack ?? error))
} finally {
  app.process().kill()
  api.server.close()
}
if (describeMainErrors(mainErrors)) failures.push(describeMainErrors(mainErrors))
console.log(failures.length === 0 ? 'MESA OK' : `FALHAS:\n- ${failures.join('\n- ')}`)
process.exit(failures.length === 0 ? 0 : 1)
