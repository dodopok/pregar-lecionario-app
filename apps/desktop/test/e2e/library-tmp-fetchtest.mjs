import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const env = { ...process.env }; delete env.NODE_OPTIONS
const app = await electron.launch({ args: ['.build-library/main/index.js', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pregar-x-'))}`, '--no-sandbox'], env, cwd: process.cwd() })
try {
  const w = await app.firstWindow()
  await w.waitForLoadState('domcontentloaded'); await w.waitForTimeout(1500)
  const r = await w.evaluate(async () => {
    const out = {}
    const asset = [...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href)[0]
    out.asset = asset
    try { const res = await fetch(asset); out.fetch = res.status + ' ' + (await res.text()).length } catch (e) { out.fetch = 'ERR ' + e.message }
    try { const blob = new Blob(['self.postMessage(1)'], { type: 'text/javascript' }); const wk = new Worker(URL.createObjectURL(blob)); out.blobWorker = await new Promise((r) => { wk.onmessage = () => r('ok'); wk.onerror = (e) => r('err ' + e.message); setTimeout(() => r('timeout'), 3000) }) } catch (e) { out.blobWorker = 'ERR ' + e.message }
    try { const wk = new Worker(asset, { type: 'module' }); out.moduleWorker = await new Promise((r) => { wk.onerror = (e) => r('err ' + (e.message || 'error event')); setTimeout(() => r('no error in 2s'), 2000) }) } catch (e) { out.moduleWorker = 'ERR ' + e.message }
    out.href = location.href
    return out
  })
  console.log(JSON.stringify(r, null, 1))
} finally { app.process().kill() }
