import AppKit
import Foundation
import XCTest
@testable import Pregar

final class GoogleDriveTests: XCTestCase {
    func testOAuthUsesDesktopPKCEAndNarrowDriveScope() throws {
        let clientID = "desktop-client.apps.googleusercontent.com"
        let verifier = GoogleOAuthRequest.randomVerifier()
        let state = GoogleOAuthRequest.randomState()
        let redirect = URL(string: "http://127.0.0.1:49152")!
        let url = try GoogleOAuthRequest.authorizationURL(
            clientID: clientID,
            redirectURI: redirect,
            state: state,
            verifier: verifier
        )
        let items = Dictionary(uniqueKeysWithValues: try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems).map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(items["client_id"], clientID)
        XCTAssertEqual(items["redirect_uri"], redirect.absoluteString)
        XCTAssertEqual(items["response_type"], "code")
        XCTAssertEqual(items["scope"], "https://www.googleapis.com/auth/drive.file")
        XCTAssertEqual(items["access_type"], "offline")
        XCTAssertEqual(items["code_challenge_method"], "S256")
        XCTAssertEqual(items["state"], state)
        XCTAssertFalse(url.absoluteString.contains(verifier))
        XCTAssertFalse(url.absoluteString.localizedCaseInsensitiveContains("client_secret"))
        XCTAssertThrowsError(try GoogleOAuthRequest.authorizationURL(
            clientID: "not-a-google-client",
            redirectURI: redirect,
            state: state,
            verifier: verifier
        ))
    }

    func testRTFConversionPreservesTextAndCharacterStyles() throws {
        let source = NSMutableAttributedString(string: "Sermão fiel\nUma citação\n")
        source.addAttribute(.font, value: NSFont.boldSystemFont(ofSize: 14), range: NSRange(location: 0, length: 6))
        let quoteStyle = NSMutableParagraphStyle()
        quoteStyle.headIndent = 22
        quoteStyle.firstLineHeadIndent = 22
        quoteStyle.tailIndent = -12
        source.addAttribute(.paragraphStyle, value: quoteStyle, range: NSRange(location: 12, length: 12))
        let data = try source.data(
            from: NSRange(location: 0, length: source.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )

        let content = try GoogleDocsContent.fromRTF(data)

        XCTAssertEqual(content.text, "Sermão fiel\nUma citação\n")
        XCTAssertTrue(content.styles.contains { $0.range.location == 0 && $0.bold && $0.fontSize >= 13 })
        XCTAssertTrue(content.paragraphs.contains { $0.headingType == "HEADING_2" })
        XCTAssertTrue(content.paragraphs.contains { $0.indentStart > 0 }, "Paragraph styles: \(content.paragraphs)")
    }

    func testBatchUpdateRequiresRemoteRevisionAndUsesUTF16Ranges() throws {
        let content = GoogleDocsContent(
            text: "A 😀 B\n",
            styles: [.init(range: NSRange(location: 2, length: 2), fontName: "Arial", fontSize: 14, bold: true, italic: false, superscript: false)],
            paragraphs: [.init(range: NSRange(location: 0, length: 7), indentStart: 22, indentFirstLine: 22, indentEnd: 12, headingType: "HEADING_2")]
        )

        let body = GoogleDriveAPI.batchUpdateBody(content: content, currentEndIndex: 15, requiredRevisionID: "revision-8")
        let requests = try XCTUnwrap(body["requests"] as? [[String: Any]])
        let deletion = try XCTUnwrap(requests[0]["deleteContentRange"] as? [String: Any])
        let deletedRange = try XCTUnwrap(deletion["range"] as? [String: Int])
        let insertion = try XCTUnwrap(requests[1]["insertText"] as? [String: Any])
        let updates = requests.compactMap { $0["updateTextStyle"] as? [String: Any] }
        let styledUpdate = try XCTUnwrap(updates.last)
        let range = try XCTUnwrap(styledUpdate["range"] as? [String: Int])
        let writeControl = try XCTUnwrap(body["writeControl"] as? [String: String])
        let paragraphUpdate = try XCTUnwrap(requests.compactMap { $0["updateParagraphStyle"] as? [String: Any] }.first)
        let paragraphFields = try XCTUnwrap(paragraphUpdate["fields"] as? String)

        XCTAssertEqual(deletedRange["startIndex"], 1)
        XCTAssertEqual(deletedRange["endIndex"], 14)
        XCTAssertEqual(insertion["text"] as? String, content.text)
        XCTAssertEqual(range["startIndex"], 3)
        XCTAssertEqual(range["endIndex"], 5)
        XCTAssertEqual(writeControl["requiredRevisionId"], "revision-8")
        XCTAssertTrue(paragraphFields.contains("namedStyleType"))
    }

    func testDocumentFetchExtractsTextAndUsesBearerToken() async throws {
        var captured: URLRequest?
        GoogleDriveStubURLProtocol.setHandler { request in
            captured = request
            return (200, Data(#"{"revisionId":"rev-2","body":{"content":[{"startIndex":0,"endIndex":1},{"startIndex":1,"endIndex":7,"paragraph":{"elements":[{"textRun":{"content":"Ideias\n"}}]}}]}}"#.utf8))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let api = GoogleDriveAPI(session: session, accessToken: { "test-access-token" })

        let document = try await api.getDocument(id: "doc-1")

        XCTAssertEqual(document.revisionID, "rev-2")
        XCTAssertEqual(document.text, "Ideias\n")
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer test-access-token")
        XCTAssertEqual(captured?.url?.host, "docs.googleapis.com")
    }

    func testDocumentReplacementReturnsTheRevisionProducedByItsWrite() async throws {
        var captured: URLRequest?
        GoogleDriveStubURLProtocol.setHandler { request in
            captured = request
            return (200, Data(#"{"documentId":"doc-1","replies":[],"writeControl":{"requiredRevisionId":"rev-3"}}"#.utf8))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let api = GoogleDriveAPI(session: session, accessToken: { "test-access-token" })
        let content = GoogleDocsContent(text: "Texto local\n", styles: [])

        let revision = try await api.replaceDocument(
            id: "doc-1",
            content: content,
            currentEndIndex: 9,
            requiredRevisionID: "rev-2"
        )

        XCTAssertEqual(revision, "rev-3")
        XCTAssertEqual(captured?.url?.path, "/v1/documents/doc-1:batchUpdate")
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer test-access-token")
    }

    func testStaleGoogleDocsRevisionBecomesConflictWithoutSecondRequest() async throws {
        var requests = 0
        GoogleDriveStubURLProtocol.setHandler { _ in
            requests += 1
            return (400, Data(#"{"error":{"message":"The revision ID is invalid or stale."}}"#.utf8))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let api = GoogleDriveAPI(session: session, accessToken: { "test-access-token" })

        do {
            _ = try await api.getDocument(id: "doc-1")
            XCTFail("Expected a revision conflict")
        } catch let error as GoogleDriveError {
            if case .documentConflict = error {} else { XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertEqual(requests, 1)
    }

    func testPublicDriveFolderLinkKeepsResourceKeyAndRejectsUnrelatedHosts() throws {
        let link = try XCTUnwrap(GoogleDrivePublicFolderLink.parse(
            " https://drive.google.com/drive/folders/folder_123?usp=sharing&resourcekey=share-key "
        ))

        XCTAssertEqual(link.folderID, "folder_123")
        XCTAssertEqual(link.resourceKey, "share-key")
        XCTAssertEqual(GoogleDrivePublicFolderLink.parse("https://drive.google.com/open?id=folder_123")?.folderID, "folder_123")
        XCTAssertNil(GoogleDrivePublicFolderLink.parse("http://drive.google.com/drive/folders/folder_123"))
        XCTAssertNil(GoogleDrivePublicFolderLink.parse("https://drive.google.com.evil.example/drive/folders/folder_123"))
        XCTAssertNil(GoogleDrivePublicFolderLink.parse("https://docs.google.com/document/d/folder_123"))
    }

    func testPublicDriveClientListsPagesAndNestedFoldersWithResourceKeys() async throws {
        var requests: [URLRequest] = []
        GoogleDriveStubURLProtocol.setHandler { request in
            requests.append(request)
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            let query = Dictionary(components.queryItems?.map { ($0.name, $0.value ?? "") } ?? [], uniquingKeysWith: { first, _ in first })

            if components.path.hasSuffix("/folder-root") {
                return (200, Data(#"{"id":"folder-root","name":"Comentários","mimeType":"application/vnd.google-apps.folder","resourceKey":"root-key"}"#.utf8))
            }
            if query["alt"] == "media" {
                return (200, Data("%PDF-1.7\nmock pdf".utf8))
            }
            if query["pageToken"] == "page-2" {
                return (200, Data(#"{"files":[{"id":"second-pdf","name":"Segundo.pdf","mimeType":"application/pdf","size":12}]}"#.utf8))
            }
            if query["q"]?.contains("'folder-nested'") == true {
                return (200, Data(#"{"files":[{"id":"nested-pdf","name":"Subpasta.pdf","mimeType":"application/pdf","size":"16","resourceKey":"pdf-key"}]}"#.utf8))
            }
            return (200, Data(#"{"nextPageToken":"page-2","files":[{"id":"folder-nested","name":"Subpasta","mimeType":"application/vnd.google-apps.folder","resourceKey":"nested-key"},{"id":"root-pdf","name":"Primeiro.pdf","mimeType":"application/pdf","size":"10","resourceKey":"root-pdf-key"}]}"#.utf8))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let client = GoogleDrivePublicFolderClient(apiKey: "test-key", session: session)
        let link = try XCTUnwrap(GoogleDrivePublicFolderLink.parse(
            "https://drive.google.com/drive/folders/folder-root?resourcekey=link-root-key"
        ))

        let folder = try await client.folder(for: link)
        let pdfs = try await client.pdfFiles(in: folder, rootResourceKey: link.resourceKey, includeSubfolders: true)
        let nestedPDF = try XCTUnwrap(pdfs.first(where: { $0.file.id == "nested-pdf" }))
        let bytes = try await client.download(nestedPDF)

        XCTAssertEqual(pdfs.map(\.file.id).sorted(), ["nested-pdf", "root-pdf", "second-pdf"])
        XCTAssertTrue(bytes.starts(with: Data("%PDF-".utf8)))
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "X-Goog-Drive-Resource-Keys"), "folder-root/link-root-key")

        let rootPages = requests.filter {
            URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value?.contains("'folder-root'") == true
        }
        XCTAssertEqual(rootPages.count, 2)
        XCTAssertEqual(URLComponents(url: rootPages[1].url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "pageToken" })?.value, "page-2")
        XCTAssertTrue(rootPages.allSatisfy { $0.value(forHTTPHeaderField: "X-Goog-Drive-Resource-Keys") == "folder-root/link-root-key" })

        let nestedListing = try XCTUnwrap(requests.first { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value?.contains("'folder-nested'") == true })
        XCTAssertEqual(nestedListing.value(forHTTPHeaderField: "X-Goog-Drive-Resource-Keys"), "folder-nested/nested-key,folder-root/link-root-key")
        let mediaRequest = try XCTUnwrap(requests.first { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "alt" && $0.value == "media" }) == true })
        XCTAssertEqual(mediaRequest.value(forHTTPHeaderField: "X-Goog-Drive-Resource-Keys"), "folder-nested/nested-key,folder-root/link-root-key,nested-pdf/pdf-key")
        XCTAssertEqual(URLComponents(url: mediaRequest.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "key" })?.value, "test-key")
    }

    func testPublicDriveDistinguishesInvalidAPIKeyFromPrivateFolder() async throws {
        GoogleDriveStubURLProtocol.setHandler { _ in
            (403, Data(#"{"error":{"message":"API key not valid. Please pass a valid API key."}}"#.utf8))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let client = GoogleDrivePublicFolderClient(apiKey: "invalid-key", session: session)
        let link = try XCTUnwrap(GoogleDrivePublicFolderLink.parse("https://drive.google.com/drive/folders/folder-root"))

        do {
            _ = try await client.folder(for: link)
            XCTFail("Expected an API key error")
        } catch let GoogleDriveError.api(status, message) {
            XCTAssertEqual(status, 403)
            XCTAssertTrue(message.contains("API key not valid"))
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        GoogleDriveStubURLProtocol.setHandler { _ in
            (404, Data(#"{"error":{"message":"File not found"}}"#.utf8))
        }
        do {
            _ = try await client.folder(for: link)
            XCTFail("Expected a public-folder access error")
        } catch let error as GoogleDriveError {
            if case .publicDriveFolderIsNotAccessible = error {} else { XCTFail("Unexpected error: \(error)") }
        }
    }

    private func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GoogleDriveStubURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private final class GoogleDriveStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var requestHandler: ((URLRequest) -> (Int, Data))?

    static func setHandler(_ handler: @escaping (URLRequest) -> (Int, Data)) {
        lock.lock()
        requestHandler = handler
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let handler = Self.requestHandler
        Self.lock.unlock()
        guard let handler else { XCTFail("Missing Google Drive stub"); return }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
