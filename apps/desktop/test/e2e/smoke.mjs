// Uso: xvfb-run -a node test/e2e/smoke.mjs [pasta-do-build] [captura.png]
// Abre o app, confere isolamento e ponte, e garante que o texto digitado logo antes de sair é salvo.
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchMainErrors, describeMainErrors } from './main-errors.mjs'

const outDir = process.argv[2] ?? 'out'
const userData = mkdtempSync(join(tmpdir(), 'pregar-e2e-'))
const env = { ...process.env }
delete env.NODE_OPTIONS
const launch = () => electron.launch({ args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
const mainErrors = []
const typed = `Texto digitado antes de sair ${Date.now()}`

let app = await launch()
mainErrors.push(watchMainErrors(app))
try {
  const window = await app.firstWindow({ timeout: 20000 })
  // O Playwright força o tema claro por padrão; o app decide o tema pelas Preferências.
  await window.emulateMedia({ colorScheme: null })
  window.on('pageerror', (error) => console.log('[pageerror]', error.message))
  await window.waitForSelector('.mesa', { timeout: 15000 })
  const isolated = await window.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined')
  // A ponte só responde a páginas do próprio app; aqui ela precisa funcionar.
  const info = await window.evaluate(() => window.pregar.invoke('app:info'))
  if (!isolated || !info?.ok) throw new Error(`Isolamento ou ponte do app com problema: ${JSON.stringify({ isolated, info })}`)
  await window.screenshot({ path: process.argv[3] ?? 'smoke.png', timeout: 20000 })

  // Digita e sai imediatamente, antes do salvamento agrupado (350 ms): o fechamento tem de esperar.
  const later = window.locator('button', { hasText: 'Decidir depois' })
  if (await later.isVisible().catch(() => false)) await later.click()
  await window.locator('.manuscript-editor').click()
  await window.keyboard.type(typed, { delay: 0 })
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.evaluate(({ app: electronApp }) => electronApp.quit())
  const quitInTime = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 8000))])
  if (!quitInTime) throw new Error('O app não terminou de sair em 8 s.')

  app = await launch()
  mainErrors.push(watchMainErrors(app))
  const reopened = await app.firstWindow({ timeout: 20000 })
  await reopened.waitForSelector('.manuscript-editor', { timeout: 15000 })
  const text = await reopened.locator('.manuscript-editor').innerText()
  if (!text.includes(typed)) throw new Error(`O texto digitado antes de sair não foi salvo. Editor: ${JSON.stringify(text.slice(0, 200))}`)
  console.log(JSON.stringify({ title: await reopened.title(), isolated, savedOnQuit: true }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  app.process().kill()
}
if (describeMainErrors(mainErrors.flat())) {
  console.error(describeMainErrors(mainErrors.flat()))
  process.exitCode = 1
}
// Processos auxiliares do Chromium podem manter o Playwright aberto; o resultado já foi impresso.
process.exit(process.exitCode ?? 0)
