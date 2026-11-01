/**
 * Monta RTF como o NSAttributedString do Cocoa grava (cabeçalho cocoartf, tabela de fontes com
 * nomes PostScript, tabela de cores com branco na entrada 1, `\pard...\partightenfactor0` por
 * parágrafo, `\` + quebra de linha no fim do parágrafo, `\uc0\uN` para Unicode, `\'hh` para
 * cp1252, campos HYPERLINK) e com os estilos semânticos que DocumentRTF.encode guarda nas
 * palavras-chave: `PregarDocumentStyles.v1:` + base64 do JSON ordenado com intervalos UTF-16.
 */

export interface FixtureRun {
  text: string
  font?: number
  /** Pontos (vira \fs em meios-pontos). */
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** baselineOffset em pontos (\up em meios-pontos). */
  up?: number
  color?: number
  background?: number
  link?: string
}

export interface FixtureParagraph {
  runs: FixtureRun[]
  /** Pontos. */
  li?: number
  fi?: number
  ri?: number
  sb?: number
  sa?: number
  lineHeight?: number
  align?: 'ql' | 'qc' | 'qr' | 'qj'
  /** Trecho cru inserido antes do texto (por exemplo, `{\listtext ...}`). */
  raw?: string
}

export interface FixtureStyle {
  /** Parágrafos (índices) cobertos por este estilo, contíguos. */
  paragraphs: [number, number]
  style: string
}

export interface FixtureDocument {
  fonts?: string[]
  colors?: Array<[number, number, number]>
  paragraphs: FixtureParagraph[]
  styles?: FixtureStyle[]
  /** Palavras-chave antes da de estilos ("Sermão, "). */
  extraKeywords?: string
  /** Metadados já codificados (para testar entradas inválidas). */
  rawKeywords?: string
  trailingNewline?: boolean
}

export function encodeText(text: string): string {
  let out = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\' || character === '{' || character === '}') out += `\\${character}`
    else if (character === '\t') out += '\\tab '
    else if (code < 0x80) out += character
    else if (code >= 0xa0 && code <= 0xff) out += `\\'${code.toString(16)}`
    else for (let index = 0; index < character.length; index += 1) out += `\\uc0\\u${character.charCodeAt(index)} `
  }
  return out
}

interface RunState {
  font: number
  size: number
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  up: number
  color: number
  background: number
}

function formatting(previous: RunState, run: FixtureRun): { tokens: string; state: RunState } {
  const next: RunState = {
    font: run.font ?? 0,
    size: run.size ?? 11,
    bold: run.bold ?? false,
    italic: run.italic ?? false,
    underline: run.underline ?? false,
    strike: run.strike ?? false,
    up: run.up ?? 0,
    color: run.color ?? 2,
    background: run.background ?? 0,
  }
  let tokens = ''
  if (next.font !== previous.font) tokens += `\\f${next.font}`
  if (next.bold !== previous.bold) tokens += next.bold ? '\\b' : '\\b0'
  if (next.italic !== previous.italic) tokens += next.italic ? '\\i' : '\\i0'
  if (next.size !== previous.size) tokens += `\\fs${Math.round(next.size * 2)}`
  if (tokens) tokens += ' '
  if (next.color !== previous.color) tokens += `\\cf${next.color} `
  if (next.background !== previous.background) tokens += `\\cb${next.background} `
  if (next.underline !== previous.underline) tokens += next.underline ? '\\ul \\ulc0 ' : '\\ulnone '
  if (next.strike !== previous.strike) tokens += next.strike ? '\\strike \\strikec0 ' : '\\strike0\\striked0 '
  if (next.up !== previous.up) tokens += `\\up${Math.round(next.up * 2)} `
  return { tokens, state: next }
}

function utf16Length(value: string): number {
  return value.length
}

export function semanticKeywords(document: FixtureDocument): string {
  if (document.rawKeywords !== undefined) return document.rawKeywords
  if (!document.styles?.length) return ''
  const starts: number[] = []
  let offset = 0
  document.paragraphs.forEach((paragraph, index) => {
    starts.push(offset)
    offset += utf16Length(paragraph.runs.map((run) => run.text).join(''))
    if (index < document.paragraphs.length - 1 || document.trailingNewline) offset += 1
  })
  starts.push(offset)
  const runs = document.styles.map((style) => {
    const location = starts[style.paragraphs[0]] ?? 0
    const end = starts[style.paragraphs[1] + 1] ?? offset
    // Chaves em ordem alfabética, como JSONEncoder com .sortedKeys.
    return { length: end - location, location, style: style.style }
  })
  const bytes = new TextEncoder().encode(JSON.stringify(runs))
  return `${document.extraKeywords ?? ''}PregarDocumentStyles.v1:${btoa(String.fromCharCode(...bytes))}`
}

export function cocoaRtf(document: FixtureDocument): string {
  const fonts = document.fonts ?? ['ArialMT']
  const colors = document.colors ?? []
  let rtf = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2822\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl'
  fonts.forEach((name, index) => {
    rtf += `\\f${index}\\fswiss\\fcharset0 ${name};`
  })
  rtf += '}\n{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;'
  for (const [r, g, b] of colors) rtf += `\\red${r}\\green${g}\\blue${b};`
  rtf += '}\n{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;'
  for (let index = 0; index < colors.length; index += 1) rtf += '\\csgenericrgb\\c50000\\c50000\\c50000;'
  rtf += '}\n'
  const keywords = semanticKeywords(document)
  if (keywords) rtf += `{\\info\n{\\keywords ${keywords}}}`
  rtf += '\\paperw11900\\paperh16840\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0\n\\deftab720\n'
  let state: RunState = { font: -1, size: -1, bold: false, italic: false, underline: false, strike: false, up: 0, color: 0, background: 0 }
  document.paragraphs.forEach((paragraph, index) => {
    const twips = (points: number | undefined) => Math.round((points ?? 0) * 20)
    rtf += '\\pard\\pardeftab720'
    if (paragraph.li) rtf += `\\li${twips(paragraph.li)}`
    if (paragraph.li !== undefined || paragraph.fi) rtf += `\\fi${twips(paragraph.fi)}`
    if (paragraph.ri) rtf += `\\ri${twips(paragraph.ri)}`
    if (paragraph.sb) rtf += `\\sb${twips(paragraph.sb)}`
    if (paragraph.sa) rtf += `\\sa${twips(paragraph.sa)}`
    rtf += `\\sl${Math.round((paragraph.lineHeight ?? 1.15) * 240)}\\slmult1`
    if (paragraph.align) rtf += `\\${paragraph.align}`
    rtf += '\\partightenfactor0\n\n'
    if (paragraph.raw) rtf += paragraph.raw
    for (const run of paragraph.runs) {
      const { tokens, state: next } = formatting(state, run)
      if (run.link) {
        rtf += `{\\field{\\*\\fldinst{HYPERLINK "${run.link}"}}{\\fldrslt ${tokens}${encodeText(run.text)}}}`
      } else {
        rtf += tokens + encodeText(run.text)
        state = next
      }
    }
    if (index < document.paragraphs.length - 1 || document.trailingNewline) rtf += '\\\n'
  })
  return `${rtf}}`
}

/** Atalho: parágrafo de corpo com um único trecho. */
export function body(text: string, run: Omit<FixtureRun, 'text'> = {}, paragraph: Omit<FixtureParagraph, 'runs'> = {}): FixtureParagraph {
  return { runs: [{ text, ...run }], ...paragraph }
}
