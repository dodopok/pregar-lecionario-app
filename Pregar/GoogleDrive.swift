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
    case authorizationDenied(String)
    case authorizationTimedOut
    case api(status: Int, message: String)
    case documentConflict
    case emptyDocument
    case syncInProgress

    var errorDescription: String? {
        switch self {
        case .missingClientID: "Informe o OAuth Client ID na conexão do Google Drive."
        case .notConnected: "Conecte o Google Drive pela Mesa e tente novamente."
        case .invalidClientID: "O Client ID não parece ser de um aplicativo Google para desktop."
        case .invalidOAuthResponse: "O Google não concluiu a autorização. Tente conectar novamente."
        case let .authorizationDenied(message): "A autorização do Google foi recusada: \(message)"
        case .authorizationTimedOut: "A autorização expirou. Volte ao app e conecte o Google Drive novamente."
        case let .api(status, message): "Google Drive (HTTP \(status)): \(message)"
        case .documentConflict: "O Google Doc mudou fora do app desde a última sincronização. Sua cópia local foi preservada. Compare as versões antes de substituir a cópia do Drive."
        case .emptyDocument: "Escreva algum texto antes de salvar o sermão no Google Drive."
        case .syncInProgress: "A sincronização anterior ainda está em andamento."
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

    static func authorizationURL(clientID: String, redirectURI: URL, state: String, verifier: String) throws -> URL {
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

struct GoogleDriveFile: Decodable {
    let id: String
    let name: String
    let mimeType: String?
    let webViewLink: URL?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case mimeType
        case webViewLink
    }
}

struct GoogleDocsContent {
    let text: String
    let styles: [StyleRun]
    let paragraphs: [ParagraphRun]

    struct StyleRun: Equatable {
        let range: NSRange
        let fontName: String
        let fontSize: Double
        let bold: Bool
        let italic: Bool
        let superscript: Bool
    }

    struct ParagraphRun: Equatable {
        let range: NSRange
        let indentStart: Double
        let indentFirstLine: Double
        let indentEnd: Double
        let headingType: String?
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
        attributed.enumerateAttribute(.font, in: fullRange) { value, range, _ in
            guard range.length > 0 else { return }
            let font = value as? NSFont ?? NSFont(name: "Arial", size: 10) ?? .systemFont(ofSize: 10)
            let traits = font.fontDescriptor.symbolicTraits
            let superscript = ((attributed.attribute(.baselineOffset, at: range.location, effectiveRange: nil) as? NSNumber)?.doubleValue ?? 0) > 0
            let run = StyleRun(
                range: range,
                fontName: font.familyName ?? "Arial",
                fontSize: Double(font.pointSize),
                bold: traits.contains(.bold),
                italic: traits.contains(.italic),
                superscript: superscript
            )
            if let last = runs.last,
               NSMaxRange(last.range) == range.location,
               last.fontName == run.fontName,
               last.fontSize == run.fontSize,
               last.bold == run.bold,
               last.italic == run.italic,
               last.superscript == run.superscript {
                runs[runs.count - 1] = StyleRun(
                    range: NSRange(location: last.range.location, length: last.range.length + range.length),
                    fontName: last.fontName,
                    fontSize: last.fontSize,
                    bold: last.bold,
                    italic: last.italic,
                    superscript: last.superscript
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
                headingType: isHeading ? "HEADING_2" : nil
            )
            if run.indentStart > 0 || run.indentFirstLine > 0 || run.indentEnd > 0 || run.headingType != nil {
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

    var session: URLSession = .shared
    var accessToken: () async throws -> String

    func searchFolder(named name: String) async throws -> GoogleDriveFile? {
        let escaped = name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
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

    func deleteFile(id: String) async throws {
        var request = URLRequest(url: URL(string: "\(Self.driveFilesURL.absoluteString)/\(id)")!)
        request.httpMethod = "DELETE"
        let (data, response) = try await send(request)
        guard (200..<300).contains(response.statusCode) else { throw apiError(response, data: data) }
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
                "fields": "bold,italic,baselineOffset,weightedFontFamily,fontSize"
            ]])
            for style in content.styles where style.bold || style.italic || style.superscript || style.fontSize != 10 || style.fontName != "Arial" {
                let range: [String: Int] = [
                    "startIndex": style.range.location + 1,
                    "endIndex": NSMaxRange(style.range) + 1
                ]
                requests.append(["updateTextStyle": [
                    "range": range,
                    "textStyle": [
                        "bold": style.bold,
                        "italic": style.italic,
                        "baselineOffset": style.superscript ? "SUPERSCRIPT" : "BASELINE",
                        "weightedFontFamily": ["fontFamily": style.fontName],
                        "fontSize": ["magnitude": style.fontSize, "unit": "PT"]
                    ],
                    "fields": "bold,italic,baselineOffset,weightedFontFamily,fontSize"
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
        request.setValue("application/json", forHTTPHeaderField: "Accept")
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
    private let defaults = UserDefaults.standard

    init() {
        ideasDocumentID = defaults.string(forKey: "drive.ideasDocumentID")
        ideasText = defaults.string(forKey: "drive.ideasText") ?? ""
        ideasUpdatedAt = defaults.object(forKey: "drive.ideasUpdatedAt") as? Date
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
        let folder = try await ensureFolder(named: Self.sermonFolderName, using: api)
        let file = try await api.createDocument(named: Self.ideasDocumentTitle, inFolder: folder.id)
        let document = try await api.getDocument(id: file.id)
        ideasDocumentID = file.id
        defaults.set(file.id, forKey: "drive.ideasDocumentID")
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
        var createdDocumentID: String?
        do {
            let documentID: String
            if let existingID = draft.googleDriveDocumentID {
                documentID = existingID
            } else {
                let folder = try await ensureFolder(named: Self.sermonFolderName, using: api)
                let file = try await api.createDocument(named: Self.sermonTitle(for: draft), inFolder: folder.id)
                createdDocumentID = file.id
                documentID = file.id
            }

            let remote = try await api.getDocument(id: documentID)
            if !overwriteRemote,
               let expected = draft.googleDriveRevisionID,
               expected != remote.revisionID {
                throw GoogleDriveError.documentConflict
            }
            let updatedRevisionID = try await api.replaceDocument(
                id: documentID,
                content: content,
                currentEndIndex: remote.endIndex,
                requiredRevisionID: remote.revisionID
            )
            draft.googleDriveDocumentID = documentID
            draft.googleDriveRevisionID = updatedRevisionID
            draft.googleDriveSyncedAt = .now
            draft.googleDriveSyncedContentHash = Self.contentHash(data)
            draft.googleDriveSyncError = nil
            try modelContext.save()
        } catch {
            if let createdDocumentID {
                try? await api.deleteFile(id: createdDocumentID)
            }
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
        GoogleDriveAPI(accessToken: { [weak self] in
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
