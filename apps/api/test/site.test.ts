import { afterEach, describe, expect, it } from 'vitest'
import { matchAssets, RELEASES_PAGE, renderIndex } from '../src/modules/site/plugin'
import { createTestContext, type TestContext } from './helpers'

const DOWNLOAD = 'https://github.com/dodopok/pregar-lecionario-app/releases/download/v0.2.0'
const RELEASE = {
  tag_name: 'v0.2.0',
  assets: [
    { name: 'latest-mac.yml', browser_download_url: `${DOWNLOAD}/latest-mac.yml` },
    { name: 'Proper-0.2.0-mac.dmg', browser_download_url: `${DOWNLOAD}/Proper-0.2.0-mac.dmg` },
    { name: 'Proper-0.2.0-mac.zip', browser_download_url: `${DOWNLOAD}/Proper-0.2.0-mac.zip` },
    { name: 'Proper-Setup-0.2.0-x64.exe', browser_download_url: `${DOWNLOAD}/Proper-Setup-0.2.0-x64.exe` },
    {
      name: 'Proper-Setup-0.2.0-arm64.exe',
      browser_download_url: `${DOWNLOAD}/Proper-Setup-0.2.0-arm64.exe`,
    },
    { name: 'Proper-0.2.0-x64.AppImage', browser_download_url: `${DOWNLOAD}/Proper-0.2.0-x64.AppImage` },
    { name: 'Proper-0.2.0-x64.deb', browser_download_url: `${DOWNLOAD}/Proper-0.2.0-x64.deb` },
  ],
}

let context: TestContext | null = null
afterEach(async () => {
  await context?.close()
  context = null
})

describe('site: página inicial e downloads', () => {
  it('escolhe o instalador de cada sistema entre os arquivos do release', () => {
    expect(matchAssets(RELEASE.assets)).toEqual({
      mac: `${DOWNLOAD}/Proper-0.2.0-mac.dmg`,
      windows: `${DOWNLOAD}/Proper-Setup-0.2.0-x64.exe`,
      'windows-arm': `${DOWNLOAD}/Proper-Setup-0.2.0-arm64.exe`,
      linux: `${DOWNLOAD}/Proper-0.2.0-x64.AppImage`,
      'linux-deb': `${DOWNLOAD}/Proper-0.2.0-x64.deb`,
    })
    expect(renderIndex('v {{versao}}', { version: '1.0.0 <x>', assets: {} })).toBe('v 1.0.0 &lt;x&gt;')
    expect(renderIndex('v {{versao}}', null)).toBe('v em preparação')
  })

  it('serve a página com a versão do último release e redireciona os downloads, consultando o GitHub uma vez', async () => {
    context = await createTestContext()
    context.fake.on('GET', /\/releases\/latest$/, () => RELEASE)

    const home = await context.app.inject({ method: 'GET', url: '/' })
    expect(home.statusCode).toBe(200)
    expect(home.headers['content-type']).toContain('text/html')
    expect(home.body).toContain('<title>Proper')
    expect(home.body).toContain('Versão 0.2.0')
    expect(home.body).not.toContain('{{versao}}')

    const mac = await context.app.inject({ method: 'GET', url: '/baixar/mac' })
    expect(mac.statusCode).toBe(302)
    expect(mac.headers.location).toBe(`${DOWNLOAD}/Proper-0.2.0-mac.dmg`)
    const deb = await context.app.inject({ method: 'GET', url: '/baixar/linux-deb' })
    expect(deb.headers.location).toBe(`${DOWNLOAD}/Proper-0.2.0-x64.deb`)
    const unknown = await context.app.inject({ method: 'GET', url: '/baixar/ios' })
    expect(unknown.statusCode).toBe(404)

    expect(context.fake.calls.filter((call) => call.url.pathname.endsWith('/releases/latest'))).toHaveLength(
      1,
    )
  })

  it('sem release publicado, a página diz "em preparação" e o download leva à página de releases', async () => {
    context = await createTestContext()
    context.fake.on('GET', /\/releases\/latest$/, () => ({ message: 'Not Found' }), 404)

    const home = await context.app.inject({ method: 'GET', url: '/' })
    expect(home.body).toContain('Versão em preparação')
    const windows = await context.app.inject({ method: 'GET', url: '/baixar/windows' })
    expect(windows.statusCode).toBe(302)
    expect(windows.headers.location).toBe(RELEASES_PAGE)

    // Um release publicado depois aparece em um minuto, sem esperar o cache de dez.
    context.fake.routes.length = 0
    context.fake.on('GET', /\/releases\/latest$/, () => RELEASE)
    context.clock.advance(61_000)
    const mac = await context.app.inject({ method: 'GET', url: '/baixar/mac' })
    expect(mac.headers.location).toBe(`${DOWNLOAD}/Proper-0.2.0-mac.dmg`)
  })

  it('serve os arquivos estáticos do site e mantém as rotas da API', async () => {
    context = await createTestContext()
    const script = await context.app.inject({ method: 'GET', url: '/site.js' })
    expect(script.statusCode).toBe(200)
    expect(script.headers['content-type']).toContain('javascript')
    const font = await context.app.inject({
      method: 'GET',
      url: '/fonts/source-sans-3-latin-wght-normal.woff2',
    })
    expect(font.statusCode).toBe(200)
    const missing = await context.app.inject({ method: 'GET', url: '/nao-existe.png' })
    expect(missing.statusCode).toBe(404)
    const health = await context.app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
  })
})
