import AppKit
import PDFKit
import XCTest
@testable import Pregar

final class PDFLibraryIndexerTests: XCTestCase {
    func testSectionHeadingParserRejectsInlineReferences() throws {
        let heading = try XCTUnwrap(ScriptureReference.parseHeading(
            "Romans 13.8—14 Love, the Law and the Coming Day"
        ))

        XCTAssertEqual(heading.startVerse, 8)
        XCTAssertEqual(heading.endVerse, 14)
        XCTAssertNil(ScriptureReference.parseHeading("different kinds of material (Leviticus 19.19). Someone"))
        XCTAssertNil(ScriptureReference.parseHeading("Romans 6.1—14, 8.12-17 or 12.1-2"))
    }

    func testPortugueseLectionaryAbbreviationsNormalizeToCanonicalBooks() {
        let references = ScriptureReference.parseAll("Zc 9.9-12 · Sl 145.8-15 · Rm 7.15-25a")

        XCTAssertEqual(references.map(\.book), ["zechariah", "psalms", "romans"])
        XCTAssertEqual(references.map(\.startVerse), [9, 8, 15])
        XCTAssertEqual(references.map(\.endVerse), [12, 15, 25])
    }

    func testFeastingSectionsPreserveSharedPageOffsetsAndAuthorBoundaries() throws {
        let pageTexts = [
            10: "Psalm 122 continues here.\nELIZABETH P. RANDALL\nRomans 13:8-14\n8 Owe no one anything.\nTheological Perspective\nTheological body begins.",
            11: "Theological body continues.\nELEAZAR S. FERNANDEZ\nPastoral Perspective\nPastoral body begins.",
            12: "Pastoral body continues.\nROCHELLE A. STACKHOUSE\nExegetical Perspective\nExegetical body begins.\nCHRISTOPHER R. HUTSON\n",
            13: "Homiletical Perspective\nHomiletical body ends here.\nDAVID L. BARTLETT\nMatthew 18:15-20\nNext reading."
        ]
        let section = PDFSectionLocation(title: "Romans 13:8-14", startPage: 10, endPage: 12)
        let target = try XCTUnwrap(ScriptureReference.parse(section.title))

        let components = try XCTUnwrap(PDFLibraryIndexer.feastingComponents(
            for: section,
            target: target,
            pageTexts: pageTexts
        ))

        XCTAssertEqual(components.map(\.kind), [.biblicalText, .theological, .pastoral, .exegetical, .homiletical])
        XCTAssertEqual(components.map(\.author), [nil, "ELEAZAR S. FERNANDEZ", "ROCHELLE A. STACKHOUSE", "CHRISTOPHER R. HUTSON", "DAVID L. BARTLETT"])
        XCTAssertEqual(components[0].content.start.page, 10)
        XCTAssertEqual(components[1].location.start.page, 10)
        XCTAssertEqual(components[2].location.start.page, 11)
        XCTAssertEqual(components[3].location.start.page, 12)
        XCTAssertEqual(components[4].location.end.page, 13)

        let sharedPage = pageTexts[13]! as NSString
        let nextReadingOffset = sharedPage.range(of: "Matthew 18:15-20").location
        XCTAssertEqual(components[4].location.end.utf16Offset, nextReadingOffset)
        XCTAssertEqual(
            components[4].content.end.utf16Offset,
            sharedPage.range(of: "DAVID L. BARTLETT").location
        )
    }

    func testOlderSectionRecordsDecodeWithoutComponentData() throws {
        let json = #"{"title":"Romans 13:8-14","startPage":96,"endPage":107,"context":null}"#
        let section = try JSONDecoder().decode(PDFSectionLocation.self, from: Data(json.utf8))

        XCTAssertNil(section.components)
    }

    func testReindexOnlyTargetsLegacyFeastingAndUnbookmarkedPDFs() {
        let legacyFeasting = PDFLibraryRecord(
            id: "feasting",
            title: "Feasting on the Word: Year A, Volume 4",
            path: "/tmp/feasting.pdf",
            pageCount: 761,
            bookmarkCount: 0,
            sections: [],
            indexVersion: 2
        )
        let legacyUnbookmarked = PDFLibraryRecord(
            id: "wright",
            title: "Paul for Everyone: Romans Part 2",
            path: "/tmp/wright.pdf",
            pageCount: 184,
            bookmarkCount: 0,
            sections: [],
            indexVersion: 2
        )
        let legacyBookmarked = PDFLibraryRecord(
            id: "matthew",
            title: "Matthew for Everyone, Part 2",
            path: "/tmp/matthew.pdf",
            pageCount: 242,
            bookmarkCount: 60,
            sections: [],
            indexVersion: 2
        )

        XCTAssertTrue(PDFLibraryIndexer.requiresReindex(legacyFeasting))
        XCTAssertTrue(PDFLibraryIndexer.requiresReindex(legacyUnbookmarked))
        XCTAssertFalse(PDFLibraryIndexer.requiresReindex(legacyBookmarked))
    }

    func testLegacyLibraryRecordsDecodeWithoutMetadataOverrides() throws {
        let json = #"{"id":"legacy","title":"Book title","path":"/tmp/book.pdf","pageCount":20,"bookmarkCount":3}"#
        let record = try JSONDecoder().decode(PDFLibraryRecord.self, from: Data(json.utf8))

        XCTAssertNil(record.metadataOverrides)
        XCTAssertEqual(record.displayTitle, "Book title")
        XCTAssertNil(record.displayAuthor)
    }

    func testArchiveCountsPDFSectionsRelatedToTheMainReading() {
        let matching = PDFSectionLocation(title: "Matthew 21:33-46", startPage: 91, endPage: 97)
        let partial = PDFSectionLocation(title: "Matthew 21:23-40", startPage: 88, endPage: 90)
        let unrelated = PDFSectionLocation(title: "Romans 13:8-14", startPage: 96, endPage: 102)
        let record = PDFLibraryRecord(
            id: "commentary",
            title: "Commentary",
            path: "/tmp/commentary.pdf",
            pageCount: 120,
            bookmarkCount: 3,
            sections: [matching, partial, unrelated]
        )

        XCTAssertEqual(PDFLibraryIndexer.matchingSectionCount(in: [record], reference: "Mateus 21.33-46"), 2)
        XCTAssertEqual(PDFLibraryIndexer.matchingSectionCount(in: [record], reference: nil), 0)
        XCTAssertEqual(PDFLibraryIndexer.matchingSectionCount(in: [record], reference: "invalid"), 0)
    }

    func testManualMetadataSurvivesReindexAndPersistence() throws {
        let metadata = PDFLibraryMetadataOverrides(
            title: "Matthew for Everyone, Part 2",
            author: "N. T. Wright",
            publisher: "SPCK",
            year: "2004",
            volume: "Part 2",
            edition: "",
            language: "English"
        )
        let previous = PDFLibraryRecord(
            id: "book",
            title: "Feasting on the Word: Year A, Volume 4",
            path: "/tmp/book.pdf",
            pageCount: 242,
            bookmarkCount: 60,
            sections: [],
            indexVersion: 3,
            metadataOverrides: metadata
        )
        let indexed = PDFLibraryRecord(
            id: "book",
            title: "Feasting on the Word: Year A, Volume 4",
            path: "/tmp/book.pdf",
            pageCount: 243,
            bookmarkCount: 60,
            sections: [],
            indexVersion: 3
        )

        let refreshed = indexed.preservingMetadata(from: previous)
        let decoded = try JSONDecoder().decode(
            PDFLibraryRecord.self,
            from: JSONEncoder().encode(refreshed)
        )

        XCTAssertEqual(decoded.displayTitle, "Matthew for Everyone, Part 2")
        XCTAssertEqual(decoded.displayCredits, ["N. T. Wright", "SPCK", "2004", "Part 2", "English"])
        XCTAssertEqual(decoded.pageCount, 243)
        XCTAssertTrue(PDFLibraryIndexer.requiresReindex(decoded), "Indexing must classify by the PDF-derived title, not the user override")
    }

    func testLegacyBookmarkMethodBackfillPreservesKnownOrigins() throws {
        let legacyJSON = #"{"title":"Romans 13:8-14","startPage":102,"endPage":107,"context":null}"#
        let legacy = try JSONDecoder().decode(PDFSectionLocation.self, from: Data(legacyJSON.utf8))
        let heading = PDFSectionLocation(
            title: "Romans 14:1-6",
            startPage: 108,
            endPage: 112,
            findingMethod: .textHeading
        )

        let recovered = PDFLibraryIndexer.backfillingBookmarkMethod(in: [legacy, heading], bookmarkCount: 60)
        XCTAssertEqual(recovered[0].findingMethod, .bookmark)
        XCTAssertEqual(recovered[1].findingMethod, .textHeading)

        let unbookmarked = PDFLibraryIndexer.backfillingBookmarkMethod(in: [legacy], bookmarkCount: 0)
        XCTAssertNil(unbookmarked.first?.findingMethod)
    }

    func testOnDemandOCRFindsHeadingsInScannedPDFWithoutChangingOriginal() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarOCR-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("scanned-commentary.pdf")

        let image = NSImage(size: CGSize(width: 1500, height: 2000))
        image.lockFocus()
        NSColor.white.setFill()
        NSRect(origin: .zero, size: image.size).fill()
        ("Romans 13:8-14" as NSString).draw(
            at: NSPoint(x: 130, y: 1500),
            withAttributes: [.font: NSFont.boldSystemFont(ofSize: 92), .foregroundColor: NSColor.black]
        )
        ("The command is to love your neighbor." as NSString).draw(
            at: NSPoint(x: 130, y: 1300),
            withAttributes: [.font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black]
        )
        image.unlockFocus()

        let document = PDFDocument()
        document.insert(try XCTUnwrap(PDFPage(image: image)), at: 0)
        XCTAssertTrue(document.write(to: url))
        let original = try Data(contentsOf: url)

        let result = try XCTUnwrap(PDFLibraryIndexer.recognizeScannedPages(path: url.path, previousRecord: nil))
        let section = try XCTUnwrap(result.record.sections?.first { $0.findingMethod == .ocrHeading })

        XCTAssertEqual(result.candidatePageCount, 1)
        XCTAssertEqual(result.scannedPageCount, 1)
        XCTAssertEqual(result.recognizedTextPageCount, 1)
        XCTAssertEqual(section.startPage, 1)
        XCTAssertEqual(section.confidenceLabel, "baixa · conferir")
        XCTAssertFalse(section.hasHighConfidence)
        XCTAssertEqual(PDFLibraryIndexer.match(section, reference: "Romans 13:8-14"), .exact)
        XCTAssertEqual(result.record.ocrPageNumbers, [1])
        let storedRecord = try JSONDecoder().decode(PDFLibraryRecord.self, from: JSONEncoder().encode(result.record))
        XCTAssertTrue(try XCTUnwrap(storedRecord.ocrTextByPage?[1]).localizedCaseInsensitiveContains("neighbor"))

        let tab = ReaderTab(
            id: UUID(),
            title: "Scanned commentary",
            kind: .pdf,
            location: url.path,
            physicalPage: 1,
            reference: "Romans 13:8-14",
            includedInReview: true,
            reviewInclusionConfirmed: true
        )
        let sources = try PDFReviewSourceExtractor.extract(
            tab: tab,
            targetReference: "Romans 13:8-14",
            libraryRecords: [storedRecord]
        )
        XCTAssertEqual(sources.count, 1)
        XCTAssertTrue(sources[0].text.localizedCaseInsensitiveContains("neighbor"))

        var missingOCRText = storedRecord
        missingOCRText.ocrTextByPage = nil
        XCTAssertThrowsError(try PDFReviewSourceExtractor.extract(
            tab: tab,
            targetReference: "Romans 13:8-14",
            libraryRecords: [missingOCRText]
        )) { error in
            XCTAssertEqual(error.localizedDescription, SermonReviewMaterialError.pageUnavailable.errorDescription)
        }

        XCTAssertEqual(try Data(contentsOf: url), original, "OCR must not modify the imported PDF")

        let reindexed = try XCTUnwrap(PDFLibraryIndexer.index(path: url.path, previousRecord: storedRecord))
        XCTAssertEqual(reindexed.ocrPageNumbers, [1])
        XCTAssertEqual(reindexed.ocrTextByPage, storedRecord.ocrTextByPage)
        XCTAssertTrue(reindexed.sections?.contains { $0.findingMethod == .ocrHeading } == true)
    }

    func testRealImageOnlyDownloadUsesOCRWithoutChangingSource() throws {
        guard let url = downloadedPDF(containing: "16_16_13_compressed") else {
            throw XCTSkip("A local image-only scan is not available in ~/Downloads")
        }
        let original = try Data(contentsOf: url)
        let document = try XCTUnwrap(PDFDocument(url: url))
        XCTAssertEqual(document.pageCount, 21)
        XCTAssertTrue((0..<document.pageCount).allSatisfy { pageNumber in
            document.page(at: pageNumber)?.string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true
        })

        let result = try XCTUnwrap(PDFLibraryIndexer.recognizeScannedPages(path: url.path, previousRecord: nil))
        let firstPageOCR = try XCTUnwrap(result.record.ocrTextByPage?[1])
        let recognizedReadings = ScriptureReference.parseAll(firstPageOCR)

        XCTAssertEqual(result.candidatePageCount, 21)
        XCTAssertEqual(result.scannedPageCount, 21)
        XCTAssertGreaterThan(result.recognizedTextPageCount, 0)
        XCTAssertEqual(result.record.ocrPageNumbers?.count, 21)
        XCTAssertEqual(result.record.ocrTextByPage?.count, result.recognizedTextPageCount)
        XCTAssertTrue(recognizedReadings.contains {
            $0.book == "romans" && $0.chapter == 7 && $0.startVerse == 15
                && ($0.endChapter ?? $0.chapter) == 7 && $0.endVerse == 25
        }, "OCR should locate the LOC's Romans 7:15-25 reading on physical page 1")
        XCTAssertEqual(try Data(contentsOf: url), original, "OCR must not modify the downloaded source")
    }

    func testRasterizedWrightRomansSectionIsLocatedByOCRWhenAvailable() throws {
        guard let sourceURL = downloadedPDF(containing: "Romans Part 2") else {
            throw XCTSkip("Wright Romans Part 2 is not in ~/Downloads")
        }
        let source = try XCTUnwrap(PDFDocument(url: sourceURL))
        let scan = PDFDocument()
        for physicalPage in 102...108 {
            let sourcePage = try XCTUnwrap(source.page(at: physicalPage - 1))
            let bounds = sourcePage.bounds(for: .mediaBox)
            let scale = 1800 / max(bounds.width, bounds.height)
            let image = sourcePage.thumbnail(
                of: CGSize(width: bounds.width * scale, height: bounds.height * scale),
                for: .mediaBox
            )
            scan.insert(try XCTUnwrap(PDFPage(image: image)), at: scan.pageCount)
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarWrightOCR-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scanURL = directory.appendingPathComponent("wright-commentary-scan.pdf")
        XCTAssertTrue(scan.write(to: scanURL))

        let imageOnlySource = try Data(contentsOf: scanURL)
        let imageOnlyDocument = try XCTUnwrap(PDFDocument(url: scanURL))
        XCTAssertEqual(imageOnlyDocument.pageCount, 7)
        XCTAssertTrue((0..<imageOnlyDocument.pageCount).allSatisfy { pageNumber in
            imageOnlyDocument.page(at: pageNumber)?.string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true
        })

        let result = try XCTUnwrap(PDFLibraryIndexer.recognizeScannedPages(path: scanURL.path, previousRecord: nil))
        let matches = (result.record.sections ?? []).filter {
            PDFLibraryIndexer.match($0, reference: "Romans 13:8-14") == .exact
        }

        XCTAssertEqual(result.candidatePageCount, 7)
        XCTAssertEqual(result.scannedPageCount, 7)
        XCTAssertEqual(matches.count, 1)
        let section = try XCTUnwrap(matches.first)
        XCTAssertEqual(section.startPage, 1)
        XCTAssertEqual(section.endPage, 6)
        XCTAssertEqual(section.findingMethod, .ocrHeading)
        XCTAssertEqual(try Data(contentsOf: scanURL), imageOnlySource, "OCR must not modify the rasterized source")
    }

    func testRealFeastingVolumeFourRomansUnitWhenAvailable() throws {
        guard let url = downloadedPDF(startingWith: "Feasting-on-the-Word_-Year-A_-Volume-4") else {
            throw XCTSkip("Feasting Year A Volume 4 is not in ~/Downloads")
        }
        let record = try XCTUnwrap(PDFLibraryIndexer.index(path: url.path))
        let matching = (record.sections ?? []).filter {
            PDFLibraryIndexer.match($0, reference: "Romans 13:8-14") == .exact
        }

        XCTAssertEqual(matching.count, 1)
        let section = try XCTUnwrap(matching.first)
        XCTAssertEqual(section.startPage, 96)
        XCTAssertEqual(section.endPage, 108)
        XCTAssertEqual(section.findingMethod, .bookmark)
        XCTAssertEqual(section.confidenceLabel, "alta")
        XCTAssertEqual(section.components?.map(\.author), [
            nil,
            "ELEAZAR S. FERNANDEZ",
            "ROCHELLE A. STACKHOUSE",
            "CHRISTOPHER R. HUTSON",
            "DAVID L. BARTLETT"
        ])

        let document = try XCTUnwrap(PDFDocument(url: url))
        let scripture = try XCTUnwrap(section.components?.first)
        let scriptureText = PDFLibraryIndexer.extractedText(in: scripture.content, from: document)
        XCTAssertTrue(scriptureText.contains("Owe no one anything"))
        XCTAssertFalse(scriptureText.localizedCaseInsensitiveContains("psalmist"))
        XCTAssertFalse(scriptureText.contains("Theological Perspective"))

        let homiletical = try XCTUnwrap(section.components?.last)
        let homileticalText = PDFLibraryIndexer.extractedText(in: homiletical.content, from: document)
        XCTAssertTrue(homileticalText.contains("Love your neighbor as yourself"))
        XCTAssertFalse(homileticalText.contains("Matthew 18:15-20"))
        XCTAssertFalse(homileticalText.contains("DAVID L. BARTLETT"))
    }

    func testRealFeastingVolumeFourMatthewProper22WhenAvailable() throws {
        guard let url = downloadedPDF(startingWith: "Feasting-on-the-Word_-Year-A_-Volume-4") else {
            throw XCTSkip("Feasting Year A Volume 4 is not in ~/Downloads")
        }
        let record = try XCTUnwrap(PDFLibraryIndexer.index(path: url.path))
        let matching = (record.sections ?? []).filter {
            PDFLibraryIndexer.match($0, reference: "Matthew 21:33-46") == .exact
        }

        XCTAssertEqual(matching.count, 1)
        let section = try XCTUnwrap(matching.first)
        XCTAssertEqual(section.startPage, 314)
        XCTAssertEqual(section.endPage, 328)
        XCTAssertEqual(section.findingMethod, .bookmark)
        XCTAssertEqual(section.components?.count, 5)
        XCTAssertEqual(section.components?.map(\.author), [
            nil,
            "ANDREW PURVES",
            "RICHARD E. SPALDING",
            "SUSAN GROVE EASTMAN",
            "MARVIN A. MCMICKLE"
        ])

        let document = try XCTUnwrap(PDFDocument(url: url))
        let scripture = try XCTUnwrap(section.components?.first)
        let scriptureText = PDFLibraryIndexer.extractedText(in: scripture.content, from: document)
        XCTAssertTrue(scriptureText.contains("Listen to another parable"))
        XCTAssertFalse(scriptureText.contains("Nathan Eddy"), "The shared page must start at the Matthew heading, not include the previous section's author.")

        let homiletical = try XCTUnwrap(section.components?.last)
        let homileticalText = PDFLibraryIndexer.extractedText(in: homiletical.content, from: document)
        XCTAssertTrue(homileticalText.contains("must be read as an allegory"))
        XCTAssertFalse(homileticalText.contains("Isaiah 5:1-7"), "The section must stop before the next Proper 22 reading.")
    }

    func testRealWrightRomansHeaderAndPrintedPagesWhenAvailable() throws {
        guard let url = downloadedPDF(containing: "Romans Part 2") else {
            throw XCTSkip("Wright Romans Part 2 is not in ~/Downloads")
        }
        let record = try XCTUnwrap(PDFLibraryIndexer.index(path: url.path))
        let matches = (record.sections ?? []).filter {
            PDFLibraryIndexer.match($0, reference: "Romans 13:8-14") == .exact
        }

        XCTAssertEqual(matches.count, 1)
        let section = try XCTUnwrap(matches.first)
        XCTAssertEqual(section.startPage, 102)
        XCTAssertEqual(section.findingMethod, .textHeading)
        XCTAssertEqual(section.confidenceLabel, "média")
        let indexedSections = (record.sections ?? []).map {
            "\($0.title) p.\($0.startPage)-\($0.endPage)"
        }.joined(separator: "; ")
        XCTAssertEqual(section.endPage, 107, "Indexed: \(indexedSections)")
        let document = try XCTUnwrap(PDFDocument(url: url))
        XCTAssertEqual(document.page(at: section.startPage - 1)?.label, "88")
        XCTAssertEqual(document.page(at: section.endPage - 1)?.label, "93")
    }

    func testRealFeastingVolumeOneRemainsPartialWhenAvailable() throws {
        guard let url = downloadedPDF(startingWith: "Feasting-on-the-Word_-Year-A_-Volume-1") else {
            throw XCTSkip("Feasting Year A Volume 1 is not in ~/Downloads")
        }
        let record = try XCTUnwrap(PDFLibraryIndexer.index(path: url.path))
        let partials = (record.sections ?? []).filter {
            PDFLibraryIndexer.match($0, reference: "Romans 13:8-14") == .partial
        }

        XCTAssertFalse(partials.isEmpty)
        XCTAssertTrue(partials.contains { ScriptureReference.parse($0.title)?.startVerse == 11 })
    }

    private func downloadedPDF(startingWith prefix: String) -> URL? {
        downloadedPDF { $0.lastPathComponent.hasPrefix(prefix) }
    }

    private func downloadedPDF(containing fragment: String) -> URL? {
        downloadedPDF { $0.lastPathComponent.localizedCaseInsensitiveContains(fragment) }
    }

    private func downloadedPDF(where predicate: (URL) -> Bool) -> URL? {
        let downloads = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(at: downloads, includingPropertiesForKeys: nil))?
            .first { $0.pathExtension.lowercased() == "pdf" && predicate($0) }
    }
}
