/**
 * Leitor pequeno e tolerante de XML para feeds RSS/Atom. O processo principal do Electron não
 * tem `DOMParser`, então este módulo faz a varredura no estilo SAX (como o `XMLParser` do
 * Foundation) e repete a lógica do `RSSAtomFeedParser` do Swift.
 *
 * Tolerâncias: entidades HTML desconhecidas (&nbsp;) ficam no texto para a limpeza posterior,
 * tags de fechamento trocadas fecham até a correspondente e um feed truncado entrega os itens
 * completos. Página HTML, documento sem elementos e marcação não terminada são rejeitados.
 */

export interface FeedArticleCandidate {
  title: string
  url: string
  author: string | null
  date: string | null
  excerpt: string
}

export class FeedSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedSyntaxError'
  }
}

export interface XMLScanHandlers {
  startElement(name: string, attributes: Record<string, string>): void
  endElement(name: string): void
  text(value: string): void
  cdata(value: string): void
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Entidades predefinidas do XML e referências numéricas; as demais ficam como estão. */
export function decodeXMLEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (token, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return token
      return String.fromCodePoint(code)
    }
    return XML_ENTITIES[body] ?? token
  })
}

function isNameBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || /\s/.test(char)
}

/** Fim de uma declaração `<!DOCTYPE …>`, respeitando aspas e o subconjunto interno `[…]`. */
function declarationEnd(source: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '[') {
      depth += 1
    } else if (char === ']') {
      depth = Math.max(0, depth - 1)
    } else if (char === '>' && depth === 0) {
      return index
    }
  }
  return -1
}

function localName(qualifiedName: string): string {
  const parts = qualifiedName.split(':')
  return (parts[parts.length - 1] ?? qualifiedName).toLowerCase()
}

/** Varre o documento chamando os handlers; lança `FeedSyntaxError` para marcação inválida. */
export function scanXML(source: string, handlers: XMLScanHandlers): void {
  const length = source.length
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const stack: string[] = []
  let rootSeen = false

  const closeTo = (name: string): void => {
    const position = stack.lastIndexOf(name)
    if (position === -1) return // fechamento sem abertura: ignorado
    while (stack.length > position) {
      const open = stack.pop()
      if (open !== undefined) handlers.endElement(open)
    }
  }

  while (index < length) {
    const lt = source.indexOf('<', index)
    if (lt === -1) {
      handlers.text(decodeXMLEntities(source.slice(index)))
      break
    }
    if (lt > index) handlers.text(decodeXMLEntities(source.slice(index, lt)))

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end === -1) throw new FeedSyntaxError('Comentário não terminado.')
      index = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      if (end === -1) throw new FeedSyntaxError('CDATA não terminado.')
      handlers.cdata(source.slice(lt + 9, end))
      index = end + 3
      continue
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      if (end === -1) throw new FeedSyntaxError('Instrução de processamento não terminada.')
      index = end + 2
      continue
    }
    if (source.startsWith('<!', lt)) {
      const end = declarationEnd(source, lt + 2)
      if (end === -1) throw new FeedSyntaxError('Declaração não terminada.')
      index = end + 1
      continue
    }
    if (source[lt + 1] === '/') {
      const end = source.indexOf('>', lt + 2)
      if (end === -1) throw new FeedSyntaxError('Tag de fechamento não terminada.')
      const name = source.slice(lt + 2, end).trim()
      if (name) closeTo(name)
      index = end + 1
      continue
    }

    // Tag de abertura.
    let cursor = lt + 1
    while (cursor < length && !isNameBoundary(source[cursor])) cursor += 1
    const name = source.slice(lt + 1, cursor)
    if (!name || !/^[\p{L}_:]/u.test(name)) {
      // "<" solto no texto: tolerado como caractere.
      handlers.text('<')
      index = lt + 1
      continue
    }
    const attributes: Record<string, string> = {}
    let selfClosing = false
    let closed = false
    while (cursor < length) {
      const char = source[cursor]
      if (char === undefined) break
      if (/\s/.test(char)) {
        cursor += 1
        continue
      }
      if (char === '>') {
        closed = true
        cursor += 1
        break
      }
      if (char === '/' && source[cursor + 1] === '>') {
        selfClosing = true
        closed = true
        cursor += 2
        break
      }
      const attributeStart = cursor
      while (cursor < length && !/[\s=>]/.test(source[cursor] ?? '') && !source.startsWith('/>', cursor))
        cursor += 1
      const attributeName = source.slice(attributeStart, cursor)
      if (!attributeName) {
        cursor += 1
        continue
      }
      while (cursor < length && /\s/.test(source[cursor] ?? '')) cursor += 1
      if (source[cursor] !== '=') {
        attributes[attributeName] = ''
        continue
      }
      cursor += 1
      while (cursor < length && /\s/.test(source[cursor] ?? '')) cursor += 1
      const quote = source[cursor]
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, cursor + 1)
        if (end === -1) throw new FeedSyntaxError('Atributo não terminado.')
        attributes[attributeName] = decodeXMLEntities(source.slice(cursor + 1, end))
        cursor = end + 1
      } else {
        const valueStart = cursor
        while (cursor < length && !/[\s>]/.test(source[cursor] ?? '') && !source.startsWith('/>', cursor))
          cursor += 1
        attributes[attributeName] = decodeXMLEntities(source.slice(valueStart, cursor))
      }
    }
    if (!closed) throw new FeedSyntaxError('Tag não terminada.')
    if (!rootSeen) {
      rootSeen = true
      if (localName(name) === 'html') throw new FeedSyntaxError('Página HTML em vez de feed.')
    }
    handlers.startElement(name, attributes)
    if (selfClosing) handlers.endElement(name)
    else stack.push(name)
    index = cursor
  }

  if (!rootSeen) throw new FeedSyntaxError('Documento sem elementos.')
  while (stack.length > 0) {
    const open = stack.pop()
    if (open !== undefined) handlers.endElement(open)
  }
}

/** Decodifica os bytes do feed respeitando BOM e a declaração `encoding` do prólogo. */
export function decodeFeedBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1]
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes)
    } catch {
      // Codificação desconhecida: segue em UTF-8.
    }
  }
  return new TextDecoder().decode(bytes)
}

/** Coletor equivalente ao `RSSAtomFeedParser` do Swift. */
class RSSAtomCollector implements XMLScanHandlers {
  readonly candidates: FeedArticleCandidate[] = []
  private entry: Record<string, string> | null = null
  private captureKey: string | null = null
  private captureElement: string | null = null
  private captureDepth = 0
  private depth = 0
  private captureText = ''

  startElement(qualifiedName: string, attributes: Record<string, string>): void {
    this.depth += 1
    const name = localName(qualifiedName)
    if (name === 'item' || name === 'entry') this.entry = {}
    if (!this.entry) return

    const href = attributes.href
    if (name === 'link' && href) {
      const rel = attributes.rel
      if (rel === undefined || rel === 'alternate') this.entry.url = href
      return
    }

    let field: string | null
    switch (name) {
      case 'title':
        field = 'title'
        break
      case 'link':
        field = 'url'
        break
      case 'creator':
      case 'author':
        field = 'author'
        break
      case 'pubdate':
      case 'published':
      case 'updated':
        field = 'date'
        break
      case 'description':
      case 'summary':
      case 'encoded':
      case 'content':
        field = 'excerpt'
        break
      default:
        field = null
    }
    if (field === null || this.captureKey !== null) return
    this.captureKey = field
    this.captureElement = name
    this.captureDepth = this.depth
    this.captureText = ''
  }

  text(value: string): void {
    if (this.captureKey !== null) this.captureText += value
  }

  cdata(value: string): void {
    if (this.captureKey !== null) this.captureText += value
  }

  endElement(qualifiedName: string): void {
    const name = localName(qualifiedName)
    if (this.captureElement === name && this.captureDepth === this.depth && this.captureKey !== null) {
      if (this.entry && this.entry[this.captureKey] === undefined) {
        this.entry[this.captureKey] = this.captureText.trim()
      }
      this.captureKey = null
      this.captureElement = null
      this.captureText = ''
    }
    if ((name === 'item' || name === 'entry') && this.entry) {
      const { title, url, author, date, excerpt } = this.entry
      if (title !== undefined && url !== undefined) {
        this.candidates.push({
          title,
          url,
          author: author ?? null,
          date: date ?? null,
          excerpt: excerpt ?? '',
        })
      }
      this.entry = null
    }
    this.depth = Math.max(0, this.depth - 1)
  }
}

/** Itens (`<item>`) e entradas (`<entry>`) com título e link de um feed RSS ou Atom. */
export function parseRSSAtomCandidates(data: string | Uint8Array): FeedArticleCandidate[] {
  const source = typeof data === 'string' ? data : decodeFeedBytes(data)
  const collector = new RSSAtomCollector()
  scanXML(source, collector)
  return collector.candidates
}
