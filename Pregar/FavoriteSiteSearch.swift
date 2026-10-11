import Foundation

enum FavoriteSiteMatch: String, Codable, Sendable {
    case same
    case contains
    case partial
    case context

    var label: String {
        switch self {
        case .same: "mesma passagem"
        case .contains: "seção maior · contém a passagem"
        case .partial: "sobreposição parcial"
        case .context: "menção no contexto · conferir"
        }
    }

    fileprivate var priority: Int {
        switch self {
        case .same: 0
        case .contains: 1
        case .partial: 2
        case .context: 3
        }
    }
}

struct FavoriteSiteArticle: Codable, Equatable, Identifiable, Sendable {
    let site: FavoriteSite
    let title: String
    let url: URL
    let author: String?
    let publishedAt: Date?
    let match: FavoriteSiteMatch
    let passageReference: String?
    let overlapReference: String?

    var id: String { url.absoluteString }
}

struct FavoriteSiteSearchGroup: Codable, Equatable, Identifiable, Sendable {
    let site: FavoriteSite
    let searchURL: URL
    let articles: [FavoriteSiteArticle]
    let searchedAt: Date
    let errorMessage: String?

    var id: String { site.id }
}

struct FavoriteSiteSearchReport: Codable, Equatable, Identifiable, Sendable {
    let cacheKey: String
    let reference: String
    let searchedAt: Date
    let groups: [FavoriteSiteSearchGroup]

    var id: String { cacheKey }

    static func cacheKey(
        reference: String,
        occasion: String?,
        date: Date,
        isSunday: Bool,
        sites: [FavoriteSite] = [],
        authors: [FavoriteAuthor] = []
    ) -> String {
        let cleanReference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanOccasion = occasion?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let revision = FavoriteReferenceLibrary.fingerprint(sites: sites, authors: authors)
        return [cleanReference, cleanOccasion, SermonDateKey.string(from: date), isSunday ? "sunday" : "other", revision]
            .joined(separator: "|")
    }
}

@MainActor
final class FavoriteSiteSearchAutoGate {
    private var lastAttemptAt: [String: Date] = [:]
    private var activeKeys: Set<String> = []

    func begin(cacheKey: String, now: Date = .now) -> Bool {
        guard !activeKeys.contains(cacheKey) else { return false }
        if let lastAttempt = lastAttemptAt[cacheKey], now.timeIntervalSince(lastAttempt) < 24 * 60 * 60 {
            return false
        }
        activeKeys.insert(cacheKey)
        lastAttemptAt[cacheKey] = now
        return true
    }

    func finish(cacheKey: String, wasCancelled: Bool) {
        activeKeys.remove(cacheKey)
        if wasCancelled { lastAttemptAt.removeValue(forKey: cacheKey) }
    }
}

enum FavoriteSiteSearchError: Error {
    case invalidReference
    case invalidRequest
    case invalidResponse
    case httpStatus(Int)
}

struct FavoriteSiteSearchClient {
    var session: URLSession = .shared

    func search(
        reference: String,
        occasion: String?,
        date: Date,
        isSunday: Bool,
        sites: [FavoriteSite] = FavoriteSite.defaults,
        authors: [FavoriteAuthor] = []
    ) async -> FavoriteSiteSearchReport {
        let cleanReference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        let cacheKey = FavoriteSiteSearchReport.cacheKey(
            reference: cleanReference,
            occasion: occasion,
            date: date,
            isSunday: isSunday,
            sites: sites,
            authors: authors
        )
        let searchURLs = Dictionary(uniqueKeysWithValues: sites.map { site in
            (site.id, site.searchURL(reference: cleanReference, occasion: occasion, date: date, isSunday: isSunday))
        })
        guard ScriptureReference.parse(cleanReference) != nil else {
            let groups = sites.map { site in
                FavoriteSiteSearchGroup(
                    site: site,
                    searchURL: searchURLs[site.id] ?? site.baseURL,
                    articles: [],
                    searchedAt: .now,
                    errorMessage: "Escolha uma passagem com livro, capítulo e versículos."
                )
            }
            return FavoriteSiteSearchReport(cacheKey: cacheKey, reference: cleanReference, searchedAt: .now, groups: groups)
        }

        let groups = await withTaskGroup(of: (Int, FavoriteSiteSearchGroup).self) { taskGroup in
            for (index, site) in sites.enumerated() {
                let searchURL = searchURLs[site.id] ?? site.baseURL
                taskGroup.addTask {
                    (index, await self.search(site: site, reference: cleanReference, searchURL: searchURL, authors: authors))
                }
            }
            var results: [(Int, FavoriteSiteSearchGroup)] = []
            for await result in taskGroup { results.append(result) }
            return results.sorted { $0.0 < $1.0 }.map(\.1)
        }
        return FavoriteSiteSearchReport(cacheKey: cacheKey, reference: cleanReference, searchedAt: .now, groups: groups)
    }

    static func request(for site: FavoriteSite, reference: String) -> URLRequest? {
        guard site.hasStructuredSearch, let target = ScriptureReference.parse(reference) else { return nil }
        let term = "\(target.englishBookName) \(target.chapter)"
        var components = URLComponents()
        components.scheme = "https"

        switch site.adapter {
        case .workingPreacherArchive, .websiteSearch:
            return nil
        case .rssAtom:
            guard let url = site.feedURL ?? URL(string: "feed", relativeTo: site.baseURL)?.absoluteURL,
                  url.scheme?.lowercased() == "https" else { return nil }
            var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
            request.httpMethod = "GET"
            request.setValue("application/rss+xml, application/atom+xml, application/xml, text/xml", forHTTPHeaderField: "Accept")
            return request
        case .anglicanCompass, .wordpress:
            guard let host = site.baseURL.host else { return nil }
            components.host = host
            let basePath = site.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            components.path = "/" + [basePath, "wp-json/wp/v2/posts"].filter { !$0.isEmpty }.joined(separator: "/")
            components.queryItems = [
                URLQueryItem(name: "search", value: term),
                URLQueryItem(name: "per_page", value: "12"),
                URLQueryItem(name: "_embed", value: "author"),
                URLQueryItem(name: "_fields", value: "date,link,title,excerpt,_links,_embedded")
            ]
        case .wordpressCom:
            guard let host = site.baseURL.host else { return nil }
            components.host = "public-api.wordpress.com"
            components.path = "/rest/v1.1/sites/\(host)/posts/"
            components.queryItems = [
                URLQueryItem(name: "search", value: term),
                URLQueryItem(name: "number", value: "12"),
                URLQueryItem(name: "fields", value: "title,URL,date,author,excerpt")
            ]
        case .blogger:
            guard let host = site.baseURL.host else { return nil }
            components.host = host
            components.path = "/feeds/posts/default"
            components.queryItems = [
                URLQueryItem(name: "q", value: term),
                URLQueryItem(name: "alt", value: "json"),
                URLQueryItem(name: "max-results", value: "12")
            ]
        }

        guard let url = components.url else { return nil }
        var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    static func articles(
        from data: Data,
        site: FavoriteSite,
        targetReference: String,
        authors: [FavoriteAuthor] = []
    ) throws -> [FavoriteSiteArticle] {
        guard let target = ScriptureReference.parse(targetReference) else { throw FavoriteSiteSearchError.invalidReference }
        let candidates: [SiteArticleCandidate]
        switch site.adapter {
        case .workingPreacherArchive, .websiteSearch:
            return []
        case .anglicanCompass, .wordpress:
            candidates = try JSONDecoder().decode([WordPressV2Post].self, from: data).map {
                SiteArticleCandidate(
                    title: $0.title.rendered,
                    url: $0.link,
                    author: $0.embedded?.author?.first?.name,
                    date: $0.date,
                    excerpt: $0.excerpt.rendered
                )
            }
        case .wordpressCom:
            candidates = try JSONDecoder().decode(WordPressComResponse.self, from: data).posts.map {
                SiteArticleCandidate(title: $0.title, url: $0.url, author: $0.author?.name, date: $0.date, excerpt: $0.excerpt)
            }
        case .blogger:
            candidates = try JSONDecoder().decode(BloggerFeed.self, from: data).feed.entries.map { entry in
                let canonicalLink = entry.links.first(where: { $0.relation == "alternate" })?.href ?? ""
                return SiteArticleCandidate(
                    title: entry.title.text,
                    url: canonicalLink,
                    author: entry.authors.first?.name.text,
                    date: entry.published.text,
                    excerpt: entry.summary?.text ?? ""
                )
            }
        case .rssAtom:
            candidates = try RSSAtomFeedParser.candidates(from: data)
        }

        var seen: Set<String> = []
        return candidates.compactMap { candidate in
            guard let url = safeArticleURL(candidate.url, for: site),
                  let title = decodedText(candidate.title),
                  !title.isEmpty,
                  seen.insert(url.absoluteString).inserted,
                  let relation = relation(title: title, excerpt: candidate.excerpt, target: target) else { return nil }
            let author = candidate.author.flatMap(decodedText).flatMap { $0.isEmpty ? nil : $0 }
            return FavoriteSiteArticle(
                site: site,
                title: title,
                url: url,
                author: author,
                publishedAt: parseDate(candidate.date),
                match: relation.match,
                passageReference: relation.passageReference,
                overlapReference: relation.overlapReference
            )
        }
        .sorted { lhs, rhs in
            let lhsPreferred = isPreferredAuthor(lhs.author, in: authors)
            let rhsPreferred = isPreferredAuthor(rhs.author, in: authors)
            if lhsPreferred != rhsPreferred { return lhsPreferred }
            if lhs.match.priority != rhs.match.priority { return lhs.match.priority < rhs.match.priority }
            return (lhs.publishedAt ?? .distantPast) > (rhs.publishedAt ?? .distantPast)
        }
        .prefix(6)
        .map { $0 }
    }

    private func search(site: FavoriteSite, reference: String, searchURL: URL, authors: [FavoriteAuthor]) async -> FavoriteSiteSearchGroup {
        let searchedAt = Date.now
        guard let request = Self.request(for: site, reference: reference) else {
            return FavoriteSiteSearchGroup(site: site, searchURL: searchURL, articles: [], searchedAt: searchedAt, errorMessage: nil)
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw FavoriteSiteSearchError.invalidResponse }
            guard (200..<300).contains(response.statusCode) else { throw FavoriteSiteSearchError.httpStatus(response.statusCode) }
            guard data.count <= 2_000_000 else { throw FavoriteSiteSearchError.invalidResponse }
            let articles = try Self.articles(from: data, site: site, targetReference: reference, authors: authors)
            return FavoriteSiteSearchGroup(site: site, searchURL: searchURL, articles: articles, searchedAt: searchedAt, errorMessage: nil)
        } catch {
            return FavoriteSiteSearchGroup(
                site: site,
                searchURL: searchURL,
                articles: [],
                searchedAt: searchedAt,
                errorMessage: "Busca temporariamente indisponível."
            )
        }
    }

    private static func isPreferredAuthor(_ value: String?, in authors: [FavoriteAuthor]) -> Bool {
        guard let value else { return false }
        let normalized = ScriptureReference.normalized(value)
        return authors.contains { !normalized.isEmpty && normalized.contains(ScriptureReference.normalized($0.name)) }
    }

    private struct PassageRelation {
        let match: FavoriteSiteMatch
        let passageReference: String?
        let overlapReference: String?
    }

    private static func relation(title: String, excerpt: String, target: ScriptureReference) -> PassageRelation? {
        let titleReferences = ScriptureReference.parseAll(title)
        if let match = bestRelation(titleReferences, target: target) { return match }
        let excerptReferences = ScriptureReference.parseAll(decodedText(excerpt) ?? excerpt)
        guard bestRelation(excerptReferences, target: target) != nil else { return nil }
        return PassageRelation(match: .context, passageReference: nil, overlapReference: nil)
    }

    private static func bestRelation(_ candidates: [ScriptureReference], target: ScriptureReference) -> PassageRelation? {
        candidates.compactMap { relation(candidate: $0, target: target) }
            .min { $0.match.priority < $1.match.priority }
    }

    private static func relation(candidate: ScriptureReference, target: ScriptureReference) -> PassageRelation? {
        guard candidate.book == target.book else { return nil }
        let candidateEndChapter = candidate.endChapter ?? candidate.chapter
        let targetEndChapter = target.endChapter ?? target.chapter

        guard let candidateStartVerse = candidate.startVerse,
              let targetStartVerse = target.startVerse else {
            guard candidate.chapter <= targetEndChapter && candidateEndChapter >= target.chapter else { return nil }
            let candidateReference = formatReference(
                book: candidate.englishBookName,
                startChapter: candidate.chapter,
                startVerse: nil,
                endChapter: candidate.endChapter,
                endVerse: nil
            )
            return PassageRelation(match: .context, passageReference: candidateReference, overlapReference: nil)
        }

        let candidateStart = (candidate.chapter, candidateStartVerse)
        let candidateEnd = (candidateEndChapter, candidate.endVerse ?? candidateStartVerse)
        let targetStart = (target.chapter, targetStartVerse)
        let targetEnd = (targetEndChapter, target.endVerse ?? targetStartVerse)
        guard point(candidateStart, isBeforeOrEqual: targetEnd), point(targetStart, isBeforeOrEqual: candidateEnd) else { return nil }

        let candidateReference = formatReference(
            book: candidate.englishBookName,
            startChapter: candidate.chapter,
            startVerse: candidateStartVerse,
            endChapter: candidate.endChapter,
            endVerse: candidate.endVerse ?? candidateStartVerse
        )
        let overlapStart = point(candidateStart, isBeforeOrEqual: targetStart) ? targetStart : candidateStart
        let overlapEnd = point(candidateEnd, isBeforeOrEqual: targetEnd) ? candidateEnd : targetEnd
        let overlapReference = formatReference(
            book: candidate.englishBookName,
            startChapter: overlapStart.0,
            startVerse: overlapStart.1,
            endChapter: overlapEnd.0,
            endVerse: overlapEnd.1
        )

        if point(candidateStart, isEqualTo: targetStart), point(candidateEnd, isEqualTo: targetEnd) {
            return PassageRelation(match: .same, passageReference: candidateReference, overlapReference: overlapReference)
        }
        if point(candidateStart, isBeforeOrEqual: targetStart), point(targetEnd, isBeforeOrEqual: candidateEnd) {
            return PassageRelation(match: .contains, passageReference: candidateReference, overlapReference: overlapReference)
        }
        return PassageRelation(match: .partial, passageReference: candidateReference, overlapReference: overlapReference)
    }

    private static func formatReference(
        book: String,
        startChapter: Int,
        startVerse: Int?,
        endChapter: Int?,
        endVerse: Int?
    ) -> String {
        let start = startVerse.map { "\(startChapter):\($0)" } ?? "\(startChapter)"
        guard let endChapter, endChapter != startChapter else {
            guard let endVerse, let startVerse, endVerse != startVerse else { return "\(book) \(start)" }
            return "\(book) \(start)-\(endVerse)"
        }
        guard let endVerse else { return "\(book) \(startChapter)-\(endChapter)" }
        return "\(book) \(start)-\(endChapter):\(endVerse)"
    }

    private static func point(_ lhs: (Int, Int), isBeforeOrEqual rhs: (Int, Int)) -> Bool {
        lhs.0 < rhs.0 || (lhs.0 == rhs.0 && lhs.1 <= rhs.1)
    }

    private static func point(_ lhs: (Int, Int), isEqualTo rhs: (Int, Int)) -> Bool {
        lhs.0 == rhs.0 && lhs.1 == rhs.1
    }

    private static func safeArticleURL(_ value: String, for site: FavoriteSite) -> URL? {
        guard var components = URLComponents(string: value),
              let host = components.host?.lowercased(),
              normalizedHost(host) == normalizedHost(site.baseURL.host ?? ""),
              components.user == nil,
              components.password == nil,
              components.scheme?.lowercased() == "http" || components.scheme?.lowercased() == "https" else { return nil }
        components.scheme = "https"
        guard let url = components.url, url.host?.lowercased() == host else { return nil }
        return url
    }

    private static func normalizedHost(_ host: String) -> String {
        host.lowercased().hasPrefix("www.") ? String(host.dropFirst(4)).lowercased() : host.lowercased()
    }

    private static func decodedText(_ value: String) -> String? {
        let withoutActiveContent = value.replacingOccurrences(of: #"(?is)<(script|style)\b.*?</\1>"#, with: " ", options: .regularExpression)
        let plain = withoutActiveContent.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
        let mutable = NSMutableString(string: plain)
        let entities = try? NSRegularExpression(pattern: #"&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);"#)
        let fullRange = NSRange(location: 0, length: mutable.length)
        for match in (entities?.matches(in: plain, range: fullRange) ?? []).reversed() {
            let token = mutable.substring(with: match.range)
            guard let decoded = decodeEntity(token) else { continue }
            mutable.replaceCharacters(in: match.range, with: decoded)
        }
        return (mutable as String)
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decodeEntity(_ entity: String) -> String? {
        let names: [String: String] = [
            "&amp;": "&", "&apos;": "'", "&quot;": "\"", "&lt;": "<", "&gt;": ">",
            "&nbsp;": " ", "&hellip;": "…", "&ndash;": "–", "&mdash;": "—",
            "&lsquo;": "‘", "&rsquo;": "’", "&ldquo;": "“", "&rdquo;": "”"
        ]
        if let named = names[entity.lowercased()] { return named }
        guard entity.hasPrefix("&#"), entity.hasSuffix(";"),
              let delimiter = entity.firstIndex(of: "#"),
              let end = entity.lastIndex(of: ";") else { return nil }
        let digits = entity[entity.index(after: delimiter)..<end]
        let value: UInt32?
        if digits.lowercased().hasPrefix("x") {
            value = UInt32(digits.dropFirst(), radix: 16)
        } else {
            value = UInt32(digits, radix: 10)
        }
        guard let value, let scalar = UnicodeScalar(value) else { return nil }
        return String(scalar)
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: value) { return date }

        let local = DateFormatter()
        local.locale = Locale(identifier: "en_US_POSIX")
        local.timeZone = TimeZone(secondsFromGMT: 0)
        local.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return local.date(from: value)
    }
}

private struct SiteArticleCandidate {
    let title: String
    let url: String
    let author: String?
    let date: String?
    let excerpt: String
}

private struct RenderedText: Decodable {
    let rendered: String
}

private struct WordPressV2Post: Decodable {
    let date: String
    let link: String
    let title: RenderedText
    let excerpt: RenderedText
    let embedded: Embedded?

    enum CodingKeys: String, CodingKey {
        case date, link, title, excerpt
        case embedded = "_embedded"
    }

    struct Embedded: Decodable {
        let author: [Author]?
    }

    struct Author: Decodable {
        let name: String?
    }
}

private struct WordPressComResponse: Decodable {
    let posts: [Post]

    struct Post: Decodable {
        let title: String
        let url: String
        let date: String
        let author: Author?
        let excerpt: String

        enum CodingKeys: String, CodingKey {
            case title
            case url = "URL"
            case date
            case author
            case excerpt
        }
    }

    struct Author: Decodable {
        let name: String
    }
}

private struct BloggerFeed: Decodable {
    let feed: Feed

    struct Feed: Decodable {
        let entries: [Entry]

        enum CodingKeys: String, CodingKey { case entries = "entry" }
    }

    struct Entry: Decodable {
        let title: BloggerText
        let published: BloggerText
        let links: [Link]
        let authors: [Author]
        let summary: BloggerText?

        enum CodingKeys: String, CodingKey {
            case title
            case published
            case links = "link"
            case authors = "author"
            case summary
        }
    }

    struct Link: Decodable {
        let relation: String
        let href: String

        enum CodingKeys: String, CodingKey {
            case relation = "rel"
            case href
        }
    }

    struct Author: Decodable {
        let name: BloggerText
    }
}

private struct BloggerText: Decodable {
    let text: String
    enum CodingKeys: String, CodingKey { case text = "$t" }
}

private final class RSSAtomFeedParser: NSObject, XMLParserDelegate {
    private(set) var candidates: [SiteArticleCandidate] = []
    private var entry: [String: String]?
    private var captureKey: String?
    private var captureElement: String?
    private var captureDepth = 0
    private var depth = 0
    private var captureText = ""

    static func candidates(from data: Data) throws -> [SiteArticleCandidate] {
        let delegate = RSSAtomFeedParser()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.delegate = delegate
        guard parser.parse(), parser.parserError == nil else { throw FavoriteSiteSearchError.invalidResponse }
        return delegate.candidates
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String] = [:]) {
        depth += 1
        let name = localName(elementName, qualifiedName: qName)
        if name == "item" || name == "entry" {
            entry = [:]
        }
        guard entry != nil else { return }

        if name == "link", let href = attributes["href"], !href.isEmpty {
            if attributes["rel"] == nil || attributes["rel"] == "alternate" { entry?["url"] = href }
            return
        }

        let field: String?
        switch name {
        case "title": field = "title"
        case "link": field = "url"
        case "creator", "author": field = "author"
        case "pubdate", "published", "updated": field = "date"
        case "description", "summary", "encoded", "content": field = "excerpt"
        default: field = nil
        }
        guard let field, captureKey == nil else { return }
        captureKey = field
        captureElement = name
        captureDepth = depth
        captureText = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard captureKey != nil else { return }
        captureText += string
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        guard captureKey != nil, let value = String(data: CDATABlock, encoding: .utf8) else { return }
        captureText += value
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let name = localName(elementName, qualifiedName: qName)
        if captureElement == name, captureDepth == depth, let captureKey {
            if entry?[captureKey] == nil { entry?[captureKey] = captureText.trimmingCharacters(in: .whitespacesAndNewlines) }
            self.captureKey = nil
            captureElement = nil
            captureText = ""
        }
        if name == "item" || name == "entry", let entry {
            if let title = entry["title"], let url = entry["url"] {
                candidates.append(SiteArticleCandidate(
                    title: title,
                    url: url,
                    author: entry["author"],
                    date: entry["date"],
                    excerpt: entry["excerpt"] ?? ""
                ))
            }
            self.entry = nil
        }
        depth = max(0, depth - 1)
    }

    private func localName(_ elementName: String, qualifiedName: String?) -> String {
        let value = qualifiedName ?? elementName
        return value.split(separator: ":").last.map(String.init)?.lowercased() ?? value.lowercased()
    }
}
