import { describe, expect, it } from 'vitest'
import { dateKey } from '../../src/util/dates'
import { sha256Hex } from '../../src/util/hash'
import {
  BackupError,
  MemoryBackupFileSystem,
  convertLegacyBackup,
  detectBackupFormat,
  installBackupAssets,
  parseLegacyHistoryFile,
  planRestore,
  readLegacyBackup,
  scopeFileSystem,
  validateBackup,
} from '../../src/backup'
import type { BackupErrorCode, BackupFileSystem } from '../../src/backup'
import { Real, base64, encodeBinaryPlist, json, text, writeFiles } from './helpers'

const PDF = text('%PDF-1.7\nbackup fixture\n')
const CLOSED_PDF = text('%PDF-1.7\nclosed-only backup fixture\n')
const TAB_ID = '6F9619FF-8B86-D011-B42D-00C04FC964FF'
const RTF = '{\\rtf1\\ansi Sermão de teste}'
// RTF com byte alto em Windows-1252 ("ã" = 0xE3), inválido como UTF-8.
const RTF_1252 = Uint8Array.from([...text('{\\rtf1\\ansi Serm'), 0xe3, ...text('o antigo}')])

interface LegacyFixture {
  disk: MemoryBackupFileSystem
  pkg: BackupFileSystem
  pdfAsset: string
  closedAsset: string
}

/** Pacote como o `PregarBackupService.create` do Swift grava (formato 1). */
async function legacyPackage(overrides: Record<string, Uint8Array> = {}): Promise<LegacyFixture> {
  const pdfAsset = `Files/${await sha256Hex(PDF)}.pdf`
  const closedAsset = `Files/${await sha256Hex(CLOSED_PDF)}.pdf`
  const files: Record<string, Uint8Array> = {
    [pdfAsset]: PDF,
    [closedAsset]: CLOSED_PDF,
    'Drafts.json': json([
      {
        googleDriveDocumentID: 'documento-vinculado',
        googleDriveSyncedContentHash: 'hash-antigo',
        liturgicalDate: '2026-10-04T03:00:00Z',
        liturgicalOccasion: 'Próprio 22 A',
        mainReadingReference: 'Romanos 13:8-14',
        mainReadingSlot: 'second_reading',
        modifiedAt: '2026-10-03T15:20:11Z',
        rtfData: base64(RTF),
        tabletPDFPath: pdfAsset,
        tabletPDFUpdatedAt: '2026-09-27T07:20:00Z',
        title: 'Romanos 13:8-14',
      },
      {
        liturgicalDate: '2026-10-11T03:00:00Z',
        modifiedAt: '2026-10-10T10:00:00-03:00',
        rtfData: base64(RTF_1252),
        title: 'Antigo',
      },
      { liturgicalDate: '2026-10-18T03:00:00Z', modifiedAt: '2026-10-17T10:00:00Z', title: '' },
    ]),
    'Library.json': json([
      {
        author: 'Autora de teste',
        bookmarkCount: 0,
        id: 'commentary-1',
        ocrPageNumbers: [1],
        ocrTextByPage: { '1': 'Romans 13:8-14\nCommentary text' },
        pageCount: 1,
        path: pdfAsset,
        title: 'Comentário de teste',
      },
    ]),
    'Reader.json': json({
      activeSermonDateKey: '2026-10-04',
      closedTabs: [
        {
          id: 'A9A598D5-552A-46E4-8A13-EC66A4C3E079',
          includedInReview: false,
          kind: 'pdf',
          location: closedAsset,
          pdfPosition: { autoScales: false, page: 1, scale: 1.6, x: 20, y: 340 },
          physicalPage: 1,
          sermonDateKey: '2026-11-01',
          title: 'Aba fechada',
        },
      ],
      selectedBySermon: { '2026-10-04': TAB_ID },
      selectedID: TAB_ID,
      tabs: [
        {
          id: TAB_ID,
          includedInReview: false,
          kind: 'pdf',
          location: pdfAsset,
          physicalPage: 1,
          reference: 'Romanos 13:8-14',
          sermonDateKey: '2026-10-04',
          title: 'Comentário de teste',
        },
      ],
    }),
    'SectionLinks.json': json({ [`${pdfAsset}|Romanos 13:8-14`]: 1 }),
    'Preferences.plist': encodeBinaryPlist({
      'api.bible': 'naa',
      'ai.reviewProvider': 'openai',
      'drive.fontSize': new Real(14),
      'drive.targets': 'Android e iPad',
      'pregar.favorite-sites.v1': json([{ id: 'wp', name: 'Working Preacher' }], false),
      'pregar.material-research.reports.v1': json({ '2026-10-04': [{ title: 'Relatório' }] }, false),
    }),
    // JSONEncoder padrão: datas em segundos desde 2001-01-01 e RTF em base64.
    'History/2026-10-04.json': json(
      [
        {
          id: 'B1A2C3D4-0000-4000-8000-000000000002',
          version: 2,
          createdAt: 812809800.5,
          summary: 'Restaurada de v1',
          title: '',
          wordCount: 0,
        },
        {
          id: 'B1A2C3D4-0000-4000-8000-000000000001',
          version: 1,
          createdAt: 812808000,
          summary: 'Edição salva',
          title: 'Romanos 13:8-14',
          mainReadingReference: 'Romanos 13:8-14',
          mainReadingSlot: 'second_reading',
          rtfData: base64(RTF),
          wordCount: 3,
        },
      ],
      false,
    ),
    // Como no teste Swift: conteúdo que não é histórico, mas com hash correto.
    'History/2026-10-11.json': text('history fixture'),
    ...overrides,
  }
  const disk = new MemoryBackupFileSystem()
  const directory = 'Pregar Backup 2026-11-01 14.05.09'
  const digests = await writeFiles(disk, directory, files)
  const manifest = {
    appVersion: '1.4',
    assetCount: 2,
    createdAt: '2026-11-01T17:05:09Z',
    draftCount: 3,
    files: digests,
    formatVersion: 1,
    historyFileCount: 2,
    libraryCount: 1,
  }
  await disk.writeFile(`${directory}/Manifest.json`, json(manifest))
  return { disk, pkg: scopeFileSystem(disk, directory), pdfAsset, closedAsset }
}

async function expectBackupError(promise: Promise<unknown>, code: BackupErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(BackupError)
  expect((error as BackupError).code).toBe(code)
}

describe('backup do app Swift', () => {
  it('lê manifesto, rascunhos, histórico, Biblioteca, Leitor, vínculos e preferências', async () => {
    const { pkg, pdfAsset, closedAsset } = await legacyPackage()
    expect(await detectBackupFormat(pkg)).toBe('legacy-v1')

    const legacy = await readLegacyBackup(pkg)
    expect(legacy.manifest.createdAt.toISOString()).toBe('2026-11-01T17:05:09.000Z')
    expect(legacy.manifest.appVersion).toBe('1.4')
    expect(legacy.assetPaths).toEqual([pdfAsset, closedAsset].sort())

    const [draft, older, empty] = legacy.drafts
    expect(draft?.liturgicalDate.toISOString()).toBe('2026-10-04T03:00:00.000Z')
    expect(draft?.tabletPDFUpdatedAt?.toISOString()).toBe('2026-09-27T07:20:00.000Z')
    expect(draft?.rtf).toBe(RTF)
    expect(draft?.tabletPDFPath).toBe(pdfAsset)
    expect(draft?.googleDriveDocumentID).toBe('documento-vinculado')
    expect(draft?.prayerBookID).toBeNull()
    expect(older?.rtf).toBe('{\\rtf1\\ansi Sermão antigo}')
    expect(older?.modifiedAt.toISOString()).toBe('2026-10-10T13:00:00.000Z')
    expect(empty?.rtf).toBeNull()
    expect(empty?.tabletPDFPath).toBeNull()

    const [history, unreadable] = legacy.history
    expect(history?.dateKey).toBe('2026-10-04')
    expect(history?.unreadable).toBe(false)
    expect(history?.revisions.map((revision) => revision.version)).toEqual([1, 2])
    expect(history?.revisions[0]?.createdAt.toISOString()).toBe('2026-10-04T12:00:00.000Z')
    expect(history?.revisions[1]?.createdAt.toISOString()).toBe('2026-10-04T12:30:00.500Z')
    expect(history?.revisions[0]?.rtf).toBe(RTF)
    expect(history?.revisions[1]?.rtf).toBeNull()
    expect(history?.revisions[1]?.mainReadingReference).toBeNull()
    expect(unreadable).toEqual({
      path: 'History/2026-10-11.json',
      dateKey: '2026-10-11',
      revisions: [],
      unreadable: true,
    })

    expect(legacy.libraryRecords[0]?.ocrTextByPage).toEqual({ '1': 'Romans 13:8-14\nCommentary text' })
    expect(legacy.readerArchive.selectedBySermon).toEqual({ '2026-10-04': TAB_ID })
    expect(legacy.readerArchive.closedTabs?.[0]?.pdfPosition).toEqual({
      autoScales: false,
      page: 1,
      scale: 1.6,
      x: 20,
      y: 340,
    })
    expect(legacy.sectionLinks).toEqual({ [`${pdfAsset}|Romanos 13:8-14`]: 1 })
    expect(legacy.preferences['api.bible']).toBe('naa')
    expect(legacy.preferences['drive.fontSize']).toBe(14)
    expect(legacy.preferences['pregar.favorite-sites.v1']).toBeInstanceOf(Uint8Array)
  })

  it('recusa conteúdo alterado', async () => {
    const { pkg } = await legacyPackage()
    await pkg.writeFile('Drafts.json', text('tampered'))
    await expectBackupError(readLegacyBackup(pkg), 'corruptedFile')
  })

  it('recusa caminho adulterado no manifesto', async () => {
    const { pkg } = await legacyPackage()
    const manifest = JSON.parse(new TextDecoder().decode(await pkg.readFile('Manifest.json')))
    manifest.files['History/../../outside.json'] = '0'.repeat(64)
    await pkg.writeFile('Manifest.json', json(manifest))
    await expectBackupError(readLegacyBackup(pkg), 'invalidPackage')
  })

  it('recusa arquivo do pacote substituído por link simbólico', async () => {
    const { disk, pkg } = await legacyPackage()
    await disk.writeFile('outside.json', text('not part of this package'))
    await pkg.remove('Reader.json')
    disk.symlink('Pregar Backup 2026-11-01 14.05.09/Reader.json', 'outside.json')
    await expectBackupError(readLegacyBackup(pkg), 'invalidPackage')
  })

  it('recusa preferência fora da lista do app Swift e plist que não é binária', async () => {
    const withToken = await legacyPackage({
      'Preferences.plist': encodeBinaryPlist({ 'api.bible': 'naa', 'drive.accessToken': 'token' }),
    })
    await expectBackupError(readLegacyBackup(withToken.pkg), 'invalidPackage')

    const xml = await legacyPackage({
      'Preferences.plist': text('<?xml version="1.0"?><plist><dict/></plist>'),
    })
    await expectBackupError(readLegacyBackup(xml.pkg), 'invalidPackage')
  })

  it('cada leitor recusa o formato do outro como versão incompatível', async () => {
    const { pkg } = await legacyPackage()
    await expectBackupError(validateBackup(pkg), 'unsupportedVersion')
  })

  it('arquivo de histórico ilegível não impede a migração', () => {
    expect(parseLegacyHistoryFile('History/notas.json', text('[]'))).toEqual({
      path: 'History/notas.json',
      dateKey: null,
      revisions: [],
      unreadable: false,
    })
    expect(parseLegacyHistoryFile('History/2026-10-04.json', text('{"x":1}')).unreadable).toBe(true)
  })

  it('converte para o formato atual e restaura pelo mesmo plano', async () => {
    const { pkg } = await legacyPackage()
    const legacy = await readLegacyBackup(pkg)
    const converted = await convertLegacyBackup(legacy, {
      convertRTF: (rtf) =>
        rtf.includes('antigo')
          ? null
          : {
              content: { format: 'tiptap-json', data: JSON.stringify({ rtfLength: rtf.length }) },
              plainText: 'Sermão de teste',
            },
    })

    const [sermon, older, empty] = converted.sermons
    expect(sermon?.dateKey).toBe(dateKey(new Date('2026-10-04T03:00:00Z')))
    expect(sermon?.content?.format).toBe('tiptap-json')
    expect(sermon?.plainText).toBe('Sermão de teste')
    expect(sermon?.googleDriveDocumentId).toBe('documento-vinculado')
    expect(sermon?.tabletPdfUpdatedAt).toBe('2026-09-27T07:20:00.000Z')
    // Sem conversão, o RTF segue como conteúdo herdado.
    expect(older?.content).toEqual({ format: 'rtf', data: '{\\rtf1\\ansi Sermão antigo}' })
    expect(empty?.content).toBeNull()

    expect(converted.history).toHaveLength(1)
    expect(converted.skippedHistoryFiles).toEqual(['History/2026-10-11.json'])
    expect(converted.history[0]?.revisions[0]).toMatchObject({
      version: 1,
      createdAt: '2026-10-04T12:00:00.000Z',
      plainText: 'Sermão de teste',
      wordCount: 3,
    })
    expect(converted.preferences).toEqual({
      'ai.reviewProvider': 'openai',
      'api.bible': 'naa',
      'drive.fontSize': 14,
      'drive.targets': 'Android e iPad',
      'pregar.material-research.reports.v1': { '2026-10-04': [{ title: 'Relatório' }] },
    })
    expect(converted.favoriteSources).toEqual({
      sites: [{ id: 'wp', name: 'Working Preacher' }],
      authors: [],
    })

    const appFiles = new MemoryBackupFileSystem()
    const installed = await installBackupAssets({ source: pkg, destination: appFiles, contents: legacy })
    expect(installed.created).toHaveLength(2)
    const plan = await planRestore(converted, {
      assetLocation: (fileName) => `C:\\Users\\p\\AppData\\Pregar\\BackupFiles\\${fileName}`,
      currentPreferenceKeys: ['api.language', 'drive.accessToken'],
    })
    expect(plan.sermons[0]?.tabletPdfPath).toBe(
      `C:\\Users\\p\\AppData\\Pregar\\BackupFiles\\${await sha256Hex(PDF)}.pdf`,
    )
    expect(plan.sermons[0]?.googleDriveSyncedContentHash).toBe(
      await sha256Hex(plan.sermons[0]!.content!.data),
    )
    expect(plan.readerArchive.closedTabs?.[0]?.location).toContain(await sha256Hex(CLOSED_PDF))
    expect(Object.keys(plan.sectionLinks)[0]).toBe(`${plan.sermons[0]?.tabletPdfPath}|Romanos 13:8-14`)
    expect(plan.preferences.remove).toEqual(['api.language'])
  })
})
