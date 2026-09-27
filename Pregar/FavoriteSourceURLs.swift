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

    static func anglicanCompass(
        reference: String,
        occasion: String?,
        date: Date? = nil,
        isSunday: Bool = false
    ) -> URL {
        if let proper = properDay(occasion: occasion, date: date, isSunday: isSunday), !proper.year.isEmpty,
           let url = URL(string: "https://anglicancompass.com/today-in-the-spirit-proper-\(proper.number)\(proper.year.lowercased())/") {
            return url
        }
        let query = ["Today in the Spirit", occasion, englishReference(reference)].compactMap { $0 }.joined(separator: " ")
        return searchURL(host: "anglicancompass.com", query: query)
    }

    static func anglicanCompassDetail(occasion: String?, date: Date?, isSunday: Bool) -> String {
        guard let proper = properDay(occasion: occasion, date: date, isSunday: isSunday), !proper.year.isEmpty else {
            return "Today in the Spirit · \(occasion ?? "lecionário")"
        }
        return "Today in the Spirit · Proper \(proper.number)\(proper.year)"
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

    private struct ProperDay {
        let number: Int
        let year: String
    }

    private static func properDay(occasion: String?, date: Date?, isSunday: Bool) -> ProperDay? {
        if let explicit = explicitProper(occasion) {
            if !explicit.year.isEmpty { return explicit }
            if let date, let year = lectionaryYear(for: date) {
                return ProperDay(number: explicit.number, year: year)
            }
        }
        guard let occasion, let date, isSunday else { return nil }
        let normalized = ScriptureReference.normalized(occasion)
        guard normalized.contains("tempo comum")
                || normalized.contains("ordinary time")
                || normalized.contains("pentecost"),
              let number = properNumber(for: date),
              let year = lectionaryYear(for: date) else { return nil }
        return ProperDay(number: number, year: year)
    }

    private static func explicitProper(_ occasion: String?) -> ProperDay? {
        guard let occasion, !occasion.isEmpty else { return nil }
        let normalized = ScriptureReference.normalized(occasion)
        let pattern = #"(?:proprio|proper)\s+(\d+)\s*([abc])?"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: normalized, range: NSRange(normalized.startIndex..., in: normalized)),
              let numberRange = Range(match.range(at: 1), in: normalized),
              let number = Int(normalized[numberRange]), (3...29).contains(number) else { return nil }
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
        return ProperDay(number: number, year: year ?? "")
    }

    private static func properNumber(for date: Date) -> Int? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        guard calendar.component(.weekday, from: date) == 1,
              let year = calendar.dateComponents([.year], from: date).year,
              let first = calendar.date(from: DateComponents(year: year, month: 5, day: 22)),
              let last = calendar.date(from: DateComponents(year: year, month: 11, day: 26)),
              date >= first, date <= last,
              let days = calendar.dateComponents([.day], from: first, to: date).day else { return nil }
        let proper = 3 + days / 7
        return (3...29).contains(proper) ? proper : nil
    }

    private static func lectionaryYear(for date: Date) -> String? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        guard let year = calendar.dateComponents([.year], from: date).year,
              let adventBase = calendar.date(from: DateComponents(year: year, month: 11, day: 27)) else { return nil }
        let weekday = calendar.component(.weekday, from: adventBase)
        let daysToSunday = (8 - weekday) % 7
        guard let advent = calendar.date(byAdding: .day, value: daysToSunday, to: adventBase) else { return nil }
        let liturgicalYear = calendar.startOfDay(for: date) >= calendar.startOfDay(for: advent) ? year : year - 1
        switch (liturgicalYear % 3 + 3) % 3 {
        case 0: return "A"
        case 1: return "B"
        default: return "C"
        }
    }

    private static func searchURL(host: String, query: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.queryItems = [URLQueryItem(name: "s", value: query)]
        return components.url ?? URL(string: "https://\(host)/")!
    }
}
