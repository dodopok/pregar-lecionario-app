import Foundation
import XCTest
@testable import Pregar

final class FavoriteSiteSearchTests: XCTestCase {
    func testCacheKeyIncludesLiturgicalContext() {
        let date = ISO8601DateFormatter().date(from: "2026-09-27T12:00:00Z")!
        let nextSunday = ISO8601DateFormatter().date(from: "2026-10-04T12:00:00Z")!
        let proper21 = FavoriteSiteSearchReport.cacheKey(
            reference: " Matthew 21:23-32 ", occasion: "Proper 21 A", date: date, isSunday: true
        )

        XCTAssertEqual(proper21, FavoriteSiteSearchReport.cacheKey(
            reference: "Matthew 21:23-32", occasion: "Proper 21 A", date: date, isSunday: true
        ))
        XCTAssertNotEqual(proper21, FavoriteSiteSearchReport.cacheKey(
            reference: "Matthew 21:23-32", occasion: "Proper 22 A", date: date, isSunday: true
        ))
        XCTAssertNotEqual(proper21, FavoriteSiteSearchReport.cacheKey(
            reference: "Matthew 21:23-32", occasion: "Proper 21 A", date: nextSunday, isSunday: true
        ))
    }

    func testBuildsFirstPartySearchRequestsFromPassageOnly() throws {
        for site in [FavoriteSite.anglicanCompass, .myPastoralPonderings, .bobCornwall] {
            let request = try XCTUnwrap(FavoriteSiteSearchClient.request(for: site, reference: "Romanos 13.8-14"))
            let components = try XCTUnwrap(URLComponents(url: XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
            XCTAssertEqual(components.queryItems?.first(where: { ["search", "q"].contains($0.name) })?.value, "Romans 13")
            XCTAssertFalse(request.url?.absoluteString.contains("sermão") ?? true)
            if site == .anglicanCompass {
                XCTAssertEqual(components.queryItems?.first(where: { $0.name == "_embed" })?.value, "author")
                XCTAssertTrue(components.queryItems?.first(where: { $0.name == "_fields" })?.value?.contains("_embedded") == true)
            }
        }

        XCTAssertNil(FavoriteSiteSearchClient.request(for: .workingPreacher, reference: "Romanos 13.8-14"))
    }

    func testWordPressResultsUseExcerptAsContextAndRejectExternalURLs() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            [
                "date": "2026-09-20T12:00:00",
                "link": "https://anglicancompass.com/today-in-the-spirit-proper-21a/",
                "title": ["rendered": "Today in the Spirit: Proper 21A"],
                "excerpt": ["rendered": "<p>The Gospel reading is Matthew 21:28-32.</p>"],
                "_embedded": ["author": [["name": "Rev. Anna Smith"]]]
            ],
            [
                "date": "2026-09-20T12:00:00",
                "link": "https://example.org/not-our-source/",
                "title": ["rendered": "Matthew 21:23-32"],
                "excerpt": ["rendered": "<p>External source.</p>"]
            ]
        ])

        let results = try FavoriteSiteSearchClient.articles(
            from: data,
            site: .anglicanCompass,
            targetReference: "Matthew 21:23-32"
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.match, .context)
        XCTAssertEqual(results.first?.author, "Rev. Anna Smith")
        XCTAssertEqual(results.first?.url.host, "anglicancompass.com")
        XCTAssertEqual(results.first?.publishedAt, ISO8601DateFormatter().date(from: "2026-09-20T12:00:00Z"))
    }

    func testWordPressComResultsClassifyPassageRangesAndExcerptMentionsAsContext() throws {
        let data = try JSONSerialization.data(withJSONObject: ["posts": [
            post(title: "Romans 13:8-14", url: "http://mypastoralponderings.com/same", date: "2026-09-20T12:00:00-04:00"),
            post(title: "Romans 13:1-14", url: "https://mypastoralponderings.com/contains", date: "2026-09-19T12:00:00-04:00"),
            post(title: "Romans 13:11-14", url: "https://mypastoralponderings.com/partial", date: "2026-09-18T12:00:00-04:00"),
            post(title: "Isaiah 55:1-5", url: "https://mypastoralponderings.com/unrelated", date: "2026-09-17T12:00:00-04:00")
        ]])

        let results = try FavoriteSiteSearchClient.articles(
            from: data,
            site: .myPastoralPonderings,
            targetReference: "Romans 13:8-14"
        )

        XCTAssertEqual(results.map(\.match), [.same, .contains, .partial, .context])
        XCTAssertEqual(results[0].passageReference, "Romans 13:8-14")
        XCTAssertEqual(results[1].overlapReference, "Romans 13:8-14")
        XCTAssertEqual(results[2].overlapReference, "Romans 13:11-14")
        XCTAssertNil(results[3].passageReference)
        XCTAssertEqual(results.first?.url.scheme, "https")
        XCTAssertEqual(results.first?.author, "Rev. James E. Laurence")
    }

    func testBloggerSearchFindsPartialReferencesAndChecksHost() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "feed": [
                "entry": [
                    bloggerEntry(title: "Question of Authority — Matthew 21:18-27", url: "https://www.bobcornwall.com/2026/03/question.html"),
                    bloggerEntry(title: "Matthew 21:23-32", url: "https://elsewhere.example.org/not-bob.html")
                ]
            ]
        ])

        let results = try FavoriteSiteSearchClient.articles(
            from: data,
            site: .bobCornwall,
            targetReference: "Matthew 21:23-32"
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.match, .partial)
        XCTAssertEqual(results.first?.overlapReference, "Matthew 21:23-27")
        XCTAssertEqual(results.first?.passageReference, "Matthew 21:18-27")
        XCTAssertEqual(results.first?.author, "Bob Cornwall")
    }

    func testCrossChapterOverlapReportsOnlyTheSharedVerses() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "feed": [
                "entry": [bloggerEntry(title: "Matthew 21:33-22:4", url: "https://www.bobcornwall.com/2026/03/vineyard.html")]
            ]
        ])

        let results = try FavoriteSiteSearchClient.articles(
            from: data,
            site: .bobCornwall,
            targetReference: "Matthew 22:1-6"
        )

        XCTAssertEqual(results.first?.match, .partial)
        XCTAssertEqual(results.first?.overlapReference, "Matthew 22:1-4")
        XCTAssertEqual(results.first?.passageReference, "Matthew 21:33-22:4")

        let restored = try JSONDecoder().decode([FavoriteSiteArticle].self, from: JSONEncoder().encode(results))
        XCTAssertEqual(restored.first?.overlapReference, "Matthew 22:1-4")
    }

    func testSearchReturnsPartialFailuresAndKeepsWorkingPreacherFallback() async throws {
        SiteSearchStubURLProtocol.setHandler { request in
            switch request.url?.host {
            case "anglicancompass.com": (200, Self.anglicanCompassResponse())
            case "public-api.wordpress.com": (503, Data())
            case "www.bobcornwall.com": (200, Self.bobCornwallResponse())
            default: (404, Data())
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SiteSearchStubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let report = await FavoriteSiteSearchClient(session: session).search(
            reference: "Matthew 21:23-32",
            occasion: "Proper 21 A",
            date: Date(timeIntervalSince1970: 1_790_000_000),
            isSunday: true
        )

        XCTAssertEqual(report.groups.map(\.site), FavoriteSite.allCases)
        XCTAssertEqual(report.groups.first(where: { $0.site == .workingPreacher })?.errorMessage, nil)
        XCTAssertEqual(report.groups.first(where: { $0.site == .workingPreacher })?.articles, [])
        XCTAssertEqual(report.groups.first(where: { $0.site == .anglicanCompass })?.articles.count, 1)
        XCTAssertNotNil(report.groups.first(where: { $0.site == .myPastoralPonderings })?.errorMessage)
        XCTAssertEqual(report.groups.first(where: { $0.site == .bobCornwall })?.articles.count, 1)
    }

    private func post(title: String, url: String, date: String) -> [String: Any] {
        [
            "title": title,
            "URL": url,
            "date": date,
            "author": ["name": "Rev. James E. Laurence"],
            "excerpt": "<p>Romans 13:8-14</p>"
        ]
    }

    private func bloggerEntry(title: String, url: String) -> [String: Any] {
        [
            "title": ["$t": title],
            "published": ["$t": "2026-03-30T11:42:00.001-04:00"],
            "link": [["rel": "alternate", "href": url]],
            "author": [["name": ["$t": "Bob Cornwall"]]],
            "summary": ["$t": "A lectionary reflection."]
        ]
    }

    private static func anglicanCompassResponse() -> Data {
        jsonData([
            [
                "date": "2026-09-20T12:00:00",
                "link": "https://anglicancompass.com/today-in-the-spirit-proper-21a/",
                "title": ["rendered": "Today in the Spirit: Proper 21A"],
                "excerpt": ["rendered": "<p>The Gospel reading is Matthew 21:28-32.</p>"]
            ]
        ])
    }

    private static func bobCornwallResponse() -> Data {
        jsonData([
            "feed": [
                "entry": [[
                    "title": ["$t": "Question of Authority — Matthew 21:18-27"],
                    "published": ["$t": "2026-03-30T11:42:00.001-04:00"],
                    "link": [["rel": "alternate", "href": "https://www.bobcornwall.com/2026/03/question.html"]],
                    "author": [["name": ["$t": "Bob Cornwall"]]],
                    "summary": ["$t": "A lectionary reflection."]
                ]]
            ]
        ])
    }

    private static func jsonData(_ value: Any) -> Data {
        try! JSONSerialization.data(withJSONObject: value)
    }
}

private final class SiteSearchStubURLProtocol: URLProtocol {
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
