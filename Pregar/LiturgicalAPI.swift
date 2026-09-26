import Foundation

struct APIEnvelope<Value: Decodable>: Decodable {
    let data: Value
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

struct BiblePassageText: Decodable {
    let format: String?
    let bible: String?
    let verses: [BibleVerse]?
    let content: String?
}

struct BibleVerse: Decodable, Identifiable {
    let number: Int
    let text: String
    var id: Int { number }
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

    func fetchDay(_ date: Date) async throws -> LiturgicalDay {
        let url = try dayURL(date)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.setValue("application/json, application/problem+json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
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
            return try decoder.decode(APIEnvelope<LiturgicalDay>.self, from: data).data
        } catch {
            throw LiturgicalAPIError(message: "A resposta da Estêvão API não corresponde ao formato esperado da v2. Confira se essa versão já está publicada no servidor.")
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
}
