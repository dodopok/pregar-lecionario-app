import { describe, expect, it } from 'vitest'
import {
  clampPage,
  confidenceTone,
  destinationFromHash,
  destinationPoint,
  dropsAfter,
  isAutoScaleValue,
  nextZoomScale,
  parsePageField,
  pdfCopySource,
  positionFromLocation,
  sameRect,
  scrollToReveal,
  sectionFromRow,
  sectionPageRange,
  tabTooltip,
  textFromItems,
} from '../../src/renderer/src/views/leitor/reader-ui'

describe('campo de página física', () => {
  it('aceita só números e limita ao documento', () => {
    expect(parsePageField('14', 800)).toBe(14)
    expect(parsePageField(' 0 ', 800)).toBe(1)
    expect(parsePageField('9999', 800)).toBe(800)
    expect(parsePageField('xii', 800)).toBeNull()
    expect(parsePageField('', 800)).toBeNull()
    expect(clampPage(5, 0)).toBe(5)
  })
})

describe('zoom do PDF', () => {
  it('multiplica por 1,2 dentro de 0,1–8', () => {
    expect(nextZoomScale(1, 1)).toBe(1.2)
    expect(nextZoomScale(1.2, -1)).toBe(1)
    expect(nextZoomScale(7.5, 1)).toBe(8)
    expect(nextZoomScale(0.1, -1)).toBe(0.1)
    expect(isAutoScaleValue('page-width')).toBe(true)
    expect(isAutoScaleValue('1.5')).toBe(false)
  })

  it('posição publicada a partir do location do PDF.js', () => {
    expect(positionFromLocation({ pageNumber: 3, left: -4, top: 700 }, 1.4, false)).toEqual({ page: 3, x: -4, y: 700, scale: 1.4, autoScales: false })
    expect(positionFromLocation({ pageNumber: 0, left: 0, top: 0 }, 1, true)).toBeNull()
    expect(positionFromLocation({ pageNumber: 2, left: Number.NaN, top: 0 }, 1, true)).toBeNull()
    expect(positionFromLocation(null, 1, true)).toBeNull()
  })
})

describe('links internos do PDF', () => {
  it('lê destinos nomeados e explícitos do href', () => {
    expect(destinationFromHash('#cap%EDtulo')).toEqual({ kind: 'named', name: 'capítulo' })
    const explicit = `#${escape(JSON.stringify([{ num: 12, gen: 0 }, { name: 'XYZ' }, 72, 700, null]))}`
    expect(destinationFromHash(explicit)).toEqual({ kind: 'explicit', dest: [{ num: 12, gen: 0 }, { name: 'XYZ' }, 72, 700, null] })
    expect(destinationFromHash('#page=3')).toBeNull()
    expect(destinationFromHash('https://a.org/')).toBeNull()
    expect(destinationFromHash('#[quebrado')).toBeNull()
  })

  it('ponto do destino XYZ', () => {
    expect(destinationPoint([{ num: 1, gen: 0 }, { name: 'XYZ' }, 72, 700, null])).toEqual({ x: 72, y: 700 })
    expect(destinationPoint([{ num: 1, gen: 0 }, { name: 'XYZ' }, null, 700])).toEqual({ x: 0, y: 700 })
    expect(destinationPoint([{ num: 1, gen: 0 }, { name: 'Fit' }])).toBeNull()
  })
})

describe('painéis', () => {
  it('páginas da seção como no Swift', () => {
    const printed = (page: number) => (page < 3 ? null : `${page - 2}`)
    expect(sectionPageRange({ startPage: 2, endPage: 2 }, printed)).toBe('física 2')
    expect(sectionPageRange({ startPage: 14, endPage: 16 }, printed)).toBe('físicas 14–16 · impressas 12–14')
  })

  it('selo de confiança pela origem', () => {
    expect(confidenceTone({ findingMethod: 'bookmark' })).toBe('high')
    expect(confidenceTone({ findingMethod: 'textHeading' })).toBe('medium')
    expect(confidenceTone({ findingMethod: 'ocrHeading' })).toBe('low')
    expect(confidenceTone({})).toBe('unknown')
  })

  it('linha da Biblioteca vira seção do Leitor', () => {
    expect(sectionFromRow({ title: 'Mateus 21:23-32', context: 'Próprio 21', startPage: 14, endPage: 18, method: 'bookmark' })).toEqual({
      title: 'Mateus 21:23-32',
      context: 'Próprio 21',
      startPage: 14,
      endPage: 18,
      findingMethod: 'bookmark',
    })
    expect(sectionFromRow({ title: 'X', context: null, startPage: 1, endPage: 1, method: 'unknown' })).not.toHaveProperty('context')
  })

  it('texto do PDF.js com quebras de linha para o índice', () => {
    expect(textFromItems([{ str: 'Mateus 21:23-32', hasEOL: true }, { str: 'Texto ' }, { str: 'corrido', hasEOL: true }, {}])).toBe(
      'Mateus 21:23-32\nTexto corrido',
    )
  })
})

describe('barra de abas', () => {
  it('rolagem só quando a aba selecionada está fora da vista', () => {
    expect(scrollToReveal(0, 600, 100, 120)).toBe(0)
    expect(scrollToReveal(0, 600, 900, 120)).toBe(660)
    expect(scrollToReveal(800, 600, 100, 120)).toBe(0)
  })

  it('soltar na metade direita coloca depois', () => {
    expect(dropsAfter(130, 220)).toBe(true)
    expect(dropsAfter(20, 220)).toBe(false)
  })

  it('dicas das abas e origem da cópia', () => {
    expect(tabTooltip({ title: 'Feasting', kind: 'pdf', physicalPage: 14, location: '/a.pdf' })).toBe('Feasting · página 14')
    expect(tabTooltip({ title: 'Site', kind: 'web', physicalPage: 1, location: 'https://a.org/' }, 'https://a.org/b')).toBe('Site · https://a.org/b')
    expect(pdfCopySource('Feasting', 14)).toBe('Feasting, página física 14')
  })

  it('compara áreas da página web', () => {
    expect(sameRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false)
  })
})
