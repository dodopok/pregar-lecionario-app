import { net } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TESSDATA_URL } from './urls'

/**
 * Dados de idioma do OCR (modelo LSTM inteiro do tesseract, português e inglês), baixados uma
 * vez do pacote fixado no jsDelivr e conferidos por tamanho, cabeçalho gzip e SHA-256.
 */
export const TESSDATA_LANGUAGES = [
  { code: 'por', size: 1_392_239, sha256: '2s68E4bdqvg4n4EJQjbMoNaQiXzeaT1Iy9qogchuK0w=' },
  { code: 'eng', size: 2_952_873, sha256: 'RbTLNGckrBd08cNvQvGCuIe82yjr5j5v/5CsQfP8/5E=' },
] as const

const PACKAGE_VERSION = '1.0.0'

export function tessdataSourceURL(code: string): string {
  return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@${PACKAGE_VERSION}/4.0.0_best_int/${code}.traineddata.gz`
}

async function sha256Base64(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

function isValidBuffer(data: Buffer, expected: (typeof TESSDATA_LANGUAGES)[number]): boolean {
  return (
    data.length === expected.size &&
    data[0] === 0x1f &&
    data[1] === 0x8b &&
    createHash('sha256').update(data).digest('base64') === expected.sha256
  )
}

export class TessdataManager {
  private verified = new Set<string>()
  private pending: Promise<void> | null = null

  constructor(
    private readonly folder: string,
    private readonly onProgress: (loaded: number, total: number) => void,
  ) {}

  /** Endereço servido ao tesseract na janela da Biblioteca. */
  readonly langPath = TESSDATA_URL

  fileFor(code: string): string {
    return join(this.folder, `${code}.traineddata.gz`)
  }

  private async isInstalled(language: (typeof TESSDATA_LANGUAGES)[number]): Promise<boolean> {
    if (this.verified.has(language.code)) return true
    const path = this.fileFor(language.code)
    const info = await stat(path).catch(() => null)
    if (!info || info.size !== language.size) return false
    if ((await sha256Base64(path)) !== language.sha256) return false
    this.verified.add(language.code)
    return true
  }

  /** Garante os dois idiomas no disco (baixa só o que falta); chamadas simultâneas compartilham o download. */
  ensure(): Promise<void> {
    this.pending ??= this.download().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async download(): Promise<void> {
    const missing = []
    for (const language of TESSDATA_LANGUAGES) if (!(await this.isInstalled(language))) missing.push(language)
    if (missing.length === 0) return
    const total = missing.reduce((sum, language) => sum + language.size, 0)
    let loaded = 0
    this.onProgress(0, total)
    for (const language of missing) {
      let response: Response
      try {
        response = await net.fetch(tessdataSourceURL(language.code), { cache: 'no-store' })
      } catch {
        throw new Error('Não foi possível baixar os dados de idioma do OCR. Verifique a conexão e tente novamente.')
      }
      if (!response.ok || !response.body) {
        throw new Error(`Não foi possível baixar os dados de idioma do OCR (HTTP ${response.status}).`)
      }
      const chunks: Buffer[] = []
      let received = 0
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > language.size) {
          await reader.cancel()
          throw new Error('Os dados de idioma do OCR vieram com tamanho inesperado e foram descartados.')
        }
        chunks.push(Buffer.from(value))
        this.onProgress(loaded + received, total)
      }
      const data = Buffer.concat(chunks)
      if (!isValidBuffer(data, language)) {
        throw new Error('Os dados de idioma do OCR não passaram na verificação de integridade e foram descartados.')
      }
      const target = this.fileFor(language.code)
      const temporary = `${target}.download`
      await writeFile(temporary, data)
      try {
        await rename(temporary, target)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
      this.verified.add(language.code)
      loaded += language.size
      this.onProgress(loaded, total)
    }
  }
}
