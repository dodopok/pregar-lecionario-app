import Foundation
import XCTest
@testable import Pregar

final class LiturgicalAPITests: XCTestCase {
    func testBibleVersionCatalogLoadsTheAuthenticatedAPIList() async throws {
        var captured: URLRequest?
        CatalogStubURLProtocol.setHandler { request in
            captured = request
            let payload: [String: Any] = [
                "data": [[
                    "code": "nvt",
                    "name": "NVT",
                    "full_name": "Nova Versão Transformadora",
                    "language": "pt-BR",
                    "is_recommended": true,
                    "versification_system": "protestant"
                ]],
                "meta": ["count": 1]
            ]
            return (200, try JSONSerialization.data(withJSONObject: payload))
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CatalogStubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let versions = try await LiturgicalAPIClient(
            settings: APISettings(),
            apiKey: "test-api-key",
            session: session
        ).fetchBibleVersions()

        XCTAssertEqual(versions.map(\.code), ["nvt"])
        XCTAssertEqual(versions.first?.fullName, "Nova Versão Transformadora")
        XCTAssertEqual(versions.first?.language, "pt-BR")
        XCTAssertEqual(captured?.url?.host, "api.caminhoanglicano.com.br")
        XCTAssertEqual(captured?.url?.path, "/api/v2/bible-versions")
        XCTAssertNil(captured?.url?.query)
        XCTAssertEqual(captured?.value(forHTTPHeaderField: "X-API-Key"), "test-api-key")
    }
}

private final class CatalogStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var storedHandler: ((URLRequest) throws -> (Int, Data))?

    static func setHandler(_ handler: @escaping (URLRequest) throws -> (Int, Data)) {
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
        guard let handler, let (status, data) = try? handler(request) else { return }
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
}
