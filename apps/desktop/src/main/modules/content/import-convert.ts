/**
 * Conversão dos sermões antigos (.docx, .rtf, .txt e .md) para o documento do editor, sem Electron:
 * só Node, mammoth e o conversor de RTF do editor. O módulo `import.ts` cuida do diálogo, dos
 * candidatos em memória e da gravação. Tudo aqui é testável em processo.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { JSONContent } from '@tiptap/core'
import mammoth from 'mammoth'
import { parseReference, passageRelation } from '@pregar/core/bible/reference'
import { detectSermonMetadata } from '@pregar/core/import/metadata'
import type { LiturgicalDay } from '@pregar/core/liturgy/types'
import { countWords } from '@pregar/core/util/text'
import { manuscriptPlainText } from '@pregar/editor/richDocument'
import { rtfToTiptap } from '@pregar/editor/rtf'
import { defaultIdGenerator, isSafeLinkHref } from '@pregar/editor/util'
import type { IdGenerator } from '@pregar/editor/util'
import type { ImportCandidate, ImportFormat } from '@shared/ipc-import'
import type { SermonPatch } from '@shared/types'

export const IMPORT_EXTENSIONS: readonly ImportFormat[] = ['docx', 'rtf', 'txt', 'md']
export const MAX_IMPORT_FILES = 200
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FOLDER_DEPTH = 3

type JSONMark = NonNullable<JSONContent['marks']>[number]

export interface ConvertedDocument {
  doc: JSONContent
  plainText: string
  wordCount: number
  warnings: string[]
}

export function formatForFile(fileName: string): ImportFormat | null {
  const extension = extname(fileName).slice(1).toLowerCase()
  return IMPORT_EXTENSIONS.find((format) => format === extension) ?? null
}

// MARK: Pastas

export interface ExpandedPaths {
  files: string[]
  /** Havia mais arquivos do que o limite; os excedentes ficaram de fora. */
  truncated: boolean
}

/**
 * Arquivos escolhidos no diálogo: os indicados diretamente entram sempre (o formato é conferido
 * depois); pastas são percorridas até `maxDepth` níveis de subpastas, sem arquivos ou pastas
 * ocultos, com os arquivos de cada pasta antes das subpastas.
 */
export async function expandPaths(
  paths: readonly string[],
  options: { maxDepth?: number; limit?: number } = {},
): Promise<ExpandedPaths> {
  const maxDepth = options.maxDepth ?? MAX_FOLDER_DEPTH
  const limit = options.limit ?? MAX_IMPORT_FILES
  const files: string[] = []
  const seen = new Set<string>()
  let truncated = false

  const add = (file: string): boolean => {
    if (seen.has(file)) return true
    if (files.length >= limit) {
      truncated = true
      return false
    }
    seen.add(file)
    files.push(file)
    return true
  }

  async function walk(directory: string, depth: number): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort(
      (left, right) =>
        Number(left.isDirectory()) - Number(right.isDirectory()) ||
        left.name.localeCompare(right.name, 'pt-BR'),
    )
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1)
      } else if (entry.isFile() && formatForFile(entry.name)) {
        if (!add(full)) return
      }
      if (truncated) return
    }
  }

  for (const path of paths) {
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (info.isDirectory()) await walk(path, 0)
    else if (!add(path)) break
  }
  return { files, truncated }
}

// MARK: Nós do documento

function textNode(text: string, marks: readonly JSONMark[] = []): JSONContent {
  const node: JSONContent = { type: 'text', text }
  if (marks.length) node.marks = marks.map((mark) => ({ ...mark }))
  return node
}

function blockNode(
  type: string,
  generateId: IdGenerator,
  attrs: Record<string, unknown> = {},
  content?: JSONContent[],
): JSONContent {
  const node: JSONContent = { type, attrs: { id: generateId('block'), ...attrs } }
  if (content && content.length) node.content = content
  return node
}

function docNode(content: JSONContent[], generateId: IdGenerator): JSONContent {
  return { type: 'doc', content: content.length ? content : [blockNode('paragraph', generateId)] }
}

function sameMarks(left: readonly JSONMark[] | undefined, right: readonly JSONMark[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? [])
}

/** Acrescenta texto ao conteúdo, fundindo com o nó anterior quando as marcas são iguais. */
function pushText(content: JSONContent[], text: string, marks: readonly JSONMark[]): void {
  if (!text) return
  const last = content[content.length - 1]
  if (last && last.type === 'text' && sameMarks(last.marks, marks)) {
    last.text = (last.text ?? '') + text
    return
  }
  content.push(textNode(text, marks))
}

/** Tira espaços nas pontas do parágrafo e quebras soltas no fim; devolve falso quando não sobra nada. */
function tidyInline(content: JSONContent[]): boolean {
  const first = content[0]
  if (first?.type === 'text') first.text = (first.text ?? '').replace(/^\s+/, '')
  while (content.length) {
    const last = content[content.length - 1]!
    if (last.type === 'hardBreak') {
      content.pop()
      continue
    }
    if (last.type === 'text') {
      last.text = (last.text ?? '').replace(/\s+$/, '')
      if (last.text === '') {
        content.pop()
        continue
      }
    }
    break
  }
  if (content[0]?.type === 'text' && content[0].text === '') content.shift()
  return content.some((node) => node.type !== 'text' || (node.text ?? '') !== '')
}

// MARK: Texto puro e Markdown

/** UTF-8 (com ou sem BOM), UTF-16 com BOM ou, se nada disso valer, Windows-1252. */
export function decodeText(data: Uint8Array): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data)
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u2028|\u2029/g, '\n')
}

/**
 * Texto puro: blocos separados por linha em branco viram parágrafos e as quebras internas viram
 * quebras de linha (versos). Sem nenhuma linha em branco (exportação do Word), cada linha é um
 * parágrafo.
 */
export function textToDocument(text: string, generateId: IdGenerator = defaultIdGenerator): JSONContent {
  const normalized = normalizeNewlines(text).replace(/^\uFEFF/, '')
  const hasBlankLines = /\n[ \t]*\n/.test(normalized.trim())
  const blocks = hasBlankLines ? normalized.split(/\n[ \t]*\n+/) : normalized.split('\n')
  const content: JSONContent[] = []
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    if (!lines.length) continue
    const inline: JSONContent[] = []
    lines.forEach((line, index) => {
      if (index > 0) inline.push({ type: 'hardBreak' })
      inline.push(textNode(line))
    })
    content.push(blockNode('paragraph', generateId, {}, inline))
  }
  return docNode(content, generateId)
}

interface MarkdownState {
  images: number
}

const ESCAPABLE = new Set([
  '\\',
  '`',
  '*',
  '_',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '#',
  '+',
  '-',
  '.',
  '!',
  '~',
  '>',
  '|',
])

/** Marcas em linha do Markdown: negrito, itálico, tachado, código (vira texto), links e imagens. */
function markdownInline(
  source: string,
  state: MarkdownState,
  inherited: readonly JSONMark[] = [],
): JSONContent[] {
  const nodes: JSONContent[] = []
  const active: JSONMark[] = [...inherited]
  let buffer = ''
  const flush = () => {
    if (buffer) pushText(nodes, buffer, active)
    buffer = ''
  }
  const has = (type: string) => active.some((mark) => mark.type === type)
  const toggle = (type: string) => {
    flush()
    const index = active.findIndex((mark) => mark.type === type)
    if (index >= 0) active.splice(index, 1)
    else active.push({ type })
  }
  const closesLater = (delimiter: string, from: number) => source.indexOf(delimiter, from) !== -1

  let index = 0
  while (index < source.length) {
    const rest = source.slice(index)
    const char = rest[0]!
    if (char === '\\' && rest.length > 1 && ESCAPABLE.has(rest[1]!)) {
      buffer += rest[1]
      index += 2
      continue
    }
    if (rest.startsWith('![')) {
      const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest)
      if (image) {
        state.images += 1
        index += image[0].length
        continue
      }
    }
    if (char === '[') {
      const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/.exec(rest)
      if (link) {
        flush()
        const href = link[2]!
        const marks = isSafeLinkHref(href) ? [...active, { type: 'link', attrs: { href } }] : active
        for (const node of markdownInline(link[1]!, state, marks))
          pushText(nodes, node.text ?? '', node.marks ?? [])
        index += link[0].length
        continue
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(rest)
      if (auto && isSafeLinkHref(auto[1]!)) {
        flush()
        pushText(nodes, auto[1]!, [...active, { type: 'link', attrs: { href: auto[1]! } }])
        index += auto[0].length
        continue
      }
    }
    if (char === '`') {
      const end = rest.indexOf('`', 1)
      if (end > 0) {
        buffer += rest.slice(1, end)
        index += end + 1
        continue
      }
    }
    if (rest.startsWith('**') || rest.startsWith('__')) {
      const delimiter = rest.slice(0, 2)
      if (has('bold') || closesLater(delimiter, index + 2)) {
        toggle('bold')
        index += 2
        continue
      }
    }
    if (rest.startsWith('~~')) {
      if (has('strike') || closesLater('~~', index + 2)) {
        toggle('strike')
        index += 2
        continue
      }
    }
    if (char === '*' || char === '_') {
      const previous = index > 0 ? source[index - 1]! : ' '
      const next = rest[1] ?? ' '
      const boundary = char === '*' || /[\s\p{P}]/u.test(previous) || /[\s\p{P}]/u.test(next)
      if (
        boundary &&
        (has('italic')
          ? /[\s\p{P}]/u.test(next) || next === ' ' || index + 1 >= source.length || char === '*'
          : /\S/.test(next) && closesLater(char, index + 1))
      ) {
        toggle('italic')
        index += 1
        continue
      }
    }
    buffer += char
    index += 1
  }
  flush()
  return nodes
}

interface ListItemDraft {
  level: number
  lines: string[]
  children: ListDraft | null
}

interface ListDraft {
  kind: 'bulletList' | 'orderedList'
  start: number
  items: ListItemDraft[]
}

/** Markdown comum: títulos, citações, listas (com um nível de aninhamento por recuo), ênfases e links. */
export function markdownToDocument(
  text: string,
  generateId: IdGenerator = defaultIdGenerator,
): { doc: JSONContent; warnings: string[] } {
  const state: MarkdownState = { images: 0 }
  const lines = normalizeNewlines(text)
    .replace(/^\uFEFF/, '')
    .split('\n')
  const content: JSONContent[] = []
  let paragraph: string[] = []
  let quote: string[][] | null = null
  let list: ListDraft | null = null
  let fenced = false

  const paragraphNode = (parts: string[], attrs: Record<string, unknown> = {}) => {
    const inline = markdownInline(parts.join(' ').replace(/\s+/g, ' ').trim(), state)
    return tidyInline(inline) ? blockNode('paragraph', generateId, attrs, inline) : null
  }
  const flushParagraph = () => {
    if (paragraph.length) {
      const node = paragraphNode(paragraph)
      if (node) content.push(node)
    }
    paragraph = []
  }
  const flushQuote = () => {
    if (quote) {
      const paragraphs = quote
        .map((parts) =>
          paragraphNode(parts, /^[—–] /.test(parts.join(' ').trim()) ? { attribution: true } : {}),
        )
        .filter((node): node is JSONContent => node !== null)
      if (paragraphs.length) content.push(blockNode('blockquote', generateId, {}, paragraphs))
    }
    quote = null
  }
  const listNode = (draft: ListDraft): JSONContent | null => {
    const items: JSONContent[] = []
    for (const item of draft.items) {
      const body: JSONContent[] = []
      const node = paragraphNode(item.lines)
      body.push(node ?? blockNode('paragraph', generateId))
      if (item.children) {
        const nested = listNode(item.children)
        if (nested) body.push(nested)
      }
      items.push({ type: 'listItem', content: body })
    }
    if (!items.length) return null
    const attrs = draft.kind === 'orderedList' && draft.start !== 1 ? { start: draft.start } : {}
    return blockNode(draft.kind, generateId, attrs, items)
  }
  const flushList = () => {
    if (list) {
      const node = listNode(list)
      if (node) content.push(node)
    }
    list = null
  }
  const flushAll = () => {
    flushParagraph()
    flushQuote()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!
    const line = raw.replace(/\s+$/, '')
    if (/^\s*(```|~~~)/.test(line)) {
      flushAll()
      fenced = !fenced
      continue
    }
    if (fenced) {
      if (line.trim() !== '') content.push(blockNode('paragraph', generateId, {}, [textNode(line.trim())]))
      continue
    }
    if (line.trim() === '') {
      flushAll()
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flushAll()
      const inline = markdownInline(heading[2]!, state)
      if (tidyInline(inline))
        content.push(blockNode('heading', generateId, { level: heading[1]!.length }, inline))
      continue
    }
    if (paragraph.length === 1 && /^(=+|-+)\s*$/.test(line)) {
      const level = line.trim().startsWith('=') ? 1 : 2
      const inline = markdownInline(paragraph[0]!, state)
      paragraph = []
      if (tidyInline(inline)) content.push(blockNode('heading', generateId, { level }, inline))
      continue
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      flushAll()
      continue
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      flushList()
      quote ??= []
      const inner = quoted[1]!.trim()
      if (inner === '') quote.push([])
      else if (quote.length && quote[quote.length - 1]!.length > 0) quote[quote.length - 1]!.push(inner)
      else quote.push([inner])
      continue
    }
    const item = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line)
    if (item) {
      flushParagraph()
      flushQuote()
      const level = Math.min(2, Math.floor(item[1]!.replace(/\t/g, '  ').length / 2))
      const ordered = /\d/.test(item[2]!)
      const kind = ordered ? 'orderedList' : 'bulletList'
      const start = ordered ? Number.parseInt(item[2]!, 10) : 1
      if (!list || (level === 0 && list.kind !== kind)) {
        flushList()
        list = { kind, start, items: [] }
      }
      let target = list
      let depth = 0
      while (depth < level) {
        const parent = target.items[target.items.length - 1]
        if (!parent) break
        parent.children ??= { kind, start, items: [] }
        target = parent.children
        depth += 1
      }
      target.items.push({ level, lines: [item[3]!], children: null })
      continue
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // Continuação do item anterior (linha recuada sem marcador).
      let target = list
      while (target.items[target.items.length - 1]?.children)
        target = target.items[target.items.length - 1]!.children!
      const last = target.items[target.items.length - 1]
      if (last) {
        last.lines.push(line.trim())
        continue
      }
    }
    flushQuote()
    flushList()
    paragraph.push(line.trim())
  }
  flushAll()

  const warnings: string[] = []
  if (state.images > 0) {
    warnings.push(
      state.images === 1
        ? '1 imagem ficou de fora (o editor não guarda imagens).'
        : `${state.images} imagens ficaram de fora (o editor não guarda imagens).`,
    )
  }
  return { doc: docNode(content, generateId), warnings }
}

// MARK: HTML do Word (mammoth)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attributes[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const MARK_TAGS: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  sup: 'superscript',
  sub: 'subscript',
}
const BOUNDARY_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'tr',
  'thead',
  'tbody',
  'tfoot',
  'table',
])

interface Frame {
  kind: 'root' | 'blockquote' | 'bulletList' | 'orderedList' | 'listItem' | 'cell'
  children: JSONContent[]
  start?: number
}

interface TextblockDraft {
  type: 'paragraph' | 'heading'
  level?: number
  content: JSONContent[]
}

/**
 * HTML simples (o que o mammoth produz do .docx) para o JSON do manuscrito, sem DOM: parágrafos,
 * títulos, negrito/itálico/sublinhado/tachado/sobrescrito/subscrito, links, listas (aninhadas),
 * citações e quebras de linha. Imagens saem; tabelas viram parágrafos; notas viram lista no fim.
 */
export function htmlToDocument(
  html: string,
  generateId: IdGenerator = defaultIdGenerator,
): { doc: JSONContent; warnings: string[] } {
  const stack: Frame[] = [{ kind: 'root', children: [] }]
  const marks: JSONMark[] = []
  const anchors: boolean[] = []
  let textblock: TextblockDraft | null = null
  let images = 0
  let tables = 0
  let footnotes = false

  const top = () => stack[stack.length - 1]!
  const closeTextblock = () => {
    if (!textblock) return
    const draft = textblock
    textblock = null
    if (!tidyInline(draft.content)) return
    const frame = top()
    const attrs: Record<string, unknown> = draft.type === 'heading' ? { level: draft.level ?? 1 } : {}
    const text = draft.content[0]?.type === 'text' ? (draft.content[0].text ?? '') : ''
    if (frame.kind === 'blockquote' && draft.type === 'paragraph' && /^[—–] /.test(text))
      attrs.attribution = true
    frame.children.push(blockNode(draft.type, generateId, attrs, draft.content))
  }
  const openTextblock = (type: 'paragraph' | 'heading', level?: number) => {
    closeTextblock()
    textblock = { type, level, content: [] }
  }
  const appendText = (raw: string) => {
    const text = decodeEntities(raw).replace(/\s+/g, ' ')
    if (!textblock) {
      if (text.trim() === '') return
      textblock = { type: 'paragraph', content: [] }
    }
    pushText(textblock.content, text, marks)
  }
  const push = (frame: Frame) => {
    closeTextblock()
    stack.push(frame)
  }
  const pop = (kind: Frame['kind']): Frame | null => {
    closeTextblock()
    const index = stack.map((frame) => frame.kind).lastIndexOf(kind)
    if (index <= 0) return null
    // Fecha o que ficou aberto por dentro (HTML malformado) antes do quadro pedido.
    while (stack.length - 1 > index) finish(stack.pop()!)
    return stack.pop()!
  }
  const finish = (frame: Frame) => {
    const parent = top()
    if (frame.kind === 'listItem') {
      if (!frame.children.length) return
      if (frame.children[0]!.type !== 'paragraph') frame.children.unshift(blockNode('paragraph', generateId))
      parent.children.push({ type: 'listItem', content: frame.children })
    } else if (frame.kind === 'bulletList' || frame.kind === 'orderedList') {
      const items = frame.children.filter((child) => child.type === 'listItem')
      if (!items.length) return
      const attrs =
        frame.kind === 'orderedList' && frame.start && frame.start !== 1 ? { start: frame.start } : {}
      parent.children.push(blockNode(frame.kind, generateId, attrs, items))
    } else if (frame.kind === 'blockquote') {
      if (frame.children.length) parent.children.push(blockNode('blockquote', generateId, {}, frame.children))
    } else {
      parent.children.push(...frame.children)
    }
  }
  const removeMark = (type: string) => {
    const index = marks.map((mark) => mark.type).lastIndexOf(type)
    if (index >= 0) marks.splice(index, 1)
  }

  const token =
    /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|<!DOCTYPE[^>]*>|([^<]+)/g
  for (const match of html.matchAll(token)) {
    const [whole, tagName, rawAttributes, text] = match
    if (text !== undefined) {
      appendText(text)
      continue
    }
    if (!tagName) continue
    const tag = tagName.toLowerCase()
    const closing = whole.startsWith('</')
    const attributes = closing ? {} : attributesOf(rawAttributes ?? '')
    if (tag in MARK_TAGS) {
      if (closing) removeMark(MARK_TAGS[tag]!)
      else marks.push({ type: MARK_TAGS[tag]! })
      continue
    }
    switch (tag) {
      case 'p':
        if (closing) closeTextblock()
        else openTextblock('paragraph')
        break
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (closing) closeTextblock()
        else openTextblock('heading', Number(tag[1]))
        break
      case 'br':
        if (!textblock) textblock = { type: 'paragraph', content: [] }
        textblock.content.push({ type: 'hardBreak' })
        break
      case 'img':
        images += 1
        break
      case 'a':
        if (closing) {
          if (anchors.pop()) removeMark('link')
        } else {
          const href = attributes.href ?? ''
          const valid = isSafeLinkHref(href)
          if (valid) marks.push({ type: 'link', attrs: { href } })
          anchors.push(valid)
        }
        break
      case 'ul':
      case 'ol':
        if (closing) {
          const frame = pop(tag === 'ul' ? 'bulletList' : 'orderedList')
          if (frame) finish(frame)
        } else {
          const start = Number.parseInt(attributes.start ?? '1', 10)
          push({
            kind: tag === 'ul' ? 'bulletList' : 'orderedList',
            children: [],
            start: Number.isFinite(start) ? start : 1,
          })
        }
        break
      case 'li':
        if (closing) {
          const frame = pop('listItem')
          if (frame) finish(frame)
        } else {
          if (top().kind === 'listItem') {
            const unfinished = pop('listItem')
            if (unfinished) finish(unfinished)
          }
          if (top().kind !== 'bulletList' && top().kind !== 'orderedList')
            push({ kind: 'bulletList', children: [] })
          if ((attributes.id ?? '').startsWith('footnote-') || (attributes.id ?? '').startsWith('endnote-'))
            footnotes = true
          push({ kind: 'listItem', children: [] })
        }
        break
      case 'blockquote':
        if (closing) {
          const frame = pop('blockquote')
          if (frame) finish(frame)
        } else {
          push({ kind: 'blockquote', children: [] })
        }
        break
      case 'td':
      case 'th':
        if (closing) {
          const frame = pop('cell')
          if (frame) finish(frame)
        } else {
          push({ kind: 'cell', children: [] })
        }
        break
      default:
        if (tag === 'table' && !closing) tables += 1
        if (BOUNDARY_TAGS.has(tag)) closeTextblock()
    }
  }
  closeTextblock()
  while (stack.length > 1) finish(stack.pop()!)

  const warnings: string[] = []
  if (images > 0)
    warnings.push(
      images === 1
        ? '1 imagem ficou de fora (o editor não guarda imagens).'
        : `${images} imagens ficaram de fora (o editor não guarda imagens).`,
    )
  if (tables > 0)
    warnings.push(tables === 1 ? '1 tabela virou parágrafos.' : `${tables} tabelas viraram parágrafos.`)
  if (footnotes) warnings.push('As notas de rodapé viraram uma lista numerada no fim do texto.')
  return { doc: docNode(stack[0]!.children, generateId), warnings }
}

const DOCX_STYLE_MAP = [
  'u => u',
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Título'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Subtítulo'] => h2:fresh",
  "p[style-name='Título 1'] => h1:fresh",
  "p[style-name='Título 2'] => h2:fresh",
  "p[style-name='Título 3'] => h3:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Citação'] => blockquote > p:fresh",
  "p[style-name='Citação Intensa'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
]

/** Converte o .docx com o mammoth e mapeia o HTML resultante para o manuscrito. */
export async function docxToDocument(
  data: Uint8Array,
  generateId: IdGenerator = defaultIdGenerator,
): Promise<{ doc: JSONContent; warnings: string[] }> {
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(data.buffer, data.byteOffset, data.byteLength) },
    {
      styleMap: DOCX_STYLE_MAP,
      // As imagens não entram no editor; só contamos as que ficaram de fora, sem decodificar os bytes.
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  )
  const converted = htmlToDocument(result.value, generateId)
  const styles = new Set<string>()
  for (const message of result.messages) {
    if (message.type !== 'warning') continue
    const unrecognised = /Unrecognised (?:paragraph|run) style: '([^']+)'/.exec(message.message)
    if (unrecognised?.[1]) styles.add(unrecognised[1])
  }
  if (styles.size > 0) {
    const names = [...styles].slice(0, 3).join(', ')
    converted.warnings.push(
      `Estilos do Word não reconhecidos viraram texto comum: ${names}${styles.size > 3 ? '…' : '.'}`,
    )
  }
  return converted
}

export async function convertDocument(
  format: ImportFormat,
  data: Uint8Array,
  options: { generateId?: IdGenerator } = {},
): Promise<ConvertedDocument> {
  const generateId = options.generateId ?? defaultIdGenerator
  let doc: JSONContent
  const warnings: string[] = []
  switch (format) {
    case 'txt':
      doc = textToDocument(decodeText(data), generateId)
      break
    case 'md': {
      const result = markdownToDocument(decodeText(data), generateId)
      doc = result.doc
      warnings.push(...result.warnings)
      break
    }
    case 'rtf':
      doc = rtfToTiptap(data, { generateId })
      break
    case 'docx': {
      const result = await docxToDocument(data, generateId)
      doc = result.doc
      warnings.push(...result.warnings)
      break
    }
  }
  const plainText = manuscriptPlainText(doc).replace(/\s+$/, '')
  return { doc, plainText, wordCount: countWords(plainText), warnings }
}

/** Mensagem em português para a falha de conversão. */
export function describeConversionError(error: unknown, format: ImportFormat): string {
  const message = error instanceof Error ? error.message : String(error)
  if (format === 'docx' && /body element|central directory|zip|corrupt|signature/i.test(message)) {
    return 'O arquivo não é um .docx válido. Se for um .doc antigo, abra-o no Word e salve como .docx.'
  }
  return `Não foi possível converter este arquivo .${format}.`
}

// MARK: Candidatos

export interface PreparedCandidate {
  candidate: ImportCandidate
  doc: JSONContent | null
  plainText: string
  wordCount: number
}

/** Lê, converte e detecta os metadados de um arquivo; falhas viram um candidato com `error`. */
export async function prepareCandidate(
  path: string,
  id: string,
  options: { now?: Date; generateId?: IdGenerator; maxBytes?: number } = {},
): Promise<PreparedCandidate> {
  const fileName = basename(path)
  const format = formatForFile(fileName)
  const now = options.now
  const base = { id, path, fileName, format: format ?? ('txt' as const) }
  const fail = (message: string): PreparedCandidate => ({
    candidate: {
      ...base,
      detected: detectSermonMetadata({ fileName, text: '', now }),
      wordCount: 0,
      warnings: [message],
      error: message,
    },
    doc: null,
    plainText: '',
    wordCount: 0,
  })
  if (!format) return fail('Formato não aceito: use .docx, .rtf, .txt ou .md.')
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return fail('O arquivo não pôde ser lido.')
  }
  if (size > (options.maxBytes ?? MAX_IMPORT_FILE_BYTES))
    return fail('Arquivo maior que 5 MB; salve só o texto e tente de novo.')
  let converted: ConvertedDocument
  try {
    converted = await convertDocument(format, await readFile(path), { generateId: options.generateId })
  } catch (error) {
    return fail(describeConversionError(error, format))
  }
  if (converted.wordCount === 0) return fail('O arquivo não tem texto legível.')
  const detected = detectSermonMetadata({ fileName, text: converted.plainText, now })
  const warnings = [...converted.warnings]
  if (!detected.dateKey)
    warnings.push('Sem data no nome do arquivo nem nas primeiras linhas: informe a data.')
  return {
    candidate: { ...base, detected, wordCount: converted.wordCount, warnings, error: null },
    doc: converted.doc,
    plainText: converted.plainText,
    wordCount: converted.wordCount,
  }
}

// MARK: Gravação

export interface LiturgicalFields {
  liturgicalOccasion: string | null
  liturgicalCelebration: string | null
  liturgicalSeason: string | null
  prayerBookId: string | null
  mainReadingReference: string | null
  mainReadingSlot: string | null
}

/**
 * Campos litúrgicos a partir do dia carregado da API (nulos quando não há dia). Se a passagem
 * informada é exatamente uma leitura do dia, adota a grafia e o slot dessa leitura, como a Mesa.
 */
export function liturgicalFieldsFor(
  day: LiturgicalDay | null,
  reference: string | null,
  prayerBook: string | null,
): LiturgicalFields {
  const fields: LiturgicalFields = {
    liturgicalOccasion: null,
    liturgicalCelebration: null,
    liturgicalSeason: null,
    prayerBookId: null,
    mainReadingReference: reference,
    mainReadingSlot: null,
  }
  if (!day) return fields
  fields.liturgicalOccasion = day.sundayName ?? null
  fields.liturgicalCelebration = day.celebration?.name ?? null
  fields.liturgicalSeason = day.season?.name ?? null
  fields.prayerBookId = prayerBook
  const target = reference ? parseReference(reference) : null
  if (target) {
    const match = (day.readings ?? []).find((reading) => {
      const candidate = parseReference(reading.reference)
      return candidate !== null && passageRelation(candidate, target)?.kind === 'exact'
    })
    if (match) {
      fields.mainReadingReference = match.reference
      fields.mainReadingSlot = match.slot
    }
  }
  return fields
}

/** Patch completo da preparação importada, como a Mesa gravaria. */
export function sermonPatchFor(
  prepared: PreparedCandidate,
  title: string,
  fields: LiturgicalFields,
): SermonPatch {
  return {
    title,
    doc: JSON.stringify(prepared.doc),
    plainText: prepared.plainText,
    wordCount: prepared.wordCount,
    ...fields,
    tabletPdfPath: null,
    tabletPdfUpdatedAt: null,
  }
}

/** Executa `task` sobre os itens com no máximo `limit` em paralelo, preservando a ordem. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
