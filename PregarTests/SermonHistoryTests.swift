import AppKit
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

    @MainActor
    func testReaderSessionRestoresTabsPDFPageSelectionAndPericopeLink() throws {
        let suiteName = "Pregar.ReaderSessionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(suiteName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            defaults.removePersistentDomain(forName: suiteName)
            try? FileManager.default.removeItem(at: directory)
        }

        let paragraph = "Jesus conta a parábola dos lavradores e revela a paciência do proprietário. "
        let manuscript = NSAttributedString(string: String(repeating: paragraph, count: 600))
        let rtfData = try manuscript.data(
            from: NSRange(location: 0, length: manuscript.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let pdfData = try TabletPDFExporter.makePDF(
            rtfData: rtfData,
            title: "Mateus 21.33-46",
            subtitle: nil,
            fontName: "Arial",
            fontSize: 14,
            includeFootnotes: true
        )
        let generatedPDF = try XCTUnwrap(PDFDocument(data: pdfData))
        XCTAssertGreaterThanOrEqual(generatedPDF.pageCount, 3)

        let pdfURL = directory.appendingPathComponent("commentary.pdf")
        try pdfData.write(to: pdfURL, options: .atomic)

        var originalWebTabID: UUID?
        do {
            let session = ReaderSessionStore(userDefaults: defaults)
            XCTAssertTrue(session.openPDF(
                title: "Comentário",
                path: pdfURL.path,
                page: 1,
                reference: "Mateus 21.33-46",
                sermonDateKey: "2026-10-04"
            ))
            let pdfTab = try XCTUnwrap(session.tabs.first)
            session.setPage(2, for: pdfTab.id)
            session.flushPagePersistence()
            session.rememberLink(
                for: pdfTab,
                section: PDFSectionLocation(title: "Mateus 21.33-46", startPage: 3, endPage: 4)
            )

            XCTAssertTrue(session.openWeb(
                title: "Working Preacher",
                url: try XCTUnwrap(URL(string: "https://www.workingpreacher.org/example")),
                reference: "Mateus 21.33-46",
                sermonDateKey: "2026-10-04"
            ))
            originalWebTabID = session.selectedTab?.id
        }

        let restored = ReaderSessionStore(userDefaults: defaults)
        XCTAssertEqual(restored.tabs.count, 2)
        XCTAssertEqual(restored.selectedTab?.id, originalWebTabID)
        XCTAssertEqual(restored.selectedTab?.title, "Working Preacher")
        let restoredPDF = try XCTUnwrap(restored.tabs.first(where: { $0.kind == .pdf }))
        XCTAssertEqual(restoredPDF.physicalPage, 2)
        XCTAssertEqual(restoredPDF.sermonDateKey, "2026-10-04")

        if let selectedID = restored.selectedID { restored.close(selectedID) }
        XCTAssertTrue(restored.openPDF(
            title: "Comentário",
            path: pdfURL.path,
            page: 1,
            reference: "Mateus 21.33-46",
            sermonDateKey: "2026-10-04"
        ))
        XCTAssertEqual(restored.selectedTab?.physicalPage, 3)
    }

    @MainActor
    func testPoemQuotationsListAndFootnoteSurviveEditorDriveAndTabletExport() throws {
        let poem = "Na noite, uma janela;\no silêncio aprende a escutar.\n\nA manhã responde."
        let inlineQuote = "“A esperança não decepciona.”"
        let blockQuote = "O amor de Deus foi derramado em nossos corações.\n— Romanos 5:5"
        let listItem = "Uma promessa para hoje"
        let textView = NSTextView(frame: .zero)
        textView.isRichText = true
        textView.string = "Mensagem\n\nPoema:\n\(poem)\n\nCito \(inlineQuote)\n\n\(blockQuote)\n\nLista\n\(listItem)\n\nTexto com nota."
        let initialRange = NSRange(location: 0, length: (textView.string as NSString).length)
        textView.textStorage?.addAttribute(
            .font,
            value: NSFont(name: "Arial", size: 10) ?? NSFont.systemFont(ofSize: 10),
            range: initialRange
        )

        let commands = EditorCommands()
        commands.textView = textView
        let source = textView.string as NSString

        textView.setSelectedRange(source.range(of: "Mensagem"))
        commands.heading()
        textView.setSelectedRange(source.range(of: inlineQuote))
        commands.italic()
        textView.setSelectedRange(source.range(of: blockQuote))
        commands.quotation()
        textView.setSelectedRange(source.range(of: listItem))
        commands.bulletedList()
        let noteAnchor = (textView.string as NSString).range(of: "nota")
        textView.setSelectedRange(noteAnchor)
        commands.footnote()
        commands.insertText("Referência: Romanos 5:5.")

        let savedRTF = try textView.attributedString().data(
            from: NSRange(location: 0, length: textView.textStorage?.length ?? 0),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let reopenedContent = try NSAttributedString(
            data: savedRTF,
            options: [.documentType: NSAttributedString.DocumentType.rtf],
            documentAttributes: nil
        )
        let reopenedEditor = NSTextView(frame: .zero)
        reopenedEditor.isRichText = true
        reopenedEditor.textStorage?.setAttributedString(reopenedContent)
        let reopenedRTF = try reopenedEditor.attributedString().data(
            from: NSRange(location: 0, length: reopenedEditor.textStorage?.length ?? 0),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )

        XCTAssertEqual(reopenedEditor.string, textView.string)
        XCTAssertTrue(reopenedEditor.string.contains("Na noite, uma janela;\no silêncio aprende a escutar.\n\nA manhã responde."))
        XCTAssertTrue(reopenedEditor.string.contains("• \(listItem)"))
        XCTAssertTrue(reopenedEditor.string.contains("¹ Referência: Romanos 5:5."))

        let reopenedNSString = reopenedEditor.string as NSString
        let italicRange = reopenedNSString.range(of: inlineQuote)
        let italicFont = try XCTUnwrap(reopenedEditor.textStorage?.attribute(.font, at: italicRange.location, effectiveRange: nil) as? NSFont)
        XCTAssertTrue(NSFontManager.shared.traits(of: italicFont).contains(.italicFontMask))
        let blockRange = reopenedNSString.range(of: blockQuote)
        let blockStyle = try XCTUnwrap(reopenedEditor.textStorage?.attribute(.paragraphStyle, at: blockRange.location, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(blockStyle.headIndent, 22)
        XCTAssertNotNil(reopenedEditor.textStorage?.attribute(.backgroundColor, at: blockRange.location, effectiveRange: nil))
        let markerRange = reopenedNSString.range(of: "¹")
        let markerOffset = try XCTUnwrap(reopenedEditor.textStorage?.attribute(.baselineOffset, at: markerRange.location, effectiveRange: nil) as? NSNumber)
        XCTAssertGreaterThan(markerOffset.doubleValue, 0)

        let docsContent = try GoogleDocsContent.fromRTF(reopenedRTF)
        XCTAssertEqual(docsContent.text, reopenedEditor.string)
        XCTAssertTrue(docsContent.styles.contains { $0.superscript && $0.range == markerRange })
        XCTAssertTrue(docsContent.styles.contains { $0.italic && $0.range.contains(italicRange.location) })
        XCTAssertTrue(docsContent.styles.contains { $0.backgroundColor != nil })
        XCTAssertTrue(docsContent.paragraphs.contains { $0.indentStart == 22 && $0.spacingBefore == 7 && $0.spacingAfter == 9 })

        let driveBody = GoogleDriveAPI.batchUpdateBody(
            content: docsContent,
            currentEndIndex: docsContent.text.utf16.count + 1,
            requiredRevisionID: "synthetic-revision"
        )
        let driveRequests = try XCTUnwrap(driveBody["requests"] as? [[String: Any]])
        let insertedText = try XCTUnwrap(driveRequests.compactMap { $0["insertText"] as? [String: Any] }.first)
        XCTAssertEqual(insertedText["text"] as? String, docsContent.text)
        XCTAssertTrue(driveRequests.contains { $0["updateTextStyle"] != nil })
        XCTAssertTrue(driveRequests.contains { $0["updateParagraphStyle"] != nil })

        let pdfData = try TabletPDFExporter.makePDF(
            rtfData: reopenedRTF,
            title: "Mensagem",
            subtitle: "LOC 2027 · Domingo",
            fontName: "Arial",
            fontSize: 14,
            includeFootnotes: true
        )
        let pdf = try XCTUnwrap(PDFDocument(data: pdfData))
        let pdfText = (0..<pdf.pageCount).compactMap { pdf.page(at: $0)?.string }.joined(separator: "\n")
        let pdfPage = try XCTUnwrap(pdf.page(at: 0))
        let pdfAttributedText = try XCTUnwrap(pdfPage.attributedString)
        let pdfAttributedNSString = pdfAttributedText.string as NSString
        let pdfItalicRange = pdfAttributedNSString.range(of: inlineQuote)
        let pdfItalicFont = try XCTUnwrap(pdfAttributedText.attribute(.font, at: pdfItalicRange.location, effectiveRange: nil) as? NSFont)
        let bodySelection = try XCTUnwrap(pdf.findString("Cito", withOptions: []).first)
        let blockSelection = try XCTUnwrap(pdf.findString("O amor de Deus", withOptions: []).first)

        XCTAssertTrue(pdfText.contains("Na noite, uma janela;"))
        XCTAssertTrue(pdfText.contains("A manhã responde."))
        XCTAssertTrue(pdfText.contains(inlineQuote))
        XCTAssertTrue(pdfText.contains("— Romanos 5:5"))
        XCTAssertTrue(pdfText.contains("• \(listItem)"))
        XCTAssertTrue(pdfText.contains("Referência: Romanos 5:5."))
        XCTAssertTrue(NSFontManager.shared.traits(of: pdfItalicFont).contains(.italicFontMask))
        XCTAssertGreaterThan(blockSelection.bounds(for: pdfPage).minX, bodySelection.bounds(for: pdfPage).minX)
    }

    @MainActor
    func testFootnoteInsertionReusesLowestFreeNumber() {
        let textView = NSTextView(frame: .zero)
        textView.string = "Texto¹\n\n¹ Primeira nota\n\nTexto³\n\n³ Terceira nota"
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
        let commands = EditorCommands()
        commands.textView = textView

        commands.footnote()

        XCTAssertTrue(textView.string.contains("Terceira nota²\n\n² "))
        XCTAssertEqual(textView.string.filter { $0 == "²" }.count, 2)
    }

    @MainActor
    func testFootnoteInsertionKeepsNumbersAboveNineSuperscripted() {
        let textView = NSTextView(frame: .zero)
        textView.string = "¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹"
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
        let commands = EditorCommands()
        commands.textView = textView

        commands.footnote()

        XCTAssertTrue(textView.string.hasSuffix("\n\n¹⁰ "))
    }

    @MainActor
    func testQuotationFormattingIsVisibleAndCanBeRemoved() {
        let textView = NSTextView(frame: .zero)
        textView.string = "Uma frase citada."
        textView.setSelectedRange(NSRange(location: 0, length: (textView.string as NSString).length))
        let commands = EditorCommands()
        commands.textView = textView

        commands.quotation()

        let storage = try! XCTUnwrap(textView.textStorage)
        let paragraphStyle = try! XCTUnwrap(storage.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(paragraphStyle.headIndent, 22)
        XCTAssertNotNil(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil))

        commands.quotation()

        let removedStyle = try! XCTUnwrap(storage.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        XCTAssertEqual(removedStyle.headIndent, 0)
        XCTAssertNil(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil))
        XCTAssertNil(storage.attribute(.foregroundColor, at: 0, effectiveRange: nil))
    }

    @MainActor
    func testFontSizeCommandFormatsSelection() {
        let textView = NSTextView(frame: .zero)
        textView.string = "Palavra"
        textView.setSelectedRange(NSRange(location: 0, length: (textView.string as NSString).length))
        let commands = EditorCommands()
        commands.textView = textView

        commands.setFontSize(16)

        let font = try! XCTUnwrap(textView.textStorage?.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)
        XCTAssertEqual(font.pointSize, 16)
        XCTAssertEqual(commands.selectedFontSize, 16)
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

    func testTabletPDFExporterCanOmitTwoDigitSuperscriptFootnotes() throws {
        let source = NSAttributedString(string: "O texto diz algo¹⁰.\n\n¹⁰ Nota de rodapé dez.")
        let rtfData = try source.data(
            from: NSRange(location: 0, length: source.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let omitted = try TabletPDFExporter.makePDF(
            rtfData: rtfData, title: "Sermão", subtitle: nil,
            fontName: "Arial", fontSize: 14, includeFootnotes: false
        )
        let text = try XCTUnwrap(PDFDocument(data: omitted)).page(at: 0)?.string ?? ""

        XCTAssertFalse(text.contains("Nota de rodapé"))
        XCTAssertFalse(text.contains("¹⁰"))
        XCTAssertTrue(source.string.contains("Nota de rodapé"))
    }

    @MainActor
    func testTabletPDFCopyLocationPersistsWithItsSermonDraft() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarDraftPersistence-(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let schema = Schema([SermonDraft.self])
        let configuration = ModelConfiguration(
            "DriveDraftTest",
            schema: schema,
            url: directory.appendingPathComponent("Drafts.store"),
            cloudKitDatabase: .none
        )
        let expectedPDFPath = "/tmp/2026-10-04 - Mateus 21.pdf"
        let expectedPDFUpdatedAt = Date(timeIntervalSince1970: 1_790_493_600)

        do {
            let container = try ModelContainer(for: schema, configurations: [configuration])
            let draft = SermonDraft(liturgicalDate: .now)
            draft.tabletPDFPath = expectedPDFPath
            draft.tabletPDFUpdatedAt = expectedPDFUpdatedAt
            draft.googleDriveDraftKey = "draft-key-123"
            container.mainContext.insert(draft)
            try container.mainContext.save()
        }

        let reopenedContainer = try ModelContainer(for: schema, configurations: [configuration])
        let restored = try XCTUnwrap(reopenedContainer.mainContext.fetch(FetchDescriptor<SermonDraft>()).first)
        XCTAssertEqual(restored.tabletPDFPath, expectedPDFPath)
        XCTAssertEqual(restored.tabletPDFUpdatedAt, expectedPDFUpdatedAt)
        XCTAssertEqual(restored.googleDriveDraftKey, "draft-key-123")
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
