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
