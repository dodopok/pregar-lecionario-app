import { describe, expect, it } from 'vitest'
import type { RichDocument } from '../../src/document/model'
import { GoogleDriveAPI } from '../../src/drive/api'
import { GoogleDriveError } from '../../src/drive/errors'
import type { LoopbackReceiver, LoopbackResponse } from '../../src/drive/oauth'
import {
  GoogleDriveStore,
  DRIVE_IDEAS_DOCUMENT_TITLE,
  driveSermonContentHash,
  driveSermonDocumentTitle,
} from '../../src/drive/store'
import type {
  GoogleDriveRefreshTokenStore,
  GoogleDriveSermonDraft,
  GoogleDriveSermonLink,
  GoogleDriveSettingKey,
  GoogleDriveSettings,
  GoogleDriveStoreOptions,
} from '../../src/drive/store'
import { docsDocument, fakeHttp, json } from './fake-fetch'
import type { FakeHandler, FakeHttp } from './fake-fetch'

const clientId = 'desktop-client.apps.googleusercontent.com'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

class MemorySettings implements GoogleDriveSettings {
  values = new Map<GoogleDriveSettingKey, string>()

  async get(key: GoogleDriveSettingKey): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async set(key: GoogleDriveSettingKey, value: string | null): Promise<void> {
    if (value === null) this.values.delete(key)
    else this.values.set(key, value)
  }
}

class MemoryTokens implements GoogleDriveRefreshTokenStore {
  deleted = 0
  constructor(public token: string | null = null) {}

  async read(): Promise<string | null> {
    return this.token
  }

  async save(token: string): Promise<void> {
    this.token = token
  }

  async delete(): Promise<void> {
    this.deleted += 1
    this.token = null
  }
}

function documentWith(text: string): RichDocument {
  return { paragraphs: [{ headingLevel: 0, runs: [{ text }] }], footnotes: [] }
}

function draftWith(drive: GoogleDriveSermonLink, text = 'Texto local'): GoogleDriveSermonDraft {
  return {
    title: 'Fé que espera',
    mainReadingReference: 'Romanos 5:1-5',
    liturgicalDate: '2026-11-01',
    document: documentWith(text),
    drive,
  }
}

async function rejection(promise: Promise<unknown>): Promise<GoogleDriveError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(GoogleDriveError)
  return error as GoogleDriveError
}

interface Harness {
  fake: FakeHttp
  store: GoogleDriveStore
  settings: MemorySettings
  writes: GoogleDriveSermonLink[]
  writeLink: (link: GoogleDriveSermonLink) => Promise<void>
}

const fixedNow = new Date('2026-11-01T12:00:00Z')

/** Store ligado a um cliente da API com token fixo, como o `apiOverride` dos testes Swift. */
async function connectedStore(
  handler: FakeHandler,
  options: Partial<GoogleDriveStoreOptions> = {},
): Promise<Harness> {
  const fake = fakeHttp(handler)
  const settings = new MemorySettings()
  const api = new GoogleDriveAPI({ http: fake.http, accessToken: async () => 'test-access-token' })
  let keys = 0
  const store = new GoogleDriveStore({
    http: fake.http,
    client: { clientId },
    settings,
    refreshTokens: new MemoryTokens(),
    api,
    now: () => fixedNow,
    makeKey: () => `key-${++keys}`,
    ...options,
  })
  await store.load()
  const writes: GoogleDriveSermonLink[] = []
  return {
    fake,
    store,
    settings,
    writes,
    writeLink: async (link) => {
      writes.push({ ...link })
    },
  }
}

describe('documento de ideias', () => {
  it('recupera pela chave privada estável a criação com resposta ambígua', async () => {
    let remoteDocumentExists = false
    let searchCount = 0
    let createCount = 0
    let documentReadCount = 0
    let recordedKey: string | undefined
    const shared: { settings?: MemorySettings } = {}

    const harness = await connectedStore((request) => {
      if (request.url.host === 'www.googleapis.com' && request.method === 'GET') {
        searchCount += 1
        const query = request.query('q') ?? ''
        expect(query).toContain("'ideas-folder' in parents")
        expect(query).toContain("appProperties has { key='pregarIdeasKey' and value='")
        const key = query.split("value='").pop()?.split("'")[0]
        expect(key).toBeDefined()
        expect(shared.settings?.values.get('drive.ideasDocumentKey')).toBe(key)
        if (recordedKey) expect(key).toBe(recordedKey)
        else recordedKey = key
        const files = remoteDocumentExists
          ? [{ id: 'ideas-doc', name: 'Ideias de sermões', mimeType: 'application/vnd.google-apps.document' }]
          : []
        return json(200, { files })
      }
      if (request.url.host === 'www.googleapis.com' && request.method === 'POST') {
        createCount += 1
        const metadata = request.json<{
          appProperties: Record<string, string>
          parents: string[]
          name: string
        }>()
        expect(metadata.appProperties.pregarIdeasKey).toBe(recordedKey)
        expect(metadata.parents).toEqual(['ideas-folder'])
        expect(metadata.name).toBe(DRIVE_IDEAS_DOCUMENT_TITLE)
        remoteDocumentExists = true
        return json(503, { error: { message: 'Connection interrupted after creation.' } })
      }
      if (request.url.host === 'docs.googleapis.com' && request.method === 'GET') {
        documentReadCount += 1
        return docsDocument('ideas-rev-1', 'Ideia do iPhone\n')
      }
      expect.unreachable(`Requisição inesperada: ${request.url}`)
    })
    const settings = harness.settings
    shared.settings = settings
    settings.values.set('drive.sermonFolderID', 'ideas-folder')
    const { store } = harness

    const failure = await rejection(store.ensureIdeasDocument())
    expect(failure.code).toBe('api')
    expect(failure.status).toBe(503)

    expect(store.state.ideasDocumentId).toBeNull()
    expect(settings.values.get('drive.ideasDocumentKey')).toBeDefined()
    await store.ensureIdeasDocument()

    expect(store.state.ideasDocumentId).toBe('ideas-doc')
    expect(settings.values.get('drive.ideasDocumentID')).toBe('ideas-doc')
    expect(store.state.ideasText).toBe('Ideia do iPhone\n')
    expect(store.state.ideasUpdatedAt).toEqual(fixedNow)
    expect(settings.values.get('drive.ideasText')).toBe('Ideia do iPhone\n')
    expect(settings.values.get('drive.ideasUpdatedAt')).toBe(fixedNow.toISOString())
    expect(searchCount).toBe(2)
    expect(createCount).toBe(1)
    expect(documentReadCount).toBe(1)

    await store.refreshIdeas()
    expect(documentReadCount).toBe(2)
  })

  it('restaura as ideias guardadas ao carregar', async () => {
    const settings = new MemorySettings()
    settings.values.set('drive.ideasDocumentID', 'ideas-9')
    settings.values.set('drive.ideasText', 'Guardado')
    settings.values.set('drive.ideasUpdatedAt', '2026-10-30T08:00:00.000Z')
    const store = new GoogleDriveStore({
      http: fakeHttp(() => json(500, {})).http,
      client: { clientId },
      settings,
      refreshTokens: new MemoryTokens(null),
    })
    expect(store.state.isLoading).toBe(true)
    await store.load()
    expect(store.state).toMatchObject({
      isLoading: false,
      isConnected: false,
      ideasDocumentId: 'ideas-9',
      ideasText: 'Guardado',
      ideasUpdatedAt: new Date('2026-10-30T08:00:00.000Z'),
    })
  })
})

describe('sincronização do sermão com o Google Doc', () => {
  it('vincula explicitamente gravando a chave privada antes da rede e o ID antes do texto', async () => {
    const shared: { harness?: Harness } = {}
    const harnessReady = connectedStore((request) => {
      const writes = shared.harness!.writes
      expect(writes[0]?.draftKey, 'a chave precisa estar gravada antes da primeira chamada de rede').toBe(
        'key-1',
      )
      if (request.url.host === 'www.googleapis.com' && request.method === 'GET') {
        const query = request.query('q') ?? ''
        if (query.includes(FOLDER_MIME)) return json(200, { files: [] })
        expect(query).toContain("appProperties has { key='pregarDraftKey' and value='key-1' }")
        return json(200, { files: [] })
      }
      if (request.url.host === 'www.googleapis.com' && request.method === 'POST') {
        const metadata = request.json<{ mimeType: string; name: string; parents?: string[] }>()
        if (metadata.mimeType === FOLDER_MIME) {
          expect(metadata.name).toBe('Sermões')
          return json(200, { id: 'folder-1', name: 'Sermões', mimeType: FOLDER_MIME })
        }
        expect(metadata.name).toBe('2026-11-01 - Fé que espera')
        expect(metadata.parents).toEqual(['folder-1'])
        return json(200, { id: 'doc-1', name: metadata.name })
      }
      if (request.method === 'GET') return docsDocument('rev-1', '\n')
      expect(writes[writes.length - 1]?.documentId, 'o ID remoto é gravado antes do texto').toBe('doc-1')
      const body = request.json<{ writeControl: { requiredRevisionId: string } }>()
      expect(body.writeControl.requiredRevisionId).toBe('rev-1')
      return json(200, { writeControl: { requiredRevisionId: 'rev-2' } })
    })
    const harness = await harnessReady
    shared.harness = harness
    const { store, settings, writes, writeLink, fake } = harness
    const draft = draftWith({})

    const link = await store.saveSermon(draft, writeLink)

    expect(link).toEqual({
      draftKey: 'key-1',
      documentId: 'doc-1',
      revisionId: 'rev-2',
      syncedAt: fixedNow,
      syncedContentHash: await driveSermonContentHash(draft.document),
      syncError: null,
    })
    expect(writes).toHaveLength(3)
    expect(writes[writes.length - 1]).toEqual(link)
    expect(settings.values.get('drive.sermonFolderID')).toBe('folder-1')
    expect(fake.requests.map((request) => `${request.method} ${request.url.host}`)).toEqual([
      'GET www.googleapis.com',
      'POST www.googleapis.com',
      'GET www.googleapis.com',
      'POST www.googleapis.com',
      'GET docs.googleapis.com',
      'POST docs.googleapis.com',
    ])
    expect(store.state.isSaving).toBe(false)
    expect(await store.hasUnsyncedChanges({ ...draft, drive: link })).toBe(false)
    expect(
      await store.hasUnsyncedChanges({ ...draft, drive: link, document: documentWith('Texto novo') }),
    ).toBe(true)
    expect(await store.hasUnsyncedChanges(draftWith({}, 'Texto novo'))).toBe(false)
    expect(store.documentURL('doc-1')).toBe('https://docs.google.com/document/d/doc-1/edit')
  })

  it('recupera o Doc de uma criação ambígua pela chave já gravada, sem duplicar', async () => {
    let created = 0
    let exists = false
    const harness = await connectedStore((request) => {
      if (request.url.host === 'www.googleapis.com' && request.method === 'GET') {
        return json(200, { files: exists ? [{ id: 'doc-created', name: 'Sermão' }] : [] })
      }
      if (request.url.host === 'www.googleapis.com') {
        created += 1
        exists = true
        return json(503, { error: { message: 'Connection interrupted after creation.' } })
      }
      if (request.method === 'GET') return docsDocument('rev-1', '\n')
      return json(200, { writeControl: { requiredRevisionId: 'rev-2' } })
    })
    harness.settings.values.set('drive.sermonFolderID', 'folder-1')
    const { store, writes, writeLink } = harness

    const failure = await rejection(store.saveSermon(draftWith({}), writeLink))
    expect(failure.status).toBe(503)
    const afterFailure = writes[writes.length - 1]!
    expect(afterFailure.draftKey).toBe('key-1')
    expect(afterFailure.documentId).toBeUndefined()
    expect(afterFailure.syncError).toBe('Google Drive (HTTP 503): Connection interrupted after creation.')
    expect(store.state.errorMessage).toBe(afterFailure.syncError)

    const link = await store.saveSermon(draftWith(afterFailure), writeLink)

    expect(link.documentId).toBe('doc-created')
    expect(link.draftKey).toBe('key-1')
    expect(link.syncError).toBeNull()
    expect(created).toBe(1)
    expect(store.state.errorMessage).toBeNull()
  })

  it('preserva a cópia local quando o Doc mudou fora do app e só substitui com confirmação', async () => {
    const harness = await connectedStore((request) =>
      request.method === 'GET'
        ? docsDocument('remote-rev-3', 'Edição remota\n')
        : json(200, { writeControl: { requiredRevisionId: 'rev-4' } }),
    )
    const { store, writes, writeLink, fake } = harness
    const draft = draftWith({
      draftKey: 'k',
      documentId: 'doc-1',
      revisionId: 'local-rev-2',
      syncedContentHash: 'old',
    })

    const conflict = await rejection(store.saveSermon(draft, writeLink))

    expect(conflict.code).toBe('documentConflict')
    expect(fake.requests).toHaveLength(1)
    expect(writes[writes.length - 1]?.syncError).toBe(conflict.message)
    expect(writes[writes.length - 1]?.revisionId).toBe('local-rev-2')
    expect(await rejection(store.syncIfNeeded(draft, writeLink))).toMatchObject({ code: 'documentConflict' })
    expect(fake.requests).toHaveLength(2)

    const link = await store.saveSermon(draft, writeLink, { overwriteRemote: true })

    expect(link.revisionId).toBe('rev-4')
    expect(link.syncError).toBeNull()
    const write = fake.requests[fake.requests.length - 1]!
    expect(write.method).toBe('POST')
    expect(
      write.json<{ writeControl: { requiredRevisionId: string } }>().writeControl.requiredRevisionId,
    ).toBe('remote-rev-3')
  })

  it('sincroniza automaticamente só depois do vínculo explícito e quando o conteúdo mudou', async () => {
    const harness = await connectedStore((request) =>
      request.method === 'GET'
        ? docsDocument('rev-5', 'Texto\n')
        : json(200, { writeControl: { requiredRevisionId: 'rev-6' } }),
    )
    const { store, writeLink, fake } = harness

    expect(await store.syncIfNeeded(draftWith({}), writeLink)).toBe('notLinked')
    const unchangedHash = await driveSermonContentHash(documentWith('Texto local'))
    const linked = {
      draftKey: 'k',
      documentId: 'doc-1',
      revisionId: 'rev-5',
      syncedContentHash: unchangedHash,
    }
    expect(await store.syncIfNeeded(draftWith(linked), writeLink)).toBe('unchanged')
    expect(fake.requests).toHaveLength(0)

    expect(await store.syncIfNeeded(draftWith(linked, 'Texto editado'), writeLink)).toBe('synced')
    expect(fake.requests.map((request) => request.method)).toEqual(['GET', 'POST'])
    expect(harness.writes[harness.writes.length - 1]).toMatchObject({
      revisionId: 'rev-6',
      syncedContentHash: await driveSermonContentHash(documentWith('Texto editado')),
    })
  })

  it('recusa manuscrito vazio, envio sem conexão e envios simultâneos', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const harness = await connectedStore(async (request) => {
      await gate
      return request.method === 'GET'
        ? docsDocument('rev-1', '\n')
        : json(200, { writeControl: { requiredRevisionId: 'rev-2' } })
    })
    const { store, writeLink } = harness
    const linked = { documentId: 'doc-1', revisionId: 'rev-1' }

    const empty = await rejection(store.saveSermon(draftWith(linked, '   '), writeLink))
    expect(empty.message).toBe('Escreva algum texto antes de salvar o sermão no Google Drive.')

    const first = store.saveSermon(draftWith(linked), writeLink)
    expect(store.state.isSaving).toBe(true)
    const second = await rejection(store.saveSermon(draftWith(linked), writeLink))
    expect(second.message).toBe('A sincronização anterior ainda está em andamento.')
    expect(await store.syncIfNeeded(draftWith(linked, 'outro'), writeLink)).toBe('busy')
    open()
    expect((await first).revisionId).toBe('rev-2')
    expect(store.state.isSaving).toBe(false)

    const offline = new GoogleDriveStore({
      http: harness.fake.http,
      client: { clientId },
      settings: new MemorySettings(),
      refreshTokens: new MemoryTokens(null),
    })
    await offline.load()
    const notConnected = await rejection(offline.saveSermon(draftWith({}), writeLink))
    expect(notConnected.message).toBe('Conecte o Google Drive pela Mesa e tente novamente.')
    expect(await offline.syncIfNeeded(draftWith(linked, 'x'), writeLink)).toBe('notConnected')
  })

  it('nomeia o Doc pela data e pelo título, ou pela leitura principal', () => {
    expect(driveSermonDocumentTitle({ title: 'Fé', liturgicalDate: '2026-11-01' })).toBe('2026-11-01 - Fé')
    expect(
      driveSermonDocumentTitle({
        title: '  ',
        mainReadingReference: 'Lucas 18',
        liturgicalDate: '2026-11-08',
      }),
    ).toBe('2026-11-08 - Lucas 18')
    expect(driveSermonDocumentTitle({ title: '', liturgicalDate: new Date(2026, 10, 15) })).toBe(
      '2026-11-15 - Sermão',
    )
  })
})

describe('conexão e tokens', () => {
  function tokenHarness(tokens: MemoryTokens) {
    let now = new Date('2026-11-01T12:00:00Z')
    let tokenRequests = 0
    let tokenResponse = () => json(200, { access_token: `ya29.access-${tokenRequests}`, expires_in: 3600 })
    const fake = fakeHttp((request) => {
      if (request.url.host === 'oauth2.googleapis.com') {
        tokenRequests += 1
        return tokenResponse()
      }
      return docsDocument('rev-1', `Lido com ${request.headers.get('Authorization')}\n`)
    })
    const settings = new MemorySettings()
    settings.values.set('drive.ideasDocumentID', 'ideas-1')
    const store = new GoogleDriveStore({
      http: fake.http,
      client: { clientId, clientSecret: 'desktop-secret' },
      settings,
      refreshTokens: tokens,
      now: () => now,
    })
    return {
      fake,
      store,
      advance(ms: number) {
        now = new Date(now.getTime() + ms)
      },
      get tokenRequests() {
        return tokenRequests
      },
      setTokenResponse(next: typeof tokenResponse) {
        tokenResponse = next
      },
    }
  }

  it('renova o access token só quando vence e desconecta quando o refresh token é recusado', async () => {
    const tokens = new MemoryTokens('1//refresh-token-123456')
    const harness = tokenHarness(tokens)
    const { store } = harness
    await store.load()
    expect(store.state.isConnected).toBe(true)

    await store.refreshIdeas()
    await store.refreshIdeas()
    expect(harness.tokenRequests).toBe(1)
    expect(store.state.ideasText).toBe('Lido com Bearer ya29.access-1\n')
    const form = harness.fake.requests[0]!.form()
    expect(form.get('refresh_token')).toBe('1//refresh-token-123456')
    expect(form.get('client_secret')).toBe('desktop-secret')

    harness.advance(3_541_000)
    await store.refreshIdeas()
    expect(harness.tokenRequests).toBe(2)
    expect(store.state.ideasText).toBe('Lido com Bearer ya29.access-2\n')

    harness.advance(3_600_000)
    harness.setTokenResponse(() =>
      json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }),
    )
    const rejected = await rejection(store.refreshIdeas())
    expect(rejected.message).toBe('Google Drive (HTTP 400): Token has been expired or revoked.')
    expect(tokens.deleted).toBe(1)
    expect(tokens.token).toBeNull()
    expect(store.state.isConnected).toBe(false)
    expect((await rejection(store.accessToken())).code).toBe('notConnected')
    expect(harness.fake.log.lines.join('\n')).not.toContain('refresh-token-123456')
  })

  it('conecta pelo navegador na primeira vez e guarda o refresh token', async () => {
    const tokens = new MemoryTokens(null)
    let handler: ((target: string) => LoopbackResponse) | undefined
    const receiver: LoopbackReceiver = {
      start: async (onRequest) => {
        handler = onRequest
        return 50111
      },
      stop: () => {},
    }
    const fake = fakeHttp(() =>
      json(200, { access_token: 'ya29.first', refresh_token: '1//first-refresh', expires_in: 3600 }),
    )
    const store = new GoogleDriveStore({
      http: fake.http,
      client: { clientId: `  ${clientId}  ` },
      settings: new MemorySettings(),
      refreshTokens: tokens,
      authorization: {
        receiver: () => receiver,
        openBrowser: (url) => {
          const state = new URL(url).searchParams.get('state')!
          setTimeout(() => handler!(`/?state=${state}&code=granted`), 0)
          return true
        },
      },
    })
    await store.load()
    expect(store.state.isConnected).toBe(false)

    await store.connect()

    expect(store.state).toMatchObject({ isConnected: true, isConnecting: false, errorMessage: null })
    expect(tokens.token).toBe('1//first-refresh')
    expect(fake.requests[0]!.form().get('redirect_uri')).toBe('http://127.0.0.1:50111')
    expect(await store.accessToken()).toBe('ya29.first')
    expect(fake.requests).toHaveLength(1)

    await store.disconnect()
    expect(store.state.isConnected).toBe(false)
    expect(tokens.token).toBeNull()
  })

  it('informa Client ID ausente e resposta sem refresh token', async () => {
    const missing = new GoogleDriveStore({
      http: fakeHttp(() => json(500, {})).http,
      client: { clientId: '  ' },
      settings: new MemorySettings(),
      refreshTokens: new MemoryTokens(null),
    })
    await missing.connect()
    expect(missing.state.errorMessage).toBe('Informe o OAuth Client ID na conexão do Google Drive.')

    let handler: ((target: string) => LoopbackResponse) | undefined
    const tokens = new MemoryTokens(null)
    const store = new GoogleDriveStore({
      http: fakeHttp(() => json(200, { access_token: 'ya29.only-access', expires_in: 3600 })).http,
      client: { clientId },
      settings: new MemorySettings(),
      refreshTokens: tokens,
      authorization: {
        receiver: () => ({
          start: async (onRequest) => {
            handler = onRequest
            return 50112
          },
          stop: () => {},
        }),
        openBrowser: (url) => {
          setTimeout(() => handler!(`/?state=${new URL(url).searchParams.get('state')}&code=c`), 0)
        },
      },
    })
    await store.connect()
    expect(store.state.isConnected).toBe(false)
    expect(store.state.errorMessage).toBe('O Google não concluiu a autorização. Tente conectar novamente.')
    expect(tokens.token).toBeNull()
  })
})
