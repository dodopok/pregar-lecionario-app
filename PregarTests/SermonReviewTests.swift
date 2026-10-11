import Foundation
import XCTest
@testable import Pregar

final class SermonReviewTests: XCTestCase {
    @MainActor
    func testLiveClaudeCatalogAndStructuredReviewWhenOptedIn() async throws {
        #if PREGAR_LIVE_ANTHROPIC_TEST
        let isOptedIn = true
        #else
        let isOptedIn = ProcessInfo.processInfo.environment["PREGAR_LIVE_ANTHROPIC_TEST"] == "1"
        #endif
        guard isOptedIn else { throw XCTSkip("Ative PREGAR_LIVE_ANTHROPIC_TEST para usar a chave salva com texto sintético.") }
        guard let key = await AISettingsStore().key(for: .anthropic), !key.isEmpty else {
            throw XCTSkip("Nenhuma chave Claude está disponível neste contexto de assinatura.")
        }
        let models = try await AIModelCatalogClient().claudeModels(apiKey: key)
        for model in ["claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5-5"] where models.contains(where: { $0.id == model }) {
            let context = reviewContext(criteria: SermonReviewCriterion.allCases, manuscript: "A excessão confirma a regra.")
            let sources = [SermonReviewSource(id: "synthetic", title: "Fonte sintética", citation: "Teste", text: "A regra admite exceções.")]
            let configuration = SermonReviewConfiguration(provider: .anthropic, model: model, apiKey: key)
            let request = try SermonAIReviewClient.makeRequest(context: context, sources: sources, configuration: configuration)
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = try XCTUnwrap(response as? HTTPURLResponse).statusCode
            guard status == 200 else {
                throw SermonReviewError.provider(status: status, detail: AIProviderResponseError.detail(in: data, redacting: key))
            }
            // Validate the real response locally without paying for a second request.
            ReviewStubURLProtocol.setHandler { _ in (status, data) }
            let session = stubSession()
            defer { session.invalidateAndCancel() }
            let result = try await SermonAIReviewClient(session: session).review(
                context: context, sources: sources, configuration: configuration
            )
            XCTAssertTrue(
                result.findings.contains { $0.criterion == .spelling && $0.correction == "exceção" },
                "\(model): \(SermonAIReviewClient.outputText(in: data, from: .anthropic) ?? "sem saída") · rejeitados: \(result.rejectionReasons)"
            )
            print("Claude · \(model) · HTTP 200 com resposta estruturada · chave não exibida")
        }
        XCTAssertFalse(models.isEmpty)
    }

    func testClaudeReviewSchemaUsesSupportedUnionsAndPreservesCriterionAndSourceConstraints() throws {
        let request = try SermonAIReviewClient.makeRequest(
            context: reviewContext(criteria: SermonReviewCriterion.allCases),
            sources: [bibleSource()],
            configuration: SermonReviewConfiguration(provider: .anthropic, model: "claude-opus-5-5", apiKey: "secret-key")
        )
        let body = try XCTUnwrap(request.httpBody)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let config = try XCTUnwrap(root["output_config"] as? [String: Any])
        let format = try XCTUnwrap(config["format"] as? [String: Any])
        let schema = try XCTUnwrap(format["schema"] as? [String: Any])
        let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
        let findings = try XCTUnwrap(properties["findings"] as? [String: Any])
        let items = try XCTUnwrap(findings["items"] as? [String: Any])
        let alternatives = try XCTUnwrap(items["anyOf"] as? [[String: Any]])
        XCTAssertNil(items["oneOf"])
        XCTAssertEqual(alternatives.count, SermonReviewCriterion.allCases.count)
        for (criterion, alternative) in zip(SermonReviewCriterion.allCases, alternatives) {
            let fields = try XCTUnwrap(alternative["properties"] as? [String: Any])
            XCTAssertEqual((fields["criterion"] as? [String: Any])?["enum"] as? [String], [criterion.rawValue])
            let observation = try XCTUnwrap(fields["observation"] as? [String: Any])
            XCTAssertNil(observation["minLength"])
            XCTAssertNil(observation["maxLength"])
            XCTAssertTrue((observation["description"] as? String)?.contains("800") == true)
            XCTAssertEqual(alternative["additionalProperties"] as? Bool, false)
            if criterion == .fidelity {
                XCTAssertEqual((fields["evidence_source_id"] as? [String: Any])?["enum"] as? [String], [bibleSource().id])
            }
        }
    }

    func testClaudeSchemaAdaptationDoesNotTreatPropertyNamesAsSchemaKeywords() throws {
        let input: [String: Any] = ["type": "object", "properties": [
            "oneOf": ["type": "string", "maxLength": 3],
            "maxLength": ["type": "string", "enum": ["oneOf"]]
        ]]
        let properties = try XCTUnwrap(ClaudeStructuredOutputSchema.adapted(input)["properties"] as? [String: Any])
        XCTAssertNotNil(properties["oneOf"])
        XCTAssertNotNil(properties["maxLength"])
        XCTAssertEqual((properties["maxLength"] as? [String: Any])?["enum"] as? [String], ["oneOf"])
    }

    func testClaudeFidelityWithoutSourcesDoesNotMakeAnUnusableRequest() async throws {
        ReviewStubURLProtocol.setHandler { _ in
            XCTFail("Fidelidade sem fontes deve ser resolvida localmente.")
            return (400, Data())
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let result = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.fidelity]), sources: [], configuration: configuration(for: .anthropic)
        )
        XCTAssertTrue(result.findings.isEmpty)
    }

    func testClaudeProviderErrorShowsTheReasonWithoutExposingCredentials() async throws {
        let data = try JSONSerialization.data(withJSONObject: ["error": [
            "message": "Schema type 'oneOf' is not supported. secret-key sk-ant-test-secret"
        ]])
        ReviewStubURLProtocol.setHandler { _ in (400, data) }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        do {
            _ = try await SermonAIReviewClient(session: session).review(
                context: reviewContext(criteria: [.spelling]), sources: [], configuration: configuration(for: .anthropic)
            )
            XCTFail("HTTP 400 deve ser informado.")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("oneOf"))
            XCTAssertTrue(error.localizedDescription.contains("400"))
            XCTAssertFalse(error.localizedDescription.contains("secret-key"))
            XCTAssertFalse(error.localizedDescription.contains("sk-ant-test-secret"))
        }
    }

    @MainActor
    func testLivePerplexityAgentAPIUsesSavedKeyForSyntheticStructuredReviewWhenOptedIn() async throws {
        #if PREGAR_LIVE_PERPLEXITY_TEST
        let isOptedIn = true
        #else
        let isOptedIn = ProcessInfo.processInfo.environment["PREGAR_LIVE_PERPLEXITY_TEST"] == "1"
        #endif
        guard isOptedIn else {
            throw XCTSkip("Defina PREGAR_LIVE_PERPLEXITY_TEST=1 para autorizar a chamada real com texto sintético.")
        }
        guard let key = await AISettingsStore().key(for: .perplexity), !key.isEmpty else {
            throw XCTSkip("Nenhuma chave Perplexity foi encontrada no Acesso às Chaves deste contexto de assinatura.")
        }

        let context = SermonReviewContext(
            dateKey: "teste",
            title: "Teste sintético",
            mainReference: "",
            manuscript: "A excessão confirma a regra.",
            criteria: [.spelling]
        )
        let startedAt = Date.now
        let result = try await SermonAIReviewClient().review(
            context: context,
            sources: [],
            configuration: SermonReviewConfiguration(
                provider: .perplexity,
                model: AIProvider.perplexity.suggestedModel,
                apiKey: key
            )
        )
        let elapsedMilliseconds = Int(Date.now.timeIntervalSince(startedAt) * 1_000)
        let correction = try XCTUnwrap(result.findings.first { $0.manuscriptQuote == "excessão" })

        XCTAssertEqual(correction.criterion, .spelling)
        XCTAssertEqual(correction.correction, "exceção")
        XCTAssertEqual(result.rejectedFindingCount, 0)
        XCTAssertNil(result.validationNotice)
        print("Perplexity Agent API · resposta estruturada validada · \(elapsedMilliseconds) ms · chave não exibida")
    }

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
            let result = try await SermonAIReviewClient(session: session).review(
                context: context,
                sources: [source],
                configuration: providerConfiguration
            )
            session.invalidateAndCancel()

            XCTAssertTrue(result.findings.isEmpty)
            XCTAssertEqual(result.rejectedFindingCount, 0)
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
                let schemaName = try XCTUnwrap(jsonSchema["name"] as? String)
                XCTAssertEqual(schemaName, "sermonreview")
                XCTAssertNotNil(schemaName.range(of: #"^[A-Za-z0-9]{1,64}$"#, options: .regularExpression))
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
        let result = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.fidelity], manuscript: "A promessa parece distante."),
            sources: [bibleSource()],
            configuration: configuration(for: .perplexity)
        )

        XCTAssertEqual(result.findings.count, 1)
        XCTAssertEqual(result.findings[0].criterion, .fidelity)
        XCTAssertEqual(result.findings[0].manuscriptQuote, "A promessa parece distante.")
        XCTAssertEqual(result.findings[0].evidenceQuote, "Jesus chorou.")
        XCTAssertEqual(result.findings[0].evidenceSourceTitle, "NVT")
        XCTAssertNil(result.validationNotice)
        session.invalidateAndCancel()
    }

    func testFiltersFindingsWithUnverifiableQuotesOrSuggestionLanguage() async throws {
        let cases = [
            #"{"findings":[{"criterion":"fidelity","severity":"attention","manuscript_quote":"frase inventada","observation":"A afirmação não aparece no trecho.","correction":"","classification":"unsupported","evidence_source_id":"bible:nvt","evidence_quote":"Jesus chorou."}]}"#,
            #"{"findings":[{"criterion":"structure","severity":"attention","manuscript_quote":"MANUSCRITO_PRIVADO","observation":"Sugiro reescrever o início.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"findings":[{"criterion":"structure","severity":"attention","manuscript_quote":"MANUSCRITO_PRIVADO","observation":"A expressão “A esperança começa hoje” volta a aparecer no parágrafo.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""}]}"#
        ]

        for json in cases {
            ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .openAI)) }
            let session = stubSession()
            let result = try await SermonAIReviewClient(session: session).review(
                context: reviewContext(criteria: [.fidelity, .structure]),
                sources: [bibleSource()],
                configuration: configuration(for: .openAI)
            )

            XCTAssertTrue(result.findings.isEmpty)
            XCTAssertEqual(result.rejectedFindingCount, 1)
            XCTAssertNotNil(result.validationNotice)
            session.invalidateAndCancel()
        }
    }

    func testSuggestionGuardRejectsIndirectWritingPromptsButAllowsAnchoredAnalysis() {
        let manuscript = "A promessa parece distante."
        let suggestions = [
            "Você pode escrever uma frase sobre esperança.",
            "Uma forma mais clara seria começar com uma pergunta.",
            "Comece com uma imagem da vinha.",
            "Try opening with a question about hope.",
            "Uma opção seria abrir com uma pergunta.",
            "Uma possibilidade é incluir uma aplicação cotidiana."
        ]

        for suggestion in suggestions {
            XCTAssertTrue(
                AIReviewPrompt.containsForbiddenSuggestion(suggestion, manuscript: manuscript),
                "A formulação proibida passou pela validação: \(suggestion)"
            )
        }

        XCTAssertTrue(AIReviewPrompt.containsForbiddenSuggestion(
            "A expressão “A esperança começa hoje” volta a aparecer no parágrafo.",
            manuscript: manuscript
        ))
        XCTAssertFalse(AIReviewPrompt.containsForbiddenSuggestion(
            "A expressão “A promessa parece distante” retorna no final.",
            manuscript: manuscript
        ))
        XCTAssertFalse(AIReviewPrompt.containsForbiddenSuggestion(
            "A conclusão retoma a ideia central depois do contexto.",
            manuscript: manuscript
        ))
    }

    func testKeepsValidFindingsAndReportsOnlyTheCountOfRejectedContent() async throws {
        let json = #"{"findings":[{"criterion":"structure","severity":"note","manuscript_quote":"O início apresenta a tese.","observation":"A tese aparece antes de o contexto que a sustenta ser apresentado.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""},{"criterion":"structure","severity":"attention","manuscript_quote":"O início apresenta a tese.","observation":"Sugiro reescrever o início.","correction":"","classification":"structure","evidence_source_id":"","evidence_quote":""}]}"#
        ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .perplexity)) }
        let session = stubSession()
        let result = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.structure], manuscript: "O início apresenta a tese. Depois o texto a desenvolve."),
            sources: [],
            configuration: configuration(for: .perplexity)
        )

        XCTAssertEqual(result.findings.count, 1)
        XCTAssertEqual(result.findings[0].observation, "A tese aparece antes de o contexto que a sustenta ser apresentado.")
        XCTAssertEqual(result.rejectedFindingCount, 1)
        XCTAssertTrue(result.validationNotice?.contains("escopo") == true)
        XCTAssertFalse(result.validationNotice?.contains("Sugiro reescrever") == true)
        session.invalidateAndCancel()
    }

    func testStructureMapIsValidatedAgainstTheManuscriptAndSuggestionLanguage() async throws {
        let manuscript = "Começo com uma pergunta. O texto diz que Jesus chorou. Termino com um convite."
        let json = #"{"findings":[],"structure":{"verdict":"solid","summary":"O sermão abre com uma pergunta, passa pelo texto e termina com um convite.","central_idea":{"status":"clear","statement":"Jesus chora com quem chora.","quote":"Jesus chorou","note":""},"sections":[{"kind":"introduction","assessment":"fulfills","start_quote":"Começo com uma pergunta.","note":"A introdução abre com uma pergunta."},{"kind":"development","assessment":"fulfills","start_quote":"O texto diz","note":""},{"kind":"conclusion","assessment":"fulfills","start_quote":"frase inexistente","note":"Sugiro reescrever o final."}],"movements":[{"label":"Pergunta inicial","start_quote":"Começo"},{"label":"Acrescente uma aplicação","start_quote":""}],"gospel":{"status":"explicit","quote":"Termino com um convite.","note":""},"four_pages":[{"page":"problem_bible","status":"not_found","quote":""},{"page":"problem_today","status":"not_found","quote":""},{"page":"grace_bible","status":"present","quote":"Jesus chorou"},{"page":"grace_today","status":"present","quote":"trecho que não existe"}]}}"#
        ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .openAI)) }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let result = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.structure], manuscript: manuscript),
            sources: [],
            configuration: configuration(for: .openAI)
        )

        let structure = try XCTUnwrap(result.structure)
        XCTAssertEqual(result.rejectedFindingCount, 0)
        XCTAssertEqual(structure.verdict, .solid)
        XCTAssertEqual(structure.sections.map(\.kind), [.introduction, .development, .conclusion])
        XCTAssertEqual(structure.section(.introduction)?.assessment, .fulfills)
        XCTAssertEqual(structure.section(.introduction)?.startQuote, "Começo com uma pergunta.")
        XCTAssertEqual(structure.section(.conclusion)?.assessment, .partial, "Trecho inexistente rebaixa a parte para cumprida em parte.")
        XCTAssertEqual(structure.section(.conclusion)?.startQuote, "")
        XCTAssertEqual(structure.section(.conclusion)?.note, "", "Nota com sugestão de redação é ocultada.")
        XCTAssertEqual(structure.centralIdea.status, .clear)
        XCTAssertEqual(structure.centralIdea.statement, "Jesus chora com quem chora.")
        XCTAssertEqual(structure.movements.map(\.label), ["Pergunta inicial"], "Movimento com imperativo de redação é descartado.")
        XCTAssertEqual(structure.gospel.status, .explicit)
        XCTAssertEqual(structure.fourPages.first { $0.page == .graceBible }?.status, .present)
        XCTAssertEqual(structure.fourPages.first { $0.page == .graceToday }?.status, .brief, "Página presente sem trecho válido vira breve.")
        XCTAssertEqual(result.structureAdjustmentCount, 6)
        XCTAssertTrue(result.validationNotice?.contains("mapa do sermão") == true)
        XCTAssertFalse(result.validationNotice?.contains("Sugiro") == true)
    }

    func testReviewSchemaAlwaysRequestsTheSermonStructureMap() throws {
        let request = try SermonAIReviewClient.makeRequest(
            context: reviewContext(criteria: [.spelling]),
            sources: [],
            configuration: configuration(for: .openAI)
        )
        let body = try XCTUnwrap(request.httpBody)
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let text = try XCTUnwrap(root["text"] as? [String: Any])
        let format = try XCTUnwrap(text["format"] as? [String: Any])
        let schema = try XCTUnwrap(format["schema"] as? [String: Any])
        let required = try XCTUnwrap(schema["required"] as? [String])
        XCTAssertEqual(Set(required), ["findings", "structure"])
        let properties = try XCTUnwrap(schema["properties"] as? [String: Any])
        let structure = try XCTUnwrap(properties["structure"] as? [String: Any])
        XCTAssertEqual(structure["additionalProperties"] as? Bool, false)
        let structureProperties = try XCTUnwrap(structure["properties"] as? [String: Any])
        let sections = try XCTUnwrap(structureProperties["sections"] as? [String: Any])
        XCTAssertEqual(sections["minItems"] as? Int, 3)
        XCTAssertNotNil(structureProperties["central_idea"])
        XCTAssertNotNil(structureProperties["gospel"])
        XCTAssertNotNil(structureProperties["four_pages"])
        XCTAssertTrue(AIReviewPrompt.system.contains("Mapa do sermão"))
        XCTAssertTrue(AIReviewPrompt.system.contains("Um texto, um foco, um ponto"))
    }

    func testFindingStatusRoundTripsAndDefaultsToOpenForLegacyReports() throws {
        var finding = SermonReviewFinding(
            criterion: .clarity,
            severity: .note,
            manuscriptQuote: "",
            observation: "O termo aparece sem explicação.",
            correction: "",
            classification: "clarity",
            evidenceQuote: ""
        )
        finding.status = .resolved
        let data = try JSONEncoder().encode([finding])
        XCTAssertEqual(try JSONDecoder().decode([SermonReviewFinding].self, from: data), [finding])

        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        legacy[0].removeValue(forKey: "status")
        let legacyData = try JSONSerialization.data(withJSONObject: legacy)
        let decoded = try JSONDecoder().decode([SermonReviewFinding].self, from: legacyData)
        XCTAssertEqual(decoded[0].status, .open)
        XCTAssertEqual(decoded[0].observation, finding.observation)
    }

    func testOrthographyMayReturnOnlyOneCorrectedWord() async throws {
        let json = #"{"findings":[{"criterion":"spelling","severity":"attention","manuscript_quote":"excessão","observation":"A grafia desta palavra não corresponde à forma padrão.","correction":"exceção","classification":"spelling","evidence_source_id":"","evidence_quote":""}]}"#
        ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .anthropic)) }
        let session = stubSession()
        let result = try await SermonAIReviewClient(session: session).review(
            context: reviewContext(criteria: [.spelling], manuscript: "A excessão confirma a regra."),
            sources: [],
            configuration: configuration(for: .anthropic)
        )

        XCTAssertEqual(result.findings.count, 1)
        XCTAssertEqual(result.findings[0].manuscriptQuote, "excessão")
        XCTAssertEqual(result.findings[0].correction, "exceção")
        XCTAssertNil(result.findings[0].evidenceSourceTitle)
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
            if provider == .perplexity {
                let requestObject = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                let format = try XCTUnwrap(requestObject["response_format"] as? [String: Any])
                let jsonSchema = try XCTUnwrap(format["json_schema"] as? [String: Any])
                let schemaName = try XCTUnwrap(jsonSchema["name"] as? String)
                XCTAssertEqual(schemaName, "sermonquestions")
                XCTAssertNotNil(schemaName.range(of: #"^[A-Za-z0-9]{1,64}$"#, options: .regularExpression))
            }
        }
    }

    func testEmergencyQuestionsRejectUnanchoredTextAndLeadingSuggestions() async throws {
        let invalidResults = [
            #"{"questions":[{"question":"O que você quis dizer com isso?","manuscript_quote":"trecho inexistente","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"questions":[{"question":"Você poderia acrescentar uma aplicação?","manuscript_quote":"MANUSCRITO_PRIVADO","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"questions":[{"question":"Que aplicação cotidiana caberia nesta mensagem?","manuscript_quote":"A promessa parece distante.","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"questions":[{"question":"Que esperança aparece?","manuscript_quote":"A promessa parece distante.","evidence_source_id":"","evidence_quote":""}]}"#,
            #"{"questions":[{"question":"Qual frase você pode usar para abrir o sermão?","manuscript_quote":"A promessa parece distante.","evidence_source_id":"","evidence_quote":""}]}"#
        ]

        for json in invalidResults {
            ReviewStubURLProtocol.setHandler { _ in (200, Self.responseData(json, provider: .openAI)) }
            let session = stubSession()
            do {
                _ = try await SermonAIQuestionClient(session: session).questions(
                    context: questionContext(manuscript: "A promessa parece distante."),
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
            findings: [finding],
            validationNotice: "1 apontamento foi ocultado após a validação local (escopo). Nenhum texto rejeitado foi exibido."
        )
        let store = SermonReviewReportStore(directory: directory)
        _ = try await store.save(report)
        let loaded = try await SermonReviewReportStore(directory: directory).reports(for: "2026-10-04")

        XCTAssertEqual(loaded, [report])
        XCTAssertEqual(loaded[0].validationNotice, report.validationNotice)
        XCTAssertFalse(loaded[0].isStale(manuscript: manuscript, mainReference: "Mateus 21.33-46"))
        XCTAssertFalse(loaded[0].isStale(manuscript: manuscript, mainReference: ""))
        XCTAssertTrue(loaded[0].isStale(manuscript: manuscript + " mudou", mainReference: "Mateus 21.33-46"))
        let persisted = try Data(contentsOf: directory.appendingPathComponent("2026-10-04.json"))
        XCTAssertFalse(String(decoding: persisted, as: UTF8.self).contains(manuscript))

        var legacyPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: persisted) as? [[String: Any]])
        legacyPayload[0].removeValue(forKey: "validationNotice")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyPayload)
        let legacyReports = try JSONDecoder().decode([SermonReviewReport].self, from: legacyData)
        XCTAssertNil(legacyReports[0].validationNotice)
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

final class AIModelCatalogTests: XCTestCase {
    func testClaudeCatalogUsesAuthenticatedPaginationKeepsNewModelsAndDropsDuplicatesAndRetiredModels() async throws {
        var requests: [URLRequest] = []
        ReviewStubURLProtocol.setHandler { request in
            requests.append(request)
            let isFirstPage = !request.url!.absoluteString.contains("after_id")
            let models: [[String: Any]] = isFirstPage
                ? [["id": "claude-opus-6-1", "display_name": "Claude Opus 6.1"],
                   ["id": "claude-retired-test", "display_name": "Retired", "lifecycle": "retired"]]
                : [["id": "claude-opus-6-1", "display_name": "Duplicate"],
                   ["id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5"],
                   ["id": "gpt-other-provider", "display_name": "Other"]]
            return (200, try! JSONSerialization.data(withJSONObject: [
                "data": models, "has_more": isFirstPage, "last_id": "claude-opus-6-1"
            ]))
        }
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        let models = try await AIModelCatalogClient(session: session).claudeModels(apiKey: "secret-key")
        XCTAssertEqual(models.map(\.id), ["claude-opus-6-1", "claude-sonnet-5-5"])
        XCTAssertEqual(models.first?.displayName, "Claude Opus 6.1")
        XCTAssertEqual(requests.count, 2)
        for request in requests {
            XCTAssertEqual(request.url?.host, "api.anthropic.com")
            XCTAssertEqual(request.url?.path, "/v1/models")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "secret-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
            XCTAssertFalse(request.url!.absoluteString.contains("secret-key"))
        }
        XCTAssertTrue(requests.last!.url!.absoluteString.contains("after_id=claude-opus-6-1"))
    }

    func testClaudeCatalogRejectsServerErrorsAndRepeatedPaginationCursors() async throws {
        let session = stubSession()
        defer { session.invalidateAndCancel() }
        ReviewStubURLProtocol.setHandler { _ in (401, Data()) }
        do {
            _ = try await AIModelCatalogClient(session: session).claudeModels(apiKey: "secret-key")
            XCTFail("Chave recusada deve ser informada.")
        } catch let error as AIModelCatalogError {
            guard case .provider(status: 401) = error else { return XCTFail("Erro inesperado: \(error)") }
        }
        ReviewStubURLProtocol.setHandler { _ in (200, Data(#"{"data":[{"id":"claude-opus-5-5","display_name":"Opus"}],"has_more":true,"last_id":"same"}"#.utf8)) }
        do {
            _ = try await AIModelCatalogClient(session: session).claudeModels(apiKey: "secret-key")
            XCTFail("Paginação inválida deve terminar sem repetir chamadas indefinidamente.")
        } catch let error as AIModelCatalogError {
            guard case .unreadableResponse = error else { return XCTFail("Erro inesperado: \(error)") }
        }
    }

    @MainActor
    func testDynamicClaudeSelectionAndCachedCatalogSurviveSavingAndReloadingPreferences() throws {
        let suite = "PregarClaudeCatalogTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cached = [AIModelOption(id: "claude-opus-6-1", displayName: "Claude Opus 6.1")]
        defaults.set(try JSONEncoder().encode(cached), forKey: "ai.models.anthropic")
        let store = AISettingsStore(defaults: defaults, loadsKeys: false)
        store.save(reviewProvider: .anthropic, reviewModel: "claude-opus-6-1", researchProvider: .anthropic, researchModel: "claude-opus-6-1")
        let restored = AISettingsStore(defaults: defaults, loadsKeys: false)
        restored.reloadPreferences()
        XCTAssertEqual(restored.reviewModel, "claude-opus-6-1")
        XCTAssertEqual(restored.researchModel, "claude-opus-6-1")
        XCTAssertEqual(restored.modelOptions(for: .anthropic), cached)
        XCTAssertEqual(restored.modelOptions(for: .anthropic, including: "claude-sonnet-5").last?.id, "claude-sonnet-5")
        XCTAssertFalse(AIProvider.anthropic.acceptsModel("gpt-6-sol"))
        XCTAssertFalse(AIProvider.anthropic.acceptsModel("claude-unsafe/identifier"))
    }

    private func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReviewStubURLProtocol.self]
        return URLSession(configuration: configuration)
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
