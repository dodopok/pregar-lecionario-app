import Foundation

struct APIEnvelope<Value: Decodable>: Decodable {
    let data: Value
}

struct BiblePassage: Decodable {
    let reference: String
    let bible: String
    let text: BiblePassageText?
}

struct LiturgicalDay: Decodable {
    let date: String
    let dayOfWeek: String?
    let sundayName: String?
    let season: LiturgicalSeason?
    let color: String?
    let isSunday: Bool?
    let isHolyDay: Bool?
    let celebration: Celebration?
    let celebrations: [Celebration]?
    let readings: [LiturgicalReading]?
    let collect: [LiturgicalCollect]?
}

struct LiturgicalSeason: Decodable {
    let slug: String?
    let name: String?
}

struct Celebration: Decodable, Identifiable {
    let id: Int?
    let slug: String?
    let name: String
    let type: String?
    let rank: Int?
    let color: String?
}

struct LiturgicalReading: Decodable, Identifiable {
    let slot: String
    let reference: String
    let title: String?
    let alternatives: [String]?
    let text: BiblePassageText?

    var id: String { "\(slot):\(reference)" }

    var label: String {
        switch slot {
        case "first_reading": return "Primeira leitura"
        case "psalm": return "Salmo"
        case "psalm_alternative": return "Salmo alternativo"
        case "second_reading": return "Segunda leitura"
        case "gospel": return "Evangelho"
        default: return title ?? slot.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

struct BiblePassageText: Decodable, Sendable {
    let format: String?
    let bible: String?
    let verses: [BibleVerse]?
    let content: String?
}

struct BibleVersePosition: Hashable, Comparable, Identifiable, Sendable {
    let chapter: Int?
    let number: Int

    var id: String { "\(chapter.map(String.init) ?? "?"):\(number)" }

    static func < (lhs: BibleVersePosition, rhs: BibleVersePosition) -> Bool {
        let leftChapter = lhs.chapter ?? Int.min
        let rightChapter = rhs.chapter ?? Int.min
        if leftChapter != rightChapter { return leftChapter < rightChapter }
        return lhs.number < rhs.number
    }
}

struct BibleVerse: Decodable, Identifiable, Sendable {
    let chapter: Int?
    let number: Int
    let text: String

    var id: BibleVersePosition { position(fallbackChapter: nil) }

    func position(fallbackChapter: Int?) -> BibleVersePosition {
        BibleVersePosition(chapter: chapter ?? fallbackChapter, number: number)
    }
}

struct BibleVersion: Decodable, Equatable, Identifiable, Sendable {
    let code: String
    let name: String
    let fullName: String?
    let language: String?
    let description: String?
    let publisher: String?
    let year: Int?
    let isRecommended: Bool?
    let versificationSystem: String?
    let license: String?

    var id: String { code }
}

struct PrayerBookCatalogEntry: Decodable, Equatable, Identifiable, Sendable {
    let code: String
    let name: String
    let description: String?
    let language: String?
    let jurisdiction: String?
    let year: Int?
    let isRecommended: Bool?
    let imageUrl: String?
    let thumbnailUrl: String?

    var id: String { code }

    var displaySubtitle: String {
        let parts = [jurisdiction, year.map(String.init), language]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? "Livro de oração" : parts.joined(separator: " · ")
    }

    var displayDescription: String {
        let value = description?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value, !value.isEmpty else { return "Descrição não informada" }
        return value
    }

    var coverMonogram: String {
        if code.localizedCaseInsensitiveContains("loc") { return "LOC" }
        let initials = name
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .prefix(3)
            .compactMap(\.first)
        return initials.isEmpty ? "LOC" : String(initials).uppercased()
    }

    var jurisdictionMonogram: String? {
        guard let jurisdiction else { return nil }
        let initials = jurisdiction
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .prefix(4)
            .compactMap(\.first)
        return initials.isEmpty ? nil : String(initials).uppercased()
    }

    var coverURL: URL? {
        guard let rawURL = thumbnailUrl ?? imageUrl,
              let components = URLComponents(string: rawURL) else { return nil }
        if let scheme = components.scheme?.lowercased() {
            return scheme == "https" ? components.url : nil
        }
        guard let resolved = URL(string: rawURL, relativeTo: URL(string: APISettings.apiBaseURL))?.absoluteURL,
              resolved.scheme == "https" else { return nil }
        return resolved
    }
}

struct LiturgicalCollect: Decodable, Identifiable {
    let title: String?
    let subtitle: String?
    let kind: String?
    let text: String?
    let preface: String?

    var id: String { [title, subtitle, kind, text].compactMap { $0 }.joined(separator: "|") }
}

struct APIProblem: Decodable {
    let detail: String?
    let code: String?
}

struct LiturgicalAPIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct LiturgicalAPIClient {
    let settings: APISettings
    let apiKey: String
    var session: URLSession = .shared

    func fetchDay(_ date: Date) async throws -> LiturgicalDay {
        try await get(APIEnvelope<LiturgicalDay>.self, from: dayURL(date)).data
    }

    func fetchCalendarDays(from startDate: Date, through endDate: Date) async throws -> [LiturgicalDay] {
        guard var components = URLComponents(string: settings.baseURL) else {
            throw LiturgicalAPIError(message: "Endereço inválido da Estêvão API.")
        }
        let trimmedPath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let apiPath = trimmedPath.hasSuffix("api/v2") ? trimmedPath : [trimmedPath, "api/v2"].filter { !$0.isEmpty }.joined(separator: "/")
        components.path = "/\(apiPath)/days"
        components.queryItems = [
            URLQueryItem(name: "from", value: SermonDateKey.string(from: startDate)),
            URLQueryItem(name: "to", value: SermonDateKey.string(from: endDate)),
            URLQueryItem(name: "book", value: settings.prayerBook),
            URLQueryItem(name: "lang", value: settings.language),
            URLQueryItem(name: "fields[day]", value: "date,sunday_name,is_sunday")
        ]
        guard let url = components.url else {
            throw LiturgicalAPIError(message: "Não foi possível montar o calendário da Estêvão API.")
        }
        return try await get(APIEnvelope<[LiturgicalDay]>.self, from: url).data
    }

    func fetchPassage(reference: String, bible: String) async throws -> BiblePassageText {
        let passage = try await get(APIEnvelope<BiblePassage>.self, from: passageURL(reference: reference, bible: bible)).data
        guard let text = passage.text else {
            throw LiturgicalAPIError(message: "A passagem \(reference) não está disponível em \(bible.uppercased()).")
        }
        return text
    }

    func fetchBibleVersions() async throws -> [BibleVersion] {
        guard var components = URLComponents(string: settings.baseURL) else {
            throw LiturgicalAPIError(message: "Endereço inválido da Estêvão API.")
        }
        components.path = "/api/v2/bible-versions"
        components.queryItems = nil
        guard let url = components.url else {
            throw LiturgicalAPIError(message: "Não foi possível montar o catálogo de traduções.")
        }
        return try await get(APIEnvelope<[BibleVersion]>.self, from: url).data
    }

    func fetchPrayerBooks() async throws -> [PrayerBookCatalogEntry] {
        guard var components = URLComponents(string: settings.baseURL) else {
            throw LiturgicalAPIError(message: "Endereço inválido da Estêvão API.")
        }
        components.path = "/api/v2/prayer-books"
        components.queryItems = [
            URLQueryItem(name: "fields[prayer_book]", value: "code,name,description,language,jurisdiction,year,is_recommended,image_url,thumbnail_url")
        ]
        guard let url = components.url else {
            throw LiturgicalAPIError(message: "Não foi possível montar o catálogo de livros de oração.")
        }
        return try await get(APIEnvelope<[PrayerBookCatalogEntry]>.self, from: url).data
    }

    private func get<Value: Decodable>(_ type: Value.Type, from url: URL) async throws -> Value {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.setValue("application/json, application/problem+json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw LiturgicalAPIError(message: "A Estêvão API não retornou uma resposta HTTP válida.")
        }
        guard (200..<300).contains(response.statusCode) else {
            let problem = try? JSONDecoder().decode(APIProblem.self, from: data)
            let detail: String
            if let problemDetail = problem?.detail {
                detail = problemDetail
            } else if response.statusCode == 404 {
                detail = "A rota da API v2 não foi encontrada neste endereço. Confira se a v2 está publicada no servidor."
            } else {
                detail = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
            }
            throw LiturgicalAPIError(message: "\(detail) (HTTP \(response.statusCode)\(problem?.code.map { ", \($0)" } ?? "")).")
        }

        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(type, from: data)
        } catch {
            throw LiturgicalAPIError(message: "A resposta da Estêvão API não corresponde ao formato esperado da v2.")
        }
    }

    private func dayURL(_ date: Date) throws -> URL {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"

        guard var components = URLComponents(string: settings.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw LiturgicalAPIError(message: "Endereço inválido da Estêvão API.")
        }
        let trimmedPath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let apiPath = trimmedPath.hasSuffix("api/v2") ? trimmedPath : [trimmedPath, "api/v2"].filter { !$0.isEmpty }.joined(separator: "/")
        components.path = "/\(apiPath)/days/\(formatter.string(from: date))"
        var query = [
            URLQueryItem(name: "book", value: settings.prayerBook),
            URLQueryItem(name: "lang", value: settings.language),
            URLQueryItem(name: "bible", value: settings.bible),
            URLQueryItem(name: "include", value: "readings.text,collect.text,celebrations")
        ]
        if !settings.readingType.isEmpty {
            query.append(URLQueryItem(name: "reading_type", value: settings.readingType))
        }
        components.queryItems = query
        guard let url = components.url else {
            throw LiturgicalAPIError(message: "Não foi possível montar o endereço da Estêvão API.")
        }
        return url
    }

    private func passageURL(reference: String, bible: String) throws -> URL {
        guard var components = URLComponents(string: settings.baseURL) else {
            throw LiturgicalAPIError(message: "Endereço inválido da Estêvão API.")
        }
        components.path = "/api/v2/passages"
        components.queryItems = [
            URLQueryItem(name: "ref", value: reference),
            URLQueryItem(name: "bible", value: bible),
            URLQueryItem(name: "text_format", value: "verses")
        ]
        guard let url = components.url else {
            throw LiturgicalAPIError(message: "Não foi possível montar o endereço da passagem bíblica.")
        }
        return url
    }
}
