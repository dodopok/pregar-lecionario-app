import PDFKit
import SwiftData
import XCTest
@testable import Pregar

final class SermonHistoryTests: XCTestCase {
    @MainActor
    func testArchiveSearchUsesStoredLiturgicalOccasionAndBrazilianDate() throws {
        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 4))!
        let draft = SermonDraft(liturgicalDate: date)
        draft.title = "Mateus 21.33-46"
        draft.liturgicalOccasion = "Próprio 22 A"
        draft.liturgicalCelebration = "Francisco de Assis"
        draft.liturgicalSeason = "Tempo depois de Pentecostes"

        XCTAssertTrue(ArchiveSearchMode.occasion.matches(draft, query: "Próprio 22"))
        XCTAssertTrue(ArchiveSearchMode.occasion.matches(draft, query: "Francisco"))
        XCTAssertTrue(ArchiveSearchMode.occasion.matches(draft, query: "Pentecostes"))
        XCTAssertFalse(ArchiveSearchMode.occasion.matches(draft, query: "Mateus 21"))
        XCTAssertTrue(ArchiveSearchMode.date.matches(draft, query: "04/10/2026"))
        XCTAssertTrue(ArchiveSearchMode.passage.matches(draft, query: "Mateus 21"))
    }

    func testReaderReviewMaterialCountsAreScopedToSermonDateAndLegacyTabsDecode() throws {
        let legacyJSON = #"{"id":"A9A598D5-552A-46E4-8A13-EC66A4C3E079","title":"Working Preacher","kind":"web","location":"https://workingpreacher.org","physicalPage":1,"reference":"Mateus 21.33-46","includedInReview":true}"#
        let legacyTab = try JSONDecoder().decode(ReaderTab.self, from: Data(legacyJSON.utf8))
        XCTAssertNil(legacyTab.sermonDateKey)

        let reference = "Mateus 21.33-46"
        let current = ReaderTab(
            id: UUID(), title: "Working Preacher", kind: .web,
            location: "https://workingpreacher.org", physicalPage: 1,
            reference: reference, sermonDateKey: "2026-10-04",
            includedInReview: true, reviewInclusionConfirmed: true
        )
        let otherSunday = ReaderTab(
            id: UUID(), title: "Commentary", kind: .web,
            location: "https://example.org", physicalPage: 1,
            reference: reference, sermonDateKey: "2029-09-30",
            includedInReview: true, reviewInclusionConfirmed: true
        )
        let unconfirmed = ReaderTab(
            id: UUID(), title: "Unconfirmed", kind: .web,
            location: "https://example.net", physicalPage: 1,
            reference: reference, sermonDateKey: "2026-10-04",
            includedInReview: true, reviewInclusionConfirmed: false
        )

        XCTAssertEqual(
            ReaderTab.countMarkedForReview(in: [current, otherSunday, unconfirmed], reference: reference, sermonDateKey: "2026-10-04"),
            1
        )
        let restored = try JSONDecoder().decode(ReaderTab.self, from: JSONEncoder().encode(current))
        XCTAssertEqual(restored.sermonDateKey, "2026-10-04")
    }

    func testTabletPDFExporterPaginatesFormattedManuscript() throws {
        let paragraph = "Jesus entra na vinha, e a parábola nos chama a reler o texto com atenção. "
        let source = NSAttributedString(string: String(repeating: paragraph, count: 320))
        let rtfData = try source.data(
            from: NSRange(location: 0, length: source.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let pdfData = try TabletPDFExporter.makePDF(
            rtfData: rtfData,
            title: "Mateus 21.33-46",
            subtitle: "04/10/2026 · Próprio 22 A",
            fontName: "Arial",
            fontSize: 14,
            includeFootnotes: true
        )
        let pdf = try XCTUnwrap(PDFDocument(data: pdfData))
        let extractedText = (0..<pdf.pageCount).compactMap { pdf.page(at: $0)?.string }.joined(separator: "\n")

        XCTAssertGreaterThan(pdf.pageCount, 1)
        XCTAssertTrue(extractedText.contains("Mateus 21.33-46"))
        XCTAssertTrue(extractedText.contains("Jesus entra na vinha"))
    }

    func testTabletPDFExporterCanOmitFootnoteParagraphsWithoutChangingSource() throws {
        let source = NSAttributedString(string: "O texto diz algo importante¹.\n\n¹ Nota de rodapé que fica no fim.")
        let rtfData = try source.data(
            from: NSRange(location: 0, length: source.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let included = try TabletPDFExporter.makePDF(
            rtfData: rtfData, title: "Sermão", subtitle: nil,
            fontName: "Arial", fontSize: 14, includeFootnotes: true
        )
        let omitted = try TabletPDFExporter.makePDF(
            rtfData: rtfData, title: "Sermão", subtitle: nil,
            fontName: "Arial", fontSize: 14, includeFootnotes: false
        )
        let includedText = try XCTUnwrap(PDFDocument(data: included)).page(at: 0)?.string ?? ""
        let omittedText = try XCTUnwrap(PDFDocument(data: omitted)).page(at: 0)?.string ?? ""

        XCTAssertTrue(includedText.contains("Nota de rodapé"))
        XCTAssertFalse(omittedText.contains("Nota de rodapé"))
        XCTAssertFalse(omittedText.contains("¹"))
        XCTAssertTrue(source.string.contains("Nota de rodapé"))
    }

    @MainActor
    func testTabletPDFCopyLocationPersistsWithItsSermonDraft() throws {
        let container = try ModelContainer(
            for: SermonDraft.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let draft = SermonDraft(liturgicalDate: .now)
        draft.tabletPDFPath = "/tmp/2026-10-04 - Mateus 21.pdf"
        draft.tabletPDFUpdatedAt = Date(timeIntervalSince1970: 1_790_493_600)
        container.mainContext.insert(draft)
        try container.mainContext.save()

        let restored = try XCTUnwrap(container.mainContext.fetch(FetchDescriptor<SermonDraft>()).first)
        XCTAssertEqual(restored.tabletPDFPath, draft.tabletPDFPath)
        XCTAssertEqual(restored.tabletPDFUpdatedAt, draft.tabletPDFUpdatedAt)
    }

    func testCapturesDistinctVersionsAndReloadsThemFromDisk() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarHistoryTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 4))!
        let first = SermonRevisionSnapshot(
            title: "Mateus 21",
            mainReadingReference: "Mateus 21.33-46",
            mainReadingSlot: "gospel",
            rtfData: Data("primeira versão".utf8),
            wordCount: 2
        )
        let edited = SermonRevisionSnapshot(
            title: first.title,
            mainReadingReference: first.mainReadingReference,
            mainReadingSlot: first.mainReadingSlot,
            rtfData: Data("versão revisada".utf8),
            wordCount: 2
        )

        let store = SermonRevisionStore(directory: directory)
        let firstSave = try await store.capture(first, for: date)
        let duplicateSave = try await store.capture(first, for: date)
        let secondSave = try await store.capture(edited, for: date, summary: "Edição salva")
        let reopened = SermonRevisionStore(directory: directory)
        let loaded = try await reopened.revisions(for: date)

        XCTAssertEqual(firstSave.map(\.version), [1])
        XCTAssertEqual(duplicateSave.map(\.version), [1])
        XCTAssertEqual(secondSave.map(\.version), [1, 2])
        XCTAssertEqual(loaded.map(\.version), [1, 2])
        XCTAssertEqual(loaded.last?.rtfData, edited.rtfData)
    }

    func testExplicitRestoreCanCreateAVersionWithUnchangedContent() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarHistoryTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 4))!
        let snapshot = SermonRevisionSnapshot(
            title: "",
            mainReadingReference: nil,
            mainReadingSlot: nil,
            rtfData: nil,
            wordCount: 0
        )
        let store = SermonRevisionStore(directory: directory)

        _ = try await store.capture(snapshot, for: date)
        let restored = try await store.capture(snapshot, for: date, summary: "Restaurada de v1", force: true)

        XCTAssertEqual(restored.map(\.version), [1, 2])
        XCTAssertEqual(restored.last?.summary, "Restaurada de v1")
    }
}
