import { describe, expect, it } from 'vitest'
import { parseReference } from '../../src/bible/reference'
import {
  authorSignature,
  enrichFeastingSections,
  extractSpanText,
  feastingComponents,
  makeSectionLocation,
} from '../../src/library'
import { FEASTING_PAGES, FakePdfTextSource } from './fixtures'

describe('componentes do Feasting', () => {
  it('preserva offsets em páginas compartilhadas e os limites das autorias', () => {
    const section = makeSectionLocation({ title: 'Romans 13:8-14', startPage: 10, endPage: 12 })
    const target = parseReference(section.title)!

    const components = feastingComponents(section, target, FEASTING_PAGES)!

    expect(components.map((item) => item.kind)).toEqual([
      'biblicalText',
      'theological',
      'pastoral',
      'exegetical',
      'homiletical',
    ])
    expect(components.map((item) => item.author)).toEqual([
      undefined,
      'ELEAZAR S. FERNANDEZ',
      'ROCHELLE A. STACKHOUSE',
      'CHRISTOPHER R. HUTSON',
      'DAVID L. BARTLETT',
    ])
    expect(components[0]!.content.start.page).toBe(10)
    expect(components[1]!.location.start.page).toBe(10)
    expect(components[2]!.location.start.page).toBe(11)
    expect(components[3]!.location.start.page).toBe(12)
    expect(components[4]!.location.end.page).toBe(13)

    const sharedPage = FEASTING_PAGES[13]!
    expect(components[4]!.location.end.utf16Offset).toBe(sharedPage.indexOf('Matthew 18:15-20'))
    expect(components[4]!.content.end.utf16Offset).toBe(sharedPage.indexOf('DAVID L. BARTLETT'))
    expect(components[0]!.title).toBe('Texto bíblico')
  })

  it('encontra a assinatura antes das notas numeradas (caso McMickle)', async () => {
    const pages = [
      'Philippians essay ends here.\nNATHAN EDDY\nMatthew 21:33-46\n33 Listen to another parable.\nTheological Perspective\nTheological text.\nANDREW PURVES',
      'Pastoral Perspective\nPastoral text.\nRICHARD E. SPALDING\nExegetical Perspective\nExegetical text.\nSUSAN GROVE EASTMAN',
      'Homiletical Perspective\nThe parable must be read as an allegory.\nMARVIN A. MCMICKLE\n1. First note text.\n2. Second note text.\nIsaiah 25:1-9\nNext reading begins.',
    ]
    const source = new FakePdfTextSource({ pages })
    const [section] = await enrichFeastingSections(
      [
        makeSectionLocation({
          title: 'Matthew 21:33-46',
          startPage: 1,
          endPage: 2,
          findingMethod: 'bookmark',
        }),
      ],
      source,
      'Feasting on the Word: Year A, Volume 4',
    )

    expect(section!.endPage).toBe(3)
    expect(section!.findingMethod).toBe('bookmark')
    expect(section!.components?.map((item) => item.author)).toEqual([
      undefined,
      'ANDREW PURVES',
      'RICHARD E. SPALDING',
      'SUSAN GROVE EASTMAN',
      'MARVIN A. MCMICKLE',
    ])
    const scripture = await extractSpanText(section!.components![0]!.content, source)
    expect(scripture).toContain('Listen to another parable')
    expect(scripture.toLowerCase()).not.toContain('nathan eddy')

    const homiletical = await extractSpanText(section!.components![4]!.content, source)
    expect(homiletical).toContain('must be read as an allegory')
    expect(homiletical).not.toContain('MARVIN A. MCMICKLE')
    expect(homiletical).not.toContain('Isaiah 25:1-9')
    expect(section!.components![4]!.location.end).toEqual({
      page: 3,
      utf16Offset: pages[2]!.indexOf('Isaiah 25:1-9'),
    })
  })

  it('mantém a seção quando faltam perspectivas ou o título não é do Feasting', async () => {
    const source = new FakePdfTextSource({ pages: ['Romans 13:8-14\nText.\nTheological Perspective\nBody.'] })
    const section = makeSectionLocation({ title: 'Romans 13:8-14', startPage: 1, endPage: 1 })
    expect(await enrichFeastingSections([section], source, 'Feasting on the Word: Year A, Volume 4')).toEqual(
      [section],
    )

    const complete = new FakePdfTextSource({ pages: Object.values(FEASTING_PAGES) })
    const unchanged = makeSectionLocation({ title: 'Romans 13:8-14', startPage: 1, endPage: 3 })
    expect(await enrichFeastingSections([unchanged], complete, 'Paul for Everyone: Romans Part 2')).toEqual([
      unchanged,
    ])
  })

  it('usa o OCR salvo nas páginas sem camada de texto', async () => {
    const source = new FakePdfTextSource({ pages: ['', '', '', ''] })
    const ocr = {
      1: FEASTING_PAGES[10]!,
      2: FEASTING_PAGES[11]!,
      3: FEASTING_PAGES[12]!,
      4: FEASTING_PAGES[13]!,
    }
    const [section] = await enrichFeastingSections(
      [
        makeSectionLocation({
          title: 'Romans 13:8-14',
          startPage: 1,
          endPage: 3,
          findingMethod: 'ocrHeading',
        }),
      ],
      source,
      'Feasting on the Word: Year A, Volume 4',
      ocr,
    )
    expect(section!.endPage).toBe(4)
    expect(section!.components).toHaveLength(5)
    const homiletical = await extractSpanText(section!.components![4]!.content, source, ocr)
    expect(homiletical.trim()).toBe('Homiletical body ends here.')
  })

  it('reconhece assinaturas em versais', () => {
    expect(authorSignature('  MARVIN A. MCMICKLE ')).toBe('MARVIN A. MCMICKLE')
    expect(authorSignature('MARY O’CONNOR-SMITH')).toBe('MARY O’CONNOR-SMITH')
    expect(authorSignature('JOÃO DA SILVA')).toBe('JOÃO DA SILVA')
    expect(authorSignature('THEOLOGICAL')).toBeNull()
    expect(authorSignature('Marvin A. McMickle')).toBeNull()
    expect(authorSignature('ROMANS 13:8-14')).toBeNull()
    expect(authorSignature('A B')).toBeNull()
  })
})
