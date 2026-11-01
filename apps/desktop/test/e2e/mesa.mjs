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
const app = await electron.launch({ args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
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
    await window.pregar.invoke('settings:update', { apiBaseURL: base, onboarding: { completed: true, path: 'pro' } })
    await window.pregar.invoke('account:startLogin', { email: 'pastor@example.com' })
    await window.pregar.invoke('account:verifyLogin', { email: 'pastor@example.com', code: '123456' })
  }, api.url)
  await window.reload()
  await window.waitForSelector('.reading', { timeout: 15000 })
  const readings = await window.locator('.reading').count()
  check(readings === 4, `esperava 4 leituras, vieram ${readings}`)
  // Escolhe Romanos como texto principal e escreve.
  await window.locator('.reading', { hasText: 'Romanos 13:8-14' }).locator('.reading__choose').click()
  await window.waitForSelector('.toolbar__reference:has-text("Romanos 13:8-14")')
  await window.locator('.manuscript-editor').click()
  await window.keyboard.type('O amor cumpre a lei. ')
  await window.keyboard.type('Devemos amar como quem paga uma dívida que nunca termina.')
  await window.waitForTimeout(2600)
  const saved = await window.evaluate(async () => {
    const day = new Date()
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return (await window.pregar.invoke('sermons:get', { dateKey: key })).value
  })
  check(saved?.plainText?.includes('O amor cumpre a lei'), 'texto não foi salvo')
  check(saved?.mainReadingReference === 'Romanos 13:8-14', 'leitura principal não foi salva')
  check(saved?.title === 'Romanos 13:8-14', 'título não acompanhou a leitura principal')
  await window.screenshot({ path: join(shots, 'mesa-claro.png') })
  // Revisão pelo servidor (canal direto, sem depender da folha).
  const review = await window.evaluate(async (dateKey) => {
    const sources = await window.pregar.invoke('ai:reviewSources', { dateKey, mainReference: 'Romanos 13:8-14', bibles: ['nvt'], includeMaterials: false })
    const result = await window.pregar.invoke('ai:review', {
      requestId: 'r1', dateKey, title: 'Romanos 13:8-14', mainReference: 'Romanos 13:8-14',
      manuscript: 'O amor cumpre a lei. Devemos amar como quem paga uma dívida que nunca termina.', criteria: ['clarity'], sourceIds: sources.value.sources.map((item) => item.id),
    })
    return { sources: sources.value, result: result.ok ? result.value.report.findings.length : result.error }
  }, saved.dateKey)
  check(review.sources.sources.length === 1, `fontes bíblicas: ${JSON.stringify(review.sources)}`)
  check(review.result === 1, `revisão falhou: ${JSON.stringify(review.result)}`)
  await window.evaluate(() => window.pregar.invoke('settings:update', { appearance: 'dark' }))
  await window.waitForTimeout(500)
  await window.screenshot({ path: join(shots, 'mesa-escuro.png') })
  await window.evaluate(() => window.pregar.invoke('settings:update', { appearance: 'light', panels: { focusMode: false } }))
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F')
  await window.waitForTimeout(300)
  await window.screenshot({ path: join(shots, 'mesa-foco.png') })
  check(api.calls.some((call) => call.startsWith('GET /v1/estevao/days/')), 'leituras não passaram pelo proxy')
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
