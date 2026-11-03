import { describe, expect, it } from 'vitest'
import {
  Stopwatch,
  TARGET_MINUTES,
  clampFontSize,
  elapsedLabel,
  estimatedMinutes,
  isOverTime,
  paceNote,
  rehearsalSubtitle,
  timeline,
  toggleLabel,
} from '../../src/renderer/src/views/mesa/sheets/rehearsal'
import {
  SHORTCUT_TABLES,
  MESA_COMMANDS,
  filterCommands,
  platformKeys,
} from '../../src/renderer/src/views/mesa/sheets/commands'

describe('modo ensaio', () => {
  it('estima ≈ 96 palavras por minuto', () => {
    expect(estimatedMinutes(1920)).toBe(20)
    expect(estimatedMinutes(-5)).toBe(0)
    expect(rehearsalSubtitle(2115)).toBe('2.115 palavras · estimativa ≈ 22 min · alvo 18 a 25 min')
  })

  it('formata o cronômetro em minutos e segundos', () => {
    expect(elapsedLabel(0)).toBe('00:00')
    expect(elapsedLabel(65.4)).toBe('01:05')
    expect(elapsedLabel(75 * 60)).toBe('75:00')
  })

  it('a nota de ritmo muda com o tempo decorrido', () => {
    expect(paceNote(10)).toBe('Leia em voz alta, no ritmo do púlpito.')
    expect(paceNote(5 * 60)).toBe('Sem pressa: caminhe pelo texto guiando as pessoas.')
    expect(paceNote(18 * 60)).toBe('Dentro da faixa habitual de 18 a 25 minutos.')
    expect(paceNote(25 * 60)).toBe('Dentro da faixa habitual de 18 a 25 minutos.')
    expect(paceNote(25 * 60 + 1)).toBe(
      'Passou dos 25 minutos: o workshop lembra que não ser prolixo também é cuidado.',
    )
    expect(isOverTime(25 * 60)).toBe(false)
    expect(isOverTime(26 * 60)).toBe(true)
  })

  it('a linha do tempo cobre a faixa com folga e acompanha textos longos', () => {
    const short = timeline(15 * 60, 12)
    expect(short.scaleMinutes).toBe(30)
    expect(short.elapsed).toBeCloseTo(0.5)
    expect(short.bandStart).toBeCloseTo(TARGET_MINUTES.lower / 30)
    expect(short.bandEnd).toBeCloseTo(TARGET_MINUTES.upper / 30)
    expect(short.estimate).toBeCloseTo(0.4)

    const long = timeline(60 * 60, 40)
    expect(long.scaleMinutes).toBe(45)
    expect(long.elapsed).toBe(1)
    expect(long.estimate).toBeCloseTo(40 / 45)

    expect(timeline(0, 0).estimate).toBeNull()
  })

  it('limita o tipo de 14 a 36 pt', () => {
    expect(clampFontSize(10)).toBe(14)
    expect(clampFontSize(40)).toBe(36)
    expect(clampFontSize(21.6)).toBe(22)
    expect(clampFontSize(Number.NaN)).toBe(22)
  })

  it('o cronômetro soma os trechos em que esteve rodando', () => {
    let now = 0
    const stopwatch = new Stopwatch(() => now)
    expect(toggleLabel(stopwatch.running, stopwatch.elapsed())).toBe('Iniciar')
    stopwatch.toggle()
    now = 30_000
    expect(stopwatch.elapsed()).toBe(30)
    expect(toggleLabel(stopwatch.running, stopwatch.elapsed())).toBe('Pausar')
    stopwatch.toggle()
    now = 90_000
    expect(stopwatch.elapsed()).toBe(30)
    expect(toggleLabel(stopwatch.running, stopwatch.elapsed())).toBe('Continuar')
    stopwatch.toggle()
    now = 100_000
    expect(stopwatch.elapsed()).toBe(40)
    stopwatch.reset()
    expect(stopwatch.elapsed()).toBe(0)
    expect(stopwatch.running).toBe(false)
  })
})

describe('atalhos e comandos', () => {
  it('escreve os atalhos para Windows e Linux', () => {
    expect(platformKeys('⇧⌥⌘R', false)).toBe('Ctrl+Alt+Shift+R')
    expect(platformKeys('⌘[ · ⌘]', false)).toBe('Ctrl+[ · Ctrl+]')
    expect(platformKeys('⌃Tab · ⇧⌃Tab', false)).toBe('Ctrl+Tab · Ctrl+Shift+Tab')
    expect(platformKeys('⌥/', false)).toBe('Alt+/')
    expect(platformKeys('⇧⌥⌘R', true)).toBe('⇧⌥⌘R')
  })

  it('traz as tabelas do README', () => {
    expect(SHORTCUT_TABLES.map((table) => table.title)).toEqual(['Escrita', 'Preparação', 'Leitor'])
    expect(SHORTCUT_TABLES[1]!.rows.at(-1)).toEqual({
      keys: '⇧⌥⌘R · ⇧⌥⌘E · ⇧⌘T · ⇧⌥⌘H',
      action: 'Revisar · Ensaio · Levar para o púlpito · Histórico de versões',
    })
  })

  it('filtra comandos sem distinguir acentos e por sinônimos', () => {
    expect(filterCommands(MESA_COMMANDS, 'historico').map((command) => command.id)).toEqual(['history'])
    expect(filterCommands(MESA_COMMANDS, 'cronometro').map((command) => command.id)).toEqual(['rehearsal'])
    expect(filterCommands(MESA_COMMANDS, 'abrir bib').map((command) => command.id)).toEqual([
      'openBible',
      'openLibrary',
    ])
    expect(filterCommands(MESA_COMMANDS, '  ')).toHaveLength(MESA_COMMANDS.length)
    expect(filterCommands(MESA_COMMANDS, 'xyz')).toEqual([])
  })

  it('não repete identificadores', () => {
    expect(new Set(MESA_COMMANDS.map((command) => command.id)).size).toBe(MESA_COMMANDS.length)
  })
})
