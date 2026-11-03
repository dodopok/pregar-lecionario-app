import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { AppDeps } from '../../lib/context'

/**
 * Site do Proper, servido pela própria API: a página inicial com os links de download e os
 * arquivos estáticos de `apps/site`. Os botões apontam para `/baixar/<alvo>`, que redireciona ao
 * instalador do último release no GitHub (consultado no servidor e guardado por dez minutos); sem
 * release publicado, cai na página de releases.
 */

export const RELEASES_PAGE = 'https://github.com/dodopok/pregar-lecionario-app/releases'
export const LATEST_RELEASE_API = 'https://api.github.com/repos/dodopok/pregar-lecionario-app/releases/latest'
const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 5_000

export const DOWNLOAD_TARGETS = ['mac', 'windows', 'windows-arm', 'linux', 'linux-deb'] as const
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number]

export interface ReleaseInfo {
  version: string
  assets: Partial<Record<DownloadTarget, string>>
}

interface GitHubAsset {
  name?: string
  browser_download_url?: string
}

const ASSET_PATTERNS: Record<DownloadTarget, RegExp> = {
  mac: /-mac\.dmg$/i,
  windows: /-Setup-.*-x64\.exe$/i,
  'windows-arm': /-Setup-.*-arm64\.exe$/i,
  linux: /-x64\.AppImage$/i,
  'linux-deb': /(-x64|_amd64)\.deb$/i,
}

/** Pasta `apps/site`, ao lado da API tanto no bundle (`dist`) quanto em desenvolvimento (`src`). */
export function siteDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../site'),
    resolve(here, '../../../../site'),
    resolve(process.cwd(), 'apps/site'),
    resolve(process.cwd(), '../site'),
  ]
  return candidates.find((candidate) => existsSync(resolve(candidate, 'index.html'))) ?? null
}

/** Escolhe, entre os arquivos do release, o instalador de cada sistema. */
export function matchAssets(assets: GitHubAsset[]): ReleaseInfo['assets'] {
  const matched: ReleaseInfo['assets'] = {}
  for (const target of DOWNLOAD_TARGETS) {
    const asset = assets.find(
      (item) => item.name && item.browser_download_url && ASSET_PATTERNS[target].test(item.name),
    )
    if (asset?.browser_download_url) matched[target] = asset.browser_download_url
  }
  return matched
}

/** Consulta o último release no GitHub, com cache; qualquer falha vira `null` (sem release). */
export function createReleaseResolver(deps: Pick<AppDeps, 'fetch' | 'clock'>) {
  let cached: { at: number; info: ReleaseInfo | null } | null = null
  return async (): Promise<ReleaseInfo | null> => {
    const now = deps.clock.now().getTime()
    if (cached && now - cached.at < CACHE_MS) return cached.info
    let info: ReleaseInfo | null = null
    try {
      const response = await deps.fetch(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'proper-api' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.ok) {
        const body = (await response.json()) as { tag_name?: string; name?: string; assets?: GitHubAsset[] }
        const version = String(body.tag_name ?? body.name ?? '').replace(/^v/i, '')
        if (version) info = { version, assets: matchAssets(body.assets ?? []) }
      }
    } catch {
      info = null
    }
    cached = { at: now, info }
    return info
  }
}

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}

/** Preenche a versão na página inicial. */
export function renderIndex(template: string, release: ReleaseInfo | null): string {
  return template.replaceAll('{{versao}}', release ? escapeHTML(release.version) : 'em preparação')
}

export async function siteRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const dir = siteDir()
  if (!dir) {
    app.log.warn('Pasta apps/site não encontrada: o site não será servido.')
    return
  }
  const resolveRelease = createReleaseResolver(deps)
  const templatePath = resolve(dir, 'index.html')
  let template = readFileSync(templatePath, 'utf8')

  await app.register(fastifyStatic, {
    root: dir,
    prefix: '/',
    index: false,
    wildcard: false,
    maxAge: '1h',
    serve: true,
  })

  app.get('/', async (_request, reply) => {
    // Em desenvolvimento, relê o arquivo a cada pedido para ver as mudanças sem reiniciar.
    if (!deps.config.isProduction) template = readFileSync(templatePath, 'utf8')
    const release = await resolveRelease()
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(renderIndex(template, release))
  })

  app.get<{ Params: { alvo: string } }>('/baixar/:alvo', async (request, reply) => {
    const target = request.params.alvo as DownloadTarget
    if (!DOWNLOAD_TARGETS.includes(target)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Instalador desconhecido.' } })
    }
    const release = await resolveRelease()
    const url = release?.assets[target] ?? RELEASES_PAGE
    return reply.header('Cache-Control', 'no-cache').redirect(url, 302)
  })
}
