import { describe, expect, it } from 'vitest'
import {
  abbreviateReference,
  chapterLabel,
  layoutFor,
  relativeDayLabel,
  shortDayLabel,
} from '../../src/renderer/src/views/mesa/mesa-layout'

const widths = { calendar: 248, readings: 360, materials: 340 }
const open = { focus: false, calendarOpen: true, readingsOpen: true, materialsOpen: true, widths }

describe('layoutFor', () => {
  it('a 1440 px atraca calendário, leituras e materiais ao lado do editor', () => {
    const layout = layoutFor({ width: 1440, ...open })
    expect(layout.rail).toBe('wide')
    expect(layout.calendar).toBe('docked')
    expect(layout.readings).toBe(360)
    expect(layout.materials).toBe('docked')
    expect(layout.materialsWidth).toBe(340)
    expect(
      layout.railWidth + layout.calendarWidth + layout.readings + layout.materialsWidth + 420,
    ).toBeLessThanOrEqual(1440)
  })

  it('a 1280 px o calendário vira popover do botão de data e os dois painéis continuam', () => {
    const layout = layoutFor({ width: 1279, ...open })
    expect(layout.calendar).toBe('popover')
    expect(layout.calendarWidth).toBe(0)
    expect(layout.readings).toBeGreaterThanOrEqual(260)
    expect(layout.materials).toBe('docked')
    expect(layout.labels).toBe(true)
  })

  it('a 1024 px o trilho fica compacto e os materiais viram gaveta quando as leituras estão abertas', () => {
    const layout = layoutFor({ width: 1024, ...open })
    expect(layout.rail).toBe('compact')
    expect(layout.labels).toBe(false)
    expect(layout.materials).toBe('drawer')
    expect(layout.readings).toBeGreaterThanOrEqual(260)
    const withoutReadings = layoutFor({ width: 1024, ...open, readingsOpen: false })
    expect(withoutReadings.materials).toBe('docked')
  })

  it('o foco esconde tudo', () => {
    const layout = layoutFor({ width: 1440, ...open, focus: true })
    expect(layout.calendar).toBe('hidden')
    expect(layout.readings).toBe(0)
    expect(layout.materials).toBe('hidden')
  })

  it('respeita os limites das larguras guardadas', () => {
    const layout = layoutFor({
      width: 1440,
      ...open,
      widths: { calendar: 900, readings: 10, materials: 9000 },
    })
    expect(layout.calendarWidth).toBe(320)
    expect(layout.readings).toBe(240)
    expect(layout.materialsWidth).toBeLessThanOrEqual(480)
  })
})

describe('rótulos curtos', () => {
  it('conta os dias de forma humana', () => {
    expect(relativeDayLabel(0)).toBe('hoje')
    expect(relativeDayLabel(1)).toBe('amanhã')
    expect(relativeDayLabel(6)).toBe('em 6 dias')
    expect(relativeDayLabel(-1)).toBe('ontem')
    expect(relativeDayLabel(-3)).toBe('há 3 dias')
  })

  it('abrevia referências e corta no capítulo', () => {
    expect(shortDayLabel(new Date(2026, 10, 8))).toBe('Dom 8/11')
    expect(abbreviateReference('1 Tessalonicenses 4:13-18')).toBe('1 Ts 4:13-18')
    expect(abbreviateReference('Mateus 25:1-13')).toBe('Mt 25:1-13')
    expect(abbreviateReference('Salmo 78:1-7')).toBe('Sl 78:1-7')
    expect(abbreviateReference('Livro Estranho 3')).toBe('Livro Estranho 3')
    expect(chapterLabel('Josué 24:1-3a, 14-25')).toBe('Josué 24')
    expect(chapterLabel('1 Tessalonicenses 4:13-18')).toBe('1 Tessalonicenses 4')
    expect(chapterLabel('Judas')).toBe('Judas')
  })
})
