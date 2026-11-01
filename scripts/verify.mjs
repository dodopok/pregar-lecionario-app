// Verificação completa local, a mesma do CI: lint, tipos, testes e roteiros ponta a ponta.
// Uso (na raiz): npm run verify            → tudo
//                npm run verify -- --quick → sem build e sem roteiros ponta a ponta
// Os testes da API precisam de um PostgreSQL (TEST_DATABASE_URL, padrão
// postgres://pregar:pregar@127.0.0.1:5432/pregar_test); sem ele, essa parte é pulada com aviso.
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const quick = process.argv.includes('--quick')
const shell = process.platform === 'win32'
const steps = []
const skipped = []

function run(label, command, args, options = {}) {
  console.log(`\n▶ ${label}`)
  const started = Date.now()
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell, ...options })
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  steps.push({ label, ok: result.status === 0, seconds })
  if (result.status !== 0) finish()
}

function finish() {
  console.log('\nResumo')
  for (const step of steps) console.log(`${step.ok ? '✓' : '✗'} ${step.label} (${step.seconds} s)`)
  for (const item of skipped) console.log(`– ${item}`)
  const failed = steps.some((step) => !step.ok)
  console.log(failed ? '\nFalhou.' : skipped.length ? '\nPassou, com etapas puladas.' : '\nTudo passou.')
  process.exit(failed ? 1 : 0)
}

function reachable(url) {
  return new Promise((done) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      done(false)
      return
    }
    const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port || 5432), timeout: 1500 })
    socket.once('connect', () => {
      socket.end()
      done(true)
    })
    socket.once('error', () => done(false))
    socket.once('timeout', () => {
      socket.destroy()
      done(false)
    })
  })
}

function hasCommand(name) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0
}

run('Lint', 'npm', ['run', 'lint'])
run('Tipos', 'npm', ['run', 'typecheck'])

const databaseURL = process.env.TEST_DATABASE_URL ?? 'postgres://pregar:pregar@127.0.0.1:5432/pregar_test'
if (await reachable(databaseURL)) {
  run('Testes (core, editor, desktop e API)', 'npx', ['vitest', 'run'])
} else {
  run('Testes (core, editor e desktop)', 'npx', ['vitest', 'run', '--project', 'core', '--project', 'editor', '--project', 'desktop'])
  skipped.push(`Testes da API: sem PostgreSQL em ${new URL(databaseURL).host} (defina TEST_DATABASE_URL)`)
}

if (quick) {
  skipped.push('Build e roteiros ponta a ponta (--quick)')
} else {
  run('Build do app', 'npm', ['run', 'build', '-w', '@pregar/desktop'])
  const desktop = resolve(root, 'apps', 'desktop')
  const e2e = ['test/e2e/run-all.mjs', 'out', 'screenshots']
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (hasCommand('xvfb-run')) run('Roteiros ponta a ponta (xvfb)', 'xvfb-run', ['-a', 'node', ...e2e], { cwd: desktop })
    else skipped.push('Roteiros ponta a ponta: Linux sem tela e sem xvfb-run')
  } else {
    run('Roteiros ponta a ponta', 'node', e2e, { cwd: desktop })
  }
}
finish()
