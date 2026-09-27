import Foundation

enum FavoriteSourceURLs {
    static func workingPreacher(reference: String) -> URL {
        if let passage = ScriptureReference.parse(reference),
           let startVerse = passage.startVerse {
            let endVerse = passage.endVerse ?? startVerse
            let book = passage.englishBookName.lowercased().replacingOccurrences(of: " ", with: "-")
            let slug = "\(book)-\(passage.chapter)_\(startVerse)-\(endVerse)"
            if let url = URL(string: "https://www.workingpreacher.org/posts-by-tag/\(slug)") { return url }
        }
        return searchURL(host: "www.workingpreacher.org", query: reference)
    }

    static func anglicanCompass(reference: String, occasion: String?) -> URL {
        let proper = englishOccasion(occasion)
        let query = ["Today in the Spirit", proper, englishReference(reference)].compactMap { $0 }.joined(separator: " ")
        return searchURL(host: "anglicancompass.com", query: query)
    }

    static func myPastoralPonderings(reference: String) -> URL {
        searchURL(host: "mypastoralponderings.com", query: englishReference(reference))
    }

    static func bobCornwall(reference: String) -> URL {
        searchURL(host: "www.bobcornwall.com", query: englishReference(reference))
    }

    private static func englishReference(_ reference: String) -> String {
        guard let passage = ScriptureReference.parse(reference) else { return reference }
        var result = "\(passage.englishBookName) \(passage.chapter)"
        if let start = passage.startVerse {
            result += ":\(start)"
            if let end = passage.endVerse, end != start { result += "-\(end)" }
        }
        return result
    }

    private static func englishOccasion(_ occasion: String?) -> String? {
        guard let occasion, !occasion.isEmpty else { return nil }
        let normalized = ScriptureReference.normalized(occasion)
        let properPattern = #"(?:proprio|proper)\s+(\d+)\s*([abc])?"#
        guard let regex = try? NSRegularExpression(pattern: properPattern),
              let match = regex.firstMatch(in: normalized, range: NSRange(normalized.startIndex..., in: normalized)),
              let numberRange = Range(match.range(at: 1), in: normalized) else { return occasion }
        let inlineYear = Range(match.range(at: 2), in: normalized).map { String(normalized[$0]).uppercased() }
        let yearPattern = #"(?:ano|year)\s+([abc])|(?:proprio|proper)\s+\d+\s+([abc])"#
        let yearRegex = try? NSRegularExpression(pattern: yearPattern)
        let yearMatch = yearRegex?.firstMatch(in: normalized, range: NSRange(normalized.startIndex..., in: normalized))
        var year = inlineYear
        if let yearMatch {
            for index in 1...2 where yearMatch.range(at: index).location != NSNotFound {
                if let range = Range(yearMatch.range(at: index), in: normalized) {
                    year = String(normalized[range]).uppercased()
                    break
                }
            }
        }
        return ["Proper", String(normalized[numberRange]), year].compactMap { $0 }.joined(separator: " ")
    }

    private static func searchURL(host: String, query: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.queryItems = [URLQueryItem(name: "s", value: query)]
        return components.url ?? URL(string: "https://\(host)/")!
    }
}
