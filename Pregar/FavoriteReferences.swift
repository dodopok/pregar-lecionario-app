import CryptoKit
import Foundation

enum FavoriteSiteAdapter: String, CaseIterable, Codable, Identifiable, Sendable {
    case workingPreacherArchive
    case anglicanCompass
    case wordpress
    case wordpressCom
    case blogger
    case rssAtom
    case websiteSearch

    var id: String { rawValue }

    var title: String {
        switch self {
        case .workingPreacherArchive: "Arquivo do Working Preacher"
        case .anglicanCompass: "Anglican Compass"
        case .wordpress: "WordPress"
        case .wordpressCom: "WordPress.com"
        case .blogger: "Blogger"
        case .rssAtom: "RSS / Atom"
        case .websiteSearch: "Busca do site"
        }
    }
}

struct FavoriteSite: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var baseURL: URL
    var detail: String
    var language: String
    var tradition: String
    var adapter: FavoriteSiteAdapter
    var searchURLTemplate: String
    var feedURL: URL?

    var rawValue: String { id }
    var hasStructuredSearch: Bool { adapter != .websiteSearch && adapter != .workingPreacherArchive }
    var usesAnglicanCompassDestination: Bool {
        adapter == .anglicanCompass && Self.usesBuiltInDestination(for: self, defaultSite: .anglicanCompass)
    }

    func searchURL(reference: String, occasion: String?, date: Date, isSunday: Bool) -> URL {
        switch adapter {
        case .workingPreacherArchive:
            if Self.usesBuiltInDestination(for: self, defaultSite: .workingPreacher) {
                return FavoriteSourceURLs.workingPreacher(reference: reference)
            }
            return URL(string: resolvedSearchURL(reference: reference, occasion: occasion, date: date, template: searchTemplate(fallingBackFrom: .workingPreacher))) ?? baseURL
        case .anglicanCompass:
            if Self.usesBuiltInDestination(for: self, defaultSite: .anglicanCompass) {
                return FavoriteSourceURLs.anglicanCompass(reference: reference, occasion: occasion, date: date, isSunday: isSunday)
            }
            return URL(string: resolvedSearchURL(reference: reference, occasion: occasion, date: date, template: searchTemplate(fallingBackFrom: .anglicanCompass))) ?? baseURL
        case .wordpress, .wordpressCom, .blogger, .rssAtom, .websiteSearch:
            return URL(string: resolvedSearchURL(reference: reference, occasion: occasion, date: date)) ?? baseURL
        }
    }

    func resolvedSearchURL(reference: String, occasion: String? = nil, date: Date = .now, template: String? = nil) -> String {
        let passage = ScriptureReference.parse(reference)
        let query = passage.map { "\($0.englishBookName) \($0.chapter)" } ?? reference
        let values = [
            "query": query,
            "reference": passage?.englishReference ?? reference,
            "book": passage?.englishBookName ?? reference,
            "chapter": passage.map { String($0.chapter) } ?? "",
            "occasion": occasion ?? "",
            "date": SermonDateKey.string(from: date)
        ]
        var result = template ?? searchURLTemplate
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{\(key)}", with: Self.encodeQueryValue(value))
        }
        return result
    }

    static let workingPreacher = FavoriteSite(
        id: "workingPreacher", title: "Working Preacher", baseURL: URL(string: "https://www.workingpreacher.org")!,
        detail: "Comentários · Lecionário Comum Revisado", language: "inglês", adapter: .workingPreacherArchive,
        searchURLTemplate: "https://www.workingpreacher.org/?s={query}"
    )
    static let anglicanCompass = FavoriteSite(
        id: "anglicanCompass", title: "Anglican Compass", baseURL: URL(string: "https://anglicancompass.com")!,
        detail: "Recursos anglicanos · ACNA", language: "inglês", adapter: .anglicanCompass,
        searchURLTemplate: "https://anglicancompass.com/?s={query}"
    )
    static let myPastoralPonderings = FavoriteSite(
        id: "myPastoralPonderings", title: "My Pastoral Ponderings", baseURL: URL(string: "https://mypastoralponderings.com")!,
        detail: "Sermões e reflexões", language: "inglês", adapter: .wordpressCom,
        searchURLTemplate: "https://mypastoralponderings.com/?s={query}"
    )
    static let bobCornwall = FavoriteSite(
        id: "bobCornwall", title: "Ponderings on a Faith Journey", baseURL: URL(string: "https://www.bobcornwall.com")!,
        detail: "Bob Cornwall · reflexão pastoral", language: "inglês", adapter: .blogger,
        searchURLTemplate: "https://www.bobcornwall.com/search?q={query}"
    )

    static let allCases = [workingPreacher, anglicanCompass, myPastoralPonderings, bobCornwall]
    static let defaults = allCases

    static func newSite() -> FavoriteSite {
        FavoriteSite(
            id: UUID().uuidString,
            title: "",
            baseURL: URL(string: "https://example.org")!,
            detail: "",
            language: "",
            adapter: .websiteSearch,
            searchURLTemplate: "https://example.org/?s={query}"
        )
    }

    init(
        id: String,
        title: String,
        baseURL: URL,
        detail: String,
        language: String,
        adapter: FavoriteSiteAdapter,
        searchURLTemplate: String,
        feedURL: URL? = nil,
        tradition: String = ""
    ) {
        self.id = id
        self.title = title
        self.baseURL = baseURL
        self.detail = detail
        self.language = language
        self.tradition = tradition
        self.adapter = adapter
        self.searchURLTemplate = searchURLTemplate
        self.feedURL = feedURL
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, baseURL, detail, language, tradition, adapter, searchURLTemplate, feedURL
    }

    init(from decoder: Decoder) throws {
        if let legacyID = try? decoder.singleValueContainer().decode(String.self) {
            self = Self.allCases.first(where: { $0.id == legacyID }) ?? Self.legacyCustomSite(legacyID)
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        baseURL = try container.decode(URL.self, forKey: .baseURL)
        detail = try container.decodeIfPresent(String.self, forKey: .detail) ?? ""
        language = try container.decodeIfPresent(String.self, forKey: .language) ?? ""
        tradition = try container.decodeIfPresent(String.self, forKey: .tradition) ?? ""
        adapter = try container.decodeIfPresent(FavoriteSiteAdapter.self, forKey: .adapter) ?? .websiteSearch
        searchURLTemplate = try container.decodeIfPresent(String.self, forKey: .searchURLTemplate) ?? "\(baseURL.absoluteString)?s={query}"
        feedURL = try container.decodeIfPresent(URL.self, forKey: .feedURL)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(baseURL, forKey: .baseURL)
        try container.encode(detail, forKey: .detail)
        try container.encode(language, forKey: .language)
        try container.encode(tradition, forKey: .tradition)
        try container.encode(adapter, forKey: .adapter)
        try container.encode(searchURLTemplate, forKey: .searchURLTemplate)
        try container.encodeIfPresent(feedURL, forKey: .feedURL)
    }

    private static func legacyCustomSite(_ id: String) -> FavoriteSite {
        FavoriteSite(
            id: id,
            title: id,
            baseURL: URL(string: "https://example.org")!,
            detail: "",
            language: "",
            adapter: .websiteSearch,
            searchURLTemplate: "https://example.org/?s={query}"
        )
    }

    private static func encodeQueryValue(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+#"))) ?? value
    }

    private static func usesBuiltInDestination(for site: FavoriteSite, defaultSite: FavoriteSite) -> Bool {
        guard let siteHost = site.baseURL.host?.lowercased(),
              let defaultHost = defaultSite.baseURL.host?.lowercased() else { return false }
        let normalizedSiteHost = siteHost.hasPrefix("www.") ? String(siteHost.dropFirst(4)) : siteHost
        let normalizedDefaultHost = defaultHost.hasPrefix("www.") ? String(defaultHost.dropFirst(4)) : defaultHost
        return normalizedSiteHost == normalizedDefaultHost && site.baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty
    }

    private func searchTemplate(fallingBackFrom defaultSite: FavoriteSite) -> String {
        guard searchURLTemplate == defaultSite.searchURLTemplate else { return searchURLTemplate }
        return searchURLTemplate.replacingOccurrences(of: defaultSite.baseURL.absoluteString, with: baseURL.absoluteString)
    }
}

struct FavoriteAuthor: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var name: String
    var referenceURL: URL?

    static let defaults = [
        "N. T. Wright", "Michael Bird", "Scot McKnight", "Fleming Rutledge", "Andrew McGowan", "Richard Bauckham"
    ].map { FavoriteAuthor(id: UUID().uuidString, name: $0, referenceURL: nil) }

    static func newAuthor() -> FavoriteAuthor {
        FavoriteAuthor(id: UUID().uuidString, name: "", referenceURL: nil)
    }
}

enum FavoriteReferenceLibrary {
    static let sitesKey = "pregar.favorite-sites.v1"
    static let authorsKey = "pregar.favorite-authors.v1"

    static func sites(from data: Data) -> [FavoriteSite] {
        guard !data.isEmpty else { return FavoriteSite.defaults }
        return (try? JSONDecoder().decode([FavoriteSite].self, from: data)) ?? FavoriteSite.defaults
    }

    static func authors(from data: Data) -> [FavoriteAuthor] {
        guard !data.isEmpty else { return FavoriteAuthor.defaults }
        return (try? JSONDecoder().decode([FavoriteAuthor].self, from: data)) ?? FavoriteAuthor.defaults
    }

    static func fingerprint(sites: [FavoriteSite], authors: [FavoriteAuthor] = []) -> String {
        let data = (try? JSONEncoder().encode(AnyCodableFavorites(sites: sites, authors: authors))) ?? Data()
        return SHA256.hash(data: data).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private struct AnyCodableFavorites: Encodable {
        let sites: [FavoriteSite]
        let authors: [FavoriteAuthor]

        func encode(to encoder: Encoder) throws {
            var container = encoder.unkeyedContainer()
            try container.encode(sites)
            try container.encode(authors)
        }
    }
}
