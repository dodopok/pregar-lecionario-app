import Combine
import Foundation
import Security

enum AIProvider: String, CaseIterable, Codable, Identifiable, Sendable {
    case openAI = "openai"
    case anthropic = "anthropic"
    case google = "google"
    case perplexity = "perplexity"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .openAI: "OpenAI"
        case .anthropic: "Claude"
        case .google: "Gemini"
        case .perplexity: "Perplexity"
        }
    }

    var models: [String] {
        switch self {
        case .openAI: ["gpt-6-sol", "gpt-6-luna"]
        case .anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5", "claude-haiku-4-5"]
        case .google: ["gemini-3.8-flash", "gemini-3.1-pro-preview"]
        case .perplexity: ["perplexity/sonar"]
        }
    }

    var suggestedModel: String { models[0] }

    func acceptsModel(_ model: String) -> Bool {
        if self == .anthropic {
            return model.range(of: #"^claude-[a-z0-9][a-z0-9\-]{0,119}$"#, options: .regularExpression) != nil
        }
        return models.contains(model)
    }

    func modelDisplayName(for model: String) -> String {
        if self == .perplexity && model == "perplexity/sonar" {
            return "Sonar · Agent API"
        }
        return model
    }
}

struct AIModelOption: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let displayName: String
    var lifecycle: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, lifecycle
        case displayName = "display_name"
    }
}

enum AIModelCatalogError: LocalizedError {
    case noKey
    case provider(status: Int)
    case unreadableResponse

    var errorDescription: String? {
        switch self {
        case .noKey: "Salve a chave do Claude para consultar os modelos disponíveis."
        case let .provider(status): "Não foi possível atualizar os modelos do Claude (HTTP \(status)). Verifique a chave e tente novamente."
        case .unreadableResponse: "A lista de modelos do Claude não pôde ser lida. Tente novamente."
        }
    }
}

struct AIModelCatalogClient {
    var session: URLSession = .shared

    func claudeModels(apiKey: String) async throws -> [AIModelOption] {
        guard !apiKey.isEmpty else { throw AIModelCatalogError.noKey }
        var models: [AIModelOption] = []
        var seenModels = Set<String>()
        var cursors = Set<String>()
        var afterID: String?
        repeat {
            var components = URLComponents(string: "https://api.anthropic.com/v1/models")!
            components.queryItems = [URLQueryItem(name: "limit", value: "1000")]
            if let afterID { components.queryItems?.append(URLQueryItem(name: "after_id", value: afterID)) }
            var request = URLRequest(url: components.url!, timeoutInterval: 30)
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw AIModelCatalogError.unreadableResponse }
            guard (200..<300).contains(response.statusCode) else {
                throw AIModelCatalogError.provider(status: response.statusCode)
            }
            guard let page = try? JSONDecoder().decode(Page.self, from: data) else {
                throw AIModelCatalogError.unreadableResponse
            }
            for model in page.data where AIProvider.anthropic.acceptsModel(model.id)
                && model.lifecycle != "retired" && seenModels.insert(model.id).inserted {
                models.append(model)
            }
            guard page.hasMore else { break }
            guard let cursor = page.lastID, !cursor.isEmpty, cursors.insert(cursor).inserted,
                  cursors.count < 100 else { throw AIModelCatalogError.unreadableResponse }
            afterID = cursor
        } while true
        guard !models.isEmpty else { throw AIModelCatalogError.unreadableResponse }
        return models
    }

    private struct Page: Decodable {
        let data: [AIModelOption]
        let hasMore: Bool
        let lastID: String?

        enum CodingKeys: String, CodingKey {
            case data
            case hasMore = "has_more"
            case lastID = "last_id"
        }
    }
}

enum AIProviderResponseError {
    static func detail(in data: Data, redacting apiKey: String) -> String? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = root["error"] as? [String: Any],
              var message = error["message"] as? String else { return nil }
        if !apiKey.isEmpty { message = message.replacingOccurrences(of: apiKey, with: "[chave removida]") }
        message = message.replacingOccurrences(of: #"sk-[A-Za-z0-9_\-]+"#, with: "[chave removida]", options: .regularExpression)
        let detail = String(message.prefix(600)).trimmingCharacters(in: .whitespacesAndNewlines)
        return detail.isEmpty ? nil : detail
    }
}

private enum AIKeychain {
    private static let service = "br.caminhoanglicano.pregar.ai"

    static func read(for provider: AIProvider) -> String? {
        var query = baseQuery(for: provider)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ key: String, for provider: AIProvider) throws {
        let data = Data(key.utf8)
        let query = baseQuery(for: provider)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw APIKeychain.KeychainError(status: addStatus) }
        } else if status != errSecSuccess {
            throw APIKeychain.KeychainError(status: status)
        }
    }

    static func delete(for provider: AIProvider) throws {
        let status = SecItemDelete(baseQuery(for: provider) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw APIKeychain.KeychainError(status: status)
        }
    }

    private static func baseQuery(for provider: AIProvider) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: provider.rawValue
        ]
    }
}

@MainActor
final class AISettingsStore: ObservableObject {
    @Published private(set) var reviewProvider: AIProvider
    @Published private(set) var researchProvider: AIProvider
    @Published private(set) var reviewModel: String
    @Published private(set) var researchModel: String
    @Published private(set) var keyedProviders = Set<AIProvider>()
    @Published private(set) var isLoadingKeys = true
    @Published private(set) var keyReadTimedOut = false
    @Published private(set) var revision = 0
    @Published private(set) var claudeModels: [AIModelOption] = []
    @Published private(set) var isLoadingClaudeModels = false
    @Published private(set) var claudeModelsError: String?
    private var changedKeyProviders = Set<AIProvider>()
    private let defaults: UserDefaults
    private let modelCatalogClient: AIModelCatalogClient
    private var modelCatalogTask: Task<Void, Never>?
    private var modelCatalogGeneration = 0

    init(defaults: UserDefaults = PregarRuntime.makeAppUserDefaults(), modelCatalogClient: AIModelCatalogClient = AIModelCatalogClient(), loadsKeys: Bool = !PregarRuntime.isIsolatedTestHost) {
        self.defaults = defaults
        self.modelCatalogClient = modelCatalogClient
        let savedReviewProvider = AIProvider(rawValue: defaults.string(forKey: "ai.reviewProvider") ?? "anthropic") ?? .anthropic
        let savedResearchProvider = AIProvider(rawValue: defaults.string(forKey: "ai.researchProvider") ?? "perplexity") ?? .perplexity
        let savedReviewModel = defaults.string(forKey: "ai.reviewModel")
        let savedResearchModel = defaults.string(forKey: "ai.researchModel")
        reviewProvider = savedReviewProvider
        researchProvider = savedResearchProvider
        reviewModel = savedReviewModel.flatMap { savedReviewProvider.acceptsModel($0) ? $0 : nil } ?? savedReviewProvider.suggestedModel
        researchModel = savedResearchModel.flatMap { savedResearchProvider.acceptsModel($0) ? $0 : nil } ?? savedResearchProvider.suggestedModel
        if let data = defaults.data(forKey: "ai.models.anthropic"),
           let cached = try? JSONDecoder().decode([AIModelOption].self, from: data) {
            claudeModels = cached.filter { AIProvider.anthropic.acceptsModel($0.id) && $0.lifecycle != "retired" }
        }
        guard loadsKeys else {
            isLoadingKeys = false
            return
        }

        let readTask = Task.detached(priority: .utility) {
            Set(AIProvider.allCases.filter { AIKeychain.read(for: $0) != nil })
        }
        Task { [weak self] in
            let savedProviders = await readTask.value
            guard let self else { return }
            for provider in AIProvider.allCases where !self.changedKeyProviders.contains(provider) {
                if savedProviders.contains(provider) { self.keyedProviders.insert(provider) }
                else { self.keyedProviders.remove(provider) }
            }
            self.keyReadTimedOut = false
            self.isLoadingKeys = false
            self.revision += 1
            if self.hasKey(for: .anthropic) { self.refreshClaudeModels() }
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, self.isLoadingKeys else { return }
            self.keyReadTimedOut = true
            self.isLoadingKeys = false
            self.revision += 1
        }
    }

    func hasKey(for provider: AIProvider) -> Bool { keyedProviders.contains(provider) }

    func modelOptions(for provider: AIProvider, including selectedModel: String? = nil) -> [AIModelOption] {
        var options = provider == .anthropic && !claudeModels.isEmpty
            ? claudeModels
            : provider.models.map { AIModelOption(id: $0, displayName: provider.modelDisplayName(for: $0)) }
        if let selectedModel, provider.acceptsModel(selectedModel), !options.contains(where: { $0.id == selectedModel }) {
            options.append(AIModelOption(id: selectedModel, displayName: "\(selectedModel) · seleção salva"))
        }
        return options
    }

    func refreshClaudeModels() {
        guard hasKey(for: .anthropic) else { return }
        modelCatalogTask?.cancel()
        modelCatalogGeneration += 1
        let generation = modelCatalogGeneration
        isLoadingClaudeModels = true
        claudeModelsError = nil
        modelCatalogTask = Task { [weak self] in
            guard let self else { return }
            guard let apiKey = await self.key(for: .anthropic), !apiKey.isEmpty else {
                self.finishClaudeModels(generation: generation, error: AIModelCatalogError.noKey.localizedDescription)
                return
            }
            do {
                let models = try await self.modelCatalogClient.claudeModels(apiKey: apiKey)
                guard !Task.isCancelled, generation == self.modelCatalogGeneration else { return }
                self.claudeModels = models
                self.defaults.set(try JSONEncoder().encode(models), forKey: "ai.models.anthropic")
                self.finishClaudeModels(generation: generation)
            } catch {
                guard !Task.isCancelled else { return }
                self.finishClaudeModels(generation: generation, error: error.localizedDescription)
            }
        }
    }

    private func finishClaudeModels(generation: Int, error: String? = nil) {
        guard generation == modelCatalogGeneration else { return }
        claudeModelsError = error
        isLoadingClaudeModels = false
        modelCatalogTask = nil
    }

    func reloadPreferences() {
        let savedReviewProvider = AIProvider(rawValue: defaults.string(forKey: "ai.reviewProvider") ?? "anthropic") ?? .anthropic
        let savedResearchProvider = AIProvider(rawValue: defaults.string(forKey: "ai.researchProvider") ?? "perplexity") ?? .perplexity
        reviewProvider = savedReviewProvider
        researchProvider = savedResearchProvider
        reviewModel = defaults.string(forKey: "ai.reviewModel").flatMap { savedReviewProvider.acceptsModel($0) ? $0 : nil }
            ?? savedReviewProvider.suggestedModel
        researchModel = defaults.string(forKey: "ai.researchModel").flatMap { savedResearchProvider.acceptsModel($0) ? $0 : nil }
            ?? savedResearchProvider.suggestedModel
        revision += 1
    }

    func key(for provider: AIProvider) async -> String? {
        await Task.detached(priority: .utility) { AIKeychain.read(for: provider) }.value
    }

    func saveKey(_ key: String, for provider: AIProvider) async throws {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        try await Task.detached(priority: .utility) { try AIKeychain.save(trimmed, for: provider) }.value
        changedKeyProviders.insert(provider)
        keyedProviders.insert(provider)
        keyReadTimedOut = false
        revision += 1
        if provider == .anthropic { refreshClaudeModels() }
    }

    func removeKey(for provider: AIProvider) async throws {
        try await Task.detached(priority: .utility) { try AIKeychain.delete(for: provider) }.value
        changedKeyProviders.insert(provider)
        keyedProviders.remove(provider)
        keyReadTimedOut = false
        isLoadingKeys = false
        revision += 1
        if provider == .anthropic {
            modelCatalogTask?.cancel()
            modelCatalogGeneration += 1
            isLoadingClaudeModels = false
            claudeModelsError = nil
            claudeModels = []
            defaults.removeObject(forKey: "ai.models.anthropic")
        }
    }

    func save(reviewProvider: AIProvider, reviewModel: String, researchProvider: AIProvider, researchModel: String) {
        self.reviewProvider = reviewProvider
        self.reviewModel = reviewModel
        self.researchProvider = researchProvider
        self.researchModel = researchModel
        defaults.set(reviewProvider.rawValue, forKey: "ai.reviewProvider")
        defaults.set(reviewModel, forKey: "ai.reviewModel")
        defaults.set(researchProvider.rawValue, forKey: "ai.researchProvider")
        defaults.set(researchModel, forKey: "ai.researchModel")
        revision += 1
    }
}
