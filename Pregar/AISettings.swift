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
        case .anthropic: ["claude-sonnet-5", "claude-haiku-4-5"]
        case .google: ["gemini-3.8-flash", "gemini-3.1-pro-preview"]
        case .perplexity: ["perplexity/sonar"]
        }
    }

    var suggestedModel: String { models[0] }

    func modelDisplayName(for model: String) -> String {
        if self == .perplexity && model == "perplexity/sonar" {
            return "Sonar · Agent API"
        }
        return model
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
    private var changedKeyProviders = Set<AIProvider>()

    init() {
        if PregarRuntime.isIsolatedTestHost {
            reviewProvider = .anthropic
            researchProvider = .perplexity
            reviewModel = AIProvider.anthropic.suggestedModel
            researchModel = AIProvider.perplexity.suggestedModel
            isLoadingKeys = false
            return
        }

        let defaults = UserDefaults.standard
        let savedReviewProvider = AIProvider(rawValue: defaults.string(forKey: "ai.reviewProvider") ?? "anthropic") ?? .anthropic
        let savedResearchProvider = AIProvider(rawValue: defaults.string(forKey: "ai.researchProvider") ?? "perplexity") ?? .perplexity
        let savedReviewModel = defaults.string(forKey: "ai.reviewModel")
        let savedResearchModel = defaults.string(forKey: "ai.researchModel")
        reviewProvider = savedReviewProvider
        researchProvider = savedResearchProvider
        reviewModel = savedReviewModel.flatMap { savedReviewProvider.models.contains($0) ? $0 : nil } ?? savedReviewProvider.suggestedModel
        researchModel = savedResearchModel.flatMap { savedResearchProvider.models.contains($0) ? $0 : nil } ?? savedResearchProvider.suggestedModel

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

    func reloadPreferences() {
        let defaults = UserDefaults.standard
        let savedReviewProvider = AIProvider(rawValue: defaults.string(forKey: "ai.reviewProvider") ?? "anthropic") ?? .anthropic
        let savedResearchProvider = AIProvider(rawValue: defaults.string(forKey: "ai.researchProvider") ?? "perplexity") ?? .perplexity
        reviewProvider = savedReviewProvider
        researchProvider = savedResearchProvider
        reviewModel = defaults.string(forKey: "ai.reviewModel").flatMap { savedReviewProvider.models.contains($0) ? $0 : nil }
            ?? savedReviewProvider.suggestedModel
        researchModel = defaults.string(forKey: "ai.researchModel").flatMap { savedResearchProvider.models.contains($0) ? $0 : nil }
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
    }

    func removeKey(for provider: AIProvider) async throws {
        try await Task.detached(priority: .utility) { try AIKeychain.delete(for: provider) }.value
        changedKeyProviders.insert(provider)
        keyedProviders.remove(provider)
        keyReadTimedOut = false
        isLoadingKeys = false
        revision += 1
    }

    func save(reviewProvider: AIProvider, reviewModel: String, researchProvider: AIProvider, researchModel: String) {
        self.reviewProvider = reviewProvider
        self.reviewModel = reviewModel
        self.researchProvider = researchProvider
        self.researchModel = researchModel
        let defaults = UserDefaults.standard
        defaults.set(reviewProvider.rawValue, forKey: "ai.reviewProvider")
        defaults.set(reviewModel, forKey: "ai.reviewModel")
        defaults.set(researchProvider.rawValue, forKey: "ai.researchProvider")
        defaults.set(researchModel, forKey: "ai.researchModel")
        revision += 1
    }
}
