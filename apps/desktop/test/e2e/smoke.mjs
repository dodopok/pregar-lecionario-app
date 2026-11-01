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
  await window.waitForSelector('.window-header', { timeout: 15000 })
  const isolated = await window.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined')
  await window.screenshot({ path: process.argv[3] ?? 'smoke.png' })
  console.log(JSON.stringify({ title: await window.title(), isolated }))
} finally {
  app.process().kill()
}
