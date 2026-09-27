import Foundation
import XCTest
@testable import Pregar

final class SermonReviewTests: XCTestCase {
    func testEachProviderUsesItsOwnAuthenticatedStructuredEndpoint() async throws {
        let context = reviewContext(criteria: [.fidelity])
        let source = bibleSource()

        for provider in AIProvider.allCases {
            var captured: URLRequest?
            let providerConfiguration = configuration(for: provider)
            let builtRequest = try SermonAIReviewClient.makeRequest(
                context: context,
                sources: [source],
                configuration: providerConfiguration
            )
            ReviewStubURLProtocol.setHandler { request in
                captured = request
                return (200, Self.responseData("{\"findings\":[]}", provider: provider))
            }
            let session = stubSession()
            let findings = try await SermonAIReviewClient(session: session).review(
                context: context,
                sources: [source],
                configuration: providerConfiguration
            )
            session.invalidateAndCancel()

            XCTAssertTrue(findings.isEmpty)
            let request = try XCTUnwrap(captured)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.host, Self.expectedHost(for: provider))
            XCTAssertEqual(request.url?.path, Self.expectedPath(for: provider))
            XCTAssertFalse(request.url?.absoluteString.contains("secret-key") ?? true)

            switch provider {
            case .openAI, .perplexity:
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret-key")
            case .anthropic:
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "secret-key")
                XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
            case .google:
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-goog-api-key"), "secret-key")
            }

            let body = try XCTUnwrap(builtRequest.httpBody)
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(object["model"] as? String, provider.suggestedModel)
            XCTAssertTrue(body.range(of: Data("MANUSCRITO_PRIVADO".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("2026-10-04".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("Mateus 21".utf8)) != nil)
            if provider == .openAI || provider == .perplexity {
                XCTAssertEqual(object["store"] as? Bool, false)
            }
            if provider == .perplexity {
                XCTAssertTrue((object["tools"] as? [Any])?.isEmpty == true)
                XCTAssertEqual(object["instructions"] as? String, AIReviewPrompt.system)
                XCTAssertEqual(object["input"] as? String != nil, true)
                let format = try XCTUnwrap(object["response_format"] as? [String: Any])
                XCTAssertEqual(format["type"] as? String, "json_schema")
                let jsonSchema = try XCTUnwrap(format["json_schema"] as? [String: Any])
                XCTAssertEqual(jsonSchema["name"] as? String, "sermon_review")
                let schema = try XCTUnwrap(jsonSchema["schema"] as? [String: Any])
                let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
                let findings = try XCTUnwrap(properties["findings"] as? [String: Any])
                let item = try XCTUnwrap(findings["items"] as? [String: Any])
                let alternatives = try XCTUnwrap(item["oneOf"] as? [[String: Any]])
                XCTAssertEqual(alternatives.count, 1)
                let fidelityProperties = try XCTUnwrap(alternatives[0]["properties"] as? [String: Any])
                XCTAssertEqual(
                    (fidelityProperties["evidence_source_id"] as? [String: Any])?["enum"] as? [String],
                    [source.id]
                )
                XCTAssertEqual(
                    (fidelityProperties["correction"] as? [String: Any])?["enum"] as? [String],
                    [""]
                )
            }
        }
    }

    func testPerplexityAgentStructuredMessageParsesAndValidatesAgainstItsSources() async throws {
        let json = #"{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"A promessa parece distante.","observation":"A passagem citada registra que Jesus chorou, sem explicitar a afirmação do manuscrito.","correction":"","classification":"unsupported","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."}]}"#
        ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .perplexity)) }
        let session = stubSession()
        let findings = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.fidelity], manuscript: "A promessa parece distante."),
            sources: [bibleSource()],
            configuration: configuration(for: .perplexity)
        )

        XCTAssertEqual(findings.count, 1)
        XCTAssertEqual(findings[0].criterion, .fidelity)
        XCTAssertEqual(findings[0].manuscriptQuote, "A promessa parece distante.")
        XCTAssertEqual(findings[0].evidenceQuote, "Jesus chorou.")
        XCTAssertEqual(findings[0].evidenceSourceTitle, "NVT")
        session.invalidateAndCancel()
    }

    func testRejectsFindingsWithUnverifiableQuotesOrSuggestionLanguage() async throws {
        let cases = [
            #"{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"frase inventada","observation":"A afirmação não aparece no trecho.","correction":"","classification":"unsupported","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."}]}"#,
            #"{"findings":[{"criterion":"structure","severity":"attention","manuscript_quote":"MANUSCRITO_PRIVADO","observation":"Sugiro reescrever o início.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""}]}"#
        ]

        for json in cases {
            ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .openAI)) }
            let session = stubSession()
            do {
                _ = try await SermonAIReviewClient(session: session).review(
                    context: reviewContext(criteria: [.fidelity, .structure]),
                    sources: [bibleSource()],
                    configuration: configuration(for: .openAI)
                )
                XCTFail("Uma resposta fora do contrato não deve aparecer como revisão válida.")
            } catch let error as SermonReviewError {
                guard case .invalidFinding = error else { return XCTFail("Erro inesperado: \(error)") }
            }
            session.invalidateAndCancel()
        }
    }

    func testOrthographyMayReturnOnlyOneCorrectedWord() async throws {
        let json = #"{"findings":[{"criterion":"spelling","severity":"attention","manuscript_quote":"excessão","observation":"A grafia desta palavra não corresponde à forma padrão.","correction":"exceção","classification":"spelling","evidence_source_id":"","evidence_quote":""}]}"#
        ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .anthropic)) }
        let session = stubSession()
        let findings = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.spelling], manuscript: "A excessão confirma a regra."),
            sources: [],
            configuration: configuration(for: .anthropic)
        )

        XCTAssertEqual(findings.count, 1)
        XCTAssertEqual(findings[0].manuscriptQuote, "excessão")
        XCTAssertEqual(findings[0].correction, "exceção")
        XCTAssertNil(findings[0].evidenceSourceTitle)
        session.invalidateAndCancel()
    }

    func testOversizedContextIsRejectedBeforeNetworkRequest() async throws {
        ReviewStubURLProtocol.setHandler { _ in
            XCTFail("O contexto grande deve ser bloqueado antes da chamada HTTP.")
            return (500, Data())
        }
        let session = stubSession()
        do {
            _ = try await SermonAIReviewClient(session: session).review(
                context: reviewContext(
                    criteria: [.structure],
                    manuscript: String(repeating: "x", count: SermonAIReviewClient.maximumInputBytes + 1)
                ),
                sources: [],
                configuration: configuration(for: .openAI)
            )
            XCTFail("Era esperado bloquear o contexto acima do limite.")
        } catch let error as SermonReviewError {
            guard case .contextTooLarge = error else { return XCTFail("Erro inesperado: \(error)") }
        }
        do {
            _ = try await SermonAIReviewClient(session: session).review(
                context: reviewContext(criteria: [.fidelity]),
                sources: [SermonReviewSource(
                    id: "reader:large",
                    title: "Material grande",
                    citation: "Seção",
                    text: String(repeating: "x", count: PDFReviewSourceExtractor.maximumBytesPerSource + 1)
                )],
                configuration: configuration(for: .openAI)
            )
            XCTFail("Uma fonte acima do limite deve ser bloqueada antes da rede.")
        } catch let error as SermonReviewError {
            guard case .contextTooLarge = error else { return XCTFail("Erro inesperado: \(error)") }
        }
        session.invalidateAndCancel()
    }

    func testEmergencyQuestionsUseAllProvidersWithoutSendingDateOrTitle() async throws {
        let context = questionContext(manuscript: "A promessa parece distante.")
        let json = #"{"questions":[{"question":"O que você quis dizer com “distante”?","manuscript_quote":"A promessa parece distante.","evidence_source_id":"","evidence_quote":""}]}"#

        for provider in AIProvider.allCases {
            var captured: URLRequest?
            let builtRequest = try SermonAIQuestionClient.makeRequest(
                context: context,
                sources: [],
                configuration: configuration(for: provider)
            )
            ReviewStubURLProtocol.setHandler { request in
                captured = request
                return (200, Self.responseData(json, provider: provider))
            }
            let session = stubSession()
            let results = try await SermonAIQuestionClient(session: session).questions(
                context: context,
                sources: [],
                configuration: configuration(for: provider)
            )
            session.invalidateAndCancel()

            XCTAssertEqual(results.map(\.question), ["O que você quis dizer com “distante”?"])
            XCTAssertEqual(captured?.url?.host, Self.expectedHost(for: provider))
            let body = try XCTUnwrap(builtRequest.httpBody)
            XCTAssertFalse(body.range(of: Data("2026-10-04".utf8)) != nil)
            XCTAssertFalse(body.range(of: Data("Mateus 21".utf8)) != nil)
        }
    }

    func testEmergencyQuestionsRejectUnanchoredTextAndLeadingSuggestions() async throws {
        let invalidResults = [
            #"{"questions":[{"question":"O que você quis dizer com isso?","manuscript_quote":"trecho inexistente","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"questions":[{"question":"Você poderia acrescentar uma aplicação?","manuscript_quote":"MANUSCRITO_PRIVADO","evidence_source_id":"","evidence_quote":""}]}"#
        ]

        for json in invalidResults {
            ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .openAI)) }
            let session = stubSession()
            do {
                _ = try await SermonAIQuestionClient(session: session).questions(
                    context: questionContext(),
                    sources: [],
                    configuration: configuration(for: .openAI)
                )
                XCTFail("Uma pergunta fora do escopo não deve ser exibida.")
            } catch let error as SermonAIQuestionError {
                guard case .invalidQuestion = error else { return XCTFail("Erro inesperado: \(error)") }
            }
            session.invalidateAndCancel()
        }
    }

    func testPreviousReaderTabsAreNotTreatedAsExplicitReviewConsent() throws {
        let id = UUID()
        let data = try JSONSerialization.data(withJSONObject: [
            "id": id.uuidString,
            "title": "Documento pessoal",
            "kind": "web",
            "location": "https://example.org/private",
            "physicalPage": 1,
            "reference": NSNull(),
            "includedInReview": true
        ])
        let tab = try JSONDecoder().decode(ReaderTab.self, from: data)

        XCTAssertFalse(tab.isIncludedForReview)
    }

    func testReviewReportsPersistWithoutStoringTheManuscriptAndBecomeStaleAfterEdits() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarReviewTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let manuscript = "Manuscrito privado com erro de grafia."
        let finding = SermonReviewFinding(
            criterion: .spelling,
            severity: .attention,
            manuscriptQuote: "erro de grafia",
            observation: "A grafia desta palavra merece conferência.",
            correction: "manuscrito",
            classification: "spelling",
            evidenceQuote: ""
        )
        let report = SermonReviewReport(
            id: UUID(),
            createdAt: .now,
            dateKey: "2026-10-04",
            title: "Mateus 21",
            mainReference: "Mateus 21.33-46",
            provider: .openAI,
            model: "gpt-6-sol",
            manuscriptFingerprint: SermonReviewReport.fingerprint(manuscript),
            criteria: [.spelling],
            findings: [finding]
        )
        let store = SermonReviewReportStore(directory: directory)
        _ = try await store.save(report)
        let loaded = try await SermonReviewReportStore(directory: directory).reports(for: "2026-10-04")

        XCTAssertEqual(loaded, [report])
        XCTAssertFalse(loaded[0].isStale(manuscript: manuscript, mainReference: "Mateus 21.33-46"))
        XCTAssertFalse(loaded[0].isStale(manuscript: manuscript, mainReference: ""))
        XCTAssertTrue(loaded[0].isStale(manuscript: manuscript + " mudou", mainReference: "Mateus 21.33-46"))
        let persisted = try Data(contentsOf: directory.appendingPathComponent("2026-10-04.json"))
        XCTAssertFalse(String(decoding: persisted, as: UTF8.self).contains(manuscript))
    }

    private func reviewContext(
        criteria: [SermonReviewCriterion],
        manuscript: String = "MANUSCRITO_PRIVADO"
    ) -> SermonReviewContext {
        SermonReviewContext(
            dateKey: "2026-10-04",
            title: "Mateus 21",
            mainReference: "João 3:16",
            manuscript: manuscript,
            criteria: criteria
        )
    }

    private func questionContext(manuscript: String = "MANUSCRITO_PRIVADO") -> SermonQuestionContext {
        SermonQuestionContext(
            dateKey: "2026-10-04",
            title: "Mateus 21",
            mainReference: "João 3:16",
            manuscript: manuscript
        )
    }

    private func bibleSource() -> SermonReviewSource {
        SermonReviewSource(id: "bible:nvt", title: "NVT", citation: "João 3:16 · NVT", text: "Jesus chorou.")
    }

    private func configuration(for provider: AIProvider) -> SermonReviewConfiguration {
        SermonReviewConfiguration(provider: provider, model: provider.suggestedModel, apiKey: "secret-key")
    }

    private func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReviewStubURLProtocol.self]
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

    private static func responseData(_ json: String, provider: AIProvider) -> Data {
        switch provider {
        case .openAI:
            return try! JSONSerialization.data(withJSONObject: [
                "output": [["content": [["type": "output_text", "text": json]]]]
            ])
        case .perplexity:
            return try! JSONSerialization.data(withJSONObject: [
                "status": "completed",
                "output": [["type": "message", "role": "assistant", "status": "completed", "content": [["type": "output_text", "text": json]]]]
            ])
        case .anthropic:
            return try! JSONSerialization.data(withJSONObject: ["content": [["type": "text", "text": json]]])
        case .google:
            return try! JSONSerialization.data(withJSONObject: ["output_text": json])
        }
    }
}

private final class ReviewStubURLProtocol: URLProtocol {
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
