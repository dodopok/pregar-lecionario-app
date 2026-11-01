import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/util/hash'
import {
  BackupError,
  MemoryBackupFileSystem,
  backupFolderName,
  createBackup,
  detectBackupFormat,
  discardInstalledAssets,
  installBackupAssets,
  isSafeRelativePath,
  normalizeSourcePath,
  planRestore,
  scopeFileSystem,
  validateBackup,
} from '../../src/backup'
import type { BackupData, BackupErrorCode, BackupFileSystem, PdfSourceReader } from '../../src/backup'
import { createRevision, createRevisionSnapshot } from '../../src/history'
import { json, text } from './helpers'

const SOURCE = '/Users/pregador/Documentos'
const PDF_PATH = `${SOURCE}/Comentario.pdf`
const CLOSED_PDF_PATH = `${SOURCE}/ApenasNaAbaFechada.pdf`
const PDF_DATA = text('%PDF-1.7\nbackup fixture\n')
const CLOSED_PDF_DATA = text('%PDF-1.7\nclosed-only backup fixture\n')
const CREATED_AT = new Date(2026, 10, 1, 14, 5, 9)

/** Mesmos dados sintéticos do teste Swift de ciclo completo. */
function sampleData(): BackupData {
  const tabID = 'C0FFEE00-0000-4000-8000-000000000001'
  const position = { page: 1, x: 20, y: 340, scale: 1.6, autoScales: false }
  const revision = createRevision({
    id: 'rev-1',
    version: 1,
    createdAt: '2026-10-03T12:00:00.000Z',
    summary: 'Edição salva',
    snapshot: createRevisionSnapshot({
      title: 'Romanos 13:8-14',
      content: { format: 'tiptap-json', data: '{"type":"doc"}' },
      plainText: 'Sermão de teste',
    }),
  })
  return {
    sermons: [
      {
        dateKey: '2026-10-04',
        title: 'Romanos 13:8-14',
        content: { format: 'tiptap-json', data: '{"type":"doc","content":[{"type":"paragraph"}]}' },
        plainText: 'Sermão de teste',
        liturgicalOccasion: 'Próprio 22 A',
        mainReadingReference: 'Romanos 13:8-14',
        mainReadingSlot: 'second_reading',
        tabletPdfPath: PDF_PATH,
        tabletPdfUpdatedAt: new Date(1_790_493_600_000).toISOString(),
        googleDriveDocumentId: 'documento-vinculado',
        googleDriveSyncedContentHash: 'hash-antigo',
        modifiedAt: '2026-10-03T12:00:00.000Z',
        customField: { kept: true },
      },
    ],
    history: [{ dateKey: '2026-10-04', revisions: [revision] }],
    libraryRecords: [
      {
        id: 'commentary-1',
        title: 'Comentário de teste',
        // O mesmo PDF citado por outro caminho é guardado uma vez.
        path: `${SOURCE}/./sub/../Comentario.pdf`,
        pageCount: 1,
        author: 'Autora de teste',
        ocrTextByPage: { '1': 'Romans 13:8-14\nCommentary text' },
      },
    ],
    readerArchive: {
      tabs: [
        {
          id: tabID,
          title: 'Comentário de teste',
          kind: 'pdf',
          location: PDF_PATH,
          physicalPage: 1,
          reference: 'Romanos 13:8-14',
          sermonDateKey: '2026-10-04',
        },
        {
          id: 'web-1',
          title: 'Working Preacher',
          kind: 'web',
          location: 'https://www.workingpreacher.org/x',
        },
      ],
      selectedID: tabID,
      activeSermonDateKey: '2026-10-04',
      selectedBySermon: { '2026-10-04': tabID },
      closedTabs: [
        {
          id: 'closed-1',
          title: 'Aba fechada',
          kind: 'pdf',
          location: CLOSED_PDF_PATH,
          pdfPosition: position,
        },
        { id: 'closed-2', title: 'Aba fechada sem arquivo', kind: 'pdf', location: `${SOURCE}/apagado.pdf` },
      ],
    },
    sectionLinks: {
      [`${PDF_PATH}|Romanos 13:8-14`]: 1,
      [`${SOURCE}/removido.pdf|Atos 2:1-21`]: 8,
    },
    preferences: {
      'api.bible': 'naa',
      'ai.reviewProvider': 'openai',
      'drive.fontSize': 14,
      'drive.oauthClientID': 'client-id.apps.googleusercontent.com',
      'api.secret': 'api-secret-must-stay-local',
      'drive.accessToken': 'oauth-token-must-stay-local',
      'ai.openai.apiKey': 'provider-key-must-stay-local',
    },
    favoriteSources: {
      sites: [{ name: 'Working Preacher', url: 'https://www.workingpreacher.org' }],
      authors: [],
    },
    reviewReports: { '2026-10-04': [{ id: 'report-1', findings: [] }] },
  }
}

const sourceFiles = new Map<string, Uint8Array>([
  [PDF_PATH, PDF_DATA],
  [CLOSED_PDF_PATH, CLOSED_PDF_DATA],
])

const readPdf: PdfSourceReader = async (path) => sourceFiles.get(normalizeSourcePath(path)) ?? null

async function makeBackup(data: BackupData = sampleData()) {
  const disk = new MemoryBackupFileSystem()
  await disk.mkdir('exports')
  const target = scopeFileSystem(disk, 'exports')
  const created = await createBackup({ target, data, readPdf, appVersion: '0.1.0', now: () => CREATED_AT })
  return { disk, target, created, pkg: scopeFileSystem(target, created.folderName) }
}

async function expectBackupError(promise: Promise<unknown>, code: BackupErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(BackupError)
  expect((error as BackupError).code).toBe(code)
}

async function rewriteManifest(pkg: BackupFileSystem, change: (manifest: Record<string, unknown>) => void) {
  const manifest = JSON.parse(new TextDecoder().decode(await pkg.readFile('Manifest.json')))
  change(manifest)
  await pkg.writeFile('Manifest.json', json(manifest))
}

describe('backup: criação e restauração', () => {
  it('restaura sermão, histórico, Biblioteca, Leitor e preferências seguras', async () => {
    const { disk, created, pkg } = await makeBackup()

    expect(created.folderName).toBe('Pregar Backup 2026-11-01 14.05.09')
    expect(disk.files().some((path) => path.includes('.pregar-backup-'))).toBe(false)

    const contents = await validateBackup(pkg)
    expect(contents.manifest.formatVersion).toBe(2)
    expect(contents.manifest.appVersion).toBe('0.1.0')
    expect(contents.manifest.counts).toEqual({
      sermons: 1,
      historyFiles: 1,
      revisions: 1,
      libraryRecords: 1,
      assets: 2,
      reviewReports: 1,
    })
    expect(contents.assetPaths).toEqual(
      [`Files/${await sha256Hex(PDF_DATA)}.pdf`, `Files/${await sha256Hex(CLOSED_PDF_DATA)}.pdf`].sort(),
    )
    expect(Object.keys(contents.sectionLinks)).toHaveLength(1)
    expect(contents.sermons[0]?.tabletPdfPath).toMatch(/^Files\//)
    expect(contents.sermons[0]?.customField).toEqual({ kept: true })
    expect(contents.libraryRecords[0]?.path).toBe(contents.sermons[0]?.tabletPdfPath)
    expect(contents.readerArchive.tabs[0]?.location).toMatch(/^Files\//)
    expect(contents.readerArchive.tabs[1]?.location).toBe('https://www.workingpreacher.org/x')
    expect(contents.readerArchive.closedTabs).toHaveLength(1)
    expect(contents.readerArchive.closedTabs?.[0]?.location).toMatch(/^Files\//)
    expect(contents.readerArchive.closedTabs?.[0]?.pdfPosition).toEqual({
      page: 1,
      x: 20,
      y: 340,
      scale: 1.6,
      autoScales: false,
    })
    expect(contents.history[0]?.revisions[0]?.plainText).toBe('Sermão de teste')
    expect(contents.favoriteSources.sites).toHaveLength(1)
    expect(contents.reviewReports['2026-10-04']).toHaveLength(1)

    // Credenciais nunca entram no pacote.
    expect(contents.preferences).toEqual({
      'ai.reviewProvider': 'openai',
      'api.bible': 'naa',
      'drive.fontSize': 14,
    })
    const packageText = (await Promise.all(disk.files().map((path) => disk.readFile(path))))
      .map((bytes) => new TextDecoder().decode(bytes))
      .join('\n')
    expect(packageText).not.toMatch(/must-stay-local|client-id\.apps/)

    // Restauração: PDFs instalados na pasta do app e plano com caminhos de destino.
    const appFiles = new MemoryBackupFileSystem()
    const destination = scopeFileSystem(appFiles, 'BackupFiles')
    const installed = await installBackupAssets({ source: pkg, destination, contents })
    expect(installed.created).toHaveLength(2)
    const plan = await planRestore(contents, {
      assetLocation: (fileName) => `/app/BackupFiles/${fileName}`,
      currentPreferenceKeys: [
        'api.bible',
        'ai.researchModel',
        'drive.accessToken',
        'drive.oauthClientID',
        'ai.openai.apiKey',
      ],
    })

    const sermon = plan.sermons[0]!
    expect(plan.sermons).toHaveLength(1)
    expect(sermon.title).toBe('Romanos 13:8-14')
    expect(sermon.liturgicalOccasion).toBe('Próprio 22 A')
    expect(sermon.content).toEqual(sampleData().sermons[0]?.content)
    expect(sermon.googleDriveDocumentId).toBe('documento-vinculado')
    expect(sermon.googleDriveSyncedContentHash).not.toBe('hash-antigo')
    expect(sermon.googleDriveSyncedContentHash).toBe(await sha256Hex(sermon.content!.data))
    expect(sermon.tabletPdfPath).toBe(`/app/BackupFiles/${await sha256Hex(PDF_DATA)}.pdf`)
    expect(await appFiles.readFile(`BackupFiles/${await sha256Hex(PDF_DATA)}.pdf`)).toEqual(PDF_DATA)

    expect(plan.libraryRecords[0]?.path).toBe(sermon.tabletPdfPath)
    expect(plan.libraryRecords[0]?.ocrTextByPage).toEqual({ '1': 'Romans 13:8-14\nCommentary text' })
    expect(plan.history).toEqual(sampleData().history)
    expect(plan.readerArchive.activeSermonDateKey).toBe('2026-10-04')
    expect(plan.readerArchive.selectedBySermon).toEqual({
      '2026-10-04': 'C0FFEE00-0000-4000-8000-000000000001',
    })
    expect(plan.readerArchive.tabs[0]?.location).toBe(sermon.tabletPdfPath)
    expect(plan.readerArchive.closedTabs?.[0]?.location).toBe(
      `/app/BackupFiles/${await sha256Hex(CLOSED_PDF_DATA)}.pdf`,
    )
    expect(Object.keys(plan.sectionLinks)).toEqual([`${sermon.tabletPdfPath}|Romanos 13:8-14`])
    expect(plan.reviewReports).toEqual(sampleData().reviewReports)

    // Preferências: grava as do backup, apaga as cobertas ausentes, credenciais intocadas.
    expect(plan.preferences.set).toEqual({
      'ai.reviewProvider': 'openai',
      'api.bible': 'naa',
      'drive.fontSize': 14,
    })
    expect(plan.preferences.remove).toEqual(['ai.researchModel'])
  })

  it('backup sem preferências apaga as do destino, exceto credenciais', async () => {
    const data = { ...sampleData(), preferences: {} }
    const { pkg } = await makeBackup(data)
    const contents = await validateBackup(pkg)
    const plan = await planRestore(contents, {
      assetLocation: (fileName) => `/app/${fileName}`,
      currentPreferenceKeys: ['api.bible', 'drive.font', 'drive.accessToken', 'api.secret'],
    })
    expect(plan.preferences).toEqual({ set: {}, remove: ['api.bible', 'drive.font'] })
  })

  it('lista de preferências permitidas restringe criação, validação e restauração', async () => {
    const allowed = new Set(['api.bible'])
    const disk = new MemoryBackupFileSystem()
    const created = await createBackup({
      target: disk,
      data: sampleData(),
      readPdf,
      appVersion: '0.1.0',
      preferenceKeys: allowed,
    })
    const pkg = scopeFileSystem(disk, created.folderName)
    const contents = await validateBackup(pkg, { preferenceKeys: allowed })
    expect(contents.preferences).toEqual({ 'api.bible': 'naa' })
    await expectBackupError(
      validateBackup(pkg, { preferenceKeys: new Set(['drive.font']) }),
      'invalidPackage',
    )
    const plan = await planRestore(contents, {
      assetLocation: (name) => name,
      preferenceKeys: allowed,
      currentPreferenceKeys: ['api.bible', 'drive.font'],
    })
    expect(plan.preferences).toEqual({ set: { 'api.bible': 'naa' }, remove: [] })
  })

  it('não cria o pacote quando falta um PDF exigido e não deixa pasta temporária', async () => {
    const disk = new MemoryBackupFileSystem()
    const data = sampleData()
    data.libraryRecords.push({ id: 'x', title: 'Sumido', path: `${SOURCE}/Sumido.pdf` })
    const error = await createBackup({ target: disk, data, readPdf, appVersion: '0.1.0' }).catch(
      (reason) => reason,
    )
    expect(error).toBeInstanceOf(BackupError)
    expect(error.code).toBe('missingPDF')
    expect(error.message).toBe(
      'Não foi possível incluir o PDF “Sumido.pdf” no backup. Confira se o arquivo ainda está disponível.',
    )
    expect(await disk.list('')).toEqual([])
  })

  it('recusa pasta de destino inexistente', async () => {
    const disk = new MemoryBackupFileSystem()
    const error = await createBackup({
      target: scopeFileSystem(disk, 'nao-existe'),
      data: sampleData(),
      readPdf,
      appVersion: '0.1.0',
    }).catch((reason) => reason)
    expect(error.code).toBe('restoreFailed')
    expect(error.message).toBe(
      'Não foi possível concluir a restauração. Os dados anteriores foram preservados. A pasta escolhida não existe.',
    )
  })

  it('não sobrescreve um backup criado no mesmo segundo', async () => {
    const disk = new MemoryBackupFileSystem()
    const options = { target: disk, data: sampleData(), readPdf, appVersion: '0.1.0', now: () => CREATED_AT }
    const first = await createBackup(options)
    const second = await createBackup(options)
    expect([first.folderName, second.folderName]).toEqual([
      backupFolderName(CREATED_AT),
      `${backupFolderName(CREATED_AT)} (2)`,
    ])
    expect(await detectBackupFormat(scopeFileSystem(disk, second.folderName))).toBe('v2')
  })
})

describe('backup: validação antes de restaurar', () => {
  it('recusa conteúdo alterado', async () => {
    const { pkg } = await makeBackup()
    await pkg.writeFile('Sermons.json', text('tampered'))
    await expectBackupError(validateBackup(pkg), 'corruptedFile')
  })

  it('recusa PDF alterado', async () => {
    const { pkg } = await makeBackup()
    await pkg.writeFile(`Files/${await sha256Hex(PDF_DATA)}.pdf`, text('%PDF outro'))
    await expectBackupError(validateBackup(pkg), 'corruptedFile')
  })

  it('recusa caminhos inesperados no manifesto', async () => {
    const zeros = '0'.repeat(64)
    for (const path of [
      'History/../../outside.json',
      '/etc/passwd',
      'Files/../Manifest.json',
      'History\\..\\..\\outside.json',
      'C:/Windows/win.ini',
      'History/2026-10-04.json/../x.json',
      'Notes.txt',
    ]) {
      const { pkg } = await makeBackup()
      await rewriteManifest(pkg, (manifest) => {
        ;(manifest.files as Record<string, string>)[path] = zeros
      })
      await expectBackupError(validateBackup(pkg), 'invalidPackage')
    }
  })

  it('recusa arquivo do pacote substituído por link simbólico', async () => {
    const { disk, target, created, pkg } = await makeBackup()
    await target.writeFile('outside.json', text('not part of this package'))
    await pkg.remove('Reader.json')
    disk.symlink(`exports/${created.folderName}/Reader.json`, 'exports/outside.json')
    await expectBackupError(validateBackup(pkg), 'invalidPackage')
  })

  it('recusa pasta do pacote substituída por link simbólico', async () => {
    const { disk, created, pkg } = await makeBackup()
    await disk.mkdir('elsewhere/History')
    for (const name of await pkg.list('History')) {
      await disk.writeFile(`elsewhere/History/${name}`, await pkg.readFile(`History/${name}`))
    }
    await pkg.remove('History')
    disk.symlink(`exports/${created.folderName}/History`, 'elsewhere/History')
    // O conteúdo lido pelo link teria o hash certo; a recusa vem do link em si.
    await expectBackupError(validateBackup(pkg), 'invalidPackage')
  })

  it('recusa versão desconhecida, manifesto ausente e arquivo obrigatório ausente', async () => {
    const { pkg } = await makeBackup()
    await rewriteManifest(pkg, (manifest) => {
      manifest.formatVersion = 3
    })
    await expectBackupError(validateBackup(pkg), 'unsupportedVersion')
    await expectBackupError(detectBackupFormat(pkg), 'unsupportedVersion')

    const second = await makeBackup()
    await second.pkg.remove('Manifest.json')
    await expectBackupError(validateBackup(second.pkg), 'invalidPackage')

    const third = await makeBackup()
    await rewriteManifest(third.pkg, (manifest) => {
      delete (manifest.files as Record<string, string>)['Preferences.json']
    })
    await expectBackupError(validateBackup(third.pkg), 'invalidPackage')
  })

  it('recusa PDF referenciado fora do pacote e contagens divergentes', async () => {
    const { pkg } = await makeBackup()
    await rewriteManifest(pkg, (manifest) => {
      const files = manifest.files as Record<string, string>
      for (const path of Object.keys(files)) if (path.startsWith('Files/')) delete files[path]
    })
    await expectBackupError(validateBackup(pkg), 'missingAsset')

    const second = await makeBackup()
    await rewriteManifest(second.pkg, (manifest) => {
      ;(manifest.counts as Record<string, number>).sermons = 2
    })
    await expectBackupError(validateBackup(second.pkg), 'invalidPackage')
  })

  it('recusa credenciais gravadas no pacote por outra ferramenta', async () => {
    const { pkg } = await makeBackup()
    const preferences = json({ 'drive.accessToken': 'x' })
    await pkg.writeFile('Preferences.json', preferences)
    const digest = await sha256Hex(preferences)
    await rewriteManifest(pkg, (manifest) => {
      ;(manifest.files as Record<string, string>)['Preferences.json'] = digest
    })
    await expectBackupError(validateBackup(pkg), 'invalidPackage')
  })
})

describe('backup: instalação dos PDFs', () => {
  it('reaproveita PDF idêntico, recusa colisão e link simbólico e desfaz o que criou', async () => {
    const { pkg } = await makeBackup()
    const contents = await validateBackup(pkg)
    const [firstAsset, secondAsset] = contents.assetPaths
    const firstName = firstAsset!.slice('Files/'.length)
    const secondName = secondAsset!.slice('Files/'.length)

    const same = new MemoryBackupFileSystem()
    await same.writeFile(firstName, await pkg.readFile(firstAsset!))
    const installed = await installBackupAssets({ source: pkg, destination: same, contents })
    expect(installed.created).toEqual([secondName])
    await discardInstalledAssets(same, installed)
    expect(same.files()).toEqual([firstName])

    const collision = new MemoryBackupFileSystem()
    await collision.writeFile(secondName, text('outro conteúdo'))
    await expectBackupError(
      installBackupAssets({ source: pkg, destination: collision, contents }),
      'assetCollision',
    )
    // O primeiro PDF, criado antes da colisão, foi removido.
    expect(collision.files()).toEqual([secondName])

    const linked = new MemoryBackupFileSystem()
    await linked.writeFile('alvo.pdf', await pkg.readFile(firstAsset!))
    linked.symlink(firstName, 'alvo.pdf')
    await expectBackupError(
      installBackupAssets({ source: pkg, destination: linked, contents }),
      'assetCollision',
    )
  })
})

describe('backup: caminhos', () => {
  it('aceita só caminhos relativos simples', () => {
    expect(isSafeRelativePath('History/2026-10-04.json')).toBe(true)
    for (const path of ['', '/abs', 'a//b', './a', 'a/../b', 'a\\b', 'C:x', 'a\0b', 'Files/CON.pdf', 'nul']) {
      expect(isSafeRelativePath(path)).toBe(false)
    }
  })

  it('padroniza caminhos de origem para não copiar o mesmo PDF duas vezes', () => {
    expect(normalizeSourcePath('/Users/a/./b/../c.pdf')).toBe('/Users/a/c.pdf')
    expect(normalizeSourcePath('/Users//a/c.pdf')).toBe('/Users/a/c.pdf')
    expect(normalizeSourcePath('C:\\Users\\a\\..\\b\\c.pdf')).toBe('C:\\Users\\b\\c.pdf')
  })
})
