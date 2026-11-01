/**
 * Importação do RTF gravado pelo app Swift (lado de leitura de DocumentRTF) para o JSON do
 * editor. Lê tabela de fontes e cores, \b \i \ul \strike \super \sub \up \dn, \fs, \li \fi \sb
 * \sa \sl\slmult, \qc \qr \qj, \par, \line, \uN, \'hh, campos HYPERLINK e os estilos
 * semânticos que o Swift grava nas palavras-chave (JSON em base64 com intervalos UTF-16).
 * Representações antigas: título = negrito ≥ 13 pt; citação = recuo de 34 pt; lista = marcador
 * literal "• " (ou "1. ", "☐ "); nota = número sobrescrito + parágrafo "¹ texto" na área de notas.
 */
import type { JSONContent } from '@tiptap/core'
import {
  BODY_FONT_FAMILY,
  BODY_FONT_SIZE_PT,
  BODY_LINE_HEIGHT,
  HEADING_SPACE_AFTER_PT,
  HEADING_SPACE_BEFORE_PT,
  headingFontSizePt,
  LEGACY_HEADING_MIN_PT,
  QUOTE_INDENT_PT,
  QUOTE_INK_COLOR,
  QUOTE_PAPER_COLOR,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
} from './styles'
import { colorDistance, cssNumber, defaultIdGenerator, isSafeLinkHref, roundTo, type IdGenerator } from './util'

type JSONMark = NonNullable<JSONContent['marks']>[number]

export const PREGAR_STYLES_PREFIX = 'PregarDocumentStyles.v1:'

export type SemanticStyle = 'normal' | 'title' | 'subtitle' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'
const SEMANTIC_STYLES = new Set<string>(['normal', 'title', 'subtitle', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'])

export interface RtfCharFormat {
  font: number
  /** Meios-pontos (\fs). */
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
  /** Índices na tabela de cores; 0 = automático. */
  color: number
  background: number
  hidden: boolean
}

export interface RtfParFormat {
  /** Valores em twips (1/20 pt), como no RTF. */
  li: number
  fi: number
  ri: number
  sb: number
  sa: number
  sl: number
  slmult: number
  align: 'left' | 'center' | 'right' | 'justify' | null
}

export interface RtfRun {
  text: string
  format: RtfCharFormat
  link: string | null
  /** Nota nativa do RTF (\footnote), quando houver. */
  note?: string
}

export interface RtfParagraph {
  runs: RtfRun[]
  format: RtfParFormat
  /** Início do parágrafo em unidades UTF-16 do texto do NSAttributedString. */
  start: number
  /** Marcador de lista nativa (\listtext), quando houver. */
  listText?: string
}

export interface RtfStyleRun {
  location: number
  length: number
  style: SemanticStyle
}

export interface ParsedRtf {
  paragraphs: RtfParagraph[]
  fonts: Map<number, string>
  colors: Array<string | null>
  keywords: string
  /** Comprimento do texto em UTF-16, como `NSAttributedString.length`. */
  length: number
  styles: RtfStyleRun[]
}

const defaultChar = (font = 0): RtfCharFormat => ({
  font,
  fontSize: 24,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  color: 0,
  background: 0,
  hidden: false,
})

const defaultPar = (): RtfParFormat => ({ li: 0, fi: 0, ri: 0, sb: 0, sa: 0, sl: 0, slmult: 0, align: null })

type Destination = 'text' | 'skip' | 'fonttbl' | 'colortbl' | 'info' | 'keywords' | 'fldinst' | 'listtext' | 'footnote'

interface FieldContext {
  instruction: string
}

interface GroupState {
  char: RtfCharFormat
  par: RtfParFormat
  dest: Destination
  uc: number
  link: string | null
  field: FieldContext | null
  ignorable: boolean
  firstWord: boolean
  footnote: { text: string } | null
}

const SKIPPED_DESTINATIONS = new Set([
  'stylesheet',
  'pict',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'object',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'rsidtbl',
  'xmlnstbl',
  'listtable',
  'listoverridetable',
  'revtbl',
  'generator',
  'title',
  'subject',
  'author',
  'operator',
  'company',
  'doccomm',
  'comment',
  'creatim',
  'revtim',
  'printim',
  'buptim',
  'category',
  'manager',
  'hlinkbase',
  'nonshppict',
  'bkmkstart',
  'bkmkend',
  'xe',
  'tc',
  'txe',
  'ftnsep',
  'ftnsepc',
  'aftnsep',
])

const SYMBOLS: Record<string, string> = {
  tab: '\t',
  line: '\u2028',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  enspace: '\u2002',
  emspace: '\u2003',
  qmspace: '\u2005',
  zwj: '\u200d',
  zwnj: '\u200c',
  ltrmark: '\u200e',
  rtlmark: '\u200f',
}

const CP1252: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
}

function decodeByte(byte: number): string {
  return CP1252[byte] ?? String.fromCharCode(byte)
}

function sameFormat(a: RtfCharFormat, b: RtfCharFormat): boolean {
  return (
    a.font === b.font &&
    a.fontSize === b.fontSize &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.color === b.color &&
    a.background === b.background
  )
}

function hyperlinkTarget(instruction: string): string | null {
  const match = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"|HYPERLINK\s+(\S+)/i.exec(instruction)
  const target = (match?.[1] ?? match?.[2] ?? '').trim()
  return isSafeLinkHref(target) ? target : null
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Lê os estilos semânticos gravados por DocumentRTF.encode, validando os intervalos. */
export function decodeSemanticStyles(keywords: string, length: number): RtfStyleRun[] {
  const match = /PregarDocumentStyles\.v1:([A-Za-z0-9+/=]+)/.exec(keywords)
  if (!match?.[1] || match[1].length > 1_000_000) return []
  const json = decodeBase64Utf8(match[1])
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || parsed.length > 20_000) return []
  const runs: RtfStyleRun[] = []
  for (const entry of parsed as Array<Record<string, unknown>>) {
    const location = entry?.location
    const size = entry?.length
    const style = entry?.style
    if (typeof location !== 'number' || typeof size !== 'number' || typeof style !== 'string') continue
    if (!Number.isInteger(location) || !Number.isInteger(size) || location < 0 || size <= 0) continue
    if (location > length || size > length - location || !SEMANTIC_STYLES.has(style)) continue
    runs.push({ location, length: size, style: style as SemanticStyle })
  }
  return runs
}

/** Analisa o RTF em parágrafos e trechos com formatação, sem interpretar o significado. */
export function parseRtf(input: string | Uint8Array): ParsedRtf {
  const source = typeof input === 'string' ? input : Array.from(input, (byte) => String.fromCharCode(byte)).join('')
  const fonts = new Map<number, string>()
  const colors: Array<string | null> = []
  const paragraphs: RtfParagraph[] = []
  let keywords = ''
  let defaultFont = 0
  let offset = 0
  let fontIndex = 0
  let fontName = ''
  let color: { r: number | null; g: number | null; b: number | null } = { r: null, g: null, b: null }
  let pendingSkip = 0

  let state: GroupState = {
    char: defaultChar(),
    par: defaultPar(),
    dest: 'text',
    uc: 1,
    link: null,
    field: null,
    ignorable: false,
    firstWord: false,
    footnote: null,
  }
  const stack: GroupState[] = []
  let paragraph: RtfParagraph = { runs: [], format: defaultPar(), start: 0 }

  const appendRun = (text: string, extra?: { note: string }) => {
    if (!text && !extra) return
    const last = paragraph.runs[paragraph.runs.length - 1]
    if (!extra && last && last.note === undefined && last.link === state.link && sameFormat(last.format, state.char)) {
      last.text += text
    } else {
      const run: RtfRun = { text, format: { ...state.char }, link: state.link }
      if (extra) run.note = extra.note
      paragraph.runs.push(run)
    }
    offset += text.length
  }

  const finishParagraph = () => {
    paragraph.format = { ...state.par }
    paragraphs.push(paragraph)
    offset += 1
    paragraph = { runs: [], format: defaultPar(), start: offset }
  }

  const emit = (text: string) => {
    if (pendingSkip > 0) {
      const skipped = Math.min(pendingSkip, text.length)
      pendingSkip -= skipped
      text = text.slice(skipped)
      if (!text) return
    }
    switch (state.dest) {
      case 'text':
        if (!state.char.hidden) appendRun(text)
        break
      case 'fonttbl':
        for (const character of text) {
          if (character === ';') {
            fonts.set(fontIndex, fontName.trim())
            fontName = ''
          } else {
            fontName += character
          }
        }
        break
      case 'colortbl':
        for (const character of text) {
          if (character !== ';') continue
          const { r, g, b } = color
          colors.push(
            r === null && g === null && b === null
              ? null
              : `#${[r ?? 0, g ?? 0, b ?? 0].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`,
          )
          color = { r: null, g: null, b: null }
        }
        break
      case 'keywords':
        keywords += text
        break
      case 'fldinst':
        if (state.field) state.field.instruction += text
        break
      case 'listtext':
        paragraph.listText = (paragraph.listText ?? '') + text
        break
      case 'footnote':
        if (state.footnote) state.footnote.text += text
        break
      default:
        break
    }
  }

  const setDestination = (dest: Destination) => {
    state.dest = dest
  }

  const handleWord = (word: string, param: number | null) => {
    const first = state.firstWord
    state.firstWord = false
    if (state.ignorable && first && word !== 'fldinst' && word !== 'keywords') {
      setDestination('skip')
      return
    }
    if (state.dest === 'skip') return
    if (SKIPPED_DESTINATIONS.has(word)) {
      setDestination('skip')
      return
    }
    const on = param === null || param !== 0
    switch (word) {
      case 'fonttbl':
        setDestination('fonttbl')
        return
      case 'colortbl':
        setDestination('colortbl')
        color = { r: null, g: null, b: null }
        return
      case 'info':
        setDestination('info')
        return
      case 'keywords':
        setDestination('keywords')
        return
      case 'field':
        state.field = { instruction: '' }
        return
      case 'fldinst':
        setDestination('fldinst')
        return
      case 'fldrslt':
        setDestination('text')
        state.link = state.field ? hyperlinkTarget(state.field.instruction) : null
        return
      case 'listtext':
        setDestination('listtext')
        return
      case 'footnote':
        setDestination('footnote')
        state.footnote = { text: '' }
        return
      case 'deff':
        defaultFont = param ?? 0
        return
    }
    if (state.dest === 'fonttbl') {
      if (word === 'f') fontIndex = param ?? 0
      return
    }
    if (state.dest === 'colortbl') {
      if (word === 'red') color.r = param ?? 0
      else if (word === 'green') color.g = param ?? 0
      else if (word === 'blue') color.b = param ?? 0
      return
    }
    if (word === 'u' && param !== null) {
      emit(String.fromCharCode(param < 0 ? param + 65536 : param))
      pendingSkip = state.uc
      return
    }
    if (word === 'uc') {
      state.uc = Math.max(0, param ?? 1)
      return
    }
    if (state.dest !== 'text' && state.dest !== 'footnote' && state.dest !== 'listtext') {
      const symbol = SYMBOLS[word]
      if (symbol && state.dest !== 'info') emit(symbol)
      return
    }
    const char = state.char
    switch (word) {
      case 'par':
      case 'sect':
      case 'page':
      case 'row':
        if (state.dest === 'footnote') emit('\n')
        else if (state.dest === 'text') finishParagraph()
        return
      case 'cell':
        emit('\t')
        return
      case 'pard':
        state.par = defaultPar()
        return
      case 'plain':
        state.char = defaultChar(defaultFont)
        return
      case 'b':
        char.bold = on
        return
      case 'i':
        char.italic = on
        return
      case 'ul':
        char.underline = on
        return
      case 'ulnone':
        char.underline = false
        return
      case 'strike':
        char.strike = on
        return
      case 'striked':
        char.strike = on
        return
      case 'super':
        char.superscript = true
        char.subscript = false
        return
      case 'sub':
        char.subscript = true
        char.superscript = false
        return
      case 'nosupersub':
        char.superscript = false
        char.subscript = false
        return
      case 'up':
        char.superscript = (param ?? 6) > 0
        if (char.superscript) char.subscript = false
        return
      case 'dn':
        char.subscript = (param ?? 6) > 0
        if (char.subscript) char.superscript = false
        return
      case 'fs':
        char.fontSize = param ?? 24
        return
      case 'f':
        char.font = param ?? 0
        return
      case 'cf':
        char.color = param ?? 0
        return
      case 'cb':
      case 'highlight':
      case 'chcbpat':
        char.background = param ?? 0
        return
      case 'v':
        char.hidden = on
        return
      case 'li':
        state.par.li = param ?? 0
        return
      case 'fi':
        state.par.fi = param ?? 0
        return
      case 'ri':
        state.par.ri = param ?? 0
        return
      case 'sb':
        state.par.sb = param ?? 0
        return
      case 'sa':
        state.par.sa = param ?? 0
        return
      case 'sl':
        state.par.sl = param ?? 0
        return
      case 'slmult':
        state.par.slmult = param ?? 0
        return
      case 'ql':
        state.par.align = 'left'
        return
      case 'qc':
        state.par.align = 'center'
        return
      case 'qr':
        state.par.align = 'right'
        return
      case 'qj':
        state.par.align = 'justify'
        return
      case 'qn':
      case 'qd':
        state.par.align = null
        return
    }
    if (word.startsWith('ul') && word !== 'ulc' && !word.startsWith('ulc')) {
      char.underline = on
      return
    }
    const symbol = SYMBOLS[word]
    if (symbol) emit(symbol)
  }

  let index = 0
  const length = source.length
  while (index < length) {
    const character = source[index] ?? ''
    if (character === '{') {
      stack.push(state)
      state = { ...state, char: { ...state.char }, par: { ...state.par }, ignorable: false, firstWord: true }
      pendingSkip = 0
      index += 1
      continue
    }
    if (character === '}') {
      const closing = state
      const parent = stack.pop()
      if (parent) {
        if (closing.dest === 'fonttbl' && parent.dest !== 'fonttbl' && fontName.trim()) {
          fonts.set(fontIndex, fontName.trim())
          fontName = ''
        }
        state = parent
        if (closing.dest === 'footnote' && closing.footnote && state.dest === 'text') {
          appendRun('', { note: closing.footnote.text.trim() })
        }
      }
      pendingSkip = 0
      index += 1
      continue
    }
    if (character === '\\') {
      const next = source[index + 1] ?? ''
      if (/[a-zA-Z]/.test(next)) {
        let end = index + 1
        while (end < length && /[a-zA-Z]/.test(source[end] ?? '') && end - index <= 32) end += 1
        const word = source.slice(index + 1, end)
        let param: number | null = null
        const paramMatch = /^-?\d{1,10}/.exec(source.slice(end, end + 11))
        if (paramMatch) {
          param = Number(paramMatch[0])
          end += paramMatch[0].length
        }
        if (source[end] === ' ') end += 1
        if (word !== 'u') pendingSkip = 0
        handleWord(word, param)
        index = end
        continue
      }
      if (next === "'") {
        const hex = source.slice(index + 2, index + 4)
        const byte = parseInt(hex, 16)
        if (state.dest !== 'skip' && Number.isFinite(byte)) emit(decodeByte(byte))
        index += 4
        continue
      }
      index += 2
      if (next === '\n' || next === '\r') {
        if (state.dest === 'text') finishParagraph()
        else if (state.dest === 'footnote') emit('\n')
      } else if (next === '*') {
        state.ignorable = true
      } else if (next === '~') {
        emit('\u00a0')
      } else if (next === '_') {
        emit('\u2011')
      } else if (next === '{' || next === '}' || next === '\\') {
        emit(next)
      } else if (next === '-') {
        // Hífen opcional: não aparece no texto.
      } else if (next === '\t') {
        emit('\t')
      }
      continue
    }
    if (character === '\n' || character === '\r') {
      index += 1
      continue
    }
    if (state.dest !== 'skip') {
      // Texto corrido até o próximo caractere de controle.
      let end = index + 1
      while (end < length && !'{}\\\n\r'.includes(source[end] ?? '')) end += 1
      emit(source.slice(index, end))
      index = end
      continue
    }
    index += 1
  }
  if (paragraph.runs.length || paragraph.listText) {
    paragraph.format = { ...state.par }
    paragraphs.push(paragraph)
  }
  return { paragraphs, fonts, colors, keywords, length: offset, styles: decodeSemanticStyles(keywords, offset) }
}

// MARK: - Fontes

const KNOWN_FAMILIES: Record<string, string> = {
  arial: 'Arial',
  arialmt: 'Arial',
  timesnewroman: 'Times New Roman',
  timesnewromanps: 'Times New Roman',
  timesnewromanpsmt: 'Times New Roman',
  couriernew: 'Courier New',
  couriernewpsmt: 'Courier New',
  helvetica: 'Helvetica',
  helveticaneue: 'Helvetica Neue',
  georgia: 'Georgia',
  verdana: 'Verdana',
  trebuchetms: 'Trebuchet MS',
  calibri: 'Calibri',
  cambria: 'Cambria',
  times: 'Times',
  palatino: 'Palatino',
  palatinolinotype: 'Palatino Linotype',
  bookantiqua: 'Book Antiqua',
  garamond: 'Garamond',
  baskerville: 'Baskerville',
}

export interface FontInfo {
  family: string | null
  bold: boolean
  italic: boolean
}

/** Converte o nome PostScript do Cocoa ("Arial-BoldItalicMT") em família e traços. */
export function fontInfo(name: string | undefined): FontInfo {
  const raw = (name ?? '').trim()
  if (!raw || raw.startsWith('.')) return { family: null, bold: false, italic: false }
  const [base = '', ...rest] = raw.split('-')
  const style = rest.join('-')
  const bold = /bold|black|heavy|semibold|demi/i.test(style) || /\b(bold|black)\b/i.test(base)
  const italic = /italic|oblique/i.test(style) || /\b(italic|oblique)\b/i.test(base)
  const compact = base.replace(/\s+/g, '').toLowerCase()
  const known = KNOWN_FAMILIES[compact] ?? KNOWN_FAMILIES[compact.replace(/(psmt|mt|ps)$/, '')]
  if (known) return { family: known, bold, italic }
  if (/\s/.test(base)) return { family: base.replace(/\s+(bold|italic|oblique)\b.*$/i, '').trim(), bold, italic }
  const words = base
    .replace(/(PSMT|MT|PS)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
  return { family: words || null, bold, italic }
}

// MARK: - Conversão

interface Marker {
  paragraph: number
  run: number
  /** Posição no texto do trecho. */
  index: number
  length: number
  number: number
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

function superscriptToNumber(value: string): number {
  let digits = ''
  for (const character of value) {
    const digit = SUPERSCRIPT_DIGITS.indexOf(character)
    digits += digit >= 0 ? String(digit) : character
  }
  return Number(digits)
}

function paragraphText(paragraph: RtfParagraph): string {
  return paragraph.runs.map((run) => run.text).join('')
}

function findMarkers(paragraph: RtfParagraph, paragraphIndex: number): Marker[] {
  const markers: Marker[] = []
  paragraph.runs.forEach((run, runIndex) => {
    const pattern = run.format.superscript ? /[⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d+/g : /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g
    for (const match of run.text.matchAll(pattern)) {
      markers.push({ paragraph: paragraphIndex, run: runIndex, index: match.index ?? 0, length: match[0].length, number: superscriptToNumber(match[0]) })
    }
  })
  return markers
}

const NOTE_PATTERN = /^([⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d+) ([\s\S]*)$/

interface ParagraphPlan {
  source: RtfParagraph
  headingLevel: number
  semantic?: SemanticStyle
  legacyHeading: boolean
  quote: boolean
  list?: { kind: 'bullet' | 'ordered' | 'check'; number?: number; checked?: boolean; markerLength: number }
  /** Notas a substituir neste parágrafo: trecho (run, índice, tamanho) → texto da nota. */
  footnotes: Array<{ run: number; index: number; length: number; note: string }>
}

export interface RtfToTiptapOptions {
  generateId?: IdGenerator
}

function styleAt(styles: RtfStyleRun[], location: number): SemanticStyle | undefined {
  for (const style of styles) {
    if (location >= style.location && location < style.location + style.length) return style.style
  }
  return undefined
}

function levelForStyle(style: SemanticStyle | undefined): number {
  if (!style || style === 'normal' || style === 'subtitle') return 0
  if (style === 'title') return 1
  return Number(style.replace('heading', '')) || 0
}

function detectList(text: string, listText: string | undefined): ParagraphPlan['list'] {
  if (text.startsWith('• ')) return { kind: 'bullet', markerLength: 2 }
  if (text.startsWith('☐ ') || text.startsWith('☑ ')) return { kind: 'check', checked: text.startsWith('☑'), markerLength: 2 }
  const ordered = /^(\d+)\. /.exec(text)
  if (ordered?.[1]) return { kind: 'ordered', number: Number(ordered[1]), markerLength: ordered[0].length }
  const marker = listText?.replace(/\t/g, '').trim()
  if (marker) {
    const number = /^(\d+)[.)]?$/.exec(marker)
    if (number?.[1]) return { kind: 'ordered', number: Number(number[1]), markerLength: 0 }
    return { kind: 'bullet', markerLength: 0 }
  }
  return undefined
}

/** Converte o RTF gravado pelo app Swift no JSON do editor (com ids de bloco e de nota). */
export function rtfToTiptap(input: string | Uint8Array, options: RtfToTiptapOptions = {}): JSONContent {
  const parsed = parseRtf(input)
  const generateId = options.generateId ?? defaultIdGenerator
  const { paragraphs, styles } = parsed

  // Notas: parágrafos "¹ texto" cujo número já apareceu sobrescrito antes.
  const seen = new Map<number, Marker>()
  const notes = new Map<number, string>()
  const noteParagraphs = new Set<number>()
  paragraphs.forEach((paragraph, index) => {
    const text = paragraphText(paragraph)
    const match = NOTE_PATTERN.exec(text)
    if (match?.[1]) {
      const number = superscriptToNumber(match[1])
      if (seen.has(number) && !notes.has(number)) {
        notes.set(number, (match[2] ?? '').trim())
        noteParagraphs.add(index)
        return
      }
    }
    for (const marker of findMarkers(paragraph, index)) if (!seen.has(marker.number)) seen.set(marker.number, marker)
  })
  // A linha em branco que o Swift insere antes de cada nota sai junto com ela.
  for (const index of [...noteParagraphs]) {
    const previous = paragraphs[index - 1]
    if (previous && !noteParagraphs.has(index - 1) && paragraphText(previous) === '' && !previous.listText) noteParagraphs.add(index - 1)
  }

  const plans: ParagraphPlan[] = []
  paragraphs.forEach((paragraph, index) => {
    if (noteParagraphs.has(index)) return
    const text = paragraphText(paragraph)
    const semantic = styles.length ? styleAt(styles, paragraph.start) : undefined
    let headingLevel = levelForStyle(semantic)
    let legacyHeading = false
    if (!semantic) {
      const first = paragraph.runs.find((run) => run.text.trim().length > 0)
      if (first) {
        const font = fontInfo(parsed.fonts.get(first.format.font))
        if ((first.format.bold || font.bold) && first.format.fontSize / 2 >= LEGACY_HEADING_MIN_PT) {
          headingLevel = 2
          legacyHeading = true
        }
      }
    }
    const footnotes: ParagraphPlan['footnotes'] = []
    for (const [number, marker] of seen) {
      if (marker.paragraph !== index || !notes.has(number)) continue
      footnotes.push({ run: marker.run, index: marker.index, length: marker.length, note: notes.get(number) ?? '' })
    }
    const plan: ParagraphPlan = {
      source: paragraph,
      headingLevel,
      legacyHeading,
      quote: Math.abs(paragraph.format.li / 20 - QUOTE_INDENT_PT) < 0.5,
      footnotes,
    }
    if (semantic) plan.semantic = semantic
    const list = headingLevel === 0 ? detectList(text, paragraph.listText) : undefined
    if (list) plan.list = list
    plans.push(plan)
  })

  const content = groupBlocks(plans, parsed, generateId)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { id: generateId('block') } }] }
}

function groupBlocks(plans: ParagraphPlan[], parsed: ParsedRtf, generateId: IdGenerator): JSONContent[] {
  const blocks: JSONContent[] = []
  let index = 0
  while (index < plans.length) {
    const plan = plans[index]
    if (!plan) break
    if (plan.quote) {
      const quoted: ParagraphPlan[] = []
      while (plans[index]?.quote) quoted.push(plans[index++] as ParagraphPlan)
      blocks.push({ type: 'blockquote', attrs: { id: generateId('block') }, content: groupLists(quoted, parsed, generateId, true) })
      continue
    }
    const plain: ParagraphPlan[] = []
    while (plans[index] && !plans[index]?.quote) plain.push(plans[index++] as ParagraphPlan)
    blocks.push(...groupLists(plain, parsed, generateId, false))
  }
  return blocks
}

const LIST_NODE = { bullet: 'bulletList', ordered: 'orderedList', check: 'taskList' } as const

function groupLists(plans: ParagraphPlan[], parsed: ParsedRtf, generateId: IdGenerator, quote: boolean): JSONContent[] {
  const blocks: JSONContent[] = []
  let index = 0
  while (index < plans.length) {
    const plan = plans[index] as ParagraphPlan
    const kind = plan.list?.kind
    if (!kind) {
      blocks.push(textblock(plan, parsed, generateId, quote))
      index += 1
      continue
    }
    const items: JSONContent[] = []
    const first = plan.list?.number
    while (plans[index]?.list?.kind === kind) {
      const item = plans[index++] as ParagraphPlan
      const paragraph = textblock(item, parsed, generateId, quote)
      items.push(
        kind === 'check'
          ? { type: 'taskItem', attrs: { checked: item.list?.checked === true }, content: [paragraph] }
          : { type: 'listItem', content: [paragraph] },
      )
    }
    const attrs: Record<string, unknown> = { id: generateId('block') }
    if (kind === 'ordered') attrs.start = first ?? 1
    blocks.push({ type: LIST_NODE[kind], attrs, content: items })
  }
  return blocks
}

function textblock(plan: ParagraphPlan, parsed: ParsedRtf, generateId: IdGenerator, quote: boolean): JSONContent {
  const { source } = plan
  const format = source.format
  const level = plan.headingLevel
  const attrs: Record<string, unknown> = { id: generateId('block') }
  if (level > 0) attrs.level = level
  if (format.align && format.align !== 'left') attrs.textAlign = format.align

  const quoteIndent = quote ? QUOTE_INDENT_PT : 0
  const start = roundTo(format.li / 20 - quoteIndent, 2)
  const firstLine = roundTo((format.li + format.fi) / 20 - quoteIndent, 2)
  if (start > 0) attrs.indentStart = start
  if (firstLine !== Math.max(0, start) && firstLine >= 0) attrs.indentFirstLine = firstLine

  const before = roundTo(format.sb / 20, 2)
  const after = roundTo(format.sa / 20, 2)
  const defaults = quote
    ? [QUOTE_SPACE_BEFORE_PT, QUOTE_SPACE_AFTER_PT]
    : plan.legacyHeading
      ? [14, 4]
      : plan.semantic === 'title' || plan.semantic === 'subtitle'
        ? [0, 6]
        : level > 0
          ? [HEADING_SPACE_BEFORE_PT, HEADING_SPACE_AFTER_PT]
          : [0, 0]
  if (before !== defaults[0] && !(quote && before === 0)) attrs.spaceBefore = before
  if (after !== defaults[1] && !(quote && after === 0)) attrs.spaceAfter = after
  if (format.slmult === 1 && format.sl > 0) {
    const multiple = roundTo(format.sl / 240, 2)
    if (multiple !== BODY_LINE_HEIGHT) attrs.lineHeight = multiple
  }

  const markerLength = plan.list?.markerLength ?? 0
  const text = paragraphText(source).slice(markerLength)
  if (quote && level === 0 && /^[—–] /.test(text)) attrs.attribution = true

  const defaultSize = level > 0 ? headingFontSizePt(level) : BODY_FONT_SIZE_PT
  const content: JSONContent[] = []
  let skip = markerLength
  source.runs.forEach((run, runIndex) => {
    if (run.note !== undefined) {
      content.push({ type: 'footnote', attrs: { id: generateId('footnote'), note: run.note } })
      return
    }
    const marks = marksFor(run, parsed, { defaultSize, quote })
    // O marcador literal de lista ("• ", "1. ") sai do início do parágrafo.
    let cursor = Math.min(skip, run.text.length)
    skip -= cursor
    const replacements = plan.footnotes.filter((footnote) => footnote.run === runIndex).sort((a, b) => a.index - b.index)
    for (const footnote of replacements) {
      if (footnote.index < cursor) continue
      pushText(content, run.text.slice(cursor, footnote.index), marks)
      content.push({ type: 'footnote', attrs: { id: generateId('footnote'), note: footnote.note } })
      cursor = footnote.index + footnote.length
    }
    pushText(content, run.text.slice(cursor), marks)
  })
  const node: JSONContent = { type: level > 0 ? 'heading' : 'paragraph', attrs }
  if (content.length) node.content = content
  return node
}

/** Texto com quebras internas (\line, U+2028, \v) convertidas em hardBreak. */
function pushText(content: JSONContent[], text: string, marks: JSONMark[]): void {
  if (!text) return
  text.split(/[\u2028\u000b]/).forEach((part, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (!part) return
    const node: JSONContent = { type: 'text', text: part }
    if (marks.length) node.marks = marks
    content.push(node)
  })
}

function marksFor(run: RtfRun, parsed: ParsedRtf, context: { defaultSize: number; quote: boolean }): JSONMark[] {
  const format = run.format
  const font = fontInfo(parsed.fonts.get(format.font))
  const marks: JSONMark[] = []
  if (format.bold || font.bold) marks.push({ type: 'bold' })
  if (format.italic || font.italic) marks.push({ type: 'italic' })
  if (format.underline) marks.push({ type: 'underline' })
  if (format.strike) marks.push({ type: 'strike' })
  if (format.superscript) marks.push({ type: 'superscript' })
  else if (format.subscript) marks.push({ type: 'subscript' })
  if (run.link) marks.push({ type: 'link', attrs: { href: run.link } })

  const textStyle: Record<string, string> = {}
  if (font.family && font.family !== BODY_FONT_FAMILY) textStyle.fontFamily = font.family
  const size = format.fontSize / 2
  if (size !== context.defaultSize) textStyle.fontSize = `${cssNumber(size)}pt`
  const color = format.color > 0 ? parsed.colors[format.color] : null
  if (color && color !== '#000000' && !(context.quote && colorDistance(color, QUOTE_INK_COLOR) <= 8)) textStyle.color = color
  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle })

  const background = format.background > 0 ? parsed.colors[format.background] : null
  if (background && background !== '#ffffff' && !(context.quote && colorDistance(background, QUOTE_PAPER_COLOR) <= 8)) {
    marks.push({ type: 'highlight', attrs: { color: background } })
  }
  return marks
}
