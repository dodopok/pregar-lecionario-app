import { readFileSync } from 'node:fs'

/** Uma fonte embutida do app: nome da família e os arquivos .woff2 variáveis de cada estilo. */
export interface EmbeddedFont {
  family: string
  files: { path: string; style: 'normal' | 'italic' }[]
}

const rulesCache = new Map<string, string>()

/**
 * Regras @font-face, em base64, das fontes embutidas que o HTML cita (vazio quando a folha usa só
 * fontes do computador). A janela de impressão não acessa a rede nem os arquivos do pacote, então as
 * fontes do app só chegam lá dentro do próprio HTML. Cada família é lida do disco uma única vez.
 */
export function embeddedFontCss(html: string, fonts: readonly EmbeddedFont[]): string {
  let css = ''
  for (const font of fonts) {
    if (!html.includes(font.family)) continue
    let rules = rulesCache.get(font.family)
    if (rules === undefined) {
      rules = font.files
        .map(
          ({ path, style }) =>
            `@font-face{font-family:"${font.family}";font-style:${style};font-weight:200 900;` +
            `src:url(data:font/woff2;base64,${readFileSync(path).toString('base64')}) format("woff2-variations")}`,
        )
        .join('')
      rulesCache.set(font.family, rules)
    }
    css += rules
  }
  return css
}

/** HTML da folha com as fontes embutidas antes dos estilos dela. */
export function withEmbeddedFonts(html: string, fonts: readonly EmbeddedFont[]): string {
  const css = embeddedFontCss(html, fonts)
  if (!css) return html
  const tag = `<style>${css}</style>`
  return /<head>/i.test(html) ? html.replace(/<head>/i, `<head>${tag}`) : tag + html
}
