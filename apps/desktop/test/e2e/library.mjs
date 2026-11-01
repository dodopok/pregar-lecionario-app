// Ponta a ponta da Biblioteca e do Arquivo (Playwright + Electron).
// Uso: PREGAR_OUT=.build-library npx electron-vite build && xvfb-run -a node test/e2e/library.mjs [.build-library] [pasta-das-capturas]
/* eslint-disable no-console */
import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildPdf, wrightPages, WRIGHT_OUTLINE } from './library-fixture.mjs'

const outDir = process.argv[2] ?? '.build-library'
const shotsDir = resolve(process.argv[3] ?? join(tmpdir(), 'pregar-library-e2e'))
mkdirSync(shotsDir, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'pregar-e2e-library-'))
const pdfDir = mkdtempSync(join(tmpdir(), 'pregar-e2e-pdfs-'))
const env = { ...process.env }
delete env.NODE_OPTIONS

const log = (...args) => console.log('·', ...args)
const shots = []

async function prepare(page) {
  // O Playwright força prefers-color-scheme: light; sem isto o modo escuro não aparece nas capturas.
  await page.emulateMedia({ colorScheme: null })
  page.on('pageerror', (error) => console.log('[pageerror]', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Autofill|DevTools/.test(message.text())) console.log('[console]', message.text().slice(0, 300))
  })
}

async function invoke(page, channel, payload) {
  const result = await page.evaluate(([name, value]) => window.pregar.invoke(name, value), [channel, payload])
  if (!result.ok) throw new Error(`${channel}: ${result.error.message}`)
  return result.value
}

async function waitFor(check, { timeout = 30_000, interval = 250, message = 'condição' } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`Tempo esgotado esperando ${message}`)
    await new Promise((done) => setTimeout(done, interval))
  }
}

async function screenshot(page, name) {
  await page.waitForTimeout(350)
  const path = join(shotsDir, `${name}.png`)
  await page.screenshot({ path })
  shots.push(path)
}

async function openWindow(app, page, kind) {
  const opened = app.waitForEvent('window', { timeout: 20_000 })
  await invoke(page, 'app:openWindow', { window: kind })
  const window = await opened
  await prepare(window)
  await window.waitForLoadState('domcontentloaded')
  return window
}

const app = await electron.launch({
  args: [`${outDir}/main/index.js`, `--user-data-dir=${userData}`, '--no-sandbox'],
  env,
  timeout: 30_000,
})
const watchdog = setTimeout(() => {
  console.error('Tempo total esgotado.')
  app.process().kill()
  process.exit(1)
}, 300_000)

let failed = false
try {
  const mesa = await app.firstWindow({ timeout: 20_000 })
  await prepare(mesa)
  await mesa.waitForLoadState('domcontentloaded')
  await mesa.waitForFunction(() => Boolean(window.pregar), null, { timeout: 15_000 })

  // 1. PDFs de teste: Wright com sumário + uma página digitalizada (só imagem) e a mesma obra sem sumário.
  const scan = await mesa.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1275
    canvas.height = 1650
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000'
    context.font = 'bold 44px serif'
    context.fillText('Romans 15:1-6 Bearing with One Another', 120, 200)
    context.font = '30px serif'
    const body = [
      'We who are strong ought to put up with the failings of the weak,',
      'and not to please ourselves. Each of us must please our neighbour',
      'for the good purpose of building up the neighbour.',
    ]
    body.forEach((line, index) => context.fillText(line, 120, 300 + index * 48))
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const gray = new Uint8Array(canvas.width * canvas.height)
    for (let index = 0; index < gray.length; index += 1) gray[index] = data[index * 4]
    let binary = ''
    for (let index = 0; index < gray.length; index += 0x8000) binary += String.fromCharCode(...gray.subarray(index, index + 0x8000))
    return { width: canvas.width, height: canvas.height, base64: btoa(binary) }
  })
  const scanPage = { image: { width: scan.width, height: scan.height, gray: Buffer.from(scan.base64, 'base64') } }
  const withOutline = join(pdfDir, 'Wright - Romans Part 2.pdf')
  const withoutOutline = join(pdfDir, 'Paul_for_Everyone_-_Romans (1).pdf')
  const notPdf = join(pdfDir, 'nao-e-pdf.pdf')
  writeFileSync(
    withOutline,
    buildPdf({ title: 'Paul for Everyone: Romans Part 2', author: 'Wright, Tom', pages: [...wrightPages(), scanPage], outline: WRIGHT_OUTLINE }),
  )
  writeFileSync(withoutOutline, buildPdf({ pages: wrightPages() }))
  writeFileSync(notPdf, 'isto não é um PDF')
  const originalBytes = readFileSync(withOutline)

  // 2. Importação por caminhos (validação estrita).
  const imported = await invoke(mesa, 'library:importPaths', { paths: [withOutline, withoutOutline, notPdf, 'relativo.pdf', `${pdfDir}/../x.pdf`] })
  log('importação', JSON.stringify(imported))
  assert.equal(imported.queued, 2)
  assert.equal(imported.skipped.length, 3)
  const again = await invoke(mesa, 'library:importPaths', { paths: [withOutline] })
  assert.equal(again.alreadyInLibrary, 1)

  const works = await waitFor(
    async () => {
      const status = await invoke(mesa, 'library:status')
      const list = await invoke(mesa, 'library:works')
      return !status.indexing && list.length === 2 && list.every((work) => work.sectionCount > 0) ? list : null
    },
    { message: 'indexação dos PDFs' },
  )
  log('obras', works.map((work) => `${work.title} (${work.sectionCount} seções, ${work.pageCount} p.)`).join(' | '))
  const outlined = works.find((work) => work.path === withOutline)
  assert.ok(outlined, 'obra com sumário indexada')
  assert.equal(outlined.title, 'Paul for Everyone: Romans Part 2')
  assert.equal(outlined.author, 'Tom Wright')
  assert.equal(works.find((work) => work.path === withoutOutline)?.copyLabel, 'Cópia 2')

  // 3. Correspondências para a Mesa.
  const matches = await invoke(mesa, 'library:matches', { reference: 'Romanos 13:8-14' })
  log('matches', matches.map((match) => `${match.kind}:${match.section.title}@${match.section.startPage}`).join(' | '))
  const exact = matches.filter((match) => match.kind === 'exact')
  assert.equal(exact.length, 2)
  assert.ok(exact.every((match) => match.section.startPage === 3 && match.section.endPage === 4))
  assert.ok(matches.some((match) => match.kind === 'context' && match.section.title === 'Romans 13'))
  const count = await invoke(mesa, 'library:count')
  assert.equal(count.works, 2)
  const readerSections = await invoke(mesa, 'library:sectionsForPath', { path: withoutOutline })
  assert.deepEqual(
    readerSections.map((section) => [section.title, section.startPage, section.endPage, section.method, section.confidence]),
    [
      ['Romans 13:1-7 Submitting to the Authorities', 2, 2, 'textHeading', 'medium'],
      ['Romans 13:8-14 Love, the Law and the Coming Day', 3, 4, 'textHeading', 'medium'],
      ['Romans 14:1-6 Welcoming the Weak', 5, 5, 'textHeading', 'medium'],
    ],
  )
  assert.deepEqual(await invoke(mesa, 'library:sectionsForPath', { path: notPdf }), [])

  // 4. Protocolo pregar-pdf com Range, a partir da janela.
  const size = statSync(withOutline).size
  const range = await mesa.evaluate(async (url) => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-15' } })
    const head = await fetch(url, { method: 'HEAD' })
    const tail = await fetch(url, { headers: { Range: 'bytes=-5' } })
    const bad = await fetch(url, { headers: { Range: 'bytes=99999999-' } })
    const unknown = await fetch(url.replace(/open\/.*/, 'open/L3RtcC9uYW8tcmVnaXN0cmFkby5wZGY'))
    return {
      status: response.status,
      contentRange: response.headers.get('content-range'),
      acceptRanges: response.headers.get('accept-ranges'),
      type: response.headers.get('content-type'),
      text: await response.text(),
      headStatus: head.status,
      headLength: head.headers.get('content-length'),
      tail: await tail.text(),
      badStatus: bad.status,
      unknownStatus: unknown.status,
    }
  }, outlined.pdfURL)
  log('range', JSON.stringify(range))
  assert.equal(range.status, 206)
  assert.equal(range.contentRange, `bytes 0-15/${size}`)
  assert.equal(range.acceptRanges, 'bytes')
  assert.equal(range.type, 'application/pdf')
  assert.ok(range.text.startsWith('%PDF-1.7'))
  assert.equal(range.headStatus, 200)
  assert.equal(Number(range.headLength), size)
  assert.equal(range.tail, '%EOF\n')
  assert.equal(range.badStatus, 416)
  assert.equal(range.unknownStatus, 404)

  // 5. Sermões para o Arquivo.
  const sermons = [
    ['2026-09-06', 'O amor cumpre a lei', 'Romanos 13:8-14', 'Próprio 18', 'Tempo Comum', 'A graça que nos alcança em Cristo cumpre a lei pelo amor ao próximo.'],
    ['2026-09-27', '', 'Mateus 21:23-32', 'Próprio 21', 'Tempo Comum', 'Com que autoridade? Os dois filhos e a vinha.'],
    ['2026-10-04', 'A vinha e os lavradores', 'Mateus 21:33-46', 'Próprio 22', 'Tempo Comum', ''],
  ]
  for (const [dateKey, title, reference, occasion, season, plainText] of sermons) {
    await invoke(mesa, 'sermons:save', {
      dateKey,
      patch: { title, mainReadingReference: reference, liturgicalOccasion: occasion, liturgicalSeason: season, liturgicalCelebration: null, plainText },
    })
  }

  // 6. Janela da Biblioteca.
  const library = await openWindow(app, mesa, 'biblioteca')
  await library.waitForSelector('.work', { timeout: 20_000 })
  assert.equal(await library.locator('.work').count(), 2)
  await waitFor(async () => (await library.locator('.works .cover img').count()) === 2, { message: 'capas geradas', timeout: 30_000 })
  const coverFiles = await invoke(library, 'library:works')
  assert.ok(coverFiles.every((work) => work.coverURL?.startsWith('pregar-asset://cover/')))
  await library.locator('.work', { hasText: 'Romans Part 2' }).first().click()
  await library.waitForSelector('.sections__row')
  await library.fill('.detail__filter input', 'Romanos 13:8-14')
  await library.waitForSelector('.badge--exact', { timeout: 10_000 })
  log('filtro', await library.locator('.detail__filter-count').textContent())
  // Abrir a seção no Leitor (canal do módulo do Leitor): só registra o resultado.
  const readerWindow = app.waitForEvent('window', { timeout: 8_000 }).catch(() => null)
  await library.locator('.sections__row--match').first().click()
  const reader = await readerWindow
  log('leitor', reader ? reader.url() : 'nenhuma janela nova (Leitor já aberto ou indisponível)')
  await library.bringToFront()
  await screenshot(library, 'biblioteca-claro')

  // Teclado: lista de obras.
  await library.locator('.work[aria-selected="true"]').focus()
  await library.keyboard.press('ArrowUp')
  await library.waitForTimeout(150)
  const keyboardSelected = await library.locator('.work[aria-selected="true"] .work__title').textContent()
  log('seleção por teclado', keyboardSelected)
  assert.equal(keyboardSelected, 'Paul for Everyone: Romans')
  await library.keyboard.press('ArrowDown')
  await library.waitForSelector('.work[aria-selected="true"]:has-text("Romans Part 2")')

  // Folha de metadados.
  await library.getByRole('button', { name: 'Corrigir metadados' }).first().click()
  await library.waitForSelector('[role="dialog"]')
  await screenshot(library, 'biblioteca-metadados-claro')
  await library.fill('#metadata-publisher', 'SPCK')
  await library.getByRole('button', { name: 'Salvar metadados' }).click()
  await waitFor(async () => (await library.locator('.detail__meta').textContent())?.includes('SPCK'), { message: 'metadados salvos' })
  await invoke(library, 'library:reindex', { id: outlined.id })
  await waitFor(async () => !(await invoke(library, 'library:status')).indexing, { message: 'reindexação' })
  const afterReindex = (await invoke(library, 'library:works')).find((work) => work.id === outlined.id)
  assert.equal(afterReindex.overrides?.publisher, 'SPCK', 'correção sobrevive à reindexação')

  // OCR sob demanda (página 6 só tem imagem). Depende de baixar os dados de idioma uma vez.
  await library.locator('.detail__actions').getByRole('button', { name: 'OCR…' }).click()
  let ocrNotice = null
  try {
    ocrNotice = await waitFor(
      async () => {
        const text = await library.locator('.detail__notice').textContent().catch(() => null)
        return text && text.trim() ? text.trim() : null
      },
      { timeout: 150_000, interval: 1000, message: 'OCR' },
    )
  } catch (error) {
    console.log('OCR não concluiu:', error.message)
  }
  log('ocr', ocrNotice)
  if (ocrNotice && /OCR examinou/.test(ocrNotice)) {
    const ocrSections = await invoke(library, 'library:sectionsForPath', { path: withOutline })
    const recognized = ocrSections.find((section) => section.method === 'ocrHeading')
    log('seção OCR', JSON.stringify(recognized))
    assert.ok(recognized && /15:1/.test(recognized.title), 'OCR encontrou Romanos 15:1-6')
    assert.equal(recognized.confidence, 'low')
  }
  assert.deepEqual(readFileSync(withOutline), originalBytes, 'o PDF original não foi alterado')
  await library.fill('.detail__filter input', '')
  await screenshot(library, 'biblioteca-ocr-claro')

  // 7. Arquivo.
  const archive = await openWindow(app, mesa, 'arquivo')
  await archive.waitForSelector('.archive-row', { timeout: 20_000 })
  assert.equal(await archive.locator('.archive-row').count(), 3)
  const subtitle = await archive.locator('.window-header').textContent()
  assert.ok(subtitle.includes('3 preparações'), subtitle)
  const expectedCount = (await invoke(archive, 'library:matchCounts', { references: ['Romanos 13:8-14'] }))['Romanos 13:8-14']
  assert.equal(expectedCount, matches.length)
  await waitFor(
    async () => (await archive.locator('.archive-row', { hasText: 'Romanos 13:8-14' }).locator('.archive-row__materials').textContent()).includes(`${expectedCount} PDFs`),
    { message: 'contagem de materiais' },
  )
  await screenshot(archive, 'arquivo-claro')
  await archive.getByRole('radio', { name: 'Texto' }).click()
  await archive.fill('.archive__search input', 'graça')
  await waitFor(async () => (await archive.locator('.archive-row').count()) === 1 && (await archive.locator('.archive-row__snippet mark').count()) > 0, {
    message: 'busca de texto',
  })
  assert.ok((await archive.locator('.window-header').textContent()).includes('1 de 3 preparações'))
  await screenshot(archive, 'arquivo-texto-claro')
  await archive.getByRole('radio', { name: 'Passagem' }).click()
  await archive.fill('.archive__search input', 'Apocalipse 22')
  await archive.waitForSelector('.empty')
  await archive.fill('.archive__search input', '')
  await archive.waitForSelector('.archive-row')
  // Teclado e abertura na Mesa.
  await archive.locator('.archive-row').first().focus()
  await archive.keyboard.press('ArrowDown')
  await archive.keyboard.press('Enter')
  await waitFor(async () => mesa.url().includes('date=2026-09-27'), { message: 'Mesa na data da preparação', timeout: 10_000 })
  log('mesa', mesa.url())

  // Janelas no tamanho mínimo.
  const resize = (route, width, height) =>
    app.evaluate(
      ({ BrowserWindow }, [hash, w, h]) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes(hash))?.setSize(w, h),
      [route, width, height],
    )
  await resize('#/arquivo', 780, 560)
  await resize('#/biblioteca', 860, 560)
  await archive.waitForTimeout(400)
  await screenshot(archive, 'arquivo-estreito-claro')
  await screenshot(library, 'biblioteca-estreita-claro')
  await resize('#/arquivo', 1120, 780)
  await resize('#/biblioteca', 1240, 840)

  // 8. Modo escuro.
  await invoke(mesa, 'settings:update', { appearance: 'dark' })
  await library.waitForTimeout(500)
  await library.bringToFront()
  await screenshot(library, 'biblioteca-escuro')
  await archive.bringToFront()
  await screenshot(archive, 'arquivo-escuro')
  await library.getByRole('button', { name: 'Corrigir metadados' }).first().click()
  await screenshot(library, 'biblioteca-metadados-escuro')
  await library.keyboard.press('Escape')
  await library.getByRole('button', { name: 'Drive público…' }).click()
  await screenshot(library, 'biblioteca-drive-escuro')
  await library.keyboard.press('Escape')
  await invoke(mesa, 'settings:update', { appearance: 'light' })

  // 9. Remover não apaga o arquivo; a Biblioteca vazia mostra o estado inicial.
  await invoke(library, 'library:remove', { id: withoutOutline })
  await invoke(library, 'library:remove', { id: withOutline })
  assert.ok(existsSync(withOutline) && existsSync(withoutOutline), 'arquivos continuam no disco')
  await library.waitForSelector('.detail__empty', { timeout: 10_000 })
  await screenshot(library, 'biblioteca-vazia-claro')
  const forbidden = await library.evaluate(async (url) => (await fetch(url)).status, outlined.pdfURL)
  assert.equal(forbidden, 404, 'PDF removido não é mais servido')

  console.log(JSON.stringify({ ok: true, ocr: ocrNotice, screenshots: shots }, null, 1))
} catch (error) {
  failed = true
  console.error('FALHOU:', error)
} finally {
  clearTimeout(watchdog)
  app.process().kill()
}
process.exit(failed ? 1 : 0)
