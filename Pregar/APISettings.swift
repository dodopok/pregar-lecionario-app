import Foundation
import Combine
import Security
import SwiftUI

struct APISettings: Equatable {
    static let apiBaseURL = "https://api.caminhoanglicano.com.br"
    var baseURL: String { Self.apiBaseURL }
    var prayerBook = "loc_2027"
    var language = "pt-BR"
    var bible = "nvt"
    var readingType = ""

    var requestVersion: String {
        [baseURL, prayerBook, language, bible, readingType].joined(separator: "|")
    }

    static func load() -> APISettings {
        let defaults = UserDefaults.standard
        var settings = APISettings()
        settings.prayerBook = defaults.string(forKey: "api.prayerBook") ?? settings.prayerBook
        settings.language = defaults.string(forKey: "api.language") ?? settings.language
        settings.bible = defaults.string(forKey: "api.bible") ?? settings.bible
        settings.readingType = defaults.string(forKey: "api.readingType") ?? settings.readingType
        return settings
    }

    func persist() {
        let defaults = UserDefaults.standard
        defaults.set(prayerBook, forKey: "api.prayerBook")
        defaults.set(language, forKey: "api.language")
        defaults.set(bible, forKey: "api.bible")
        defaults.set(readingType, forKey: "api.readingType")
    }
}

enum APIKeychain {
    private static let service = "br.caminhoanglicano.pregar.estevao-api"
    private static let account = "api-key"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ key: String) throws {
        let data = Data(key.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var newItem = query
            newItem[kSecValueData as String] = data
            let addStatus = SecItemAdd(newItem as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    static func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    struct KeychainError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            SecCopyErrorMessageString(status, nil) as String? ?? "Não foi possível acessar o Acesso às Chaves."
        }
    }
}

@MainActor
final class APISettingsStore: ObservableObject {
    @Published private(set) var settings = APISettings.load()
    @Published private(set) var hasAPIKey = APIKeychain.read() != nil
    @Published private(set) var revision = 0

    var credential: String? { APIKeychain.read() }

    func save(settings: APISettings, enteredKey: String) throws {
        self.settings = settings
        settings.persist()
        let key = enteredKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty { try APIKeychain.save(key) }
        hasAPIKey = APIKeychain.read() != nil
        revision += 1
    }

    func removeKey() throws {
        try APIKeychain.delete()
        hasAPIKey = false
        revision += 1
    }
}
