// Roda todos os roteiros ponta a ponta sobre um build já feito.
// Uso (em apps/desktop): xvfb-run -a node test/e2e/run-all.mjs [pasta-do-build] [pasta-das-capturas]
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outDir = process.argv[2] ?? 'out'
const shots = resolve(process.argv[3] ?? 'screenshots')
mkdirSync(shots, { recursive: true })

const scripts = [
  ['smoke', [outDir, join(shots, 'smoke.png')]],
  ['mesa', [outDir, join(shots, 'mesa')]],
  ['prefs', [outDir, join(shots, 'preferencias')]],
  ['reader', [outDir, join(shots, 'leitor')]],
  ['library', [outDir, join(shots, 'biblioteca')]],
]

const failed = []
for (const [name, args] of scripts) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [`test/e2e/${name}.mjs`, ...args], { stdio: 'inherit', timeout: 10 * 60 * 1000 })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (result.status === 0) console.log(`✓ ${name} (${seconds} s)`)
  else {
    console.log(`✗ ${name} (${seconds} s, saída ${result.status ?? result.signal})`)
    failed.push(name)
  }
}
console.log(failed.length === 0 ? 'Todos os roteiros passaram.' : `Falharam: ${failed.join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
