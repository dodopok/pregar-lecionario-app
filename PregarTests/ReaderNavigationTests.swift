import AppKit
import PDFKit
import SwiftUI
import XCTest
import WebKit
import Network
@testable import Pregar

@MainActor
final class ReaderNavigationTests: XCTestCase {
    func testPDFOpensAtRequestedPageAfterTheViewIsLaidOut() async throws {
        let document = try makeDocument(sourcePathEnvironment: "PREGAR_READER_FEASTING_PDF")
        let (window, hosting, pdfView) = try host(document: document, page: 493)
        defer { window.close() }

        try await assertPage(493, in: pdfView)
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(physicalPage(in: pdfView), 493)
    }

    func testSwitchingPDFsDoesNotPublishTheCoverAsTheNewTabPosition() async throws {
        let feasting = try makeDocument(sourcePathEnvironment: "PREGAR_READER_FEASTING_PDF")
        let connections = try makeDocument(sourcePathEnvironment: "PREGAR_READER_CONNECTIONS_PDF")
        let (window, hosting, pdfView) = try host(document: feasting, page: 493)
        defer { window.close() }
        try await assertPage(493, in: pdfView)

        var publishedPages: [Int] = []
        hosting.rootView = ReaderPDFView(
            document: connections,
            pageNumber: 778,
            onPageChange: { publishedPages.append($0) },
            onSelectionChange: { _ in }
        )
        hosting.layoutSubtreeIfNeeded()
        try await assertPage(778, in: pdfView)
        XCTAssertFalse(publishedPages.contains(1), "Loading a PDF must not replace its saved position with the cover.")

        hosting.rootView = ReaderPDFView(
            document: feasting,
            pageNumber: 493,
            onPageChange: { publishedPages.append($0) },
            onSelectionChange: { _ in }
        )
        hosting.layoutSubtreeIfNeeded()
        try await assertPage(493, in: pdfView)
    }

    func testPageCommandsMoveThePDFAndNativeNavigationPublishesItsPosition() async throws {
        let document = try makeDocument(sourcePathEnvironment: "PREGAR_READER_FEASTING_PDF")
        let (window, hosting, pdfView) = try host(document: document, page: 493)
        defer { window.close() }
        try await assertPage(493, in: pdfView)

        var publishedPage: Int?
        for target in [481, 493] {
            hosting.rootView = ReaderPDFView(
                document: document, pageNumber: target,
                onPageChange: { publishedPage = $0 }, onSelectionChange: { _ in }
            )
            hosting.layoutSubtreeIfNeeded()
            try await assertPage(target, in: pdfView)
        }

        pdfView.go(to: try XCTUnwrap(document.page(at: 494 - 1)))
        for _ in 0..<100 {
            if publishedPage == 494 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(publishedPage, 494, "The position reached by scrolling the PDF must be saved back to its tab.")
    }

    func testReturningToAnOpenMaterialPreservesItsPageAndOtherContextsStillNavigate() async throws {
        let suiteName = "Pregar.ReaderNavigation.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suiteName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            defaults.removePersistentDomain(forName: suiteName)
            try? FileManager.default.removeItem(at: directory)
        }
        let document = try makeDocument()
        let feasting = directory.appendingPathComponent("feasting.pdf")
        let connections = directory.appendingPathComponent("connections.pdf")
        XCTAssertTrue(document.write(to: feasting))
        XCTAssertTrue(document.write(to: connections))
        let reference = "Salmo 34:1-10, 22"
        let date = "2026-11-01"
        let session = ReaderSessionStore(userDefaults: defaults)

        let openedFeasting = await session.openPDF(
            title: "Feasting", path: feasting.path, page: 493, reference: reference, sermonDateKey: date
        )
        XCTAssertTrue(openedFeasting)
        let feastingID = try XCTUnwrap(session.selectedID)
        session.setPage(497, for: feastingID)

        let openedConnections = await session.openPDF(
            title: "Connections", path: connections.path, page: 778, reference: reference, sermonDateKey: date
        )
        XCTAssertTrue(openedConnections)
        let connectionsID = try XCTUnwrap(session.selectedID)
        session.setPage(780, for: connectionsID)

        let returnedToFeasting = await session.openPDF(
            title: "Feasting", path: feasting.path, page: 493, reference: reference,
            sermonDateKey: date, preservePositionIfOpen: true
        )
        XCTAssertTrue(returnedToFeasting)
        XCTAssertEqual(session.selectedTab?.physicalPage, 497)
        session.select(connectionsID)
        XCTAssertEqual(session.selectedTab?.physicalPage, 780)
        session.flushPagePersistence()

        let restored = ReaderSessionStore(userDefaults: defaults)
        XCTAssertEqual(restored.tabs.first(where: { $0.id == feastingID })?.physicalPage, 497)
        XCTAssertEqual(restored.tabs.first(where: { $0.id == connectionsID })?.physicalPage, 780)

        let openedDifferentPassage = await session.openPDF(
            title: "Feasting", path: feasting.path, page: 25, reference: "Salmo 35:1-10",
            sermonDateKey: date, preservePositionIfOpen: true
        )
        XCTAssertTrue(openedDifferentPassage)
        XCTAssertEqual(session.selectedTab?.physicalPage, 25)
        let explicitJump = await session.openPDF(
            title: "Feasting", path: feasting.path, page: 30, reference: "Salmo 35:1-10", sermonDateKey: date
        )
        XCTAssertTrue(explicitJump)
        XCTAssertEqual(session.selectedTab?.physicalPage, 30)
    }

    func testEachSermonKeepsIndependentTabsSelectionAndPDFPositionAfterRestart() async throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let file = fixture.directory.appendingPathComponent("shared.pdf")
        XCTAssertTrue(try makeDocument().write(to: file))
        let store = fixture.store
        let openedA = await store.openPDF(title: "Obra", path: file.path, page: 14, reference: "Salmo 34", sermonDateKey: "2026-11-01")
        XCTAssertTrue(openedA)
        let pdfA = try XCTUnwrap(store.selectedID)
        let pointA = ReaderPDFPosition(page: 14, x: 24, y: 370, scale: 1.4, autoScales: false)
        store.recordPDFPosition(pointA, for: pdfA)
        store.setReviewInclusion(true, for: pdfA)
        let url = try XCTUnwrap(URL(string: "https://example.invalid/article"))
        store.openWeb(title: "Artigo", url: url, reference: "Salmo 34", sermonDateKey: "2026-11-01")
        let webA = try XCTUnwrap(store.selectedID)
        let openedB = await store.openPDF(title: "Obra", path: file.path, page: 60, reference: "Salmo 35", sermonDateKey: "2026-11-08")
        XCTAssertTrue(openedB)
        let pdfB = try XCTUnwrap(store.selectedID)
        store.recordPDFPosition(.init(page: 60, x: 10, y: 250, scale: 0.9, autoScales: false), for: pdfB)
        store.openWeb(title: "Artigo", url: url, reference: "Salmo 35", sermonDateKey: "2026-11-08")
        let webB = try XCTUnwrap(store.selectedID)
        XCTAssertNotEqual(pdfA, pdfB)
        XCTAssertNotEqual(webA, webB)
        XCTAssertEqual(store.tabs.count, 4)
        XCTAssertEqual(store.visibleTabs.count, 2)
        store.activateSermon("2026-11-01")
        XCTAssertEqual(store.selectedID, webA)
        XCTAssertEqual(store.materialsMarkedForReview().map(\.id), [pdfA])
        store.activateSermon("2026-11-08")
        XCTAssertEqual(store.selectedID, webB)
        XCTAssertTrue(store.materialsMarkedForReview().isEmpty)
        XCTAssertEqual(store.materialsMarkedForReview(sermonDateKey: "2026-11-01").map(\.id), [pdfA])
        store.flushPagePersistence()
        let restored = ReaderSessionStore(userDefaults: fixture.defaults)
        XCTAssertEqual(restored.activeSermonDateKey, "2026-11-08")
        XCTAssertEqual(restored.selectedID, webB)
        restored.activateSermon("2026-11-01")
        XCTAssertEqual(restored.selectedID, webA)
        XCTAssertEqual(restored.tabs.first { $0.id == pdfA }?.pdfPosition, pointA)
        XCTAssertEqual(restored.tabs.first { $0.id == pdfB }?.physicalPage, 60)
    }

    func testBackgroundTabsDoNotChangeSelectionOrStealAnotherSermon() throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let store = fixture.store
        let url = try XCTUnwrap(URL(string: "https://example.invalid/article"))
        store.openWeb(title: "Primeiro", url: url, sermonDateKey: "2026-11-01")
        let first = try XCTUnwrap(store.selectedID)
        store.setReviewInclusion(true, for: first)
        store.openWeb(title: "Outra cópia", url: url, sermonDateKey: "2026-11-01", inBackground: true, forceNewTab: true, afterTabID: first)
        XCTAssertEqual(store.visibleTabs.count, 2)
        XCTAssertEqual(store.selectedID, first)
        store.openWeb(title: "Outro sermão", url: url, sermonDateKey: "2026-11-08", inBackground: true)
        XCTAssertEqual(store.activeSermonDateKey, "2026-11-01")
        XCTAssertEqual(store.selectedID, first)
        XCTAssertEqual(store.visibleTabs.count, 2)
        store.duplicate(first, inBackground: true)
        XCTAssertEqual(store.selectedID, first)
        XCTAssertFalse(store.visibleTabs[1].isIncludedForReview, "Duplicar não deve marcar uma nova fonte para a revisão.")
        XCTAssertEqual(ReaderLinkGesture.opensNewTab(button: 2, modifiers: []), true)
        XCTAssertEqual(ReaderLinkGesture.opensNewTab(button: 2, modifiers: .shift), false)
        XCTAssertEqual(ReaderLinkGesture.opensNewTab(button: 0, modifiers: .command), true)
        XCTAssertEqual(ReaderLinkGesture.opensNewTab(button: 0, modifiers: [.command, .shift]), false)
        XCTAssertNil(ReaderLinkGesture.opensNewTab(button: 0, modifiers: []))
    }

    func testClosedTabsReopenInTheirSermonAndReorderingDoesNotAffectOtherGroups() throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let store = fixture.store
        let a = URL(string: "https://example.invalid/a")!
        let b = URL(string: "https://example.invalid/b")!
        store.openWeb(title: "A", url: a, sermonDateKey: "2026-11-01")
        let first = try XCTUnwrap(store.selectedID)
        store.openWeb(title: "B", url: b, sermonDateKey: "2026-11-01")
        let second = try XCTUnwrap(store.selectedID)
        store.openWeb(title: "Outro", url: a, sermonDateKey: "2026-11-08")
        let other = try XCTUnwrap(store.selectedID)
        store.activateSermon("2026-11-01")
        store.move(second, before: first)
        XCTAssertEqual(store.visibleTabs.map(\.id), [second, first])
        store.close(second)
        store.activateSermon("2026-11-08")
        XCTAssertFalse(store.canReopenClosedTab)
        store.activateSermon("2026-11-01")
        store.flushPagePersistence()
        let restored = ReaderSessionStore(userDefaults: fixture.defaults)
        XCTAssertTrue(restored.canReopenClosedTab)
        restored.reopenClosedTab()
        XCTAssertEqual(restored.selectedID, second)
        restored.selectRelative(-1)
        XCTAssertEqual(restored.selectedID, first)
        restored.closeOtherTabs(keeping: first)
        XCTAssertEqual(restored.visibleTabs.map(\.id), [first])
        XCTAssertTrue(restored.tabs.contains { $0.id == other })
    }

    func testOldArchiveMigratesPerSermonAndKeepsUnavailablePDFTabs() throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let a = ReaderTab(id: UUID(), title: "Antigo A", kind: .web, location: "https://example.invalid/a", physicalPage: 1, reference: nil, sermonDateKey: "2026-11-01", includedInReview: false)
        let b = ReaderTab(id: UUID(), title: "PDF offline", kind: .pdf, location: fixture.directory.appendingPathComponent("offline.pdf").path, physicalPage: 52, reference: "Salmo 35", sermonDateKey: "2026-11-08", includedInReview: false)
        let data = try JSONSerialization.data(withJSONObject: ["tabs": try JSONSerialization.jsonObject(with: JSONEncoder().encode([a, b])), "selectedID": b.id.uuidString])
        fixture.defaults.set(data, forKey: "reader.session.v1")
        let restored = ReaderSessionStore(userDefaults: fixture.defaults)
        XCTAssertEqual(restored.tabs.count, 2)
        XCTAssertEqual(restored.visibleTabs.map(\.id), [b.id])
        XCTAssertEqual(restored.selectedTab?.physicalPage, 52)
        restored.activateSermon("2026-11-01")
        XCTAssertEqual(restored.selectedID, a.id)
    }

    func testExplicitPageNavigationResetsTheViewportEvenOnTheSamePage() async throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let file = fixture.directory.appendingPathComponent("document.pdf")
        XCTAssertTrue(try makeDocument().write(to: file))
        let opened = await fixture.store.openPDF(title: "Obra", path: file.path, page: 14)
        XCTAssertTrue(opened)
        let id = try XCTUnwrap(fixture.store.selectedID)
        fixture.store.recordPDFPosition(.init(page: 14, x: 0, y: 320, scale: 1.5, autoScales: false), for: id)
        fixture.store.setPage(14, for: id)
        let tab = try XCTUnwrap(fixture.store.selectedTab)
        XCTAssertNil(fixture.store.pdfPosition(for: tab))
        XCTAssertNotNil(tab.navigationID)
    }

    func testPDFRestoresScrollWithinThePageAndZoomWithoutReapplyingItOnUpdates() async throws {
        let document = try makeDocument()
        var captured: ReaderPDFPosition?
        let (firstWindow, _, firstPDF) = try host(document: document, page: 14, onPositionChange: { captured = $0 })
        defer { firstWindow.close() }
        try await assertPage(14, in: firstPDF)
        firstPDF.autoScales = false
        firstPDF.scaleFactor = 1.5
        firstPDF.go(to: PDFDestination(page: try XCTUnwrap(document.page(at: 13)), at: NSPoint(x: 0, y: 430)))
        for _ in 0..<100 {
            if let captured, !captured.autoScales, abs(captured.scale - 1.5) < 0.01 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let saved = try XCTUnwrap(captured)
        XCTAssertEqual(saved.scale, 1.5, accuracy: 0.01)
        XCTAssertLessThan(saved.y, 790, "A posição precisa incluir o ponto dentro da página.")
        var resumed: ReaderPDFPosition?
        let (secondWindow, hosting, secondPDF) = try host(document: document, page: saved.page, position: saved, onPositionChange: { resumed = $0 })
        defer { secondWindow.close() }
        try await assertPage(saved.page, in: secondPDF)
        try await Task.sleep(for: .milliseconds(200))
        let destination = try XCTUnwrap(secondPDF.currentDestination)
        XCTAssertEqual(destination.point.y, saved.y, accuracy: 2)
        XCTAssertEqual(secondPDF.scaleFactor, saved.scale, accuracy: 0.01)
        let clip = try XCTUnwrap(secondPDF.documentView?.enclosingScrollView?.contentView)
        clip.scroll(to: NSPoint(x: clip.bounds.origin.x, y: clip.bounds.origin.y + 55))
        clip.enclosingScrollView?.reflectScrolledClipView(clip)
        try await Task.sleep(for: .milliseconds(200))
        let changed = try XCTUnwrap(resumed)
        XCTAssertGreaterThan(abs(changed.y - saved.y), 10)
        hosting.rootView = ReaderPDFView(document: document, pageNumber: changed.page, position: changed, onPositionChange: { resumed = $0 }, onPageChange: { _ in }, onSelectionChange: { _ in })
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(try XCTUnwrap(secondPDF.currentDestination).point.y, changed.y, accuracy: 2, "Salvar a rolagem não pode disparar outra navegação.")
    }

    func testPDFMiddleClickOpensLinksInBackgroundWithoutMovingTheCurrentDocument() async throws {
        let document = try makeDocument()
        let page = try XCTUnwrap(document.page(at: 0))
        let annotation = PDFAnnotation(bounds: CGRect(x: 40, y: 700, width: 140, height: 40), forType: .link, withProperties: nil)
        let url = URL(string: "https://example.invalid/reference")!
        annotation.action = PDFActionURL(url: url)
        page.addAnnotation(annotation)
        var opened: [(URL, Bool)] = []
        let (window, _, pdf) = try host(document: document, page: 1, onOpenURL: { opened.append(($0, $1)) })
        defer { window.close() }
        try await assertPage(1, in: pdf)
        await Task.yield()
        let point = pdf.convert(pdf.convert(NSPoint(x: 80, y: 720), from: page), to: nil)
        let screenPoint = window.convertPoint(toScreen: point)
        let cg = try XCTUnwrap(CGEvent(mouseEventSource: nil, mouseType: .otherMouseUp,
                                      mouseCursorPosition: CGPoint(x: screenPoint.x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - screenPoint.y), mouseButton: .center))
        let event = try XCTUnwrap(NSEvent(cgEvent: cg))
        XCTAssertEqual(event.buttonNumber, 2)
        pdf.otherMouseUp(with: event)
        XCTAssertEqual(opened.first?.0, url)
        XCTAssertEqual(opened.first?.1, true)
        XCTAssertEqual(physicalPage(in: pdf), 1)
    }

    func testTabWidthsShrinkUntilTheMinimumAndThenOverflowForHorizontalScrolling() {
        XCTAssertEqual(ReaderTabLayout.width(available: 900, count: 2), 220)
        XCTAssertEqual(ReaderTabLayout.width(available: 620, count: 4), 152)
        XCTAssertEqual(ReaderTabLayout.width(available: 620, count: 20), 108)
        XCTAssertGreaterThan(ReaderTabLayout.width(available: 620, count: 20) * 20, 620)
        XCTAssertNotNil(ReaderWebAddress.url(from: "example.org/article"))
        XCTAssertNil(ReaderWebAddress.url(from: "javascript:alert(1)"))
        XCTAssertNil(ReaderWebAddress.url(from: "file:///etc/passwd"))
    }

    func testWebTabsKeepIndependentScrollAcrossSwitchingReloadAndSessionRestart() async throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let server = try await ReaderTestServer.start()
        defer { server.stop() }
        let store = fixture.store
        store.openWeb(title: "A", url: server.url("/a"), sermonDateKey: "2026-11-01")
        let tabA = try XCTUnwrap(store.selectedTab)
        let a = try XCTUnwrap(store.webSession(for: tabA))
        let window = hostWeb(a)
        defer { window.close() }
        try await waitForWeb(a)
        _ = try await a.webView.evaluateJavaScript("scrollTo(0, 1750)")
        try await waitForScroll(a, y: 1750)
        store.openWeb(title: "B", url: server.url("/b"), sermonDateKey: "2026-11-01")
        let tabB = try XCTUnwrap(store.selectedTab)
        let b = try XCTUnwrap(store.webSession(for: tabB))
        window.contentView = b.webView
        try await waitForWeb(b)
        _ = try await b.webView.evaluateJavaScript("scrollTo(0, 2900)")
        try await waitForScroll(b, y: 2900)
        store.select(tabA.id)
        window.contentView = a.webView
        XCTAssertTrue(store.webSession(for: tabA) === a)
        let returnedY = try await a.webView.evaluateJavaScript("scrollY") as? Double
        XCTAssertEqual(returnedY, 1750)
        a.reload()
        try await waitForWeb(a)
        try await waitForScroll(a, y: 1750)
        store.flushPagePersistence()
        let restored = ReaderSessionStore(userDefaults: fixture.defaults)
        let restoredA = try XCTUnwrap(restored.tabs.first { $0.id == tabA.id })
        let reloaded = try XCTUnwrap(restored.webSession(for: restoredA))
        window.contentView = reloaded.webView
        try await waitForWeb(reloaded)
        try await waitForScroll(reloaded, y: 1750)
        XCTAssertEqual(restored.tabs.first { $0.id == tabB.id }?.webPositions?[server.url("/b").absoluteString]?.y, 2900)
        a.invalidate(); b.invalidate(); reloaded.invalidate()
    }

    func testWebTargetBlankCreatesATabInTheSameSermonAndNavigationRevokesOldReviewInclusion() async throws {
        let fixture = try ReaderTestEnvironment()
        defer { fixture.cleanup() }
        let server = try await ReaderTestServer.start()
        defer { server.stop() }
        let store = fixture.store
        store.openWeb(title: "A", url: server.url("/a"), sermonDateKey: "2026-11-01")
        let original = try XCTUnwrap(store.selectedTab)
        let session = try XCTUnwrap(store.webSession(for: original))
        let window = hostWeb(session)
        defer { window.close(); session.invalidate() }
        try await waitForWeb(session)
        _ = try await session.webView.evaluateJavaScript("document.getElementById('blank').click()")
        for _ in 0..<100 {
            if store.visibleTabs.count == 2 { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(store.visibleTabs.count, 2, "target=_blank não pode ser ignorado nem substituir a página atual.")
        XCTAssertEqual(store.selectedTab?.location, server.url("/popup").absoluteString)
        XCTAssertEqual(session.currentURL, server.url("/a"))
        store.select(original.id)
        store.setReviewInclusion(true, for: original.id)
        session.load(server.url("/b"))
        try await waitForWeb(session, url: server.url("/b"))
        XCTAssertEqual(store.selectedTab?.location, server.url("/b").absoluteString)
        XCTAssertEqual(store.selectedTab?.title, "Artigo B")
        XCTAssertFalse(try XCTUnwrap(store.selectedTab).isIncludedForReview)
    }

    private func hostWeb(_ session: ReaderWebSession) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 800, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = session.webView
        window.orderFront(nil)
        window.contentView?.layoutSubtreeIfNeeded()
        return window
    }

    private func waitForWeb(_ session: ReaderWebSession, url: URL? = nil) async throws {
        for _ in 0..<500 {
            let expected = url ?? session.currentURL
            if !session.isLoading, session.webView.url == expected,
               let state = try? await session.webView.evaluateJavaScript("({url:location.href,title:document.title,ready:document.readyState})") as? [String: String],
               state["url"] == expected.absoluteString, state["ready"] == "complete", state["title"] == session.title,
               session.title.hasPrefix("Artigo") { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Página local não terminou de carregar: \(session.errorMessage ?? "sem erro informado")")
    }

    private func waitForScroll(_ session: ReaderWebSession, y: Double) async throws {
        for _ in 0..<150 {
            let current = try await session.webView.evaluateJavaScript("scrollY") as? Double ?? -1
            if abs(current - y) < 2, abs((session.positions[session.currentURL.absoluteString]?.y ?? -1) - y) < 2 { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("A posição de rolagem esperada não foi restaurada ou publicada.")
    }

    private func makeDocument(sourcePathEnvironment: String? = nil) throws -> PDFDocument {
        if let sourcePathEnvironment, let path = ProcessInfo.processInfo.environment[sourcePathEnvironment] {
            return try XCTUnwrap(PDFDocument(url: URL(fileURLWithPath: path)))
        }
        let data = NSMutableData()
        let consumer = try XCTUnwrap(CGDataConsumer(data: data))
        var bounds = CGRect(x: 0, y: 0, width: 600, height: 800)
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &bounds, nil))
        for page in 1...800 {
            context.beginPDFPage(nil)
            context.setFillColor(CGColor(gray: 0.2, alpha: 1))
            context.fill(CGRect(x: 30, y: 30, width: page % 500 + 1, height: 2))
            context.endPDFPage()
        }
        context.closePDF()
        return try XCTUnwrap(PDFDocument(data: data as Data))
    }

    private func host(document: PDFDocument, page: Int, position: ReaderPDFPosition? = nil, onPositionChange: @escaping (ReaderPDFPosition) -> Void = { _ in }, onOpenURL: @escaping (URL, Bool) -> Void = { _, _ in }) throws -> (NSWindow, NSHostingView<ReaderPDFView>, PDFView) {
        let hosting = NSHostingView(rootView: ReaderPDFView(
            document: document,
            pageNumber: page, position: position, onPositionChange: onPositionChange, onOpenURL: onOpenURL,
            onPageChange: { _ in },
            onSelectionChange: { _ in }
        ))
        let window = NSWindow(
            contentRect: NSRect(x: -10_000, y: -10_000, width: 600, height: 800),
            styleMask: [.borderless], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentView = hosting
        window.orderFront(nil)
        hosting.layoutSubtreeIfNeeded()
        return (window, hosting, try XCTUnwrap(findPDFView(in: hosting)))
    }

    private func findPDFView(in view: NSView) -> PDFView? {
        if let pdfView = view as? PDFView { return pdfView }
        return view.subviews.lazy.compactMap { self.findPDFView(in: $0) }.first
    }

    private func physicalPage(in view: PDFView) -> Int? {
        guard let document = view.document, let page = view.currentPage else { return nil }
        return document.index(for: page) + 1
    }

    private func assertPage(_ expected: Int, in view: PDFView, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<100 {
            if physicalPage(in: view) == expected { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(physicalPage(in: view), expected, file: file, line: line)
    }
}

@MainActor
private final class ReaderTestEnvironment {
    let defaults: UserDefaults
    let directory: URL
    let store: ReaderSessionStore
    private let suite = "Pregar.ReaderBrowser.\(UUID().uuidString)"
    init() throws {
        defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        store = ReaderSessionStore(userDefaults: defaults)
    }
    func cleanup() {
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: directory)
    }
}

private final class ReaderTestServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "Pregar.ReaderTestHTTP")
    private init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
    }
    static func start() async throws -> ReaderTestServer {
        let server = try ReaderTestServer()
        return try await withCheckedThrowingContinuation { continuation in
            server.listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    server.listener.stateUpdateHandler = nil
                    continuation.resume(returning: server)
                case .failed(let error):
                    server.listener.stateUpdateHandler = nil
                    server.listener.cancel()
                    continuation.resume(throwing: error)
                default: break
                }
            }
            server.listener.newConnectionHandler = { [weak server] connection in
                guard let server else { connection.cancel(); return }
                connection.start(queue: server.queue)
                server.receive(connection, accumulated: Data())
            }
            server.listener.start(queue: server.queue)
        }
    }
    func stop() { listener.cancel() }
    func url(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)\(path)")! }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            var request = accumulated
            if let data { request.append(data) }
            guard request.count < 32_768, error == nil else { connection.cancel(); return }
            guard let string = String(data: request, encoding: .utf8), string.contains("\r\n\r\n") else {
                if complete { connection.cancel() } else { self.receive(connection, accumulated: request) }
                return
            }
            let route = string.split(separator: " ").dropFirst().first.map(String.init) ?? "/a"
            let title = route == "/b" ? "B" : (route == "/popup" ? "P" : "A")
            let paragraphs = (0..<150).map { "<p style='height:100px'>Parágrafo \($0), artigo \(title).</p>" }.joined()
            let html = "<html><head><title>Artigo \(title)</title></head><body style='font:16px Arial;margin:24px'><a id='blank' href='/popup' target='_blank'>Nova aba</a> <a id='middle' href='/b'>Outro artigo</a>\(paragraphs)</body></html>"
            let body = Data(html.utf8)
            var response = Data("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
            response.append(body)
            connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
