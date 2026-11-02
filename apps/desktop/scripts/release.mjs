// Gera os instaladores do sistema em que roda, sem depender do GitHub Actions.
// Uso (em apps/desktop): node scripts/release.mjs [--publish] [--skip-verify]
//   macOS   → .dmg universal e .zip (assinado e notarizado se CSC_LINK e APPLE_ID existirem)
//   Windows → instalador NSIS x64 e ARM64 (assinado se CSC_LINK existir)
//   Linux   → AppImage e .deb
// Com --publish e GH_TOKEN, envia para um rascunho de release no GitHub (a atualização
// automática lê de lá). Sem --publish, os arquivos ficam em apps/desktop/release/<versão>/.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(desktop, '..', '..')
const args = new Set(process.argv.slice(2))
const publish = args.has('--publish')
const skipVerify = args.has('--skip-verify')
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version

/** Variáveis do build: ambiente do terminal ou apps/desktop/.env.production(.local). */
function envFileValue(name) {
  for (const file of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const path = join(desktop, file)
    if (!existsSync(path)) continue
    const line = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim()
  }
  return undefined
}
const setting = (name) => process.env[name] || envFileValue(name)

const warnings = []
const problems = []
if (!setting('MAIN_VITE_PREGAR_API_URL')) problems.push('MAIN_VITE_PREGAR_API_URL não definido: o app usaria o endereço padrão da API.')
if (!setting('MAIN_VITE_GOOGLE_CLIENT_ID')) warnings.push('MAIN_VITE_GOOGLE_CLIENT_ID ausente: o Google Drive fica desligado nesta versão.')
if (publish && !process.env.GH_TOKEN) problems.push('--publish exige GH_TOKEN (token do GitHub com permissão de escrita em releases).')
if (publish && !isProductionURL(setting('MAIN_VITE_PREGAR_API_URL'))) {
  problems.push('--publish só aceita a API de produção (https, sem localhost nem domínio de teste); quem atualizar receberia esse endereço.')
}

function isProductionURL(value) {
  try {
    const url = new URL(value ?? '')
    const host = url.hostname
    return url.protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host) && !/(^|\.)(test|example|exemplo|localhost|invalid)(\.|$)/.test(host)
  } catch {
    return false
  }
}

const extra = []
if (process.platform === 'darwin') {
  if (!process.env.CSC_LINK) warnings.push('Sem CSC_LINK: o electron-builder procura o certificado Developer ID no Acesso às Chaves; sem ele, o app sai sem assinatura e o macOS o bloqueia em outros Macs.')
  if (!process.env.APPLE_ID) {
    warnings.push('Sem APPLE_ID: sem notarização.')
    extra.push('-c.mac.notarize=false')
  }
} else if (process.platform === 'win32') {
  if (!process.env.CSC_LINK) warnings.push('Sem CSC_LINK: o instalador sai sem assinatura e o SmartScreen vai avisar.')
}

console.log(`Pregar ${version} · ${process.platform} · ${publish ? 'publica no GitHub (rascunho)' : 'só gera os arquivos'}`)
for (const warning of warnings) console.log(`aviso: ${warning}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`erro: ${problem}`)
  process.exit(1)
}

function run(command, commandArgs, cwd) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!skipVerify) run('npm', ['run', 'verify'], root)
run('npx', ['electron-vite', 'build'], desktop)
const target = { darwin: '--mac', win32: '--win', linux: '--linux' }[process.platform]
if (!target) {
  console.error(`Sistema não suportado: ${process.platform}`)
  process.exit(1)
}
run('npx', ['electron-builder', target, '--publish', publish ? 'always' : 'never', ...extra], desktop)
console.log(`\nPronto: apps/desktop/release/${version}/${publish ? ' (e rascunho de release no GitHub)' : ''}`)
