import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyUserData } from '../../src/main/legacy-data'

function appData(): { root: string; legacy: string; current: string } {
  const root = mkdtempSync(join(tmpdir(), 'proper-legacy-'))
  return { root, legacy: join(root, 'Pregar'), current: join(root, 'Proper') }
}

function fillLegacy(legacy: string): void {
  mkdirSync(join(legacy, 'Library'), { recursive: true })
  writeFileSync(join(legacy, 'pregar.sqlite'), 'banco')
  writeFileSync(join(legacy, 'secrets.bin'), 'cofre')
  writeFileSync(join(legacy, 'Library', 'comentario.pdf'), 'pdf')
  writeFileSync(join(legacy, 'Preferences'), 'chromium')
}

describe('migrateLegacyUserData (pasta Pregar → Proper)', () => {
  it('sem pasta antiga, não faz nada', () => {
    const { legacy, current } = appData()
    expect(migrateLegacyUserData(legacy, current)).toBe('none')
    expect(existsSync(current)).toBe(false)
  })

  it('move a pasta inteira quando a nova ainda não existe', () => {
    const { legacy, current } = appData()
    fillLegacy(legacy)
    expect(migrateLegacyUserData(legacy, current)).toBe('moved')
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(join(current, 'pregar.sqlite'), 'utf8')).toBe('banco')
    expect(readFileSync(join(current, 'Library', 'comentario.pdf'), 'utf8')).toBe('pdf')
  })

  it('move só o que é do app quando o Chromium já criou a pasta nova', () => {
    const { legacy, current } = appData()
    fillLegacy(legacy)
    mkdirSync(current, { recursive: true })
    writeFileSync(join(current, 'Local State'), 'chromium novo')
    expect(migrateLegacyUserData(legacy, current)).toBe('moved')
    expect(readFileSync(join(current, 'pregar.sqlite'), 'utf8')).toBe('banco')
    expect(readFileSync(join(current, 'secrets.bin'), 'utf8')).toBe('cofre')
    expect(readFileSync(join(current, 'Library', 'comentario.pdf'), 'utf8')).toBe('pdf')
    expect(readFileSync(join(current, 'Local State'), 'utf8')).toBe('chromium novo')
    // A pasta antiga fica só com o que era do Chromium.
    expect(existsSync(join(legacy, 'Preferences'))).toBe(true)
    expect(existsSync(join(legacy, 'pregar.sqlite'))).toBe(false)
  })

  it('nunca sobrescreve um banco já existente na pasta nova', () => {
    const { legacy, current } = appData()
    fillLegacy(legacy)
    mkdirSync(current, { recursive: true })
    writeFileSync(join(current, 'pregar.sqlite'), 'banco novo')
    expect(migrateLegacyUserData(legacy, current)).toBe('kept')
    expect(readFileSync(join(current, 'pregar.sqlite'), 'utf8')).toBe('banco novo')
    expect(readFileSync(join(legacy, 'pregar.sqlite'), 'utf8')).toBe('banco')
  })
})
