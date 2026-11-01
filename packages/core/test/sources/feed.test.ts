import { describe, expect, it } from 'vitest'
import {
  FeedSyntaxError,
  createFavoriteSite,
  decodeFeedBytes,
  favoriteSiteArticles,
  parseRSSAtomCandidates,
} from '../../src/sources'

const rssSite = createFavoriteSite({
  id: 'rss',
  title: 'Blog anglicano',
  baseURL: 'https://blog.example.org',
  detail: '',
  language: 'inglês',
  adapter: 'rssAtom',
  searchURLTemplate: 'https://blog.example.org/?s={query}',
})

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rss [ <!ENTITY custom "x"> ]>
<!-- feed gerado pelo WordPress -->
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Channel title Romans 13:8-14</title>
    <link>https://blog.example.org</link>
    <item>
      <title><![CDATA[Love fulfils the law — Romans 13:8-14]]></title>
      <link>https://blog.example.org/2026/09/love/</link>
      <dc:creator><![CDATA[Fleming Rutledge]]></dc:creator>
      <pubDate>Sun, 20 Sep 2026 12:00:00 +0000</pubDate>
      <description><![CDATA[<p>Paul &amp; the law&#8230;</p>]]></description>
      <content:encoded><![CDATA[<p>Long body</p>]]></content:encoded>
    </item>
    <item>
      <title>Advent &amp;amp; waking up: Romans 13:11&#8211;14</title>
      <link>http://blog.example.org/2025/11/advent/</link>
      <pubDate>Sun, 30 Nov 2025 09:00:00 GMT</pubDate>
      <description>Reading for Advent 1</description>
    </item>
    <item>
      <title>No link here</title>
    </item>
  </channel>
</rss>`

describe('leitor de feeds RSS/Atom', () => {
  it('lê itens RSS 2.0 com CDATA, dc:creator, pubDate e content:encoded', () => {
    const candidates = parseRSSAtomCandidates(RSS)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toEqual({
      title: 'Love fulfils the law — Romans 13:8-14',
      url: 'https://blog.example.org/2026/09/love/',
      author: 'Fleming Rutledge',
      date: 'Sun, 20 Sep 2026 12:00:00 +0000',
      excerpt: '<p>Paul &amp; the law&#8230;</p>',
    })
    // Entidade XML decodificada uma vez; a referência HTML restante fica para a limpeza do título.
    expect(candidates[1]?.title).toBe('Advent &amp; waking up: Romans 13:11–14')
    expect(candidates[1]?.author).toBeNull()
  })

  it('classifica os itens do feed e lê datas RFC 822', () => {
    const articles = favoriteSiteArticles(RSS, rssSite, 'Romanos 13.8-14')
    expect(articles.map((article) => article.match)).toEqual(['same', 'partial'])
    expect(articles[0]?.publishedAt?.toISOString()).toBe('2026-09-20T12:00:00.000Z')
    expect(articles[1]?.publishedAt?.toISOString()).toBe('2025-11-30T09:00:00.000Z')
    expect(articles[1]?.title).toBe('Advent & waking up: Romans 13:11–14')
    expect(articles[1]?.url).toBe('https://blog.example.org/2025/11/advent/')
    expect(articles[1]?.overlapReference).toBe('Romans 13:11-14')
  })

  it('Atom: link alternate, autor aninhado e prefixos de namespace', () => {
    const atom = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
      <atom:title>Feed</atom:title>
      <atom:entry>
        <atom:title type="html">Matthew 21:33-46</atom:title>
        <atom:link rel="edit" href="https://blog.example.org/edit/1"/>
        <atom:link rel="alternate" type="text/html" href="https://blog.example.org/vineyard"/>
        <atom:author><atom:name>Andrew McGowan</atom:name></atom:author>
        <atom:updated>2026-09-21T08:00:00-03:00</atom:updated>
        <atom:summary type='html'>&lt;p&gt;Vineyard&lt;/p&gt;</atom:summary>
      </atom:entry>
    </atom:feed>`
    const [candidate] = parseRSSAtomCandidates(atom)
    expect(candidate).toEqual({
      title: 'Matthew 21:33-46',
      url: 'https://blog.example.org/vineyard',
      author: 'Andrew McGowan',
      date: '2026-09-21T08:00:00-03:00',
      excerpt: '<p>Vineyard</p>',
    })
  })

  it('tolera entidades HTML, tags trocadas e feed truncado', () => {
    const sloppy = `<rss><channel>
      <item><title>Romans 13:8&nbsp;-14</title><link>https://blog.example.org/a</link></item>
      <item><title>Romans 13:8-14<b></title><link>https://blog.example.org/b</link></item>
      <item><title>Romans 13:8-14</title><link>https://blog.example.org/c</link>`
    const candidates = parseRSSAtomCandidates(sloppy)
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      'https://blog.example.org/a',
      'https://blog.example.org/b',
      'https://blog.example.org/c',
    ])
    expect(candidates[0]?.title).toBe('Romans 13:8&nbsp;-14')
  })

  it('rejeita página HTML, documento vazio e marcação não terminada', () => {
    expect(() =>
      parseRSSAtomCandidates('<!doctype html><html><head><meta charset="utf-8"></head></html>'),
    ).toThrow(FeedSyntaxError)
    expect(() => parseRSSAtomCandidates('   ')).toThrow(FeedSyntaxError)
    expect(() => parseRSSAtomCandidates('<rss><channel><item><title><![CDATA[x')).toThrow(FeedSyntaxError)
    expect(() => parseRSSAtomCandidates('<rss><!-- sem fim')).toThrow(FeedSyntaxError)
    expect(() => favoriteSiteArticles('<html><body></body></html>', rssSite, 'Romans 13:8-14')).toThrow(
      /invalidResponse/,
    )
  })

  it('respeita a codificação declarada no prólogo', () => {
    const latin1 = Uint8Array.from([
      ...new TextEncoder().encode(
        '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Romanos 13:8-14 ',
      ),
      0xe9, // é
      ...new TextEncoder().encode('</title><link>https://blog.example.org/x</link></item></channel></rss>'),
    ])
    expect(decodeFeedBytes(latin1)).toContain('Romanos 13:8-14 é')
    expect(parseRSSAtomCandidates(latin1)[0]?.title).toBe('Romanos 13:8-14 é')
  })
})
