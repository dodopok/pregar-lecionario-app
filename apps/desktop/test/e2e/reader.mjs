// Ponta a ponta do Leitor: abas web (WebContentsView) servidas por 127.0.0.1, PDF com PDF.js,
// atalhos, pesquisas por sermão, persistência e capturas claro/escuro.
// Uso (em apps/desktop): xvfb-run -a node test/e2e/reader.mjs [pasta-do-build] [pasta-das-capturas]
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { watchMainErrors } from './main-errors.mjs'

const outDir = process.argv[2] ?? '.build-reader'
const shotsDir = resolve(process.argv[3] ?? mkdtempSync(join(tmpdir(), 'pregar-reader-shots-')))
mkdirSync(shotsDir, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'pregar-reader-e2e-'))
const DATE = '2026-11-01'
const REFERENCE = 'Mateus 21:23-32'
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, { timeout = 10000, interval = 100 } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
      if (last) return last
    } catch (error) {
      last = error
    }
    await sleep(interval)
  }
  return last instanceof Error ? undefined : last
}

// Páginas de teste (somente 127.0.0.1).
const paragraph = 'Quem é este que vem de Edom? Texto de teste para rolagem do Leitor, sem conteúdo real. '
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const page = (title, body) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.6 Georgia,serif;margin:40px auto;max-width:640px;color:#222;background:#fff}</style></head><body>${body}</body></html>`)
  }
  if (url.pathname === '/one') {
    page(
      'Página Um',
      `<h1>Página Um</h1>
<p><a id="to-two" href="/two">Ir para a página dois</a> · <a id="blank" href="/two?janela=1" target="_blank">Abrir em nova janela</a> · <a id="file" href="file:///etc/passwd">Arquivo local</a> · <a id="download" href="/download">Baixar</a></p>
<article>${Array.from({ length: 80 }, (_, index) => `<p>${index + 1}. ${paragraph.repeat(3)}${index === 30 ? ' <a id="deep-two" href="/two">Seguir para a dois</a>' : ''}</p>`).join('')}</article>`,
    )
  } else if (url.pathname === '/two') {
    page('Página Dois', `<h1>Página Dois</h1><main><p>Segunda página de teste.</p><p><a id="back-one" href="/one">Voltar à um</a></p></main>`)
  } else if (url.pathname === '/download') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="material.bin"' })
    response.end('dados')
  } else {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('não encontrado')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

// PDF sintético: três páginas de texto e dois bookmarks (seções de confiança alta).
function buildPdf() {
  const objects = []
  const add = (body) => objects.push(body) && objects.length
  const catalog = add(null)
  const pagesRoot = add(null)
  const outlines = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const pageIds = []
  const pageTexts = [
    ['Comentario de teste', 'Pagina fisica 1'],
    ['Mateus 21:23-32', 'Pagina fisica 2', 'A autoridade de Jesus.'],
    ['Mateus 21:33-46', 'Pagina fisica 3', 'Os lavradores maus.'],
  ]
  for (const lines of pageTexts) {
    const content = lines.map((text, index) => `BT /F1 ${index === 0 ? 20 : 12} Tf 72 ${720 - index * 28} Td (${text}) Tj ET`).join('\n')
    const contents = add({ dict: `<< /Length ${Buffer.byteLength(content, 'latin1')} >>`, stream: content })
    pageIds.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`))
  }
  const first = objects.length + 1
  const second = first + 1
  add(`<< /Title (Mateus 21:23-32) /Parent ${outlines} 0 R /Next ${second} 0 R /Dest [${pageIds[1]} 0 R /XYZ 0 792 null] >>`)
  add(`<< /Title (Mateus 21:33-46) /Parent ${outlines} 0 R /Prev ${first} 0 R /Dest [${pageIds[2]} 0 R /XYZ 0 792 null] >>`)
  objects[outlines - 1] = `<< /Type /Outlines /First ${first} 0 R /Last ${second} 0 R /Count 2 >>`
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines >>`
  const info = add('<< /Title (Comentario de teste) /Author (Autora Ficticia) >>')
  let pdf = '%PDF-1.7\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf +=
      typeof body === 'string'
        ? `${index + 1} 0 obj\n${body}\nendobj\n`
        : `${index + 1} 0 obj\n${body.dict}\nstream\n${body.stream}\nendstream\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
const pdfPath = join(mkdtempSync(join(tmpdir(), 'pregar-reader-pdf-')), 'Comentario de teste.pdf')
writeFileSync(pdfPath, buildPdf())

const env = { ...process.env }
delete env.NODE_OPTIONS
/** Erros não tratados do processo principal, de todas as execuções do app neste roteiro. */
const watchedMainErrors = []
const launch = async () => {
  const launched = await electron.launch({ args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'], env, timeout: 30000 })
  watchedMainErrors.push(watchMainErrors(launched))
  return launched
}

/** Estado das páginas web servidas pelo servidor de teste, lido no processo principal. */
const webContentsInfo = (app) =>
  app.evaluate(({ webContents }, prefix) => {
    return webContents
      .getAllWebContents()
      .filter((contents) => contents.getURL().startsWith(prefix))
      .map((contents) => ({
        id: contents.id,
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoading(),
        readerFlag: contents.pregarReaderTab === true,
        navigateListeners: contents.listenerCount('will-navigate'),
      }))
  }, base)

const inWeb = (app, urlPart, code) =>
  app.evaluate(
    async ({ webContents }, [prefix, part, source]) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix) && contents.getURL().includes(part))
      return target ? target.executeJavaScript(source) : '__missing__'
    },
    [base, urlPart, code],
  )

/** Clique real (com ativação do usuário) num elemento da página web. */
async function clickInWeb(app, urlPart, selector, button = 'left') {
  const point = await inWeb(
    app,
    urlPart,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getClientRects()[0]; return { x: Math.round(r.left + 4), y: Math.round(r.top + r.height / 2) } })()`,
  )
  await app.evaluate(
    ({ webContents }, [prefix, part, value, which]) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(prefix) && contents.getURL().includes(part))
      target.sendInputEvent({ type: 'mouseMove', x: value.x, y: value.y })
      target.sendInputEvent({ type: 'mouseDown', x: value.x, y: value.y, button: which, clickCount: 1 })
      target.sendInputEvent({ type: 'mouseUp', x: value.x, y: value.y, button: which, clickCount: 1 })
    },
    [base, urlPart, point, button],
  )
}

async function leitorPage(app) {
  return until(() => app.windows().find((page) => page.url().includes('#/leitor')), { timeout: 15000 })
}

const readerState = (page) => page.evaluate(() => window.pregar.invoke('reader:state').then((result) => result.value))

/** Captura da tela inteira do Xvfb (inclui as páginas web, que são vistas nativas). */
function screenGrab(path) {
  try {
    execFileSync('import', ['-window', 'root', path], { env: process.env, stdio: 'ignore', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

let app = await launch()
let pageErrors = []
const cspViolations = []
try {
  const mesa = await app.firstWindow({ timeout: 20000 })
  await mesa.emulateMedia({ colorScheme: null })
  mesa.on('pageerror', (error) => pageErrors.push(`mesa: ${error.message}`))
  await mesa.waitForFunction(() => Boolean(window.pregar), null, { timeout: 15000 })

  // 1. A Mesa abre um site no Leitor.
  const opened = await mesa.evaluate(
    ([url, date, reference]) => window.pregar.invoke('reader:open', { kind: 'web', location: url, title: 'Página Um', sermonDateKey: date, reference }),
    [`${base}/one`, DATE, REFERENCE],
  )
  check('reader:open responde', opened.ok, opened.error)
  const leitor = await leitorPage(app)
  check('janela do Leitor abriu', Boolean(leitor))
  if (!leitor) throw new Error('Leitor não abriu')
  await leitor.emulateMedia({ colorScheme: null })
  leitor.on('pageerror', (error) => pageErrors.push(`leitor: ${error.message}`))
  leitor.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`leitor console: ${message.text()}`)
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text())
    if (process.env.READER_E2E_DEBUG) console.log(`[leitor ${message.type()}] ${message.text()}`)
  })
  await leitor.setViewportSize?.({ width: 1280, height: 860 }).catch(() => undefined)
  await leitor.waitForSelector('.reader-tab', { timeout: 15000 })

  const loaded = await until(async () => (await webContentsInfo(app)).find((item) => item.url.endsWith('/one') && !item.loading))
  check('página web carregou na WebContentsView', loaded, loaded)
  check('marca pregarReaderTab na vista', loaded?.readerFlag)
  check('regras globais de navegação não foram instaladas na vista', loaded?.navigateListeners === 1, loaded?.navigateListeners)
  const isolation = await inWeb(app, '/one', 'JSON.stringify({ pregar: typeof window.pregar, require: typeof require, process: typeof process })')
  check('página web não alcança window.pregar nem Node', isolation === JSON.stringify({ pregar: 'undefined', require: 'undefined', process: 'undefined' }), isolation)

  const selectedTitle = await until(async () => {
    const text = await leitor.textContent('.reader-tab--selected .reader-tab__title')
    return text?.includes('Página Um') ? text : null
  })
  check('título da aba vem da página', selectedTitle, selectedTitle)
  const state1 = await readerState(leitor)
  check('aba na pesquisa do sermão', state1.activeSermonDateKey === DATE && state1.tabs.length === 1 && state1.tabs[0].reference === REFERENCE, {
    date: state1.activeSermonDateKey,
    count: state1.tabs.length,
  })
  check('título da pesquisa', state1.contextTitle === 'Pesquisa · 1 de novembro de 2026', state1.contextTitle)

  // Posição da vista nativa coincide com a área reservada na janela.
  const hostRect = await leitor.evaluate(() => {
    const rect = document.querySelector('.web-host').getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
  })
  const viewBounds = await until(() =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('#/leitor'))
      return window?.contentView.children.filter((view) => view.getVisible?.() !== false).map((view) => view.getBounds())[0] ?? null
    }),
  )
  check('vista posicionada sobre a área da página', viewBounds && Math.abs(viewBounds.x - hostRect.x) <= 1 && Math.abs(viewBounds.y - hostRect.y) <= 1 && Math.abs(viewBounds.width - hostRect.width) <= 1, { hostRect, viewBounds })

  // 2. Navegação: link, voltar, bloqueio de file:, nova janela vira aba.
  await inWeb(app, '/one', `scrollTo(0, document.getElementById('deep-two').offsetTop - 200); true`)
  await sleep(300)
  await clickInWeb(app, '/one', '#deep-two')
  const atTwo = await until(async () => (await webContentsInfo(app)).find((item) => item.url.endsWith('/two') && !item.loading))
  check('link navega na própria aba', atTwo)
  const twoTitle = await until(async () => ((await leitor.textContent('.reader-tab--selected .reader-tab__title'))?.includes('Página Dois') ? true : null))
  check('título acompanha a navegação', twoTitle)
  const addressValue = await leitor.inputValue('.web-toolbar__address')
  check('endereço mostra a página atual', addressValue === `${base}/two`, addressValue)
  const canBack = await until(async () => !(await leitor.isDisabled('button[aria-label="Voltar"]')))
  check('Voltar habilitado depois de navegar', canBack)
  await leitor.click('button[aria-label="Voltar"]')
  const backAtOne = await until(async () => (await webContentsInfo(app)).find((item) => item.url.endsWith('/one') && !item.loading))
  check('Voltar (barra de abas) volta no histórico', backAtOne)
  const restoredScroll = await until(async () => {
    const y = await inWeb(app, '/one', 'scrollY')
    return typeof y === 'number' && y > 600 ? y : null
  })
  check('rolagem restaurada ao voltar', restoredScroll, restoredScroll)

  // Espera a restauração da rolagem terminar antes de voltar ao topo.
  await sleep(1800)
  await inWeb(app, '/one', 'scrollTo(0, 0); true')
  await sleep(200)
  await clickInWeb(app, '/one', '#file')
  await sleep(500)
  const stillOne = (await webContentsInfo(app)).some((item) => item.url.endsWith('/one'))
  check('file: no quadro principal é bloqueado', stillOne)

  await clickInWeb(app, '/one', '#blank')
  const twoTabs = await until(async () => ((await readerState(leitor)).tabs.length === 2 ? true : null))
  const stateBlank = await readerState(leitor)
  check('target=_blank abre nova aba selecionada', twoTabs && stateBlank.selectedID === stateBlank.tabs[1].id, stateBlank.tabs.map((tab) => tab.location))

  // Botão do meio num link abre aba ao fundo.
  await leitor.click('.reader-tab >> nth=0')
  await until(async () => {
    const state = await readerState(leitor)
    return state.selectedID === state.tabs[0].id
  })
  await sleep(300)
  await inWeb(app, '/one', 'scrollTo(0, 0); true')
  await sleep(200)
  await clickInWeb(app, '/one', '#to-two', 'middle')
  const threeTabs = await until(async () => ((await readerState(leitor)).tabs.length === 3 ? true : null), { timeout: 5000 })
  const stateMiddle = await readerState(leitor)
  check('botão do meio abre aba ao fundo', threeTabs && stateMiddle.selectedID === stateMiddle.tabs[0].id, stateMiddle.tabs.map((tab) => tab.title))

  // Download bloqueado vira aviso.
  await clickInWeb(app, '/one', '#download')
  const notice = await until(async () => (await leitor.textContent('body'))?.includes('O Leitor não baixa arquivos') || null, { timeout: 5000 })
  check('download bloqueado com aviso', notice)

  // 3. Atalhos: com o foco na página web (encaminhados) e na janela.
  await app.evaluate(({ webContents }, prefix) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === `${prefix}/one`)
    target.focus()
    target.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] })
    target.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['control'] })
  }, base)
  const forwarded = await until(async () => {
    const state = await readerState(leitor)
    return state.selectedID === state.tabs[1].id ? true : null
  })
  check('⌃Tab na página web seleciona a próxima aba', forwarded)

  await leitor.bringToFront()
  await leitor.click('.reader-contextbar')
  await leitor.keyboard.press('Control+Shift+Tab')
  const previous = await until(async () => {
    const state = await readerState(leitor)
    return state.selectedID === state.tabs[0].id ? true : null
  })
  check('⇧⌃Tab seleciona a aba anterior', previous)
  const before = (await readerState(leitor)).tabs.length
  await leitor.keyboard.press('Control+W')
  const closed = await until(async () => ((await readerState(leitor)).tabs.length === before - 1 ? true : null))
  check('⌘W fecha a aba', closed)
  await leitor.keyboard.press('Control+Shift+T')
  const reopened = await until(async () => ((await readerState(leitor)).tabs.length === before ? true : null))
  check('⇧⌘T reabre a aba fechada', reopened)
  await leitor.keyboard.press('Control+T')
  const sheet = await until(() => leitor.isVisible('[role="dialog"][aria-label="Nova aba"]'))
  check('⌘T abre a folha Nova aba', sheet)
  const hiddenDuringSheet = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('#/leitor'))
    return window.contentView.children.every((view) => view.getVisible() === false)
  })
  check('página web some enquanto a folha está aberta', hiddenDuringSheet)
  await leitor.fill('[role="dialog"] input', 'javascript:alert(1)')
  await leitor.keyboard.press('Enter')
  const invalid = await leitor.textContent('[role="dialog"]')
  check('endereço inválido recusado', invalid.includes('Informe um endereço http ou https válido.'))
  await leitor.fill('[role="dialog"] input', `127.0.0.1:${server.address().port}/two`)
  await leitor.click('[role="dialog"] button[type="submit"]')
  const added = await until(async () => {
    const state = await readerState(leitor)
    const selected = state.tabs.find((tab) => tab.id === state.selectedID)
    return selected?.location.startsWith('https://127.0.0.1') || selected?.location.startsWith(`${base}/two`) ? selected.location : null
  })
  check('Nova aba aceita endereço sem esquema (https)', added, added)
  // O servidor de teste é http: a aba https falha e mostra o estado de falha, sem a vista nativa.
  const failure = await until(() => leitor.isVisible('.web-failure'), { timeout: 10000 })
  const failureText = failure ? await leitor.textContent('.web-failure') : ''
  const viewHiddenOnFailure = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('#/leitor'))
    return window.contentView.children.every((view) => view.getVisible() === false)
  })
  check('falha de carregamento com "Tentar novamente" e vista oculta', failure && failureText.includes('Tentar novamente') && viewHiddenOnFailure, failureText.trim())

  // ⌘L com o foco na página web leva ao campo de endereço.
  await leitor.click('.reader-tab >> nth=0')
  await until(async () => (await webContentsInfo(app)).some((item) => item.url.endsWith('/one') && !item.loading))
  await app.evaluate(({ webContents }, prefix) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === `${prefix}/one`)
    target?.focus()
    target?.sendInputEvent({ type: 'keyDown', keyCode: 'L', modifiers: ['control'] })
    target?.sendInputEvent({ type: 'keyUp', keyCode: 'L', modifiers: ['control'] })
  }, base)
  const addressFocused = await until(() => leitor.evaluate(() => document.activeElement?.classList.contains('web-toolbar__address') ?? false))
  check('⌘L na página web edita o endereço', addressFocused)
  await leitor.keyboard.press('Escape')

  const permissions = await inWeb(
    app,
    '/one',
    `(async () => JSON.stringify({ notification: await Notification.requestPermission(), geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state }))()`,
  )
  check('permissões negadas às páginas', permissions === JSON.stringify({ notification: 'denied', geolocation: 'denied' }), permissions)

  // Arrastar reordena; botão do meio fecha a aba.
  const orderBefore = (await readerState(leitor)).tabs.map((tab) => tab.id)
  await leitor.locator('.reader-tab').nth(0).dragTo(leitor.locator('.reader-tab').nth(2), { targetPosition: { x: 200, y: 16 } })
  const reordered = await until(async () => {
    const order = (await readerState(leitor)).tabs.map((tab) => tab.id)
    return order[2] === orderBefore[0] ? order : null
  }, { timeout: 4000 })
  check('arrastar reordena as abas', reordered, reordered ? 'ok' : orderBefore)
  const countBeforeMiddle = (await readerState(leitor)).tabs.length
  await leitor.locator('.reader-tab').nth(1).click({ button: 'middle' })
  const middleClosed = await until(async () => ((await readerState(leitor)).tabs.length === countBeforeMiddle - 1 ? true : null))
  check('botão do meio fecha a aba', middleClosed)
  await leitor.keyboard.press('Control+Shift+T')
  await until(async () => ((await readerState(leitor)).tabs.length === countBeforeMiddle ? true : null))

  // 4. Pesquisas por sermão.
  await mesa.evaluate(() => window.pregar.invoke('reader:activateSermon', { dateKey: null }))
  const general = await until(async () => ((await leitor.textContent('.reader-contextbar'))?.includes('Pesquisa geral') ? true : null))
  const emptyVisible = await leitor.isVisible('text=Nenhuma aba aberta')
  check('Pesquisa geral sem abas mostra o estado vazio', general && emptyVisible)
  await leitor.screenshot({ path: join(shotsDir, 'leitor-vazio-claro.png') })
  await mesa.evaluate((date) => window.pregar.invoke('reader:activateSermon', { dateKey: date, reference: 'Mateus 21:23-32' }), DATE)
  const back = await until(async () => ((await readerState(leitor)).tabs.length >= 3 ? true : null))
  check('volta à pesquisa do sermão com as abas', back)
  const tabsForSermon = await mesa.evaluate((date) => window.pregar.invoke('reader:tabsForSermon', { dateKey: date }), DATE)
  check('reader:tabsForSermon lista as abas da data', tabsForSermon.ok && tabsForSermon.value.length >= 3, tabsForSermon.value?.length)

  // 5. PDF: registra na Biblioteca (ou usa um protocolo de teste) e abre na página 2.
  const imported = await mesa.evaluate((path) => window.pregar.invoke('library:importPaths', { paths: [path] }), pdfPath)
  // A Biblioteca indexa em segundo plano; o protocolo só serve PDFs já registrados.
  const registered = imported.ok
    ? await until(
        async () => {
          const works = await mesa.evaluate(() => window.pregar.invoke('library:works'))
          return works.ok && works.value.some((work) => work.title && work.path.endsWith('Comentario de teste.pdf')) ? true : null
        },
        { timeout: 30000, interval: 300 },
      )
    : false
  const protocolReady = registered && (await app.evaluate(({ protocol }) => protocol.isProtocolHandled('pregar-pdf')))
  if (!imported.ok || !protocolReady) {
    // Somente teste: serve o arquivo direto quando a Biblioteca ainda não registra o protocolo.
    await app.evaluate(({ protocol, net }) => {
      if (protocol.isProtocolHandled('pregar-pdf')) protocol.unhandle('pregar-pdf')
      protocol.handle('pregar-pdf', (request) => {
        const segment = new URL(request.url).pathname.replace(/^\//, '')
        const path = Buffer.from(segment, 'base64url').toString('utf8')
        return net.fetch(`file://${encodeURI(path)}`)
      })
    })
  }
  check('PDF registrado (library:importPaths ou protocolo de teste)', true, protocolReady ? 'Biblioteca' : `protocolo de teste (${imported.error?.message ?? 'não registrado'})`)
  const openedPdf = await mesa.evaluate(
    ([path, date, reference]) => window.pregar.invoke('reader:open', { kind: 'pdf', location: path, title: 'Comentário de teste', sermonDateKey: date, reference, physicalPage: 2 }),
    [pdfPath, DATE, REFERENCE],
  )
  check('reader:open de PDF', openedPdf.ok, openedPdf.error)
  const pages = await until(async () => ((await leitor.locator('.pdfViewer .page').count()) === 3 ? true : null), { timeout: 15000 })
  check('PDF.js mostra as três páginas', pages)
  const pageField = await until(async () => ((await leitor.inputValue('#reader-page-field')) === '2' ? '2' : null))
  check('abre na página física pedida', pageField === '2', await leitor.inputValue('#reader-page-field'))
  const textLayer = await until(async () => ((await leitor.textContent('.pdfViewer .page[data-page-number="2"] .textLayer')) ?? '').includes('Mateus 21:23-32'))
  check('camada de texto selecionável', textLayer)
  const sectionsListed = await until(async () => ((await leitor.locator('.sections__item').count()) === 2 ? true : null), { timeout: 8000 })
  check('seções do PDF (bookmarks) no painel', sectionsListed)
  await leitor.fill('#reader-page-field', '3')
  await leitor.press('#reader-page-field', 'Enter')
  const page3 = await until(async () => {
    const state = await readerState(leitor)
    return state.tabs.find((tab) => tab.id === state.selectedID)?.physicalPage === 3 ? true : null
  })
  check('campo de página navega (Enter)', page3)
  const navBefore = (await readerState(leitor)).tabs.find((tab) => tab.kind === 'pdf').navigationID
  await leitor.click('.sections__item >> nth=0')
  const explicit = await until(async () => {
    const tab = (await readerState(leitor)).tabs.find((item) => item.kind === 'pdf')
    return tab.navigationID !== navBefore && tab.physicalPage === 2 ? true : null
  })
  check('seção navega com navegação explícita', explicit)
  const scaleBefore = await leitor.evaluate(() => getComputedStyle(document.querySelector('.pdfViewer')).getPropertyValue('--scale-factor'))
  await leitor.click('.pdf-container')
  await leitor.keyboard.press('Control+=')
  const scaleAfter = await until(async () => {
    const value = await leitor.evaluate(() => getComputedStyle(document.querySelector('.pdfViewer')).getPropertyValue('--scale-factor'))
    return value !== scaleBefore ? value : null
  })
  // Um disparo só: o menu do app (CmdOrCtrl+=) não pode repetir o zoom.
  await sleep(400)
  const scaleSettled = await leitor.evaluate(() => getComputedStyle(document.querySelector('.pdfViewer')).getPropertyValue('--scale-factor'))
  check('⌘+ aumenta o zoom uma vez', scaleAfter === scaleSettled && Math.abs(Number(scaleSettled) / Number(scaleBefore) - 1.2) < 0.02, { scaleBefore, scaleSettled })
  const saved = await until(async () => {
    const tab = (await readerState(leitor)).tabs.find((item) => item.kind === 'pdf')
    return tab.pdfPosition?.autoScales === false ? tab : null
  })
  check('posição e escala publicadas', saved?.pdfPosition && saved.pdfPosition.page >= 1, saved?.pdfPosition)

  if (!(await leitor.isVisible('.info'))) await leitor.click('button[aria-label="Alternar informações do material"]')
  const badge = await until(() => leitor.textContent('.info .badge'))
  check('confiança da seção (bookmark = alta)', badge?.trim() === 'alta', badge)
  await leitor.fill('.pdf-find input', 'lavradores')
  const found = await until(async () => ((await leitor.textContent('.pdf-find__status')) ?? '').includes('1 de 1') || null, { timeout: 8000 })
  check('busca no PDF', found, await leitor.textContent('.pdf-find').catch(() => ''))
  await leitor.fill('.pdf-find input', '')
  await leitor.click('.info .toggle')
  const marked = await until(async () => ((await readerState(leitor)).tabs.find((tab) => tab.kind === 'pdf')?.includedInReview ? true : null))
  check('marcar para a revisão', marked)
  await sleep(400)

  // Materiais marcados para a revisão: PDF pela Biblioteca e página web pela vista aberta.
  const janela = (await readerState(leitor)).tabs.find((tab) => tab.location.endsWith('/two?janela=1'))
  await leitor.evaluate((id) => window.pregar.invoke('reader:setReviewInclusion', { tabID: id, included: true }), janela.id)
  const review = await mesa.evaluate(
    ([date, reference]) => window.pregar.invoke('ai:reviewSources', { dateKey: date, mainReference: reference, bibles: [], includeMaterials: true }),
    [DATE, REFERENCE],
  )
  const reviewWeb = review.value?.sources.find((source) => source.id === `web:${janela.id}`)
  check('revisão extrai a página web marcada (vista aberta)', review.ok && reviewWeb && reviewWeb.bytes > 0 && reviewWeb.citation === `${base}/two`, review.ok ? review.value : review.error)
  const reviewPdf = review.value?.sources.find((source) => source.kind === 'pdf')
  check('revisão extrai a seção do PDF marcado (Biblioteca)', review.ok && (reviewPdf || review.value.blockedReason), reviewPdf ?? review.value?.blockedReason)

  // 6. Capturas claro e escuro (janela e tela inteira, que inclui a página web nativa).
  await leitor.screenshot({ path: join(shotsDir, 'leitor-pdf-claro.png') })
  await leitor.click('.reader-tab >> nth=0')
  await until(async () => (await webContentsInfo(app)).some((item) => item.url.endsWith('/one') && !item.loading))
  await sleep(700)
  screenGrab(join(shotsDir, 'leitor-web-claro-tela.png'))
  await mesa.evaluate(() => window.pregar.invoke('settings:update', { appearance: 'dark' }))
  await sleep(800)
  screenGrab(join(shotsDir, 'leitor-web-escuro-tela.png'))
  await leitor.click('.reader-tab >> nth=-1')
  await until(async () => {
    const state = await readerState(leitor)
    return state.tabs.find((tab) => tab.id === state.selectedID)?.kind === 'pdf' ? true : null
  })
  await sleep(800)
  await leitor.screenshot({ path: join(shotsDir, 'leitor-pdf-escuro.png') })
  screenGrab(join(shotsDir, 'leitor-pdf-escuro-tela.png'))
  // Janela no tamanho mínimo com os dois painéis abertos.
  await leitor.setViewportSize({ width: 820, height: 600 })
  await sleep(600)
  await leitor.screenshot({ path: join(shotsDir, 'leitor-pdf-estreito-escuro.png') })
  const toolbarFits = await leitor.evaluate(() => {
    const toolbar = document.querySelector('.pdf-toolbar')
    return toolbar.scrollWidth <= toolbar.clientWidth + 1
  })
  check('barra do PDF cabe na largura mínima com os painéis', toolbarFits)
  await leitor.setViewportSize({ width: 1280, height: 860 })
  await mesa.evaluate(() => window.pregar.invoke('settings:update', { appearance: 'system' }))

  // 7. Persistência: estado gravado e restaurado ao reabrir o app.
  const finalState = await readerState(leitor)
  await sleep(800)
  app.process().kill()
  await sleep(500)
  app = await launch()
  const mesa2 = await app.firstWindow({ timeout: 20000 })
  await mesa2.waitForFunction(() => Boolean(window.pregar), null, { timeout: 15000 })
  const restored = await mesa2.evaluate(() => window.pregar.invoke('reader:state').then((result) => result.value))
  check(
    'sessão restaurada após reiniciar',
    restored.tabs.length === finalState.tabs.length && restored.selectedID === finalState.selectedID && restored.activeSermonDateKey === DATE,
    { before: finalState.tabs.length, after: restored.tabs.length },
  )
  const restoredPdf = restored.tabs.find((tab) => tab.kind === 'pdf')
  check('posição do PDF restaurada', restoredPdf?.pdfPosition?.scale > 0 && restoredPdf.includedInReview === true, restoredPdf?.pdfPosition)
  // Sem janela do Leitor aberta, a página marcada é carregada de forma oculta para a revisão.
  const hiddenReview = await mesa2.evaluate(
    ([date, reference]) => window.pregar.invoke('ai:reviewSources', { dateKey: date, mainReference: reference, bibles: [], includeMaterials: true }),
    [DATE, REFERENCE],
  )
  check(
    'revisão carrega a página web marcada sem a janela aberta',
    hiddenReview.ok && hiddenReview.value.sources.some((source) => source.kind === 'web' && source.bytes > 0),
    hiddenReview.ok ? hiddenReview.value.sources.map((source) => [source.kind, source.bytes]) : hiddenReview.error,
  )
  const leftovers = await webContentsInfo(app)
  check('carregamento oculto é liberado depois', leftovers.length === 0, leftovers)
  await mesa2.evaluate(() => window.pregar.invoke('app:openWindow', { window: 'leitor' }))
  const leitor2 = await leitorPage(app)
  await leitor2.waitForSelector('.reader-tab', { timeout: 15000 })
  if (restored.tabs.find((tab) => tab.id === restored.selectedID)?.kind !== 'pdf') await leitor2.click('.reader-tab:has(.lucide-file-text)')
  await until(async () => ((await leitor2.locator('.pdfViewer .page').count()) === 3 ? true : null), { timeout: 15000 })
  await sleep(500)
  const reopenedView = await leitor2.evaluate(() => ({
    page: document.querySelector('#reader-page-field')?.value,
    scale: Number(getComputedStyle(document.querySelector('.pdfViewer')).getPropertyValue('--scale-factor')),
  }))
  check(
    'visor volta à página e ao zoom salvos',
    reopenedView.page === String(restoredPdf.pdfPosition.page) && Math.abs(reopenedView.scale - restoredPdf.pdfPosition.scale * (96 / 72)) < 0.01,
    reopenedView,
  )
} catch (error) {
  check('execução sem exceções', false, String(error?.stack ?? error))
} finally {
  app.process().kill()
  server.close()
}

check('sem violações de CSP no Leitor (PDF.js, fontes e wasm)', cspViolations.length === 0, cspViolations.slice(0, 3))
const relevantErrors = pageErrors.filter((message) => !/Failed to load resource|favicon/i.test(message))
check('sem erros de página', relevantErrors.length === 0, relevantErrors.slice(0, 5))
check('sem exceções não tratadas no processo principal', watchedMainErrors.flat().length === 0, watchedMainErrors.flat().slice(0, 2))
const failed = results.filter((result) => !result.ok)
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, shots: shotsDir }))
process.exit(failed.length ? 1 : 0)
