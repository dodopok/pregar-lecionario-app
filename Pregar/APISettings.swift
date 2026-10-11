import AppKit
import Combine
import Foundation
import OSLog
import Security
import SwiftUI

enum PregarRuntime {
    static let isIsolatedTestHost: Bool = {
        let environment = ProcessInfo.processInfo.environment
        return environment["XCTestConfigurationFilePath"] != nil
            || environment["XCInjectBundleInto"] != nil
            || environment["XCTestBundlePath"] != nil
    }()

    static func makeAppUserDefaults() -> UserDefaults {
        guard isIsolatedTestHost else { return .standard }
        return UserDefaults(suiteName: "br.caminhoanglicano.pregar.tests.\(UUID().uuidString)")!
    }
}

/// Registro persistente das integrações externas (Estêvão API, provedores de IA, fontes favoritas e
/// Google Drive). Cada chamada vira uma linha no Console do sistema e num arquivo de texto com rotação:
/// nível, integração, operação, método e caminho, código HTTP, duração e, nas falhas, a resposta do
/// serviço. O corpo da requisição nunca é gravado (leva manuscrito e credenciais); o corpo da resposta
/// só entra em falhas, truncado e com segredos removidos.
enum IntegrationLog {
    enum Integration: String, Sendable {
        case estevaoAPI = "Estêvão API"
        case ai = "IA"
        case favoriteSites = "Fontes favoritas"
        case googleDrive = "Google Drive"
    }

    enum Level: String, Sendable {
        case ok = "OK"
        case warning = "AVISO"
        case error = "ERRO"
    }

    static let maximumFileSize = 1_000_000
    static let maximumBodyExcerpt = 4_000

    private static let queue = DispatchQueue(label: "br.caminhoanglicano.pregar.integration-log", qos: .utility)
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "br.caminhoanglicano.pregar", category: "integracoes")
    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter
    }()

    static let directoryURL: URL = {
        if PregarRuntime.isIsolatedTestHost {
            return FileManager.default.temporaryDirectory
                .appendingPathComponent("PregarTests-Logs-\(UUID().uuidString)", isDirectory: true)
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return support
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Pregar", isDirectory: true)
            .appendingPathComponent("Logs", isDirectory: true)
    }()

    static var fileURL: URL { directoryURL.appendingPathComponent("integracoes.log") }
    static var previousFileURL: URL { directoryURL.appendingPathComponent("integracoes-anterior.log") }

    /// Executa a requisição e registra o resultado. Devolve o mesmo par de `URLSession.data(for:)`,
    /// então quem chama continua decidindo o que fazer com a resposta.
    static func data(
        for request: URLRequest,
        using session: URLSession,
        integration: Integration,
        operation: String
    ) async throws -> (Data, URLResponse) {
        let started = Date.now
        do {
            let (data, response) = try await session.data(for: request)
            let duration = Date.now.timeIntervalSince(started)
            if let http = response as? HTTPURLResponse {
                if (200..<300).contains(http.statusCode) {
                    record(.ok, integration, operation, request: request, status: http.statusCode, duration: duration)
                } else {
                    record(.error, integration, operation, request: request, status: http.statusCode, duration: duration, body: data)
                }
            } else {
                record(.error, integration, operation, request: request, duration: duration, note: "resposta não HTTP")
            }
            return (data, response)
        } catch {
            record(.error, integration, operation, request: request, duration: Date.now.timeIntervalSince(started), error: error)
            throw error
        }
    }

    static func record(
        _ level: Level,
        _ integration: Integration,
        _ operation: String,
        request: URLRequest? = nil,
        status: Int? = nil,
        duration: TimeInterval? = nil,
        body: Data? = nil,
        error: Error? = nil,
        note: String? = nil
    ) {
        let secrets = secrets(in: request)
        var parts = [timestampFormatter.string(from: .now), level.rawValue, integration.rawValue, operation]
        if let request, let url = request.url {
            parts.append("\(request.httpMethod ?? "GET") \(url.host ?? "")\(url.path)")
        }
        if let status { parts.append("HTTP \(status)") }
        if let duration { parts.append(String(format: "%.1f s", duration)) }
        if let note { parts.append(note) }
        if let error { parts.append(describe(error)) }
        var line = parts.joined(separator: " · ")
        if let body, !body.isEmpty {
            line += "\n    " + excerpt(of: body).replacingOccurrences(of: "\n", with: "\n    ")
        }
        line = redact(line, secrets: secrets)
        switch level {
        case .ok: logger.info("\(line, privacy: .public)")
        case .warning: logger.notice("\(line, privacy: .public)")
        case .error: logger.error("\(line, privacy: .public)")
        }
        queue.async { append(line) }
    }

    /// Últimas linhas do arquivo atual.
    static func tail(lines maximum: Int = 400) -> String {
        queue.sync {}
        guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return "" }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        return lines.suffix(maximum).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func clear() {
        queue.sync {
            try? FileManager.default.removeItem(at: fileURL)
            try? FileManager.default.removeItem(at: previousFileURL)
        }
    }

    /// Garante que o arquivo exista e o seleciona no Finder.
    static func revealInFinder() {
        queue.sync {
            try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: fileURL.path) {
                FileManager.default.createFile(atPath: fileURL.path, contents: nil)
            }
        }
        NSWorkspace.shared.activateFileViewerSelecting([fileURL])
    }

    /// Espera as gravações pendentes; usado pelos testes.
    static func flush() {
        queue.sync {}
    }

    // MARK: - Internos

    private static func append(_ line: String) {
        let fileManager = FileManager.default
        try? fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let attributes = try? fileManager.attributesOfItem(atPath: fileURL.path)
        if let size = attributes?[.size] as? NSNumber, size.intValue > maximumFileSize {
            try? fileManager.removeItem(at: previousFileURL)
            try? fileManager.moveItem(at: fileURL, to: previousFileURL)
        }
        if !fileManager.fileExists(atPath: fileURL.path) {
            fileManager.createFile(atPath: fileURL.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data((line + "\n").utf8))
    }

    private static func secrets(in request: URLRequest?) -> [String] {
        guard let request else { return [] }
        var values: [String] = []
        for header in ["Authorization", "x-api-key", "X-API-Key", "x-goog-api-key"] {
            if let value = request.value(forHTTPHeaderField: header) {
                values.append(value.replacingOccurrences(of: "Bearer ", with: ""))
            }
        }
        if let url = request.url, let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            for item in items where ["key", "access_token", "token"].contains(item.name.lowercased()) {
                if let value = item.value { values.append(value) }
            }
        }
        return values.filter { $0.count >= 6 }
    }

    private static let tokenPatterns = [
        #"sk-[A-Za-z0-9_\-]{8,}"#,
        #"AIza[0-9A-Za-z_\-]{20,}"#,
        #"ya29\.[0-9A-Za-z_\-\.]{8,}"#,
        #"1//[0-9A-Za-z_\-]{8,}"#
    ]
    private static let jsonSecretPattern = #""(access_token|refresh_token|id_token|client_secret|api_key)"\s*:\s*"[^"]*""#

    /// Remove segredos conhecidos (valores dos cabeçalhos e da query) e formatos típicos de chave/token.
    static func redact(_ text: String, secrets: [String]) -> String {
        var result = text
        for secret in secrets where !secret.isEmpty {
            result = result.replacingOccurrences(of: secret, with: "[segredo removido]")
        }
        for pattern in tokenPatterns {
            result = result.replacingOccurrences(of: pattern, with: "[segredo removido]", options: .regularExpression)
        }
        result = result.replacingOccurrences(of: jsonSecretPattern, with: "\"$1\":\"[segredo removido]\"", options: .regularExpression)
        return result
    }

    private static func excerpt(of body: Data) -> String {
        let sample = body.prefix(maximumBodyExcerpt)
        let text = String(decoding: sample, as: UTF8.self)
        let scalars = text.unicodeScalars
        let printable = scalars.filter { $0 == "\n" || $0 == "\t" || !CharacterSet.controlCharacters.contains($0) }.count
        guard scalars.isEmpty || printable * 10 >= scalars.count * 9 else {
            return "<\(body.count) bytes não textuais>"
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return body.count > maximumBodyExcerpt ? trimmed + "… [\(body.count) bytes no total]" : trimmed
    }

    private static func describe(_ error: Error) -> String {
        if let urlError = error as? URLError {
            return "URLError \(urlError.code.rawValue): \(urlError.localizedDescription)"
        }
        let nsError = error as NSError
        return "\(nsError.domain) \(nsError.code): \(error.localizedDescription)"
    }
}

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
        var query = baseQuery
        query.merge([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ key: String) throws {
        let data = Data(key.utf8)
        let query = baseQuery
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
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    struct KeychainError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            if status == errSecInteractionNotAllowed {
                return "Desbloqueie o Acesso às Chaves deste Mac e tente novamente."
            }
            if status == errSecMissingEntitlement {
                return "Esta build não tem o entitlement necessário para acessar a chave."
            }
            return SecCopyErrorMessageString(status, nil) as String? ?? "Não foi possível acessar o Acesso às Chaves."
        }
    }
}

@MainActor
final class APISettingsStore: ObservableObject {
    @Published private(set) var settings: APISettings
    @Published private(set) var credential: String?
    @Published private(set) var isLoadingCredential = true
    @Published private(set) var credentialReadTimedOut = false
    @Published private(set) var revision = 0
    private var credentialWasChanged = false

    var hasAPIKey: Bool { credential != nil }

    func reloadFromPreferences() {
        settings = APISettings.load()
        revision += 1
    }

    init() {
        settings = PregarRuntime.isIsolatedTestHost ? APISettings() : APISettings.load()
        guard !PregarRuntime.isIsolatedTestHost else {
            isLoadingCredential = false
            return
        }

        let readTask = Task.detached(priority: .utility) { APIKeychain.read() }
        Task { [weak self] in
            let savedCredential = await readTask.value
            guard let self else { return }
            if !self.credentialWasChanged { self.credential = savedCredential }
            self.credentialReadTimedOut = false
            self.isLoadingCredential = false
            self.revision += 1
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, self.isLoadingCredential else { return }
            self.credentialReadTimedOut = true
            self.isLoadingCredential = false
            self.revision += 1
        }
    }

    func save(settings: APISettings, enteredKey: String) async throws {
        self.settings = settings
        settings.persist()
        let key = enteredKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !key.isEmpty {
            try await Task.detached(priority: .utility) { try APIKeychain.save(key) }.value
            credentialWasChanged = true
            credential = key
            credentialReadTimedOut = false
        }
        isLoadingCredential = false
        revision += 1
    }

    func removeKey() async throws {
        try await Task.detached(priority: .utility) { try APIKeychain.delete() }.value
        credentialWasChanged = true
        credential = nil
        credentialReadTimedOut = false
        isLoadingCredential = false
        revision += 1
    }
}
