import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeAppURLCheck } from '../../src/main/app-url'

const rendererDir = join('/opt', 'Pregar', 'resources', 'app.asar', 'out', 'renderer')
const page = pathToFileURL(join(rendererDir, 'index.html')).href

describe('origem das janelas do app', () => {
  const isApp = makeAppURLCheck(rendererDir)

  it('aceita a interface empacotada, com rota no hash', () => {
    expect(isApp(page)).toBe(true)
    expect(isApp(`${page}#/mesa`)).toBe(true)
  })

  it('recusa outros arquivos locais, inclusive com ../', () => {
    expect(isApp(pathToFileURL('/home/pastor/Downloads/pagina.html').href)).toBe(false)
    expect(isApp(pathToFileURL(join(rendererDir, '..', 'main', 'index.js')).href)).toBe(false)
    expect(isApp(`${pathToFileURL(rendererDir).href}/../../evil.html`)).toBe(false)
    expect(isApp(pathToFileURL(rendererDir).href)).toBe(false)
  })

  it('recusa sites, data: e URLs inválidas', () => {
    expect(isApp('https://exemplo.com/')).toBe(false)
    expect(isApp('data:text/html,oi')).toBe(false)
    expect(isApp('não é url')).toBe(false)
  })

  it('em desenvolvimento, aceita só a mesma origem do Vite', () => {
    const dev = makeAppURLCheck(rendererDir, 'http://localhost:5173')
    expect(dev('http://localhost:5173/#/mesa')).toBe(true)
    expect(dev('http://localhost:5173.evil.com/')).toBe(false)
    expect(dev('http://localhost:51730/')).toBe(false)
  })
})
