import Foundation
import SwiftData
import XCTest
@testable import Pregar

final class PregarBackupTests: XCTestCase {
    @MainActor
    func testBackupRestoresDraftHistoryLibraryReaderAndSafePreferences() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarBackupTests-\(UUID().uuidString)", isDirectory: true)
        let sourceDirectory = root.appendingPathComponent("source", isDirectory: true)
        let historyDirectory = sourceDirectory.appendingPathComponent("SermonHistory", isDirectory: true)
        let exportDirectory = root.appendingPathComponent("exports", isDirectory: true)
        let appSupport = root.appendingPathComponent("restored-support", isDirectory: true)
        let restoredHistory = appSupport.appendingPathComponent("Pregar/SermonHistory", isDirectory: true)
        try FileManager.default.createDirectory(at: historyDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let pdfURL = sourceDirectory.appendingPathComponent("Comentario.pdf")
        let pdfData = Data("%PDF-1.7\nbackup fixture\n".utf8)
        try pdfData.write(to: pdfURL)
        let historyData = Data("history fixture".utf8)
        try historyData.write(to: historyDirectory.appendingPathComponent("2026-10-04.json"))

        let suiteName = "PregarBackupTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("naa", forKey: "api.bible")
        defaults.set("openai", forKey: "ai.reviewProvider")
        defaults.set("client-id.apps.googleusercontent.com", forKey: "drive.oauthClientID")
        defaults.set("api-secret-must-stay-local", forKey: "api.secret")
        defaults.set("oauth-token-must-stay-local", forKey: "drive.accessToken")
        defaults.set("provider-key-must-stay-local", forKey: "ai.openai.apiKey")

        let record = PDFLibraryRecord(
            id: "commentary-1",
            title: "Comentário de teste",
            path: pdfURL.path,
            pageCount: 1,
            bookmarkCount: 0,
            author: "Autora de teste"
        )
        defaults.set(try JSONEncoder().encode([record]), forKey: "pregar.library.records.v1")
        defaults.set(3, forKey: "pregar.library.records.revision.v1")

        let date = Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 4))!
        let draft = SermonDraft(liturgicalDate: date)
        draft.title = "Romanos 13:8-14"
        draft.liturgicalOccasion = "Próprio 22 A"
        draft.mainReadingReference = "Romanos 13:8-14"
        draft.mainReadingSlot = "second_reading"
        draft.tabletPDFPath = pdfURL.path
        draft.tabletPDFUpdatedAt = Date(timeIntervalSince1970: 1_790_493_600)
        draft.googleDriveDocumentID = "documento-vinculado"
        draft.googleDriveSyncedContentHash = "hash-antigo"
        draft.rtfData = Data(#"{\rtf1\ansi Sermão de teste}"#.utf8)

        let tabID = UUID()
        let reader = ReaderArchive(tabs: [ReaderTab(
            id: tabID,
            title: "Comentário de teste",
            kind: .pdf,
            location: pdfURL.path,
            physicalPage: 1,
            reference: "Romanos 13:8-14",
            sermonDateKey: "2026-10-04",
            includedInReview: false
        )], selectedID: tabID)
        defaults.set(try JSONEncoder().encode(reader), forKey: "reader.session.v1")
        defaults.set(try JSONEncoder().encode([
            "\(pdfURL.path)|Romanos 13:8-14": 1,
            "\(sourceDirectory.appendingPathComponent("removido.pdf").path)|Atos 2:1-21": 8
        ]), forKey: "reader.section-links.v1")

        let snapshot = try PregarBackupSnapshot.make(
            drafts: [draft],
            defaults: defaults,
            historyDirectory: historyDirectory
        )
        let package = try PregarBackupService.create(snapshot: snapshot, in: exportDirectory)
        let contents = try PregarBackupService.load(from: package)

        XCTAssertEqual(contents.manifest.draftCount, 1)
        XCTAssertEqual(contents.manifest.libraryCount, 1)
        XCTAssertEqual(contents.manifest.historyFileCount, 1)
        XCTAssertEqual(contents.assetPaths.count, 1)
        XCTAssertEqual(contents.rememberedPages.count, 1)
        XCTAssertTrue(contents.drafts[0].tabletPDFPath?.hasPrefix("Files/") == true)
        XCTAssertTrue(contents.libraryRecords[0].path.hasPrefix("Files/"))
        XCTAssertTrue(contents.readerArchive.tabs[0].location.hasPrefix("Files/"))

        let preferenceValues = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: contents.preferences, format: nil) as? [String: Any]
        )
        XCTAssertEqual(preferenceValues["api.bible"] as? String, "naa")
        XCTAssertNil(preferenceValues["api.secret"])
        XCTAssertNil(preferenceValues["drive.accessToken"])
        XCTAssertNil(preferenceValues["drive.oauthClientID"])
        XCTAssertNil(preferenceValues["ai.openai.apiKey"])
        XCTAssertNil(preferenceValues["pregar.library.records.revision.v1"])

        let schema = Schema([SermonDraft.self])
        let configuration = ModelConfiguration(
            "PregarBackupTest",
            schema: schema,
            url: root.appendingPathComponent("restored.store"),
            cloudKitDatabase: .none
        )
        let container = try ModelContainer(for: schema, configurations: [configuration])
        let oldDraft = SermonDraft(liturgicalDate: .now)
        oldDraft.title = "Será substituído"
        container.mainContext.insert(oldDraft)
        try container.mainContext.save()

        defaults.set("nvt", forKey: "api.bible")
        defaults.set("destination-only-model", forKey: "ai.researchModel")
        defaults.set("token-at-destination", forKey: "drive.accessToken")
        defaults.set("destination-client.apps.googleusercontent.com", forKey: "drive.oauthClientID")
        defaults.set(19, forKey: "pregar.library.records.revision.v1")
        let installed = try PregarBackupService.installAssets(from: contents, applicationSupportDirectory: appSupport)
        let restored = try PregarBackupService.restore(
            contents,
            installedAssets: installed,
            modelContext: container.mainContext,
            defaults: defaults,
            applicationSupportDirectory: appSupport,
            historyDirectory: restoredHistory
        )

        let drafts = try container.mainContext.fetch(FetchDescriptor<SermonDraft>())
        let restoredDraft = try XCTUnwrap(drafts.first)
        XCTAssertEqual(drafts.count, 1)
        XCTAssertEqual(restoredDraft.title, "Romanos 13:8-14")
        XCTAssertEqual(restoredDraft.liturgicalOccasion, "Próprio 22 A")
        XCTAssertEqual(restoredDraft.rtfData, draft.rtfData)
        XCTAssertEqual(restoredDraft.googleDriveDocumentID, "documento-vinculado")
        XCTAssertNotEqual(restoredDraft.googleDriveSyncedContentHash, "hash-antigo")
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: try XCTUnwrap(restoredDraft.tabletPDFPath))), pdfData)

        let restoredRecords = try JSONDecoder().decode(
            [PDFLibraryRecord].self,
            from: try XCTUnwrap(defaults.data(forKey: "pregar.library.records.v1"))
        )
        XCTAssertEqual(restoredRecords.first?.displayTitle, "Comentário de teste")
        XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(restoredRecords.first?.path)))
        XCTAssertTrue(FileManager.default.fileExists(atPath: restoredHistory.appendingPathComponent("2026-10-04.json").path))
        XCTAssertEqual(try Data(contentsOf: restoredHistory.appendingPathComponent("2026-10-04.json")), historyData)
        XCTAssertEqual(defaults.string(forKey: "api.bible"), "naa")
        XCTAssertEqual(defaults.string(forKey: "ai.reviewProvider"), "openai")
        XCTAssertNil(defaults.string(forKey: "ai.researchModel"))
        XCTAssertEqual(defaults.string(forKey: "drive.accessToken"), "token-at-destination")
        XCTAssertEqual(defaults.string(forKey: "drive.oauthClientID"), "destination-client.apps.googleusercontent.com")
        XCTAssertEqual(defaults.integer(forKey: "pregar.library.records.revision.v1"), 20)

        XCTAssertEqual(restored.readerArchive.tabs.first?.location, restoredDraft.tabletPDFPath)
        XCTAssertTrue(restored.rememberedPages.keys.first?.hasPrefix(try XCTUnwrap(restoredDraft.tabletPDFPath) + "|") == true)
        XCTAssertEqual(restored.draftCount, 1)
        XCTAssertEqual(restored.libraryCount, 1)

        let session = ReaderSessionStore(userDefaults: defaults)
        session.restore(archive: restored.readerArchive, rememberedPages: restored.rememberedPages)
        XCTAssertEqual(session.selectedTab?.physicalPage, 1)
        XCTAssertEqual(session.selectedTab?.location, restoredDraft.tabletPDFPath)
    }

    func testBackupRejectsChangedContentBeforeRestore() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarBackupIntegrity-\(UUID().uuidString)", isDirectory: true)
        let exportDirectory = root.appendingPathComponent("exports", isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let suiteName = "PregarBackupTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let snapshot = try PregarBackupSnapshot.make(drafts: [], defaults: defaults, historyDirectory: root.appendingPathComponent("missing-history"))
        let package = try PregarBackupService.create(snapshot: snapshot, in: exportDirectory)
        try Data("tampered".utf8).write(to: package.appendingPathComponent("Drafts.json"), options: .atomic)

        XCTAssertThrowsError(try PregarBackupService.load(from: package)) { error in
            XCTAssertEqual(error as? PregarBackupError, .corruptedFile)
        }
    }

    func testBackupRejectsUnexpectedManifestPaths() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarBackupPaths-\(UUID().uuidString)", isDirectory: true)
        let exportDirectory = root.appendingPathComponent("exports", isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let suiteName = "PregarBackupPaths-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let snapshot = try PregarBackupSnapshot.make(
            drafts: [],
            defaults: defaults,
            historyDirectory: root.appendingPathComponent("missing-history")
        )
        let package = try PregarBackupService.create(snapshot: snapshot, in: exportDirectory)
        let manifestURL = package.appendingPathComponent("Manifest.json")
        var manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
        var files = try XCTUnwrap(manifest["files"] as? [String: String])
        files["History/../../outside.json"] = String(repeating: "0", count: 64)
        manifest["files"] = files
        try JSONSerialization.data(withJSONObject: manifest).write(to: manifestURL, options: .atomic)

        XCTAssertThrowsError(try PregarBackupService.load(from: package)) { error in
            XCTAssertEqual(error as? PregarBackupError, .invalidPackage)
        }
    }

    func testBackupRejectsSymlinkedPackageFiles() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PregarBackupSymlink-\(UUID().uuidString)", isDirectory: true)
        let exportDirectory = root.appendingPathComponent("exports", isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let suiteName = "PregarBackupSymlink-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let snapshot = try PregarBackupSnapshot.make(
            drafts: [],
            defaults: defaults,
            historyDirectory: root.appendingPathComponent("missing-history")
        )
        let package = try PregarBackupService.create(snapshot: snapshot, in: exportDirectory)
        let outsideFile = root.appendingPathComponent("outside.json")
        try Data("not part of this package".utf8).write(to: outsideFile)
        let readerFile = package.appendingPathComponent("Reader.json")
        try FileManager.default.removeItem(at: readerFile)
        try FileManager.default.createSymbolicLink(at: readerFile, withDestinationURL: outsideFile)

        XCTAssertThrowsError(try PregarBackupService.load(from: package)) { error in
            XCTAssertEqual(error as? PregarBackupError, .invalidPackage)
        }
    }
}
