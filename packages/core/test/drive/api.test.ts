import { describe, expect, it } from 'vitest'
import { GoogleDriveAPI, googleDocURL, parseGoogleDriveFile } from '../../src/drive/api'
import { GoogleDriveError } from '../../src/drive/errors'
import type { GoogleDocsContent } from '../../src/drive/docs-content'
import { docsDocument, fakeHttp, json } from './fake-fetch'
import type { FakeHandler } from './fake-fetch'

const ACCESS_TOKEN = 'test-access-token'

function apiWith(handler: FakeHandler) {
  const fake = fakeHttp(handler)
  const api = new GoogleDriveAPI({ http: fake.http, accessToken: async () => ACCESS_TOKEN })
  return { fake, api }
}

const localContent: GoogleDocsContent = { text: 'Texto local\n', styles: [], paragraphs: [] }

async function rejection(promise: Promise<unknown>): Promise<GoogleDriveError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(GoogleDriveError)
  return error as GoogleDriveError
}

describe('Google Drive e Docs com OAuth', () => {
  it('lê o documento extraindo o texto e enviando o token Bearer', async () => {
    const { fake, api } = apiWith(() =>
      json(200, {
        revisionId: 'rev-2',
        body: {
          content: [
            { startIndex: 0, endIndex: 1 },
            { startIndex: 1, endIndex: 7, paragraph: { elements: [{ textRun: { content: 'Ideias\n' } }] } },
          ],
        },
      }),
    )

    const document = await api.getDocument('doc-1')

    expect(document).toEqual({ revisionId: 'rev-2', text: 'Ideias\n', endIndex: 7 })
    const request = fake.requests[0]!
    expect(request.headers.get('Authorization')).toBe('Bearer test-access-token')
    expect(request.headers.get('Accept')).toBe('application/json')
    expect(request.url.host).toBe('docs.googleapis.com')
    expect(request.url.pathname).toBe('/v1/documents/doc-1')
    expect(fake.log.entries[0]?.integration).toBe('Google Drive')
    expect(fake.log.lines.join('\n')).not.toContain(ACCESS_TOKEN)
  })

  it('devolve a revisão produzida pela própria escrita', async () => {
    const { fake, api } = apiWith(() =>
      json(200, { documentId: 'doc-1', replies: [], writeControl: { requiredRevisionId: 'rev-3' } }),
    )

    const revision = await api.replaceDocument('doc-1', localContent, 9, 'rev-2')

    expect(revision).toBe('rev-3')
    const request = fake.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url.pathname).toBe('/v1/documents/doc-1:batchUpdate')
    expect(request.headers.get('Authorization')).toBe('Bearer test-access-token')
    expect(request.headers.get('Content-Type')).toBe('application/json')
    const body = request.json<{ requests: Record<string, unknown>[]; writeControl: unknown }>()
    expect(body.writeControl).toEqual({ requiredRevisionId: 'rev-2' })
    expect(body.requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 8 } } })
    expect(body.requests[1]).toEqual({ insertText: { location: { index: 1 }, text: 'Texto local\n' } })
  })

  it('recupera pela chave privada o Doc criado numa resposta ambígua, sem duplicar', async () => {
    let searchCount = 0
    let createCount = 0
    let remoteDocumentExists = false
    const { api } = apiWith((request) => {
      if (request.method === 'GET') {
        searchCount += 1
        const query = request.query('q') ?? ''
        expect(query).toContain("'folder-1' in parents")
        expect(query).toContain("appProperties has { key='pregarDraftKey' and value='draft-key-123' }")
        expect(query).toContain("mimeType = 'application/vnd.google-apps.document'")
        expect(request.query('spaces')).toBe('drive')
        const files = remoteDocumentExists
          ? [{ id: 'doc-created', name: 'Sermão', mimeType: 'application/vnd.google-apps.document' }]
          : []
        return json(200, { files })
      }
      createCount += 1
      const metadata = request.json<{
        appProperties: Record<string, string>
        parents: string[]
        mimeType: string
      }>()
      expect(metadata.appProperties.pregarDraftKey).toBe('draft-key-123')
      expect(metadata.parents).toEqual(['folder-1'])
      expect(metadata.mimeType).toBe('application/vnd.google-apps.document')
      remoteDocumentExists = true
      return json(503, { error: { message: 'Connection interrupted after creation.' } })
    })

    const failure = await rejection(api.findOrCreateSermonDocument('Sermão', 'folder-1', 'draft-key-123'))
    expect(failure.code).toBe('api')
    expect(failure.status).toBe(503)
    expect(failure.message).toBe('Google Drive (HTTP 503): Connection interrupted after creation.')

    const recovered = await api.findOrCreateSermonDocument('Sermão', 'folder-1', 'draft-key-123')

    expect(recovered.id).toBe('doc-created')
    expect(searchCount).toBe(2)
    expect(createCount).toBe(1)
  })

  it('transforma revisão inválida ou desatualizada em conflito sem segunda requisição', async () => {
    const { fake, api } = apiWith(() =>
      json(400, { error: { message: 'The revision ID is invalid or stale.' } }),
    )

    const error = await rejection(api.getDocument('doc-1'))

    expect(error.code).toBe('documentConflict')
    expect(error.message).toBe(
      'O Google Doc mudou fora do app desde a última sincronização. Sua cópia local foi preservada. Compare as versões antes de substituir a cópia do Drive.',
    )
    expect(fake.requests).toHaveLength(1)

    fake.setHandler(() => json(409, {}))
    expect((await rejection(api.replaceDocument('doc-1', localContent, 2, 'rev'))).code).toBe(
      'documentConflict',
    )
    fake.setHandler(() => json(403, { error: { message: 'The caller does not have permission' } }))
    const forbidden = await rejection(api.getDocument('doc-1'))
    expect(forbidden.code).toBe('api')
    expect(forbidden.message).toBe('Google Drive (HTTP 403): The caller does not have permission')
    fake.setHandler(() => json(500, 'Internal'))
    expect((await rejection(api.getDocument('doc-1'))).detail).toBe(
      'Confira a conexão e as APIs ativadas no Google Cloud.',
    )
  })

  it('bloqueia a sincronização antes de escrever quando o Doc foi editado fora do app', async () => {
    const { fake, api } = apiWith(() => docsDocument('remote-rev-3', 'Edição remota\n'))

    const error = await rejection(api.synchronizeDocument('doc-1', localContent, 'local-rev-2', false))

    expect(error.code).toBe('documentConflict')
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.method).toBe('GET')
    expect(fake.requests[0]!.url.host).toBe('docs.googleapis.com')
  })

  it('substitui com a revisão recém-lida quando ela confere ou com confirmação explícita', async () => {
    const { fake, api } = apiWith((request) =>
      request.method === 'GET'
        ? docsDocument('remote-rev-3', 'Edição remota\n')
        : json(200, { writeControl: { requiredRevisionId: 'rev-4' } }),
    )

    expect(await api.synchronizeDocument('doc-1', localContent, 'local-rev-2', true)).toBe('rev-4')
    const write = fake.requests[1]!.json<{
      writeControl: { requiredRevisionId: string }
      requests: unknown[]
    }>()
    expect(write.writeControl.requiredRevisionId).toBe('remote-rev-3')
    expect(write.requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 14 } } })

    expect(await api.synchronizeDocument('doc-1', localContent, 'remote-rev-3', false)).toBe('rev-4')
    expect(await api.synchronizeDocument('doc-1', localContent, null, false)).toBe('rev-4')
    expect(fake.requests).toHaveLength(6)
  })

  it('busca e cria a pasta escapando o nome', async () => {
    const { fake, api } = apiWith((request) =>
      request.method === 'GET'
        ? json(200, { files: [] })
        : json(200, { id: 'folder-9', name: "Sermões d'O", mimeType: 'application/vnd.google-apps.folder' }),
    )

    expect(await api.searchFolder("Sermões d'O")).toBeNull()
    const folder = await api.createFolder("Sermões d'O")

    expect(fake.requests[0]!.query('q')).toBe(
      "name = 'Sermões d\\'O' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    )
    expect(fake.requests[0]!.query('fields')).toBe('files(id,name,mimeType,webViewLink)')
    expect(fake.requests[1]!.query('fields')).toBe('id,name,mimeType,webViewLink')
    expect(fake.requests[1]!.json()).toEqual({
      name: "Sermões d'O",
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(folder.id).toBe('folder-9')
  })

  it('cria o documento de ideias com a sua própria chave privada', async () => {
    const { fake, api } = apiWith((request) =>
      request.method === 'GET'
        ? json(200, { files: [] })
        : json(200, { id: 'ideas-doc', name: 'Ideias de sermões', webViewLink: 'https://docs.google.com/x' }),
    )

    const file = await api.findOrCreateIdeasDocument('Ideias de sermões', 'folder-1', 'ideas-key')

    expect(file).toEqual({
      id: 'ideas-doc',
      name: 'Ideias de sermões',
      webViewLink: 'https://docs.google.com/x',
    })
    expect(fake.requests[0]!.query('q')).toContain(
      "appProperties has { key='pregarIdeasKey' and value='ideas-key' }",
    )
    expect(fake.requests[1]!.json<{ appProperties: unknown }>().appProperties).toEqual({
      pregarIdeasKey: 'ideas-key',
    })
  })

  it('rejeita respostas fora do formato esperado', async () => {
    const { fake, api } = apiWith(() => json(200, { title: 'sem revisão' }))
    expect((await rejection(api.getDocument('doc-1'))).code).toBe('invalidOAuthResponse')
    fake.setHandler(() => json(200, { replies: [] }))
    expect((await rejection(api.replaceDocument('doc-1', localContent, 2, 'rev'))).code).toBe(
      'invalidOAuthResponse',
    )
    fake.setHandler(() => json(200, { id: 'sem-nome' }))
    expect((await rejection(api.createFolder('Sermões'))).code).toBe('invalidOAuthResponse')
  })

  it('lê metadados de arquivos com tamanho em texto ou número', () => {
    expect(parseGoogleDriveFile({ id: 'a', name: 'A.pdf', size: '17', parents: ['p'] })).toEqual({
      id: 'a',
      name: 'A.pdf',
      size: 17,
      parents: ['p'],
    })
    expect(parseGoogleDriveFile({ id: 'b', name: 'B.pdf', size: 12, md5Checksum: 'abc' })?.size).toBe(12)
    expect(parseGoogleDriveFile({ id: 'c', name: 'C.pdf', size: 'x' })?.size).toBeUndefined()
    expect(parseGoogleDriveFile({ id: 'd' })).toBeNull()
    expect(googleDocURL('doc-1')).toBe('https://docs.google.com/document/d/doc-1/edit')
  })
})
