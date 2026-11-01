// Uso: xvfb-run -a node test/e2e/smoke.mjs [pasta-do-build] [captura.png]
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'out'
const userData = mkdtempSync(join(tmpdir(), 'pregar-e2e-'))
const env = { ...process.env }
delete env.NODE_OPTIONS
const app = await electron.launch({ args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
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
  console.log(JSON.stringify({ title: await window.title(), isolated }))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  app.process().kill()
}
// Processos auxiliares do Chromium podem manter o Playwright aberto; o resultado já foi impresso.
process.exit(process.exitCode ?? 0)
