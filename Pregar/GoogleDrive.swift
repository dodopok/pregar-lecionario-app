import AppKit
import Combine
import CryptoKit
import Foundation
import Network
import Security
import SwiftData

enum GoogleDriveError: LocalizedError {
    case missingClientID
    case notConnected
    case invalidClientID
    case invalidOAuthResponse
    case invalidPublicDriveFolderLink
    case missingPublicDriveAPIKey
    case publicDriveFolderIsNotAccessible
    case noPDFsInPublicDriveFolder
    case authorizationDenied(String)
    case authorizationTimedOut
    case api(status: Int, message: String)
    case documentConflict
    case emptyDocument
    case syncInProgress
    case driveImportFileTooLarge(String)
    case driveImportInvalidPDF(String)
    case driveImportIntegrityMismatch(String)
    case driveImportTooManyFiles

    var errorDescription: String? {
        switch self {
        case .missingClientID: "Informe o OAuth Client ID na conexão do Google Drive."
        case .notConnected: "Conecte o Google Drive pela Mesa e tente novamente."
        case .invalidClientID: "O Client ID não parece ser de um aplicativo Google para desktop."
        case .invalidOAuthResponse: "O Google não concluiu a autorização. Tente conectar novamente."
        case .invalidPublicDriveFolderLink: "Cole o link compartilhável de uma pasta do Google Drive."
        case .missingPublicDriveAPIKey: "Informe uma chave de API Google com a Drive API ativada."
        case .publicDriveFolderIsNotAccessible: "A pasta não está pública ou o link não permite acesso. Confira o compartilhamento “Qualquer pessoa com o link”."
        case .noPDFsInPublicDriveFolder: "Nenhum PDF foi encontrado nessa pasta pública."
        case let .authorizationDenied(message): "A autorização do Google foi recusada: \(message)"
        case .authorizationTimedOut: "A autorização expirou. Volte ao app e conecte o Google Drive novamente."
        case let .api(status, message): "Google Drive (HTTP \(status)): \(message)"
        case .documentConflict: "O Google Doc mudou fora do app desde a última sincronização. Sua cópia local foi preservada. Compare as versões antes de substituir a cópia do Drive."
        case .emptyDocument: "Escreva algum texto antes de salvar o sermão no Google Drive."
        case .syncInProgress: "A sincronização anterior ainda está em andamento."
        case let .driveImportFileTooLarge(name): "O PDF \(name) excede o limite de 128 MB e foi ignorado."
        case let .driveImportInvalidPDF(name): "O arquivo \(name) não parece ser um PDF válido."
        case let .driveImportIntegrityMismatch(name): "O PDF \(name) não passou na verificação de integridade e não foi guardado."
        case .driveImportTooManyFiles: "A pasta contém mais de 5.000 PDFs. Escolha uma pasta menor para importar com segurança."
        }
    }
}

struct GoogleOAuthTokens: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: TimeInterval

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

enum GoogleOAuthRequest {
    static let authorizationEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    static let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
    static let driveScope = "https://www.googleapis.com/auth/drive.file"

    static func randomVerifier() -> String {
        randomURLSafeString(byteCount: 64)
    }

    static func randomState() -> String {
        randomURLSafeString(byteCount: 32)
    }

    static func authorizationURL(
        clientID: String,
        redirectURI: URL,
        state: String,
        verifier: String
    ) throws -> URL {
        guard clientID.hasSuffix(".apps.googleusercontent.com") else { throw GoogleDriveError.invalidClientID }
        var components = URLComponents(url: authorizationEndpoint, resolvingAgainstBaseURL: false)!
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8)))
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: driveScope),
            URLQueryItem(name: "access_type", value: "offline"),
            URLQueryItem(name: "prompt", value: "consent"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256")
        ]
        guard let url = components.url else { throw GoogleDriveError.invalidOAuthResponse }
        return url
    }

    static func exchangeCode(
        _ code: String,
        clientID: String,
        redirectURI: URL,
        verifier: String,
        session: URLSession = .shared
    ) async throws -> GoogleOAuthTokens {
        try await tokenRequest([
            "code": code,
            "client_id": clientID,
            "redirect_uri": redirectURI.absoluteString,
            "grant_type": "authorization_code",
            "code_verifier": verifier
        ], session: session)
    }

    static func refreshAccessToken(
        refreshToken: String,
        clientID: String,
        session: URLSession = .shared
    ) async throws -> GoogleOAuthTokens {
        try await tokenRequest([
            "client_id": clientID,
            "refresh_token": refreshToken,
            "grant_type": "refresh_token"
        ], session: session)
    }

    private static func tokenRequest(_ values: [String: String], session: URLSession) async throws -> GoogleOAuthTokens {
        var request = URLRequest(url: tokenEndpoint, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var components = URLComponents()
        components.queryItems = values.map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = components.percentEncodedQuery?.replacingOccurrences(of: "%20", with: "+").data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw GoogleDriveError.invalidOAuthResponse }
        guard (200..<300).contains(response.statusCode) else {
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = payload?["error_description"] as? String ?? payload?["error"] as? String ?? "Confira o OAuth Client ID e as APIs ativadas no Google Cloud."
            throw GoogleDriveError.api(status: response.statusCode, message: message)
        }
        guard let tokens = try? JSONDecoder().decode(GoogleOAuthTokens.self, from: data) else {
            throw GoogleDriveError.invalidOAuthResponse
        }
        return tokens
    }

    private static func randomURLSafeString(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private final class GoogleOAuthLoopbackServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "br.caminhoanglicano.pregar.google-oauth-loopback")
    private let lock = NSLock()
    private var readyContinuation: CheckedContinuation<UInt16, Error>?
    private var callbackContinuation: CheckedContinuation<[String: String], Error>?
    private var pendingCallback: [String: String]?
    private var timeout: DispatchWorkItem?
    private var redirectPort: UInt16?

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            self.receive(connection, accumulated: Data())
        }
    }

    func start() async throws -> URL {
        let port = try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            readyContinuation = continuation
            lock.unlock()
            listener.stateUpdateHandler = { [weak self] state in self?.listenerChanged(state) }
            listener.start(queue: queue)
        }
        lock.withLock { redirectPort = port }
        return URL(string: "http://127.0.0.1:\(port)")!
    }

    func waitForCallback() async throws -> [String: String] {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let pendingCallback {
                self.pendingCallback = nil
                lock.unlock()
                continuation.resume(returning: pendingCallback)
            } else {
                callbackContinuation = continuation
                lock.unlock()
            }
        }
    }

    func stop() {
        timeout?.cancel()
        listener.cancel()
        lock.lock()
        let waiting = callbackContinuation
        callbackContinuation = nil
        lock.unlock()
        waiting?.resume(throwing: CancellationError())
    }

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            guard let port = listener.port?.rawValue else {
                finishReady(.failure(GoogleDriveError.invalidOAuthResponse))
                return
            }
            finishReady(.success(port))
            let work = DispatchWorkItem { [weak self] in self?.finishCallback(.failure(GoogleDriveError.authorizationTimedOut)) }
            timeout = work
            queue.asyncAfter(deadline: .now() + 240, execute: work)
        case .failed:
            finishReady(.failure(GoogleDriveError.invalidOAuthResponse))
            finishCallback(.failure(GoogleDriveError.invalidOAuthResponse))
        case .cancelled, .setup, .waiting:
            break
        @unknown default:
            finishReady(.failure(GoogleDriveError.invalidOAuthResponse))
        }
    }

    private func finishReady(_ result: Result<UInt16, Error>) {
        lock.lock()
        let continuation = readyContinuation
        readyContinuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    private func finishCallback(_ result: Result<[String: String], Error>) {
        lock.lock()
        let continuation = callbackContinuation
        callbackContinuation = nil
        if case let .success(callback) = result, continuation == nil { pendingCallback = callback }
        lock.unlock()
        continuation?.resume(with: result)
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.start(queue: queue)
        readRequest(connection, accumulated: accumulated)
    }

    private func readRequest(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in
            guard let self else { connection.cancel(); return }
            var request = accumulated
            if let data { request.append(data) }
            let delimiter = Data([13, 10, 13, 10])
            guard let headerEnd = request.range(of: delimiter)?.lowerBound else {
                if error != nil || isComplete || request.count > 16_384 {
                    connection.cancel()
                } else {
                    self.readRequest(connection, accumulated: request)
                }
                return
            }
            let headers = String(decoding: request[..<headerEnd], as: UTF8.self)
            guard let target = headers.components(separatedBy: "\r\n").first?.split(separator: " ").dropFirst().first,
                  let port = self.currentPort,
                  let components = URLComponents(string: "http://127.0.0.1:\(port)\(target)") else {
                self.respond(to: connection, status: 404, body: "Return to Pregar.")
                return
            }
            let values = Dictionary(components.queryItems?.compactMap { item in
                item.value.map { (item.name, $0) }
            } ?? [], uniquingKeysWith: { first, _ in first })
            guard values["state"] != nil, values["code"] != nil || values["error"] != nil else {
                self.respond(to: connection, status: 404, body: "Return to Pregar.")
                return
            }
            self.respond(to: connection, status: 200, body: "Authorization received. You may close this page and return to Pregar.")
            self.finishCallback(.success(values))
        }
    }

    private var currentPort: UInt16? {
        lock.lock()
        defer { lock.unlock() }
        return redirectPort ?? listener.port?.rawValue
    }

    private func respond(to connection: NWConnection, status: Int, body: String) {
        let page = "<!doctype html><html><meta charset=\"utf-8\"><title>Pregar</title><body style=\"font:16px -apple-system,sans-serif;padding:3rem\">\(body)</body></html>"
        let data = Data(page.utf8)
        let header = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Not Found")\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        response.append(data)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

enum GoogleOAuthFlow {
    static func authorize(clientID: String, session: URLSession = .shared) async throws -> GoogleOAuthTokens {
        let server = try GoogleOAuthLoopbackServer()
        defer { server.stop() }
        let redirectURI = try await server.start()
        let state = GoogleOAuthRequest.randomState()
        let verifier = GoogleOAuthRequest.randomVerifier()
        let url = try GoogleOAuthRequest.authorizationURL(
            clientID: clientID,
            redirectURI: redirectURI,
            state: state,
            verifier: verifier
        )
        guard NSWorkspace.shared.open(url) else { throw GoogleDriveError.invalidOAuthResponse }
        let callback = try await server.waitForCallback()
        guard callback["state"] == state else { throw GoogleDriveError.invalidOAuthResponse }
        if let error = callback["error"] { throw GoogleDriveError.authorizationDenied(error) }
        guard let code = callback["code"] else { throw GoogleDriveError.invalidOAuthResponse }
        return try await GoogleOAuthRequest.exchangeCode(
            code,
            clientID: clientID,
            redirectURI: redirectURI,
            verifier: verifier,
            session: session
        )
    }
}

private enum GoogleRefreshTokenKeychain {
    private static let service = "br.caminhoanglicano.pregar.google-drive"
    private static let account = "refresh-token"

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

    static func save(_ token: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(token.utf8)] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = Data(token.utf8)
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw APIKeychain.KeychainError(status: addStatus) }
        } else if status != errSecSuccess {
            throw APIKeychain.KeychainError(status: status)
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
            throw APIKeychain.KeychainError(status: status)
        }
    }
}

struct GoogleDriveFile: Decodable, Equatable, Sendable {
    let id: String
    let name: String
    let mimeType: String?
    let webViewLink: URL?
    let size: Int64?
    let md5Checksum: String?
    let parents: [String]?
    let resourceKey: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case mimeType
        case webViewLink
        case size
        case md5Checksum
        case parents
        case resourceKey
    }

    init(id: String, name: String, mimeType: String?, webViewLink: URL?, size: Int64? = nil, md5Checksum: String? = nil, parents: [String]? = nil, resourceKey: String? = nil) {
        self.id = id
        self.name = name
        self.mimeType = mimeType
        self.webViewLink = webViewLink
        self.size = size
        self.md5Checksum = md5Checksum
        self.parents = parents
        self.resourceKey = resourceKey
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType)
        webViewLink = try container.decodeIfPresent(URL.self, forKey: .webViewLink)
        if let value = try? container.decode(String.self, forKey: .size) {
            size = Int64(value)
        } else {
            size = try container.decodeIfPresent(Int64.self, forKey: .size)
        }
        md5Checksum = try container.decodeIfPresent(String.self, forKey: .md5Checksum)
        parents = try container.decodeIfPresent([String].self, forKey: .parents)
        resourceKey = try container.decodeIfPresent(String.self, forKey: .resourceKey)
    }
}

struct GoogleDocsContent {
    let text: String
    let styles: [StyleRun]
    let paragraphs: [ParagraphRun]

    struct RGBColor: Equatable {
        let red: Double
        let green: Double
        let blue: Double

        init?(color: NSColor) {
            guard let color = color.usingColorSpace(.deviceRGB) else { return nil }
            red = Double(color.redComponent)
            green = Double(color.greenComponent)
            blue = Double(color.blueComponent)
        }

        var docsValue: [String: Any] {
            ["color": ["rgbColor": ["red": red, "green": green, "blue": blue]]]
        }
    }

    struct StyleRun: Equatable {
        let range: NSRange
        let fontName: String
        let fontSize: Double
        let bold: Bool
        let italic: Bool
        let superscript: Bool
        let foregroundColor: RGBColor?
        let backgroundColor: RGBColor?

        init(
            range: NSRange,
            fontName: String,
            fontSize: Double,
            bold: Bool,
            italic: Bool,
            superscript: Bool,
            foregroundColor: RGBColor? = nil,
            backgroundColor: RGBColor? = nil
        ) {
            self.range = range
            self.fontName = fontName
            self.fontSize = fontSize
            self.bold = bold
            self.italic = italic
            self.superscript = superscript
            self.foregroundColor = foregroundColor
            self.backgroundColor = backgroundColor
        }
    }

    struct ParagraphRun: Equatable {
        let range: NSRange
        let indentStart: Double
        let indentFirstLine: Double
        let indentEnd: Double
        let headingType: String?
        let spacingBefore: Double
        let spacingAfter: Double

        init(
            range: NSRange,
            indentStart: Double,
            indentFirstLine: Double,
            indentEnd: Double,
            headingType: String?,
            spacingBefore: Double = 0,
            spacingAfter: Double = 0
        ) {
            self.range = range
            self.indentStart = indentStart
            self.indentFirstLine = indentFirstLine
            self.indentEnd = indentEnd
            self.headingType = headingType
            self.spacingBefore = spacingBefore
            self.spacingAfter = spacingAfter
        }
    }

    init(text: String, styles: [StyleRun], paragraphs: [ParagraphRun] = []) {
        self.text = text
        self.styles = styles
        self.paragraphs = paragraphs
    }

    static func fromRTF(_ data: Data) throws -> GoogleDocsContent {
        guard let attributed = try? NSAttributedString(
            data: data,
            options: [.documentType: NSAttributedString.DocumentType.rtf],
            documentAttributes: nil
        ) else { throw GoogleDriveError.emptyDocument }
        let text = attributed.string
        let fullRange = NSRange(location: 0, length: attributed.length)
        var runs: [StyleRun] = []
        attributed.enumerateAttributes(in: fullRange) { attributes, range, _ in
            guard range.length > 0 else { return }
            let font = attributes[.font] as? NSFont ?? NSFont(name: "Arial", size: 10) ?? .systemFont(ofSize: 10)
            let traits = font.fontDescriptor.symbolicTraits
            let superscript = ((attributes[.baselineOffset] as? NSNumber)?.doubleValue ?? 0) > 0
            let foregroundColor = (attributes[.foregroundColor] as? NSColor).flatMap(RGBColor.init(color:))
            let backgroundColor = (attributes[.backgroundColor] as? NSColor).flatMap(RGBColor.init(color:))
            let run = StyleRun(
                range: range,
                fontName: font.familyName ?? "Arial",
                fontSize: Double(font.pointSize),
                bold: traits.contains(.bold),
                italic: traits.contains(.italic),
                superscript: superscript,
                foregroundColor: foregroundColor,
                backgroundColor: backgroundColor
            )
            if let last = runs.last,
               NSMaxRange(last.range) == range.location,
               last.fontName == run.fontName,
               last.fontSize == run.fontSize,
               last.bold == run.bold,
               last.italic == run.italic,
               last.superscript == run.superscript,
               last.foregroundColor == run.foregroundColor,
               last.backgroundColor == run.backgroundColor {
                runs[runs.count - 1] = StyleRun(
                    range: NSRange(location: last.range.location, length: last.range.length + range.length),
                    fontName: last.fontName,
                    fontSize: last.fontSize,
                    bold: last.bold,
                    italic: last.italic,
                    superscript: last.superscript,
                    foregroundColor: last.foregroundColor,
                    backgroundColor: last.backgroundColor
                )
            } else {
                runs.append(run)
            }
        }
        var paragraphs: [ParagraphRun] = []
        let textNSString = text as NSString
        var paragraphLocation = 0
        while paragraphLocation < textNSString.length {
            let range = textNSString.paragraphRange(for: NSRange(location: paragraphLocation, length: 0))
            let style = attributed.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle ?? .default
            let font = attributed.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont
            let isHeading = (font?.pointSize ?? 0) >= 13 && (font?.fontDescriptor.symbolicTraits.contains(.bold) ?? false)
            let run = ParagraphRun(
                range: range,
                indentStart: Double(max(0, style.headIndent)),
                indentFirstLine: Double(max(0, style.firstLineHeadIndent)),
                indentEnd: Double(max(0, -style.tailIndent)),
                headingType: isHeading ? "HEADING_2" : nil,
                spacingBefore: Double(max(0, style.paragraphSpacingBefore)),
                spacingAfter: Double(max(0, style.paragraphSpacing))
            )
            if run.indentStart > 0 || run.indentFirstLine > 0 || run.indentEnd > 0 || run.headingType != nil || run.spacingBefore > 0 || run.spacingAfter > 0 {
                paragraphs.append(run)
            }
            paragraphLocation = NSMaxRange(range)
        }
        return GoogleDocsContent(text: text, styles: runs, paragraphs: paragraphs)
    }
}

struct GoogleDriveAPI {
    static let driveFilesURL = URL(string: "https://www.googleapis.com/drive/v3/files")!
    static let googleDocMimeType = "application/vnd.google-apps.document"
    static let folderMimeType = "application/vnd.google-apps.folder"
    private static let sermonDraftPropertyKey = "pregarDraftKey"
    private static let ideasDocumentPropertyKey = "pregarIdeasKey"

    var session: URLSession = .shared
    var accessToken: () async throws -> String

    func searchFolder(named name: String) async throws -> GoogleDriveFile? {
        let escaped = Self.escapeQueryLiteral(name)
        let files = try await listFiles(query: "name = '\(escaped)' and mimeType = '\(Self.folderMimeType)' and trashed = false")
        return files.first
    }

    func createFolder(named name: String) async throws -> GoogleDriveFile {
        try await createFile(metadata: ["name": name, "mimeType": Self.folderMimeType])
    }

    func createDocument(named name: String, inFolder folderID: String) async throws -> GoogleDriveFile {
        try await createFile(metadata: [
            "name": name,
            "mimeType": Self.googleDocMimeType,
            "parents": [folderID]
        ])
    }

    func findOrCreateSermonDocument(named name: String, inFolder folderID: String, draftKey: String) async throws -> GoogleDriveFile {
        let escapedFolderID = Self.escapeQueryLiteral(folderID)
        let escapedDraftKey = Self.escapeQueryLiteral(draftKey)
        let query = "'\(escapedFolderID)' in parents and mimeType = '\(Self.googleDocMimeType)' and appProperties has { key='\(Self.sermonDraftPropertyKey)' and value='\(escapedDraftKey)' } and trashed = false"
        if let existing = try await listFiles(query: query).first { return existing }

        return try await createFile(metadata: [
            "name": name,
            "mimeType": Self.googleDocMimeType,
            "parents": [folderID],
            "appProperties": [Self.sermonDraftPropertyKey: draftKey]
        ])
    }

    func findOrCreateIdeasDocument(named name: String, inFolder folderID: String, ideasKey: String) async throws -> GoogleDriveFile {
        let escapedFolderID = Self.escapeQueryLiteral(folderID)
        let escapedIdeasKey = Self.escapeQueryLiteral(ideasKey)
        let query = "'\(escapedFolderID)' in parents and mimeType = '\(Self.googleDocMimeType)' and appProperties has { key='\(Self.ideasDocumentPropertyKey)' and value='\(escapedIdeasKey)' } and trashed = false"
        if let existing = try await listFiles(query: query).first { return existing }

        return try await createFile(metadata: [
            "name": name,
            "mimeType": Self.googleDocMimeType,
            "parents": [folderID],
            "appProperties": [Self.ideasDocumentPropertyKey: ideasKey]
        ])
    }

    func getDocument(id: String) async throws -> (revisionID: String, text: String, endIndex: Int) {
        let url = URL(string: "https://docs.googleapis.com/v1/documents/\(id)")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let revisionID = json["revisionId"] as? String,
              let body = json["body"] as? [String: Any],
              let content = body["content"] as? [[String: Any]] else { throw GoogleDriveError.invalidOAuthResponse }
        let endIndex = content.compactMap { $0["endIndex"] as? Int }.max() ?? 2
        return (revisionID, Self.plainText(in: content), endIndex)
    }

    func replaceDocument(
        id: String,
        content: GoogleDocsContent,
        currentEndIndex: Int,
        requiredRevisionID: String
    ) async throws -> String {
        let body = Self.batchUpdateBody(
            content: content,
            currentEndIndex: currentEndIndex,
            requiredRevisionID: requiredRevisionID
        )
        var request = URLRequest(url: URL(string: "https://docs.googleapis.com/v1/documents/\(id):batchUpdate")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let writeControl = json["writeControl"] as? [String: Any],
              let revisionID = writeControl["requiredRevisionId"] as? String else {
            throw GoogleDriveError.invalidOAuthResponse
        }
        return revisionID
    }

    func synchronizeDocument(
        id: String,
        content: GoogleDocsContent,
        expectedRevisionID: String?,
        overwriteRemote: Bool
    ) async throws -> String {
        let remote = try await getDocument(id: id)
        if !overwriteRemote,
           let expectedRevisionID,
           expectedRevisionID != remote.revisionID {
            throw GoogleDriveError.documentConflict
        }
        return try await replaceDocument(
            id: id,
            content: content,
            currentEndIndex: remote.endIndex,
            requiredRevisionID: remote.revisionID
        )
    }

    static func batchUpdateBody(content: GoogleDocsContent, currentEndIndex: Int, requiredRevisionID: String) -> [String: Any] {
        let length = (content.text as NSString).length
        var requests: [[String: Any]] = []
        if currentEndIndex > 2 {
            requests.append(["deleteContentRange": ["range": [
                "startIndex": 1,
                "endIndex": currentEndIndex - 1
            ]]])
        }
        if length > 0 {
            requests.append(["insertText": ["location": ["index": 1], "text": content.text]])
            let textRange: [String: Int] = ["startIndex": 1, "endIndex": length + 1]
            requests.append(["updateTextStyle": [
                "range": textRange,
                "textStyle": [
                    "bold": false,
                    "italic": false,
                    "baselineOffset": "BASELINE",
                    "weightedFontFamily": ["fontFamily": "Arial"],
                    "fontSize": ["magnitude": 10, "unit": "PT"]
                ],
                "fields": "bold,italic,baselineOffset,weightedFontFamily,fontSize,foregroundColor,backgroundColor"
            ]])
            for style in content.styles where style.bold || style.italic || style.superscript || style.fontSize != 10 || style.fontName != "Arial" || style.foregroundColor != nil || style.backgroundColor != nil {
                let range: [String: Int] = [
                    "startIndex": style.range.location + 1,
                    "endIndex": NSMaxRange(style.range) + 1
                ]
                var textStyle: [String: Any] = [
                    "bold": style.bold,
                    "italic": style.italic,
                    "baselineOffset": style.superscript ? "SUPERSCRIPT" : "BASELINE",
                    "weightedFontFamily": ["fontFamily": style.fontName],
                    "fontSize": ["magnitude": style.fontSize, "unit": "PT"]
                ]
                if let foregroundColor = style.foregroundColor { textStyle["foregroundColor"] = foregroundColor.docsValue }
                if let backgroundColor = style.backgroundColor { textStyle["backgroundColor"] = backgroundColor.docsValue }
                requests.append(["updateTextStyle": [
                    "range": range,
                    "textStyle": textStyle,
                    "fields": "bold,italic,baselineOffset,weightedFontFamily,fontSize,foregroundColor,backgroundColor"
                ]])
            }
            for paragraph in content.paragraphs {
                var paragraphStyle: [String: Any] = [:]
                var fields: [String] = []
                if paragraph.indentStart > 0 {
                    paragraphStyle["indentStart"] = ["magnitude": paragraph.indentStart, "unit": "PT"]
                    fields.append("indentStart")
                }
                if paragraph.indentFirstLine > 0 {
                    paragraphStyle["indentFirstLine"] = ["magnitude": paragraph.indentFirstLine, "unit": "PT"]
                    fields.append("indentFirstLine")
                }
                if paragraph.indentEnd > 0 {
                    paragraphStyle["indentEnd"] = ["magnitude": paragraph.indentEnd, "unit": "PT"]
                    fields.append("indentEnd")
                }
                if paragraph.spacingBefore > 0 {
                    paragraphStyle["spaceAbove"] = ["magnitude": paragraph.spacingBefore, "unit": "PT"]
                    fields.append("spaceAbove")
                }
                if paragraph.spacingAfter > 0 {
                    paragraphStyle["spaceBelow"] = ["magnitude": paragraph.spacingAfter, "unit": "PT"]
                    fields.append("spaceBelow")
                }
                if let headingType = paragraph.headingType {
                    paragraphStyle["namedStyleType"] = headingType
                    fields.append("namedStyleType")
                }
                guard !fields.isEmpty else { continue }
                requests.append(["updateParagraphStyle": [
                    "range": ["startIndex": paragraph.range.location + 1, "endIndex": NSMaxRange(paragraph.range) + 1],
                    "paragraphStyle": paragraphStyle,
                    "fields": fields.joined(separator: ",")
                ]])
            }
        }
        return ["requests": requests, "writeControl": ["requiredRevisionId": requiredRevisionID]]
    }

    private func listFiles(query: String) async throws -> [GoogleDriveFile] {
        var components = URLComponents(url: Self.driveFilesURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "spaces", value: "drive"),
            URLQueryItem(name: "pageSize", value: "100"),
            URLQueryItem(name: "fields", value: "files(id,name,mimeType,webViewLink)")
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        return try JSONDecoder().decode(GoogleDriveFileList.self, from: data).files
    }

    private static func escapeQueryLiteral(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
    }

    private func createFile(metadata: [String: Any]) async throws -> GoogleDriveFile {
        var components = URLComponents(url: Self.driveFilesURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "fields", value: "id,name,mimeType,webViewLink")]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: metadata)
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        guard let file = try? JSONDecoder().decode(GoogleDriveFile.self, from: data) else {
            throw GoogleDriveError.invalidOAuthResponse
        }
        return file
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var request = request
        request.setValue("Bearer \(try await accessToken())", forHTTPHeaderField: "Authorization")
        if request.value(forHTTPHeaderField: "Accept") == nil {
            request.setValue("application/json", forHTTPHeaderField: "Accept")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw GoogleDriveError.invalidOAuthResponse }
        return (data, response)
    }

    private func apiError(_ response: HTTPURLResponse, data: Data) -> GoogleDriveError {
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let error = payload?["error"] as? [String: Any]
        let message = error?["message"] as? String ?? "Confira a conexão e as APIs ativadas no Google Cloud."
        if response.statusCode == 409 || message.localizedCaseInsensitiveContains("revision") {
            return .documentConflict
        }
        return .api(status: response.statusCode, message: message)
    }

    private static func plainText(in blocks: [[String: Any]]) -> String {
        var result = ""
        for block in blocks {
            if let paragraph = block["paragraph"] as? [String: Any],
               let elements = paragraph["elements"] as? [[String: Any]] {
                for element in elements {
                    if let textRun = element["textRun"] as? [String: Any], let content = textRun["content"] as? String {
                        result += content
                    }
                }
            } else if let table = block["table"] as? [String: Any],
                      let rows = table["tableRows"] as? [[String: Any]] {
                for row in rows {
                    for cell in row["tableCells"] as? [[String: Any]] ?? [] {
                        result += plainText(in: cell["content"] as? [[String: Any]] ?? [])
                    }
                }
            } else if let contents = block["tableOfContents"] as? [String: Any] {
                result += plainText(in: contents["content"] as? [[String: Any]] ?? [])
            }
        }
        return result
    }
}

private struct GoogleDriveFileList: Decodable {
    let files: [GoogleDriveFile]
    let nextPageToken: String?
}

struct GoogleDrivePublicFolderLink: Equatable, Sendable {
    let folderID: String
    let resourceKey: String?

    static func parse(_ value: String) -> GoogleDrivePublicFolderLink? {
        guard let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(), host == "drive.google.com" || host == "www.drive.google.com",
              components.user == nil, components.password == nil else { return nil }
        let pathParts = components.path.split(separator: "/").map(String.init)
        let pathID: String? = {
            guard let index = pathParts.firstIndex(of: "folders"), pathParts.indices.contains(index + 1) else { return nil }
            return pathParts[index + 1]
        }()
        let query = Dictionary(components.queryItems?.map { ($0.name.lowercased(), $0.value ?? "") } ?? [], uniquingKeysWith: { first, _ in first })
        let id = pathID ?? query["id"]
        guard let id, id.range(of: #"^[A-Za-z0-9_-]{5,}$"#, options: .regularExpression) != nil else { return nil }
        return GoogleDrivePublicFolderLink(folderID: id, resourceKey: query["resourcekey"])
    }
}

struct GoogleDrivePublicPDF: Equatable, Sendable {
    let file: GoogleDriveFile
    let parentResourceKeys: [String: String]
}

struct GoogleDrivePublicPDFDownloadResult: Sendable {
    let index: Int
    let pdf: GoogleDrivePublicPDF
    let data: Data?
    let errorMessage: String?
}

struct GoogleDrivePublicFolderClient {
    static let filesURL = URL(string: "https://www.googleapis.com/drive/v3/files")!
    static let maximumPDFSize = 128 * 1_024 * 1_024
    static let importConcurrency = 2

    let apiKey: String
    var session: URLSession = .shared

    func folder(for link: GoogleDrivePublicFolderLink) async throws -> GoogleDriveFile {
        let file = try await getFile(id: link.folderID, resourceKey: link.resourceKey)
        guard file.mimeType == GoogleDriveAPI.folderMimeType else { throw GoogleDriveError.invalidPublicDriveFolderLink }
        return file
    }

    func pdfFiles(in folder: GoogleDriveFile, rootResourceKey: String?, includeSubfolders: Bool) async throws -> [GoogleDrivePublicPDF] {
        var folderKeys: [String: String] = [:]
        if let rootResourceKey { folderKeys[folder.id] = rootResourceKey }
        else if let key = folder.resourceKey { folderKeys[folder.id] = key }
        var pending: [(folder: GoogleDriveFile, keys: [String: String], depth: Int)] = [(folder, folderKeys, 0)]
        var visited: Set<String> = []
        var results: [GoogleDrivePublicPDF] = []

        while let current = pending.popLast() {
            guard visited.insert(current.folder.id).inserted else { continue }
            let children = try await listChildren(of: current.folder.id, resourceKeys: current.keys)
            for child in children {
                if child.mimeType == GoogleDriveAPI.folderMimeType {
                    if includeSubfolders, current.depth < 24 {
                        var keys = current.keys
                        if let resourceKey = child.resourceKey { keys[child.id] = resourceKey }
                        pending.append((child, keys, current.depth + 1))
                    }
                } else if child.mimeType == "application/pdf" || child.name.lowercased().hasSuffix(".pdf") {
                    results.append(GoogleDrivePublicPDF(file: child, parentResourceKeys: current.keys))
                    guard results.count <= 5_000 else { throw GoogleDriveError.driveImportTooManyFiles }
                }
            }
        }
        return results.sorted { $0.file.name.localizedStandardCompare($1.file.name) == .orderedAscending }
    }

    func download(_ pdf: GoogleDrivePublicPDF) async throws -> Data {
        if let size = pdf.file.size, size > Self.maximumPDFSize {
            throw GoogleDriveError.driveImportFileTooLarge(pdf.file.name)
        }
        var components = URLComponents(url: Self.filesURL.appending(path: pdf.file.id), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "alt", value: "media"), URLQueryItem(name: "key", value: apiKey)]
        var request = URLRequest(url: components.url!, timeoutInterval: 90)
        request.httpMethod = "GET"
        request.setValue("application/pdf", forHTTPHeaderField: "Accept")
        var keys = pdf.parentResourceKeys
        if let resourceKey = pdf.file.resourceKey { keys[pdf.file.id] = resourceKey }
        setResourceKeyHeader(keys, on: &request)
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw GoogleDriveError.invalidOAuthResponse }
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        guard data.count <= Self.maximumPDFSize else { throw GoogleDriveError.driveImportFileTooLarge(pdf.file.name) }
        guard data.starts(with: Data("%PDF-".utf8)) else { throw GoogleDriveError.driveImportInvalidPDF(pdf.file.name) }
        if let expectedSize = pdf.file.size, expectedSize != Int64(data.count) {
            throw GoogleDriveError.driveImportIntegrityMismatch(pdf.file.name)
        }
        if let expectedChecksum = pdf.file.md5Checksum {
            let actualChecksum = Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard actualChecksum.caseInsensitiveCompare(expectedChecksum) == .orderedSame else {
                throw GoogleDriveError.driveImportIntegrityMismatch(pdf.file.name)
            }
        }
        return data
    }

    func downloadConcurrently(
        _ pdfs: [GoogleDrivePublicPDF],
        maximumConcurrentDownloads: Int,
        download: (@Sendable (GoogleDrivePublicPDF) async throws -> Data)? = nil,
        onCompletion: @escaping @MainActor @Sendable (GoogleDrivePublicPDFDownloadResult) async -> Void
    ) async {
        let limit = min(max(1, maximumConcurrentDownloads), pdfs.count)
        guard limit > 0 else { return }
        let downloadPDF: @Sendable (GoogleDrivePublicPDF) async throws -> Data = download ?? { try await self.download($0) }

        await withTaskGroup(of: GoogleDrivePublicPDFDownloadResult.self) { group in
            for index in 0..<limit {
                let pdf = pdfs[index]
                group.addTask { await self.downloadResult(index: index, pdf: pdf, using: downloadPDF) }
            }

            var nextIndex = limit
            while let result = await group.next() {
                await onCompletion(result)
                guard nextIndex < pdfs.count else { continue }
                let index = nextIndex
                let pdf = pdfs[index]
                nextIndex += 1
                group.addTask { await self.downloadResult(index: index, pdf: pdf, using: downloadPDF) }
            }
        }
    }

    private func downloadResult(
        index: Int,
        pdf: GoogleDrivePublicPDF,
        using download: @escaping @Sendable (GoogleDrivePublicPDF) async throws -> Data
    ) async -> GoogleDrivePublicPDFDownloadResult {
        do {
            return GoogleDrivePublicPDFDownloadResult(index: index, pdf: pdf, data: try await download(pdf), errorMessage: nil)
        } catch {
            return GoogleDrivePublicPDFDownloadResult(index: index, pdf: pdf, data: nil, errorMessage: error.localizedDescription)
        }
    }

    private func getFile(id: String, resourceKey: String?) async throws -> GoogleDriveFile {
        var components = URLComponents(url: Self.filesURL.appending(path: id), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "key", value: apiKey),
            URLQueryItem(name: "fields", value: "id,name,mimeType,webViewLink,size,md5Checksum,parents,resourceKey")
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let resourceKey { request.setValue("\(id)/\(resourceKey)", forHTTPHeaderField: "X-Goog-Drive-Resource-Keys") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw GoogleDriveError.invalidOAuthResponse }
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
        return try JSONDecoder().decode(GoogleDriveFile.self, from: data)
    }

    private func listChildren(of folderID: String, resourceKeys: [String: String]) async throws -> [GoogleDriveFile] {
        let escapedID = folderID.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        let query = "'\(escapedID)' in parents and trashed = false"
        var results: [GoogleDriveFile] = []
        var nextPageToken: String?
        repeat {
            var components = URLComponents(url: Self.filesURL, resolvingAgainstBaseURL: false)!
            components.queryItems = [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "key", value: apiKey),
                URLQueryItem(name: "spaces", value: "drive"),
                URLQueryItem(name: "pageSize", value: "1000"),
                URLQueryItem(name: "supportsAllDrives", value: "true"),
                URLQueryItem(name: "includeItemsFromAllDrives", value: "true"),
                URLQueryItem(name: "fields", value: "nextPageToken,files(id,name,mimeType,webViewLink,size,md5Checksum,parents,resourceKey)")
            ]
            if let nextPageToken { components.queryItems?.append(URLQueryItem(name: "pageToken", value: nextPageToken)) }
            var request = URLRequest(url: components.url!)
            request.httpMethod = "GET"
            setResourceKeyHeader(resourceKeys, on: &request)
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw GoogleDriveError.invalidOAuthResponse }
            guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
            let page = try JSONDecoder().decode(GoogleDriveFileList.self, from: data)
            results.append(contentsOf: page.files)
            nextPageToken = page.nextPageToken
            guard results.count <= 10_000 else { throw GoogleDriveError.driveImportTooManyFiles }
        } while nextPageToken != nil
        return results
    }

    private func setResourceKeyHeader(_ keys: [String: String], on request: inout URLRequest) {
        guard !keys.isEmpty else { return }
        let value = keys.keys.sorted().compactMap { id in keys[id].map { "\(id)/\($0)" } }.joined(separator: ",")
        request.setValue(value, forHTTPHeaderField: "X-Goog-Drive-Resource-Keys")
    }

    private func apiError(_ response: HTTPURLResponse, data: Data) -> GoogleDriveError {
        let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let error = root?["error"] as? [String: Any]
        let message = error?["message"] as? String ?? "A API do Google Drive recusou a solicitação."
        let normalizedMessage = message.lowercased()
        let keyFailure = ["api key", "api_key", "api has not been used", "service_disabled", "referer"].contains {
            normalizedMessage.contains($0)
        }
        if response.statusCode == 404 || (response.statusCode == 403 && !keyFailure) {
            return .publicDriveFolderIsNotAccessible
        }
        return .api(status: response.statusCode, message: message)
    }
}

private enum GoogleDrivePublicAPIKeychain {
    private static let service = "br.caminhoanglicano.pregar.google-drive-public-api"
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
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(key.utf8)] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = Data(key.utf8)
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw APIKeychain.KeychainError(status: addStatus) }
        } else if status != errSecSuccess {
            throw APIKeychain.KeychainError(status: status)
        }
    }
}

struct GoogleDrivePublicPDFImportResult: Sendable {
    let folderName: String
    let localURLs: [URL]
    let failures: [String]
}

@MainActor
final class GoogleDrivePublicPDFImporter: ObservableObject {
    @Published private(set) var isLoadingKey = true
    @Published private(set) var isImporting = false
    @Published private(set) var savedAPIKeyExists = false
    @Published private(set) var status = ""
    @Published private(set) var completedCount = 0
    @Published private(set) var totalCount = 0

    private var savedAPIKey: String?

    init() {
        let readTask = Task.detached(priority: .utility) { GoogleDrivePublicAPIKeychain.read() }
        Task { [weak self] in
            let key = await readTask.value
            self?.savedAPIKey = key
            self?.savedAPIKeyExists = key != nil
            self?.isLoadingKey = false
        }
    }

    func importPDFs(
        from publicFolderLink: String,
        apiKey enteredAPIKey: String,
        includeSubfolders: Bool
    ) async throws -> GoogleDrivePublicPDFImportResult {
        guard !isImporting else { throw GoogleDriveError.syncInProgress }
        guard let link = GoogleDrivePublicFolderLink.parse(publicFolderLink) else {
            throw GoogleDriveError.invalidPublicDriveFolderLink
        }
        let submittedKey = enteredAPIKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = submittedKey.isEmpty ? savedAPIKey : submittedKey
        guard let key, !key.isEmpty else { throw GoogleDriveError.missingPublicDriveAPIKey }

        isImporting = true
        completedCount = 0
        totalCount = 0
        status = "Verificando pasta pública…"
        defer { isImporting = false }

        let client = GoogleDrivePublicFolderClient(apiKey: key)
        let folder = try await client.folder(for: link)
        if !submittedKey.isEmpty {
            try await Task.detached(priority: .utility) { try GoogleDrivePublicAPIKeychain.save(submittedKey) }.value
            savedAPIKey = submittedKey
            savedAPIKeyExists = true
        }
        let files = try await client.pdfFiles(in: folder, rootResourceKey: link.resourceKey, includeSubfolders: includeSubfolders)
        guard !files.isEmpty else { throw GoogleDriveError.noPDFsInPublicDriveFolder }
        totalCount = files.count
        let directory = try Self.importDirectory(folderID: folder.id)
        status = "Baixando até \(GoogleDrivePublicFolderClient.importConcurrency) PDFs simultaneamente…"
        var importedByIndex: [Int: URL] = [:]
        var failuresByIndex: [(Int, String)] = []

        await client.downloadConcurrently(files, maximumConcurrentDownloads: GoogleDrivePublicFolderClient.importConcurrency) { [weak self] result in
            guard let self else { return }
            if let data = result.data {
                let destination = directory.appendingPathComponent(Self.localFilename(for: result.pdf.file), isDirectory: false)
                do {
                    try await Task.detached(priority: .utility) {
                        try data.write(to: destination, options: .atomic)
                    }.value
                    importedByIndex[result.index] = destination
                } catch {
                    failuresByIndex.append((result.index, "\(result.pdf.file.name): \(error.localizedDescription)"))
                }
            } else {
                failuresByIndex.append((result.index, "\(result.pdf.file.name): \(result.errorMessage ?? "Falha ao baixar o arquivo.")"))
            }
            self.completedCount += 1
            self.status = "Processados \(self.completedCount) de \(files.count) PDFs"
        }
        let imported = importedByIndex.keys.sorted().compactMap { importedByIndex[$0] }
        let failures = failuresByIndex.sorted { $0.0 < $1.0 }.map(\.1)
        guard !imported.isEmpty else {
            throw GoogleDriveError.api(status: 400, message: failures.first ?? "Nenhum PDF pôde ser baixado.")
        }
        status = "\(imported.count) PDF(s) baixado(s)\(failures.isEmpty ? "" : " · \(failures.count) com erro")"
        return GoogleDrivePublicPDFImportResult(folderName: folder.name, localURLs: imported, failures: failures)
    }

    private static func importDirectory(folderID: String) throws -> URL {
        let root = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let safeID = String(folderID.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || "-_".unicodeScalars.contains($0) })
        let directory = root.appendingPathComponent("Pregar/Library/Google Drive/\(safeID)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func localFilename(for file: GoogleDriveFile) -> String {
        let basename = URL(fileURLWithPath: file.name).deletingPathExtension().lastPathComponent
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_()."))
        let cleaned = basename.unicodeScalars.map { allowed.contains($0) ? String($0) : "_" }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let safeName = cleaned.isEmpty ? "Comentario" : cleaned
        let safeID = String(file.id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || "-_".unicodeScalars.contains($0) })
        return "\(safeName) [\(safeID)].pdf"
    }
}

@MainActor
final class GoogleDriveStore: ObservableObject {
    static let sermonFolderName = "Sermões"
    static let ideasDocumentTitle = "Ideias de sermões"
    @Published private(set) var isLoading = true
    @Published private(set) var isConnected = false
    @Published private(set) var isConnecting = false
    @Published private(set) var isSaving = false
    @Published private(set) var ideasDocumentID: String?
    @Published private(set) var ideasText = ""
    @Published private(set) var ideasUpdatedAt: Date?
    @Published private(set) var errorMessage: String?

    private var refreshToken: String?
    private var cachedAccessToken: String?
    private var accessTokenExpiresAt = Date.distantPast
    private let defaults: UserDefaults
    private let apiOverride: GoogleDriveAPI?

    init(defaults: UserDefaults = .standard, apiOverride: GoogleDriveAPI? = nil) {
        self.defaults = defaults
        self.apiOverride = apiOverride
        ideasDocumentID = defaults.string(forKey: "drive.ideasDocumentID")
        ideasText = defaults.string(forKey: "drive.ideasText") ?? ""
        ideasUpdatedAt = defaults.object(forKey: "drive.ideasUpdatedAt") as? Date
        if apiOverride != nil {
            isConnected = true
            isLoading = false
            return
        }
        let tokenTask = Task.detached(priority: .utility) { GoogleRefreshTokenKeychain.read() }
        Task { [weak self] in
            let token = await tokenTask.value
            guard let self else { return }
            self.refreshToken = token
            self.isConnected = token != nil
            self.isLoading = false
        }
    }

    func connect(clientID: String) async {
        let clientID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isConnecting else { return }
        guard !clientID.isEmpty else {
            errorMessage = GoogleDriveError.missingClientID.localizedDescription
            return
        }
        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }
        do {
            if let refresh = refreshToken {
                let tokens = try await GoogleOAuthRequest.refreshAccessToken(refreshToken: refresh, clientID: clientID)
                cachedAccessToken = tokens.accessToken
                accessTokenExpiresAt = Date().addingTimeInterval(tokens.expiresIn - 60)
            } else {
                let tokens = try await GoogleOAuthFlow.authorize(clientID: clientID)
                guard let newRefreshToken = tokens.refreshToken else { throw GoogleDriveError.invalidOAuthResponse }
                try await Task.detached(priority: .utility) { try GoogleRefreshTokenKeychain.save(newRefreshToken) }.value
                refreshToken = newRefreshToken
                cachedAccessToken = tokens.accessToken
                accessTokenExpiresAt = Date().addingTimeInterval(tokens.expiresIn - 60)
            }
            defaults.set(clientID, forKey: "drive.oauthClientID")
            isConnected = true
        } catch {
            await clearRefreshTokenIfRejected(by: error)
            errorMessage = error.localizedDescription
        }
    }

    func disconnect() async {
        do {
            try await Task.detached(priority: .utility) { try GoogleRefreshTokenKeychain.delete() }.value
            refreshToken = nil
            cachedAccessToken = nil
            accessTokenExpiresAt = .distantPast
            isConnected = false
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func ensureIdeasDocument() async throws {
        let api = driveAPI()
        if let ideasDocumentID {
            let document = try await api.getDocument(id: ideasDocumentID)
            setIdeasText(document.text)
            return
        }
        let ideasKey: String
        if let savedKey = defaults.string(forKey: "drive.ideasDocumentKey") {
            ideasKey = savedKey
        } else {
            ideasKey = UUID().uuidString
            defaults.set(ideasKey, forKey: "drive.ideasDocumentKey")
        }
        let folder = try await ensureFolder(named: Self.sermonFolderName, using: api)
        let file = try await api.findOrCreateIdeasDocument(
            named: Self.ideasDocumentTitle,
            inFolder: folder.id,
            ideasKey: ideasKey
        )
        ideasDocumentID = file.id
        defaults.set(file.id, forKey: "drive.ideasDocumentID")
        let document = try await api.getDocument(id: file.id)
        setIdeasText(document.text)
    }

    func refreshIdeas() async throws {
        guard let ideasDocumentID else { return }
        let document = try await driveAPI().getDocument(id: ideasDocumentID)
        setIdeasText(document.text)
    }

    func saveSermon(_ draft: SermonDraft, modelContext: ModelContext, overwriteRemote: Bool = false) async throws {
        guard isConnected else { throw GoogleDriveError.notConnected }
        guard !isSaving else { throw GoogleDriveError.syncInProgress }
        guard let data = draft.rtfData else { throw GoogleDriveError.emptyDocument }
        let content = try GoogleDocsContent.fromRTF(data)
        guard !content.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw GoogleDriveError.emptyDocument }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let api = driveAPI()
        do {
            let documentID: String
            if let existingID = draft.googleDriveDocumentID {
                documentID = existingID
            } else {
                let folder = try await ensureFolder(named: Self.sermonFolderName, using: api)
                let draftKey: String
                if let savedKey = draft.googleDriveDraftKey {
                    draftKey = savedKey
                } else {
                    draftKey = UUID().uuidString
                    draft.googleDriveDraftKey = draftKey
                    try modelContext.save()
                }
                let file = try await api.findOrCreateSermonDocument(
                    named: Self.sermonTitle(for: draft),
                    inFolder: folder.id,
                    draftKey: draftKey
                )
                documentID = file.id
                draft.googleDriveDocumentID = documentID
                try modelContext.save()
            }

            let updatedRevisionID = try await api.synchronizeDocument(
                id: documentID,
                content: content,
                expectedRevisionID: draft.googleDriveRevisionID,
                overwriteRemote: overwriteRemote
            )
            draft.googleDriveDocumentID = documentID
            draft.googleDriveRevisionID = updatedRevisionID
            draft.googleDriveSyncedAt = .now
            draft.googleDriveSyncedContentHash = Self.contentHash(data)
            draft.googleDriveSyncError = nil
            try modelContext.save()
        } catch {
            draft.googleDriveSyncError = error.localizedDescription
            try? modelContext.save()
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func documentURL(for id: String) -> URL? {
        URL(string: "https://docs.google.com/document/d/\(id)/edit")
    }

    func hasUnsyncedChanges(_ draft: SermonDraft) -> Bool {
        guard draft.googleDriveDocumentID != nil, let data = draft.rtfData else { return false }
        return draft.googleDriveSyncedContentHash != Self.contentHash(data)
    }

    private func ensureFolder(named name: String, using api: GoogleDriveAPI) async throws -> GoogleDriveFile {
        if let id = defaults.string(forKey: "drive.sermonFolderID") {
            return GoogleDriveFile(id: id, name: name, mimeType: GoogleDriveAPI.folderMimeType, webViewLink: nil)
        }
        if let existing = try await api.searchFolder(named: name) {
            defaults.set(existing.id, forKey: "drive.sermonFolderID")
            return existing
        }
        let folder = try await api.createFolder(named: name)
        defaults.set(folder.id, forKey: "drive.sermonFolderID")
        return folder
    }

    private func driveAPI() -> GoogleDriveAPI {
        if let apiOverride { return apiOverride }
        return GoogleDriveAPI(accessToken: { [weak self] in
            guard let self else { throw GoogleDriveError.notConnected }
            return try await self.accessToken()
        })
    }

    private func accessToken() async throws -> String {
        guard let refreshToken,
              let clientID = defaults.string(forKey: "drive.oauthClientID"),
              !clientID.isEmpty else { throw GoogleDriveError.notConnected }
        if let cachedAccessToken, accessTokenExpiresAt > .now { return cachedAccessToken }
        do {
            let tokens = try await GoogleOAuthRequest.refreshAccessToken(refreshToken: refreshToken, clientID: clientID)
            cachedAccessToken = tokens.accessToken
            accessTokenExpiresAt = Date().addingTimeInterval(tokens.expiresIn - 60)
            return tokens.accessToken
        } catch {
            await clearRefreshTokenIfRejected(by: error)
            throw error
        }
    }

    private func clearRefreshTokenIfRejected(by error: Error) async {
        guard let driveError = error as? GoogleDriveError,
              case let .api(status: 400, message) = driveError,
              message.localizedCaseInsensitiveContains("invalid_grant") else { return }
        try? await Task.detached(priority: .utility) { try GoogleRefreshTokenKeychain.delete() }.value
        refreshToken = nil
        cachedAccessToken = nil
        accessTokenExpiresAt = .distantPast
        isConnected = false
    }

    private func setIdeasText(_ text: String) {
        ideasText = text
        ideasUpdatedAt = .now
        defaults.set(text, forKey: "drive.ideasText")
        defaults.set(ideasUpdatedAt, forKey: "drive.ideasUpdatedAt")
    }

    private static func sermonTitle(for draft: SermonDraft) -> String {
        let subject = draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (draft.mainReadingReference ?? "Sermão")
            : draft.title
        return "\(SermonDateKey.string(from: draft.liturgicalDate)) - \(subject)"
    }

    private static func contentHash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
