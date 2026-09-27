import Foundation
import XCTest
@testable import Pregar

final class AIResearchTests: XCTestCase {
    func testEachProviderReturnsOnlyVerifiedSearchSources() async throws {
        for provider in AIProvider.allCases {
            var captured: URLRequest?
            ResearchStubURLProtocol.setHandler { request in
                captured = request
                return (200, Self.responseData(for: provider))
            }
            let session = stubSession()
            let sources = try await AIResearchClient(session: session).search(
                reference: "Romanos 13.8-14",
                occasion: "Próprio 18 A",
                configuration: configuration(for: provider)
            )
            session.invalidateAndCancel()
            let builtRequest = try AIResearchClient.makeRequest(
                reference: "Romanos 13.8-14",
                occasion: "Próprio 18 A",
                configuration: configuration(for: provider)
            )

            XCTAssertEqual(sources.count, 1)
            XCTAssertEqual(sources.first?.title, "Commentary on Romans 13")
            XCTAssertEqual(sources.first?.publishedDate, "2026-05-12")
            XCTAssertEqual(sources.first?.author, "Dr. Rowan Williams")
            XCTAssertEqual(sources.first?.publisher, "Theology Journal")
            XCTAssertEqual(sources.first?.tradition, "Anglican")
            XCTAssertEqual(sources.first?.language, "en")
            XCTAssertEqual(
                sources.first?.editorialContext,
                "Autor: Dr. Rowan Williams · Instituição: Theology Journal · Tradição: Anglican · Idioma: en"
            )
            XCTAssertEqual(captured?.httpMethod, "POST")
            XCTAssertEqual(captured?.url?.host, Self.expectedHost(for: provider))
            XCTAssertEqual(captured?.url?.path, Self.expectedPath(for: provider))
            XCTAssertFalse(captured?.url?.absoluteString.contains("secret-key") ?? true)

            switch provider {
            case .openAI, .perplexity:
                XCTAssertEqual(captured?.value(forHTTPHeaderField: "Authorization"), "Bearer secret-key")
            case .anthropic:
                XCTAssertEqual(captured?.value(forHTTPHeaderField: "x-api-key"), "secret-key")
                XCTAssertEqual(captured?.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
            case .google:
                XCTAssertEqual(captured?.value(forHTTPHeaderField: "x-goog-api-key"), "secret-key")
            }

            let body = try XCTUnwrap(builtRequest.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["model"] as? String, provider.suggestedModel)
            XCTAssertTrue(body.range(of: Data("Romanos 13.8-14".utf8)) != nil)
            XCTAssertTrue(body.range(of: Data("Próprio 18 A".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("MANUSCRITO_PRIVADO".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("2026-09-27".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("Título particular".utf8)) != nil)
            if provider == .openAI || provider == .google || provider == .perplexity {
                XCTAssertEqual(json["store"] as? Bool, false)
            }
        }
    }

    func testRequestUsesSearchToolsAndKeepsKeysOutOfURL() throws {
        for provider in AIProvider.allCases {
            let request = try AIResearchClient.makeRequest(
                reference: "Romanos 13.8-14",
                occasion: nil,
                configuration: configuration(for: provider)
            )
            let body = try XCTUnwrap(request.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertFalse(request.url?.absoluteString.contains("secret-key") ?? true)
            XCTAssertTrue(body.range(of: Data("N. T. Wright".utf8)) != nil)
            XCTAssertTrue(body.range(of: Data("sem manuscrito".utf8)) != nil || body.range(of: Data("no sermon manuscript".utf8)) != nil)
            XCTAssertTrue(body.range(of: Data("never infer an author's denomination".utf8)) != nil)

            switch provider {
            case .openAI:
                XCTAssertEqual(json["include"] as? [String], ["web_search_call.action.sources"])
                XCTAssertEqual((json["tools"] as? [[String: Any]])?.first?["type"] as? String, "web_search")
                XCTAssertEqual(json["store"] as? Bool, false)
            case .anthropic:
                XCTAssertEqual((json["tools"] as? [[String: Any]])?.first?["type"] as? String, "web_search_20250305")
            case .google:
                XCTAssertEqual((json["tools"] as? [[String: Any]])?.first?["type"] as? String, "google_search")
                XCTAssertEqual(json["store"] as? Bool, false)
            case .perplexity:
                XCTAssertEqual((json["tools"] as? [[String: Any]])?.first?["type"] as? String, "web_search")
                XCTAssertEqual(json["store"] as? Bool, false)
            }
        }
    }

    func testRejectsMissingCredentialsInvalidModelsAndUnverifiedURLs() async throws {
        let session = stubSession()
        defer { session.invalidateAndCancel() }

        do {
            _ = try await AIResearchClient(session: session).search(
                reference: "Romanos 13",
                occasion: nil,
                configuration: AIResearchConfiguration(provider: .openAI, model: "invalid-model", apiKey: "secret-key")
            )
            XCTFail("Modelo inválido não deve chegar à rede.")
        } catch let error as AIResearchError {
            guard case .invalidModel = error else { return XCTFail("Erro inesperado: \(error)") }
        }

        do {
            _ = try await AIResearchClient(session: session).search(
                reference: "Romanos 13",
                occasion: nil,
                configuration: AIResearchConfiguration(provider: .openAI, model: AIProvider.openAI.suggestedModel, apiKey: "")
            )
            XCTFail("Chave ausente não deve chegar à rede.")
        } catch let error as AIResearchError {
            guard case .noKey = error else { return XCTFail("Erro inesperado: \(error)") }
        }

        ResearchStubURLProtocol.setHandler { _ in (200, Self.unverifiedResponse()) }
        do {
            _ = try await AIResearchClient(session: session).search(
                reference: "Romanos 13",
                occasion: nil,
                configuration: configuration(for: .openAI)
            )
            XCTFail("URLs sem HTTPS ou sem host público não devem ser exibidas.")
        } catch let error as AIResearchError {
            guard case .unreadableResponse = error else { return XCTFail("Erro inesperado: \(error)") }
        }
    }

    func testMissingEditorialMetadataIsNotInferredAndOldSourcesRemainReadable() throws {
        let payload: [String: Any] = ["output": [[
            "type": "web_search_call",
            "action": ["sources": [[
                "title": "Commentary on Romans",
                "url": "https://anglican.example.org/romans"
            ]]]
        ]]]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let source = try XCTUnwrap(AIResearchClient.sources(in: data, from: .openAI).first)

        XCTAssertNil(source.author)
        XCTAssertNil(source.publisher)
        XCTAssertNil(source.tradition)
        XCTAssertNil(source.language)
        XCTAssertEqual(source.editorialContext, "Metadados editoriais não informados pela busca")

        let olderReportSource = Data("""
        {"title":"Saved commentary","url":"https://example.org/old","publishedDate":null}
        """.utf8)
        let restored = try JSONDecoder().decode(AIResearchSource.self, from: olderReportSource)
        XCTAssertNil(restored.author)
        XCTAssertNil(restored.publisher)
        XCTAssertNil(restored.tradition)
        XCTAssertNil(restored.language)
    }

    private func configuration(for provider: AIProvider) -> AIResearchConfiguration {
        AIResearchConfiguration(provider: provider, model: provider.suggestedModel, apiKey: "secret-key")
    }

    private func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ResearchStubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private static func expectedHost(for provider: AIProvider) -> String {
        switch provider {
        case .openAI: "api.openai.com"
        case .anthropic: "api.anthropic.com"
        case .google: "generativelanguage.googleapis.com"
        case .perplexity: "api.perplexity.ai"
        }
    }

    private static func expectedPath(for provider: AIProvider) -> String {
        switch provider {
        case .openAI: "/v1/responses"
        case .anthropic: "/v1/messages"
        case .google: "/v1beta/interactions"
        case .perplexity: "/v1/agent"
        }
    }

    private static func responseData(for provider: AIProvider) -> Data {
        let source: [String: Any] = [
            "title": "Commentary on Romans 13",
            "url": "https://example.org/romans-13",
            "date": "2026-05-12",
            "author": "Dr. Rowan Williams",
            "publisher": "Theology Journal",
            "tradition": "Anglican",
            "language": "en"
        ]
        let payload: [String: Any]
        switch provider {
        case .openAI:
            payload = ["output": [["type": "web_search_call", "action": ["sources": [source]]]]]
        case .anthropic:
            var result = source
            result["type"] = "web_search_result"
            result["page_age"] = "2026-05-12"
            payload = ["content": [[
                "type": "web_search_tool_result",
                "content": [result]
            ]]]
        case .google:
            var annotation = source
            annotation["type"] = "url_citation"
            payload = ["steps": [[
                "type": "model_output",
                "content": [["type": "text", "annotations": [annotation]]]
            ]]]
        case .perplexity:
            payload = ["output": [
                ["type": "search_results", "results": [source]],
                ["type": "message", "content": [["type": "output_text", "annotations": [["type": "url_citation", "title": source["title"]!, "url": source["url"]!]]]]]
            ]]
        }
        return try! JSONSerialization.data(withJSONObject: payload)
    }

    private static func unverifiedResponse() -> Data {
        try! JSONSerialization.data(withJSONObject: ["output": [[
            "type": "web_search_call",
            "action": ["sources": [
                ["title": "Insecure", "url": "http://example.org/romans"],
                ["title": "Private host", "url": "https://user:pass@example.org/romans"],
                ["title": "No host", "url": "https:relative-path"]
            ]]
        ]]])
    }
}

private final class ResearchStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var storedHandler: ((URLRequest) -> (Int, Data))?

    static func setHandler(_ handler: @escaping (URLRequest) -> (Int, Data)) {
        lock.lock()
        storedHandler = handler
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let handler = Self.storedHandler
        Self.lock.unlock()
        guard let handler else { return }
        let (status, data) = handler(request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
