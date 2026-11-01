import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'pregar-e2e-'))
const env = { ...process.env }
delete env.NODE_OPTIONS
console.log('launching')
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
console.log('launched')
app.process().stderr?.on('data', (d) => { const s = String(d); if (!/dbus|Fontconfig|vaapi|gbm|sandbox_linux/.test(s)) process.stdout.write('[stderr] ' + s) })
const window = await app.firstWindow({ timeout: 20000 })
console.log('window', window.url())
window.on('console', (m) => console.log('[console]', m.type(), m.text()))
window.on('pageerror', (e) => console.log('[pageerror]', e.message))
await window.waitForSelector('.window-header', { timeout: 15000 })
const header = await window.textContent('.window-header')
const settings = await window.evaluate(async () => (await window.pregar.invoke('settings:get')).value.liturgy.prayerBook)
const isolated = await window.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined')
await window.screenshot({ path: process.argv[2] ?? 'smoke.png' })
console.log(JSON.stringify({ title: await window.title(), header, settings, isolated }))
await app.close()
