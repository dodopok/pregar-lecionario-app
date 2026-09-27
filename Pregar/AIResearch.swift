import Foundation

struct AIResearchConfiguration: Sendable {
    let provider: AIProvider
    let model: String
    let apiKey: String
}

struct AIResearchSource: Codable, Equatable, Identifiable, Sendable {
    let title: String
    let url: URL
    let publishedDate: String?

    var id: String { url.absoluteString }
    var domain: String { url.host ?? url.absoluteString }
}

struct AIResearchReport: Codable, Equatable, Identifiable, Sendable {
    var id: String { reference }

    let reference: String
    let provider: AIProvider
    let model: String
    let createdAt: Date
    let sources: [AIResearchSource]
}

enum AIResearchError: LocalizedError {
    case emptyReference
    case noKey
    case invalidModel
    case provider(status: Int)
    case unreadableResponse

    var errorDescription: String? {
        switch self {
        case .emptyReference: "Escolha uma passagem antes de pesquisar materiais."
        case .noKey: "A chave do provedor de pesquisa não está salva no Acesso às Chaves."
        case .invalidModel: "O modelo escolhido não pertence ao provedor de pesquisa."
        case let .provider(status): "O provedor recusou a pesquisa (HTTP \(status)). Verifique a chave, o modelo e os créditos disponíveis."
        case .unreadableResponse: "O provedor não retornou fontes verificáveis. Tente novamente ou abra as fontes favoritas."
        }
    }
}

struct AIResearchClient {
    var session: URLSession = .shared

    func search(
        reference: String,
        occasion: String?,
        configuration: AIResearchConfiguration
    ) async throws -> [AIResearchSource] {
        guard !reference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIResearchError.emptyReference
        }
        guard configuration.provider.models.contains(configuration.model) else {
            throw AIResearchError.invalidModel
        }
        guard !configuration.apiKey.isEmpty else { throw AIResearchError.noKey }

        let request = try Self.makeRequest(reference: reference, occasion: occasion, configuration: configuration)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AIResearchError.unreadableResponse }
        guard (200..<300).contains(response.statusCode) else {
            throw AIResearchError.provider(status: response.statusCode)
        }
        let sources = Self.sources(in: data, from: configuration.provider)
        guard !sources.isEmpty else { throw AIResearchError.unreadableResponse }
        return sources
    }

    static func makeRequest(
        reference: String,
        occasion: String?,
        configuration: AIResearchConfiguration
    ) throws -> URLRequest {
        let query = [reference, occasion]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        let instructions = """
        Find existing web sources about the specified biblical passage. Search for biblical commentaries, exegetical articles, lectionary reflections, or sermons by serious Anglican, Catholic, and Protestant scholars and institutions. Prioritize N. T. Wright, Michael Bird, Scot McKnight, Fleming Rutledge, Andrew McGowan, and Richard Bauckham, but do not invent a source or author. Return source links and titles only. Do not interpret the passage, summarize theology, suggest sermon ideas or applications, or draft any wording. Search only for this public passage and occasion; no sermon manuscript or personal text is provided.
        """

        let endpoint: URL
        switch configuration.provider {
        case .openAI: endpoint = URL(string: "https://api.openai.com/v1/responses")!
        case .anthropic: endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
        case .google: endpoint = URL(string: "https://generativelanguage.googleapis.com/v1beta/interactions")!
        case .perplexity: endpoint = URL(string: "https://api.perplexity.ai/v1/agent")!
        }

        var request = URLRequest(url: endpoint, timeoutInterval: 120)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        var body: [String: Any]
        switch configuration.provider {
        case .openAI:
            request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
            body = [
                "model": configuration.model,
                "input": "\(instructions)\n\nPassagem e ocasião: \(query)",
                "tools": [["type": "web_search", "search_context_size": "low"]],
                "include": ["web_search_call.action.sources"],
                "max_output_tokens": 1600,
                "store": false
            ]
        case .anthropic:
            request.setValue(configuration.apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            body = [
                "model": configuration.model,
                "max_tokens": 1600,
                "system": instructions,
                "messages": [["role": "user", "content": "Pesquise fontes para: \(query)"]],
                "tools": [[
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 2,
                    "allowed_callers": ["direct"]
                ]]
            ]
        case .google:
            request.setValue(configuration.apiKey, forHTTPHeaderField: "x-goog-api-key")
            body = [
                "model": configuration.model,
                "input": "\(instructions)\n\nPassagem e ocasião: \(query)",
                "tools": [["type": "google_search"]],
                "store": false
            ]
        case .perplexity:
            request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
            body = [
                "model": configuration.model,
                "input": "Pesquise fontes bíblicas sobre: \(query). Retorne resultados com título e link, sem resumo ou interpretação.",
                "instructions": instructions,
                "tools": [["type": "web_search"]],
                "max_output_tokens": 1600,
                "store": false
            ]
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    static func sources(in data: Data, from provider: AIProvider) -> [AIResearchSource] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        var candidates: [[String: Any]] = []

        switch provider {
        case .openAI:
            for item in root["output"] as? [[String: Any]] ?? [] {
                if let action = item["action"] as? [String: Any] {
                    candidates += action["sources"] as? [[String: Any]] ?? []
                }
                if let results = item["results"] as? [[String: Any]] {
                    candidates += results
                }
                for block in item["content"] as? [[String: Any]] ?? [] {
                    candidates += block["annotations"] as? [[String: Any]] ?? []
                }
            }
        case .anthropic:
            for block in root["content"] as? [[String: Any]] ?? [] {
                candidates += block["content"] as? [[String: Any]] ?? []
                candidates += block["citations"] as? [[String: Any]] ?? []
            }
        case .google:
            for step in root["steps"] as? [[String: Any]] ?? [] {
                for block in step["content"] as? [[String: Any]] ?? [] {
                    candidates += block["annotations"] as? [[String: Any]] ?? []
                }
            }
        case .perplexity:
            for item in root["output"] as? [[String: Any]] ?? [] where item["type"] as? String == "search_results" {
                candidates += item["results"] as? [[String: Any]] ?? []
            }
            for item in root["output"] as? [[String: Any]] ?? [] {
                for block in item["content"] as? [[String: Any]] ?? [] {
                    candidates += block["annotations"] as? [[String: Any]] ?? []
                }
            }
        }

        var seen: Set<String> = []
        return candidates.compactMap { candidate in
            guard let rawURL = candidate["url"] as? String,
                  let url = URL(string: rawURL),
                  let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  components.scheme?.lowercased() == "https",
                  let host = components.host, host.contains("."),
                  components.user == nil, components.password == nil,
                  seen.insert(url.absoluteString).inserted else { return nil }
            let title = (candidate["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            return AIResearchSource(
                title: title.flatMap { $0.isEmpty ? nil : $0 } ?? host,
                url: url,
                publishedDate: candidate["date"] as? String ?? candidate["page_age"] as? String
            )
        }
        .prefix(12)
        .map { $0 }
    }
}
