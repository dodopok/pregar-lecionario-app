import AppKit
import PDFKit
import SwiftUI
import XCTest
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

    private func host(document: PDFDocument, page: Int) throws -> (NSWindow, NSHostingView<ReaderPDFView>, PDFView) {
        let hosting = NSHostingView(rootView: ReaderPDFView(
            document: document,
            pageNumber: page,
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
