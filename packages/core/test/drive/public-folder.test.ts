import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GoogleDriveError } from '../../src/drive/errors'
import {
  GoogleDrivePublicFolderClient,
  GoogleDrivePublicPDFImporter,
  PUBLIC_DRIVE_MAXIMUM_PDF_SIZE,
  parseGoogleDrivePublicFolderLink,
  publicDriveImportDirectory,
  publicDriveLocalFilename,
  driveResourceKeysHeader,
} from '../../src/drive/public-folder'
import type {
  GoogleDriveImportFileSink,
  GoogleDrivePublicPDF,
  GoogleDrivePublicPDFDownloadResult,
} from '../../src/drive/public-folder'
import { fakeHttp, json } from './fake-fetch'
import type { RecordedRequest } from './fake-fetch'

const encoder = new TextEncoder()

function md5(data: Uint8Array): string {
  return createHash('md5').update(data).digest('hex')
}

async function rejection(promise: Promise<unknown>): Promise<GoogleDriveError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(GoogleDriveError)
  return error as GoogleDriveError
}

function pdf(id: string, extra: Partial<GoogleDrivePublicPDF['file']> = {}): GoogleDrivePublicPDF {
  return { file: { id, name: `${id}.pdf`, mimeType: 'application/pdf', ...extra }, parentResourceKeys: {} }
}

class MemorySink implements GoogleDriveImportFileSink {
  files = new Map<string, Uint8Array>()
  failOn?: string

  async writeFile(directory: readonly string[], fileName: string, data: Uint8Array): Promise<string> {
    if (this.failOn && fileName.includes(this.failOn)) throw new Error('Disco cheio.')
    const path = `/app-data/${[...directory, fileName].join('/')}`
    this.files.set(path, data)
    return path
  }
}

describe('link de pasta pública do Drive', () => {
  it('mantém a resourcekey e recusa hosts alheios', () => {
    const link = parseGoogleDrivePublicFolderLink(
      ' https://drive.google.com/drive/folders/folder_123?usp=sharing&resourcekey=share-key ',
    )
    expect(link).toEqual({ folderId: 'folder_123', resourceKey: 'share-key' })
    expect(parseGoogleDrivePublicFolderLink('https://drive.google.com/open?id=folder_123')?.folderId).toBe(
      'folder_123',
    )
    expect(
      parseGoogleDrivePublicFolderLink('https://www.drive.google.com/drive/u/0/folders/folder_123')?.folderId,
    ).toBe('folder_123')
    expect(
      parseGoogleDrivePublicFolderLink('https://drive.google.com/drive/folders/folder_123?resourceKey=k')
        ?.resourceKey,
    ).toBe('k')
    expect(parseGoogleDrivePublicFolderLink('http://drive.google.com/drive/folders/folder_123')).toBeNull()
    expect(
      parseGoogleDrivePublicFolderLink('https://drive.google.com.evil.example/drive/folders/folder_123'),
    ).toBeNull()
    expect(parseGoogleDrivePublicFolderLink('https://docs.google.com/document/d/folder_123')).toBeNull()
    expect(
      parseGoogleDrivePublicFolderLink('https://user:pw@drive.google.com/drive/folders/folder_123'),
    ).toBeNull()
    expect(parseGoogleDrivePublicFolderLink('https://drive.google.com/drive/folders/abc')).toBeNull()
    expect(parseGoogleDrivePublicFolderLink('https://drive.google.com/drive/folders/folder%27123')).toBeNull()
    expect(parseGoogleDrivePublicFolderLink('não é link')).toBeNull()
  })
})

describe('cliente da pasta pública', () => {
  it('lista páginas e subpastas encaminhando as chaves de recurso', async () => {
    const fake = fakeHttp((request) => {
      if (request.url.pathname.endsWith('/folder-root')) {
        return json(200, {
          id: 'folder-root',
          name: 'Comentários',
          mimeType: 'application/vnd.google-apps.folder',
          resourceKey: 'root-key',
        })
      }
      if (request.query('alt') === 'media') return { status: 200, body: encoder.encode('%PDF-1.7\nmock pdf') }
      if (request.query('pageToken') === 'page-2') {
        return json(200, {
          files: [{ id: 'second-pdf', name: 'Segundo.pdf', mimeType: 'application/pdf', size: 12 }],
        })
      }
      if (request.query('q')?.includes("'folder-nested'")) {
        return json(200, {
          files: [
            {
              id: 'nested-pdf',
              name: 'Subpasta.pdf',
              mimeType: 'application/pdf',
              size: '17',
              resourceKey: 'pdf-key',
            },
          ],
        })
      }
      return json(200, {
        nextPageToken: 'page-2',
        files: [
          {
            id: 'folder-nested',
            name: 'Subpasta',
            mimeType: 'application/vnd.google-apps.folder',
            resourceKey: 'nested-key',
          },
          {
            id: 'root-pdf',
            name: 'Primeiro.pdf',
            mimeType: 'application/pdf',
            size: '10',
            resourceKey: 'root-pdf-key',
          },
          {
            id: 'notes',
            name: 'Notas.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ],
      })
    })
    const client = new GoogleDrivePublicFolderClient({ apiKey: 'test-key-123', http: fake.http })
    const link = parseGoogleDrivePublicFolderLink(
      'https://drive.google.com/drive/folders/folder-root?resourcekey=link-root-key',
    )!

    const folder = await client.folder(link)
    const pdfs = await client.pdfFiles(folder, link.resourceKey, true)
    const nested = pdfs.find((item) => item.file.id === 'nested-pdf')!
    const bytes = await client.download(nested)

    expect(pdfs.map((item) => item.file.id).sort()).toEqual(['nested-pdf', 'root-pdf', 'second-pdf'])
    expect(pdfs.map((item) => item.file.name)).toEqual(['Primeiro.pdf', 'Segundo.pdf', 'Subpasta.pdf'])
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    const keysOf = (request: RecordedRequest) => request.headers.get('X-Goog-Drive-Resource-Keys')
    expect(keysOf(fake.requests[0]!)).toBe('folder-root/link-root-key')
    expect(fake.requests[0]!.query('fields')).toBe(
      'id,name,mimeType,webViewLink,size,md5Checksum,parents,resourceKey',
    )

    const rootPages = fake.requests.filter((request) => request.query('q')?.includes("'folder-root'"))
    expect(rootPages).toHaveLength(2)
    expect(rootPages[1]!.query('pageToken')).toBe('page-2')
    expect(rootPages.every((request) => keysOf(request) === 'folder-root/link-root-key')).toBe(true)
    expect(rootPages[0]!.query('q')).toBe("'folder-root' in parents and trashed = false")
    expect(rootPages[0]!.query('pageSize')).toBe('1000')
    expect(rootPages[0]!.query('supportsAllDrives')).toBe('true')
    expect(rootPages[0]!.query('includeItemsFromAllDrives')).toBe('true')

    const nestedListing = fake.requests.find((request) => request.query('q')?.includes("'folder-nested'"))!
    expect(keysOf(nestedListing)).toBe('folder-nested/nested-key,folder-root/link-root-key')
    const media = fake.requests.find((request) => request.query('alt') === 'media')!
    expect(keysOf(media)).toBe('folder-nested/nested-key,folder-root/link-root-key,nested-pdf/pdf-key')
    expect(media.query('key')).toBe('test-key-123')
    expect(media.headers.get('Accept')).toBe('application/pdf')
    expect(fake.requests.every((request) => request.query('key') === 'test-key-123')).toBe(true)
    expect(fake.log.lines.join('\n')).not.toContain('test-key-123')
    expect(fake.log.entries.map((entry) => entry.operation)).toContain('pasta pública · listagem')
  })

  it('não desce às subpastas quando não pedido e recusa links que não são pastas', async () => {
    const fake = fakeHttp((request) => {
      if (request.url.pathname.endsWith('/file-1'))
        return json(200, { id: 'file-1', name: 'A.pdf', mimeType: 'application/pdf' })
      return json(200, {
        files: [
          { id: 'sub', name: 'Sub', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'pdf-1', name: 'SEM-MIME.PDF' },
        ],
      })
    })
    const client = new GoogleDrivePublicFolderClient({ apiKey: 'key-abcdef', http: fake.http })

    const pdfs = await client.pdfFiles(
      { id: 'root', name: 'Raiz', mimeType: 'application/vnd.google-apps.folder' },
      undefined,
      false,
    )
    expect(pdfs.map((item) => item.file.id)).toEqual(['pdf-1'])
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.headers.has('X-Goog-Drive-Resource-Keys')).toBe(false)

    const error = await rejection(client.folder({ folderId: 'file-1' }))
    expect(error.code).toBe('invalidPublicDriveFolderLink')
  })

  it('confere tamanho, MD5 e assinatura do PDF baixado', async () => {
    const pdfData = encoder.encode('%PDF-1.7\nverified fixture')
    const checksum = md5(pdfData)
    const fake = fakeHttp(() => ({ status: 200, body: pdfData }))
    const client = new GoogleDrivePublicFolderClient({ apiKey: 'test-key', http: fake.http })
    const file = {
      id: 'integrity-pdf',
      name: 'Comentário.pdf',
      mimeType: 'application/pdf',
      size: pdfData.length,
      md5Checksum: checksum,
    }

    expect(await client.download({ file, parentResourceKeys: {} })).toEqual(pdfData)
    expect(
      await client.download({
        file: { ...file, md5Checksum: checksum.toUpperCase() },
        parentResourceKeys: {},
      }),
    ).toEqual(pdfData)

    for (const invalid of [
      { ...file, id: 'wrong-size', size: pdfData.length + 1 },
      { ...file, id: 'wrong-checksum', md5Checksum: '0'.repeat(32) },
    ]) {
      const error = await rejection(client.download({ file: invalid, parentResourceKeys: {} }))
      expect(error.code).toBe('driveImportIntegrityMismatch')
      expect(error.detail).toBe(file.name)
      expect(error.message).toBe(
        'O PDF Comentário.pdf não passou na verificação de integridade e não foi guardado.',
      )
    }

    fake.setHandler(() => ({ status: 200, body: encoder.encode('<html>login</html>') }))
    const invalidPDF = await rejection(
      client.download({ file: { id: 'html', name: 'Falso.pdf' }, parentResourceKeys: {} }),
    )
    expect(invalidPDF.code).toBe('driveImportInvalidPDF')
    expect(invalidPDF.message).toBe('O arquivo Falso.pdf não parece ser um PDF válido.')

    const requestsBefore = fake.requests.length
    const tooLarge = await rejection(
      client.download({
        file: { id: 'big', name: 'Grande.pdf', size: PUBLIC_DRIVE_MAXIMUM_PDF_SIZE + 1 },
        parentResourceKeys: {},
      }),
    )
    expect(tooLarge.code).toBe('driveImportFileTooLarge')
    expect(tooLarge.message).toBe('O PDF Grande.pdf excede o limite de 128 MB e foi ignorado.')
    expect(fake.requests).toHaveLength(requestsBefore)
  })

  it('limita os downloads simultâneos e entrega cada arquivo, inclusive as falhas', async () => {
    const client = new GoogleDrivePublicFolderClient({
      apiKey: 'test-key',
      http: fakeHttp(() => json(500, {})).http,
    })
    const files = Array.from({ length: 5 }, (_, index) => pdf(`pdf-${index}`, { size: 12 }))
    let active = 0
    let maximum = 0
    let completionsRunning = 0
    const outcomes: GoogleDrivePublicPDFDownloadResult[] = []

    await client.downloadConcurrently(
      files,
      2,
      async (outcome) => {
        completionsRunning += 1
        expect(completionsRunning).toBe(1)
        await new Promise((resolve) => setTimeout(resolve, 1))
        outcomes.push(outcome)
        completionsRunning -= 1
      },
      async (item) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, item.file.id === 'pdf-0' ? 30 : 5))
        active -= 1
        if (item.file.id === 'pdf-3') throw GoogleDriveError.invalidPDF(item.file.name)
        return encoder.encode('%PDF-1.7\nmock')
      },
    )

    expect(maximum).toBe(2)
    expect(outcomes).toHaveLength(files.length)
    expect(outcomes.map((outcome) => outcome.index).sort()).toEqual([0, 1, 2, 3, 4])
    expect(outcomes[0]!.index).not.toBe(0)
    const failed = outcomes.find((outcome) => outcome.index === 3)!
    expect(failed.data).toBeUndefined()
    expect(failed.errorMessage).toBe('O arquivo pdf-3.pdf não parece ser um PDF válido.')
    expect(outcomes.filter((outcome) => outcome.data).length).toBe(4)

    let calls = 0
    await client.downloadConcurrently([], 2, () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })

  it('distingue chave de API inválida de pasta sem acesso', async () => {
    const fake = fakeHttp(() =>
      json(403, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
    )
    const client = new GoogleDrivePublicFolderClient({ apiKey: 'invalid-key', http: fake.http })
    const link = parseGoogleDrivePublicFolderLink('https://drive.google.com/drive/folders/folder-root')!

    const keyError = await rejection(client.folder(link))
    expect(keyError.code).toBe('api')
    expect(keyError.status).toBe(403)
    expect(keyError.message).toContain('API key not valid')

    fake.setHandler(() => json(404, { error: { message: 'File not found' } }))
    const notFound = await rejection(client.folder(link))
    expect(notFound.code).toBe('publicDriveFolderIsNotAccessible')
    expect(notFound.message).toBe(
      'A pasta não está pública ou o link não permite acesso. Confira o compartilhamento “Qualquer pessoa com o link”.',
    )

    fake.setHandler(() =>
      json(403, { error: { message: 'The user does not have sufficient permissions for this file.' } }),
    )
    expect((await rejection(client.folder(link))).code).toBe('publicDriveFolderIsNotAccessible')

    fake.setHandler(() =>
      json(403, { error: { message: 'Google Drive API has not been used in project 123 before' } }),
    )
    expect((await rejection(client.folder(link))).code).toBe('api')

    fake.setHandler(() => json(500, 'oops'))
    expect((await rejection(client.folder(link))).detail).toBe('A API do Google Drive recusou a solicitação.')
  })

  it('recusa pastas com mais de 5.000 PDFs', async () => {
    let page = 0
    const fake = fakeHttp(() => {
      page += 1
      const files = Array.from({ length: 1000 }, (_, index) => ({
        id: `p${page}-${index}`,
        name: `${index}.pdf`,
      }))
      return json(200, { files, nextPageToken: page < 6 ? `page-${page + 1}` : undefined })
    })
    const client = new GoogleDrivePublicFolderClient({ apiKey: 'key-abcdef', http: fake.http })
    const error = await rejection(client.pdfFiles({ id: 'root', name: 'Raiz' }, undefined, false))
    expect(error.code).toBe('driveImportTooManyFiles')
    expect(error.message).toBe(
      'A pasta contém mais de 5.000 PDFs. Escolha uma pasta menor para importar com segurança.',
    )
  })

  it('monta o cabeçalho de chaves e os nomes locais estáveis', () => {
    expect(driveResourceKeysHeader({})).toBeUndefined()
    expect(driveResourceKeysHeader({ b: '2', a: '1' })).toBe('a/1,b/2')
    expect(publicDriveImportDirectory('folder-1/../x')).toEqual(['Library', 'Google Drive', 'folder-1x'])
    expect(publicDriveLocalFilename({ id: 'abc_1', name: 'Matthew Commentary.pdf' })).toBe(
      'Matthew Commentary [abc_1].pdf',
    )
    expect(publicDriveLocalFilename({ id: 'id2', name: 'Romanos: 5*1 (vol. 2).pdf' })).toBe(
      'Romanos_ 5_1 (vol. 2) [id2].pdf',
    )
    expect(publicDriveLocalFilename({ id: 'id3', name: 'pasta/Comentário' })).toBe('Comentário [id3].pdf')
    expect(publicDriveLocalFilename({ id: 'id4', name: '   .pdf' })).toBe('Comentario [id4].pdf')
  })
})

describe('importador da pasta pública', () => {
  it('baixa os PDFs para a biblioteca isolada e guarda a chave depois de validar a pasta', async () => {
    const pdfData = encoder.encode('%PDF-1.7\npublic folder fixture')
    const checksum = md5(pdfData)
    const fake = fakeHttp((request) => {
      if (request.url.pathname.endsWith('/folder-public')) {
        return json(200, {
          id: 'folder-public',
          name: 'Comentários públicos',
          mimeType: 'application/vnd.google-apps.folder',
          resourceKey: 'folder-key',
        })
      }
      if (request.query('alt') === 'media') return { status: 200, body: pdfData }
      if (request.query('q')?.includes("'folder-public'")) {
        return json(200, {
          files: [
            {
              id: 'commentary-pdf',
              name: 'Matthew Commentary.pdf',
              mimeType: 'application/pdf',
              size: String(pdfData.length),
              md5Checksum: checksum,
              resourceKey: 'pdf-key',
            },
          ],
        })
      }
      return json(404, { error: { message: 'Unexpected test request' } })
    })
    let releaseRead: (value: string | null) => void = () => {}
    const saved: string[] = []
    const sink = new MemorySink()
    const statuses: string[] = []
    const importer = new GoogleDrivePublicPDFImporter({
      http: fake.http,
      sink,
      keyStore: {
        read: () => new Promise((resolve) => (releaseRead = resolve)),
        save: async (key) => {
          saved.push(key)
        },
      },
      onChange: (state) => statuses.push(state.status),
    })
    const initialRead = importer.loadSavedKey()

    const result = await importer.importPDFs(
      'https://drive.google.com/drive/folders/folder-public?resourcekey=folder-key',
      '  test-api-key  ',
      false,
    )

    expect(result.folderName).toBe('Comentários públicos')
    expect(result.localPaths).toEqual([
      '/app-data/Library/Google Drive/folder-public/Matthew Commentary [commentary-pdf].pdf',
    ])
    expect(result.failures).toEqual([])
    expect(sink.files.get(result.localPaths[0]!)).toEqual(pdfData)
    expect(importer.state.status).toBe('1 PDF(s) baixado(s)')
    expect(importer.state.completedCount).toBe(1)
    expect(importer.state.totalCount).toBe(1)
    expect(importer.state.isImporting).toBe(false)
    expect(importer.state.savedAPIKeyExists).toBe(true)
    expect(saved).toEqual(['test-api-key'])
    expect(statuses).toContain('Verificando pasta pública…')
    expect(statuses).toContain('Baixando até 2 PDFs simultaneamente…')
    expect(statuses).toContain('Processados 1 de 1 PDFs')

    releaseRead(null)
    await initialRead
    expect(importer.state.isLoadingKey).toBe(false)
    expect(
      importer.state.savedAPIKeyExists,
      'A leitura inicial atrasada não pode apagar a chave salva pela importação.',
    ).toBe(true)
    expect(fake.requests).toHaveLength(3)
    expect(fake.requests.every((request) => request.query('key') === 'test-api-key')).toBe(true)
  })

  it('reutiliza a chave salva e continua quando um arquivo falha, mantendo a ordem', async () => {
    const good = encoder.encode('%PDF-1.4\nok')
    const fake = fakeHttp((request) => {
      if (request.url.pathname.endsWith('/folder-two')) {
        return json(200, { id: 'folder-two', name: 'Dois', mimeType: 'application/vnd.google-apps.folder' })
      }
      if (request.query('alt') === 'media') {
        return request.url.pathname.endsWith('/bad')
          ? { status: 200, body: encoder.encode('not a pdf') }
          : { status: 200, body: good }
      }
      return json(200, {
        files: [
          { id: 'c', name: 'C.pdf' },
          { id: 'bad', name: 'B.pdf' },
          { id: 'a', name: 'A.pdf' },
          { id: 'disk', name: 'D.pdf' },
        ],
      })
    })
    const sink = new MemorySink()
    sink.failOn = '[disk]'
    const importer = new GoogleDrivePublicPDFImporter({
      http: fake.http,
      sink,
      keyStore: { read: async () => 'saved-key-123', save: async () => expect.unreachable() },
    })

    const result = await importer.importPDFs('https://drive.google.com/drive/folders/folder-two', '', true)

    expect(result.localPaths.map((path) => path.split('/').pop())).toEqual(['A [a].pdf', 'C [c].pdf'])
    expect(result.failures).toEqual([
      'B.pdf: O arquivo B.pdf não parece ser um PDF válido.',
      'D.pdf: Disco cheio.',
    ])
    expect(importer.state.status).toBe('2 PDF(s) baixado(s) · 2 com erro')
    expect(fake.requests.every((request) => request.query('key') === 'saved-key-123')).toBe(true)
  })

  it('valida link, chave, pasta vazia e falha total', async () => {
    const fake = fakeHttp((request) => {
      if (request.url.pathname.endsWith('/folder-empty')) {
        return json(200, {
          id: 'folder-empty',
          name: 'Vazia',
          mimeType: 'application/vnd.google-apps.folder',
        })
      }
      if (request.url.pathname.endsWith('/folder-bad')) {
        return json(200, { id: 'folder-bad', name: 'Ruim', mimeType: 'application/vnd.google-apps.folder' })
      }
      if (request.query('alt') === 'media') return { status: 200, body: encoder.encode('nope') }
      if (request.query('q')?.includes("'folder-bad'"))
        return json(200, { files: [{ id: 'x', name: 'X.pdf' }] })
      return json(200, { files: [] })
    })
    const importer = new GoogleDrivePublicPDFImporter({
      http: fake.http,
      sink: new MemorySink(),
      keyStore: { read: async () => null, save: async () => {} },
    })

    expect((await rejection(importer.importPDFs('https://example.com/x', 'k', true))).code).toBe(
      'invalidPublicDriveFolderLink',
    )
    const missingKey = await rejection(
      importer.importPDFs('https://drive.google.com/drive/folders/folder-empty', ' ', true),
    )
    expect(missingKey.code).toBe('missingPublicDriveAPIKey')
    expect(fake.requests).toHaveLength(0)
    const empty = await rejection(
      importer.importPDFs('https://drive.google.com/drive/folders/folder-empty', 'key-1234', true),
    )
    expect(empty.message).toBe('Nenhum PDF foi encontrado nessa pasta pública.')
    const allFailed = await rejection(
      importer.importPDFs('https://drive.google.com/drive/folders/folder-bad', 'key-1234', true),
    )
    expect(allFailed.code).toBe('api')
    expect(allFailed.message).toBe(
      'Google Drive (HTTP 400): X.pdf: O arquivo X.pdf não parece ser um PDF válido.',
    )
    expect(importer.state.isImporting).toBe(false)
  })

  it('não permite duas importações ao mesmo tempo', async () => {
    let release: () => void = () => {}
    const fake = fakeHttp(
      () =>
        new Promise((resolve) => {
          release = () => resolve(json(404, {}))
        }),
    )
    const importer = new GoogleDrivePublicPDFImporter({
      http: fake.http,
      sink: new MemorySink(),
      keyStore: { read: async () => null, save: async () => {} },
    })
    const first = importer.importPDFs('https://drive.google.com/drive/folders/folder-one', 'key-1234', true)
    const second = await rejection(
      importer.importPDFs('https://drive.google.com/drive/folders/folder-one', 'key-1234', true),
    )
    expect(second.code).toBe('syncInProgress')
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    expect((await rejection(first)).code).toBe('publicDriveFolderIsNotAccessible')
  })
})
