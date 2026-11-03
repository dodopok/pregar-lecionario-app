import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withEmbeddedFonts } from '../../src/main/modules/content/print-fonts'

const dir = mkdtempSync(join(tmpdir(), 'proper-print-fonts-'))
const normal = join(dir, 'serif-normal.woff2')
const italic = join(dir, 'serif-italic.woff2')
writeFileSync(normal, 'wOF2-normal')
writeFileSync(italic, 'wOF2-italic')
const fonts = [
  {
    family: 'Source Serif 4',
    files: [
      { path: normal, style: 'normal' as const },
      { path: italic, style: 'italic' as const },
    ],
  },
  { family: 'Source Sans 3', files: [{ path: join(dir, 'nao-existe.woff2'), style: 'normal' as const }] },
]

describe('withEmbeddedFonts (folha do púlpito)', () => {
  it('embute em base64 só as famílias que a folha usa, antes dos estilos dela', () => {
    const html =
      '<!doctype html><html><head><style>body { font-family: "Source Serif 4", serif; }</style></head><body>x</body></html>'
    const out = withEmbeddedFonts(html, fonts)
    const inserted = out.slice(out.indexOf('<head>') + '<head>'.length, out.indexOf('<style>body'))
    expect(
      inserted.startsWith(
        '<style>@font-face{font-family:"Source Serif 4";font-style:normal;font-weight:200 900;',
      ),
    ).toBe(true)
    expect(inserted).toContain(`data:font/woff2;base64,${Buffer.from('wOF2-normal').toString('base64')}`)
    expect(inserted).toContain('font-style:italic')
    expect(inserted).toContain(`base64,${Buffer.from('wOF2-italic').toString('base64')}`)
    expect(inserted).not.toContain('Source Sans 3')
    expect(out.endsWith('<body>x</body></html>')).toBe(true)
  })

  it('deixa a folha como está quando ela usa só fontes do computador', () => {
    const html =
      '<!doctype html><html><head><style>body { font-family: "Georgia", serif; }</style></head><body>x</body></html>'
    expect(withEmbeddedFonts(html, fonts)).toBe(html)
  })
})
