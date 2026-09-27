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
