import CryptoKit
import Foundation
import SwiftData

struct SermonDraftBackup: Codable, Sendable {
    var liturgicalDate: Date
    var title: String
    var liturgicalOccasion: String?
    var liturgicalCelebration: String?
    var liturgicalSeason: String?
    var prayerBookID: String?
    var mainReadingReference: String?
    var mainReadingSlot: String?
    var tabletPDFPath: String?
    var tabletPDFUpdatedAt: Date?
    var googleDriveDraftKey: String?
    var googleDriveDocumentID: String?
    var googleDriveRevisionID: String?
    var googleDriveSyncedAt: Date?
    var googleDriveSyncedContentHash: String?
    var googleDriveSyncError: String?
    var modifiedAt: Date
    var rtfData: Data?

    init(draft: SermonDraft) {
        liturgicalDate = draft.liturgicalDate
        title = draft.title
        liturgicalOccasion = draft.liturgicalOccasion
        liturgicalCelebration = draft.liturgicalCelebration
        liturgicalSeason = draft.liturgicalSeason
        prayerBookID = draft.prayerBookID
        mainReadingReference = draft.mainReadingReference
        mainReadingSlot = draft.mainReadingSlot
        tabletPDFPath = draft.tabletPDFPath
        tabletPDFUpdatedAt = draft.tabletPDFUpdatedAt
        googleDriveDraftKey = draft.googleDriveDraftKey
        googleDriveDocumentID = draft.googleDriveDocumentID
        googleDriveRevisionID = draft.googleDriveRevisionID
        googleDriveSyncedAt = draft.googleDriveSyncedAt
        googleDriveSyncedContentHash = draft.googleDriveSyncedContentHash
        googleDriveSyncError = draft.googleDriveSyncError
        modifiedAt = draft.modifiedAt
        rtfData = draft.rtfData
    }

    func makeDraft(assetPaths: [String: String]) throws -> SermonDraft {
        let restoredTabletPath: String?
        if let tabletPDFPath {
            guard let path = assetPaths[tabletPDFPath] else {
                throw PregarBackupError.missingAsset
            }
            restoredTabletPath = path
        } else {
            restoredTabletPath = nil
        }

        let draft = SermonDraft(liturgicalDate: liturgicalDate)
        draft.title = title
        draft.liturgicalOccasion = liturgicalOccasion
        draft.liturgicalCelebration = liturgicalCelebration
        draft.liturgicalSeason = liturgicalSeason
        draft.prayerBookID = prayerBookID
        draft.mainReadingReference = mainReadingReference
        draft.mainReadingSlot = mainReadingSlot
        draft.tabletPDFPath = restoredTabletPath
        draft.tabletPDFUpdatedAt = tabletPDFUpdatedAt
        draft.googleDriveDraftKey = googleDriveDraftKey
        draft.googleDriveDocumentID = googleDriveDocumentID
        draft.googleDriveRevisionID = googleDriveRevisionID
        draft.googleDriveSyncedAt = googleDriveSyncedAt
        draft.googleDriveSyncedContentHash = googleDriveSyncedContentHash
        draft.googleDriveSyncError = googleDriveSyncError
        draft.modifiedAt = modifiedAt
        draft.rtfData = rtfData
        return draft
    }
}

struct PregarBackupManifest: Codable, Sendable {
    let formatVersion: Int
    let createdAt: Date
    let appVersion: String
    let draftCount: Int
    let libraryCount: Int
    let historyFileCount: Int
    let assetCount: Int
    let files: [String: String]
}

struct PregarBackupSnapshot: Sendable {
    let drafts: [SermonDraftBackup]
    let libraryRecords: [PDFLibraryRecord]
    let preferences: Data
    let readerArchive: ReaderArchive
    let rememberedPages: [String: Int]
    let historyDirectory: URL

    static func make(
        drafts: [SermonDraft],
        defaults: UserDefaults = .standard,
        historyDirectory: URL = SermonRevisionStore.defaultDirectoryURL()
    ) throws -> PregarBackupSnapshot {
        let libraryRecords: [PDFLibraryRecord]
        if let data = defaults.data(forKey: "pregar.library.records.v1"), !data.isEmpty {
            libraryRecords = try JSONDecoder().decode([PDFLibraryRecord].self, from: data)
        } else {
            libraryRecords = []
        }

        let readerArchive: ReaderArchive
        if let data = defaults.data(forKey: "reader.session.v1") {
            readerArchive = try JSONDecoder().decode(ReaderArchive.self, from: data)
        } else {
            readerArchive = ReaderArchive(tabs: [], selectedID: nil)
        }

        let rememberedPages: [String: Int]
        if let data = defaults.data(forKey: "reader.section-links.v1") {
            rememberedPages = try JSONDecoder().decode([String: Int].self, from: data)
        } else {
            rememberedPages = [:]
        }

        var storedPreferences: [String: Any] = [:]
        for key in PregarBackupService.preferenceKeys {
            if let value = defaults.object(forKey: key) { storedPreferences[key] = value }
        }
        let preferences = try PropertyListSerialization.data(
            fromPropertyList: storedPreferences,
            format: .binary,
            options: 0
        )

        return PregarBackupSnapshot(
            drafts: drafts.map(SermonDraftBackup.init(draft:)),
            libraryRecords: libraryRecords,
            preferences: preferences,
            readerArchive: readerArchive,
            rememberedPages: rememberedPages,
            historyDirectory: historyDirectory
        )
    }
}

struct PregarBackupContents: Sendable {
    let packageURL: URL
    let manifest: PregarBackupManifest
    let drafts: [SermonDraftBackup]
    let libraryRecords: [PDFLibraryRecord]
    let preferences: Data
    let readerArchive: ReaderArchive
    let rememberedPages: [String: Int]
    let historyFiles: [String]

    var assetPaths: [String] {
        manifest.files.keys.filter { $0.hasPrefix("Files/") }.sorted()
    }
}

struct PregarBackupInstalledAssets: Sendable {
    let paths: [String: String]
    let createdURLs: [URL]
}

struct PregarBackupRestoreResult: Sendable {
    let draftCount: Int
    let libraryCount: Int
    let readerArchive: ReaderArchive
    let rememberedPages: [String: Int]
}

enum PregarBackupError: LocalizedError, Equatable {
    case invalidPackage
    case unsupportedVersion
    case corruptedFile
    case missingAsset
    case missingPDF(String)
    case assetCollision
    case restoreFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidPackage:
            "Esta pasta não contém um backup válido do Pregar."
        case .unsupportedVersion:
            "A versão deste backup não é compatível com esta versão do Pregar."
        case .corruptedFile:
            "Um arquivo do backup está incompleto ou foi alterado."
        case .missingAsset:
            "O backup referencia um arquivo que não está incluído no pacote."
        case .missingPDF(let title):
            "Não foi possível incluir o PDF “\(title)” no backup. Confira se o arquivo ainda está disponível."
        case .assetCollision:
            "Um arquivo local destinado à restauração não corresponde ao conteúdo do backup."
        case .restoreFailed(let detail):
            "Não foi possível concluir a restauração. Os dados anteriores foram preservados. \(detail)"
        }
    }
}

enum PregarBackupService {
    static let formatVersion = 1

    static let preferenceKeys: Set<String> = [
        "api.prayerBook", "api.language", "api.bible", "api.readingType",
        "ai.reviewProvider", "ai.researchProvider", "ai.reviewModel", "ai.researchModel",
        "drive.targets", "drive.font", "drive.fontSize", "drive.lastTabletFolder",
        "library.pdfFolder",
        "pregar.material-research.reports.v1", "pregar.favorite-site-search.reports.v3",
        FavoriteReferenceLibrary.sitesKey, FavoriteReferenceLibrary.authorsKey
    ]

    static func create(snapshot: PregarBackupSnapshot, in parentDirectory: URL) throws -> URL {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: parentDirectory.path) else {
            throw PregarBackupError.restoreFailed("A pasta escolhida não existe.")
        }

        let staging = parentDirectory.appendingPathComponent(".pregar-backup-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        do {
            let filesDirectory = staging.appendingPathComponent("Files", isDirectory: true)
            let historyDestination = staging.appendingPathComponent("History", isDirectory: true)
            try fileManager.createDirectory(at: filesDirectory, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: historyDestination, withIntermediateDirectories: true)

            var checksums: [String: String] = [:]
            var assetLocations: [String: String] = [:]
            var uniqueAssets = Set<String>()
            let sourcePaths = sourcePDFPaths(in: snapshot)
            for sourcePath in sourcePaths.sorted() {
                let standardizedPath = standardizedFilePath(sourcePath)
                let sourceURL = URL(fileURLWithPath: standardizedPath)
                guard fileManager.isReadableFile(atPath: standardizedPath),
                      let values = try? sourceURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
                      values.isRegularFile == true,
                      values.isSymbolicLink != true else {
                    throw PregarBackupError.missingPDF(sourceURL.lastPathComponent)
                }
                let digest = try checksum(at: sourceURL)
                let relativePath = "Files/\(digest).pdf"
                assetLocations[standardizedPath] = relativePath
                if uniqueAssets.insert(relativePath).inserted {
                    let destination = staging.appendingPathComponent(relativePath)
                    try fileManager.copyItem(at: sourceURL, to: destination)
                    checksums[relativePath] = digest
                }
            }

            let drafts = try snapshot.drafts.map { draft -> SermonDraftBackup in
                var draft = draft
                if let tabletPDFPath = draft.tabletPDFPath {
                    guard let relativePath = assetLocations[standardizedFilePath(tabletPDFPath)] else {
                        throw PregarBackupError.missingAsset
                    }
                    draft.tabletPDFPath = relativePath
                }
                return draft
            }

            let records = try snapshot.libraryRecords.map { record -> PDFLibraryRecord in
                var record = record
                guard let relativePath = assetLocations[standardizedFilePath(record.path)] else {
                    throw PregarBackupError.missingAsset
                }
                record.path = relativePath
                return record
            }

            var readerArchive = snapshot.readerArchive
            for index in readerArchive.tabs.indices where readerArchive.tabs[index].kind == .pdf {
                let path = standardizedFilePath(readerArchive.tabs[index].location)
                guard let relativePath = assetLocations[path] else { throw PregarBackupError.missingAsset }
                readerArchive.tabs[index].location = relativePath
            }
            let rememberedPages = remapRememberedPages(snapshot.rememberedPages, paths: assetLocations)

            let historyFiles = try copyHistory(
                from: snapshot.historyDirectory,
                to: historyDestination,
                packageRoot: staging,
                checksums: &checksums
            )
            try encode(drafts).write(to: staging.appendingPathComponent("Drafts.json"), options: .atomic)
            checksums["Drafts.json"] = try checksum(at: staging.appendingPathComponent("Drafts.json"))
            try encode(records).write(to: staging.appendingPathComponent("Library.json"), options: .atomic)
            checksums["Library.json"] = try checksum(at: staging.appendingPathComponent("Library.json"))
            try snapshot.preferences.write(to: staging.appendingPathComponent("Preferences.plist"), options: .atomic)
            checksums["Preferences.plist"] = try checksum(at: staging.appendingPathComponent("Preferences.plist"))
            try encode(readerArchive).write(to: staging.appendingPathComponent("Reader.json"), options: .atomic)
            checksums["Reader.json"] = try checksum(at: staging.appendingPathComponent("Reader.json"))
            try encode(rememberedPages).write(to: staging.appendingPathComponent("SectionLinks.json"), options: .atomic)
            checksums["SectionLinks.json"] = try checksum(at: staging.appendingPathComponent("SectionLinks.json"))

            let manifest = PregarBackupManifest(
                formatVersion: formatVersion,
                createdAt: .now,
                appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "desenvolvimento",
                draftCount: drafts.count,
                libraryCount: records.count,
                historyFileCount: historyFiles.count,
                assetCount: uniqueAssets.count,
                files: checksums
            )
            try encode(manifest).write(to: staging.appendingPathComponent("Manifest.json"), options: .atomic)
            _ = try load(from: staging)

            let destination = uniqueBackupURL(in: parentDirectory, date: .now)
            try fileManager.moveItem(at: staging, to: destination)
            return destination
        } catch {
            try? fileManager.removeItem(at: staging)
            throw error
        }
    }

    static func load(from packageURL: URL) throws -> PregarBackupContents {
        let fileManager = FileManager.default
        let root = packageURL.standardizedFileURL
        guard (try? root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
              let manifestData = try? Data(contentsOf: root.appendingPathComponent("Manifest.json")),
              let manifest = try? decoder().decode(PregarBackupManifest.self, from: manifestData) else {
            throw PregarBackupError.invalidPackage
        }
        guard manifest.formatVersion == formatVersion else { throw PregarBackupError.unsupportedVersion }
        guard manifest.files.allSatisfy({ isValidManifestPath($0.key) && isValidDigest($0.value) }) else {
            throw PregarBackupError.invalidPackage
        }

        for (relativePath, expectedDigest) in manifest.files {
            let fileURL = try safeURL(relativePath, in: root)
            guard fileManager.isReadableFile(atPath: fileURL.path),
                  try checksum(at: fileURL) == expectedDigest else {
                throw PregarBackupError.corruptedFile
            }
        }

        let assetPaths = Set(manifest.files.keys.filter { $0.hasPrefix("Files/") })
        guard assetPaths.allSatisfy(isValidAssetPath),
              ["Drafts.json", "Library.json", "Preferences.plist", "Reader.json", "SectionLinks.json"]
                .allSatisfy({ manifest.files[$0] != nil }) else {
            throw PregarBackupError.invalidPackage
        }

        let drafts = try decode([SermonDraftBackup].self, at: "Drafts.json", root: root)
        let libraryRecords = try decode([PDFLibraryRecord].self, at: "Library.json", root: root)
        let readerArchive = try decode(ReaderArchive.self, at: "Reader.json", root: root)
        let rememberedPages = try decode([String: Int].self, at: "SectionLinks.json", root: root)
        let preferencesURL = try safeURL("Preferences.plist", in: root)
        let preferences = try Data(contentsOf: preferencesURL)
        guard let preferenceValues = try PropertyListSerialization.propertyList(from: preferences, format: nil) as? [String: Any],
              Set(preferenceValues.keys).isSubset(of: preferenceKeys) else {
            throw PregarBackupError.invalidPackage
        }

        let referencedAssets = Set(
            drafts.compactMap(\.tabletPDFPath)
                + libraryRecords.map(\.path)
                + readerArchive.tabs.filter { $0.kind == .pdf }.map(\.location)
                + rememberedPages.keys.compactMap { rememberedAssetPath(in: $0) }
        )
        guard referencedAssets.allSatisfy({ assetPaths.contains($0) && isValidAssetPath($0) }) else {
            throw PregarBackupError.missingAsset
        }

        let historyFiles = manifest.files.keys
            .filter { $0.hasPrefix("History/") }
            .sorted()
        guard manifest.draftCount == drafts.count,
              manifest.libraryCount == libraryRecords.count,
              manifest.historyFileCount == historyFiles.count,
              manifest.assetCount == assetPaths.count else {
            throw PregarBackupError.invalidPackage
        }

        return PregarBackupContents(
            packageURL: root,
            manifest: manifest,
            drafts: drafts,
            libraryRecords: libraryRecords,
            preferences: preferences,
            readerArchive: readerArchive,
            rememberedPages: rememberedPages,
            historyFiles: historyFiles
        )
    }

    static func installAssets(
        from contents: PregarBackupContents,
        applicationSupportDirectory: URL
    ) throws -> PregarBackupInstalledAssets {
        let fileManager = FileManager.default
        let destinationDirectory = applicationSupportDirectory
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Pregar", isDirectory: true)
            .appendingPathComponent("BackupFiles", isDirectory: true)
        try fileManager.createDirectory(at: destinationDirectory, withIntermediateDirectories: true)

        var paths: [String: String] = [:]
        var createdURLs: [URL] = []
        do {
            for relativePath in contents.assetPaths {
                let source = try safeURL(relativePath, in: contents.packageURL)
                let destination = destinationDirectory.appendingPathComponent(URL(fileURLWithPath: relativePath).lastPathComponent)
                if let values = try? destination.resourceValues(forKeys: [.isSymbolicLinkKey]),
                   values.isSymbolicLink == true {
                    throw PregarBackupError.assetCollision
                }
                if fileManager.fileExists(atPath: destination.path) {
                    guard (try? destination.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
                          try checksum(at: destination) == contents.manifest.files[relativePath] else {
                        throw PregarBackupError.assetCollision
                    }
                } else {
                    let temporary = destinationDirectory.appendingPathComponent(".\(UUID().uuidString).tmp")
                    do {
                        try fileManager.copyItem(at: source, to: temporary)
                        guard try checksum(at: temporary) == contents.manifest.files[relativePath] else {
                            throw PregarBackupError.corruptedFile
                        }
                        try fileManager.moveItem(at: temporary, to: destination)
                        createdURLs.append(destination)
                    } catch {
                        try? fileManager.removeItem(at: temporary)
                        throw error
                    }
                }
                paths[relativePath] = destination.path
            }
        } catch {
            for url in createdURLs { try? fileManager.removeItem(at: url) }
            throw error
        }
        return PregarBackupInstalledAssets(paths: paths, createdURLs: createdURLs)
    }

    static func discard(_ installedAssets: PregarBackupInstalledAssets) {
        for url in installedAssets.createdURLs { try? FileManager.default.removeItem(at: url) }
    }

    @MainActor
    static func restore(
        _ contents: PregarBackupContents,
        installedAssets: PregarBackupInstalledAssets,
        modelContext: ModelContext,
        defaults: UserDefaults = .standard,
        applicationSupportDirectory: URL,
        historyDirectory: URL = SermonRevisionStore.defaultDirectoryURL()
    ) throws -> PregarBackupRestoreResult {
        let fileManager = FileManager.default
        let currentLibraryRevision = defaults.integer(forKey: "pregar.library.records.revision.v1")
        let restoredDrafts = try contents.drafts.map { backup -> SermonDraft in
            let draft = try backup.makeDraft(assetPaths: installedAssets.paths)
            if draft.googleDriveDocumentID != nil, let rtfData = draft.rtfData {
                draft.googleDriveSyncedContentHash = digest(rtfData)
            }
            return draft
        }
        var restoredRecords = contents.libraryRecords
        for index in restoredRecords.indices {
            guard let path = installedAssets.paths[restoredRecords[index].path] else { throw PregarBackupError.missingAsset }
            restoredRecords[index].path = path
        }
        var readerArchive = contents.readerArchive
        for index in readerArchive.tabs.indices where readerArchive.tabs[index].kind == .pdf {
            guard let path = installedAssets.paths[readerArchive.tabs[index].location] else { throw PregarBackupError.missingAsset }
            readerArchive.tabs[index].location = path
        }
        let rememberedPages = remapRememberedPages(contents.rememberedPages, paths: installedAssets.paths)
        let libraryData = try encode(restoredRecords)
        let readerData = try encode(readerArchive)
        let sectionLinksData = try encode(rememberedPages)
        let preferenceValues = try PropertyListSerialization.propertyList(from: contents.preferences, format: nil) as? [String: Any] ?? [:]
        guard Set(preferenceValues.keys).isSubset(of: preferenceKeys) else { throw PregarBackupError.invalidPackage }

        let restoreDirectory = applicationSupportDirectory.appendingPathComponent(".pregar-restore-\(UUID().uuidString)", isDirectory: true)
        let stagedHistory = restoreDirectory.appendingPathComponent("History", isDirectory: true)
        let previousHistory = restoreDirectory.appendingPathComponent("PreviousHistory", isDirectory: true)
        try fileManager.createDirectory(at: stagedHistory, withIntermediateDirectories: true)
        do {
            for relativePath in contents.historyFiles {
                let filename = URL(fileURLWithPath: relativePath).lastPathComponent
                try fileManager.copyItem(
                    at: safeURL(relativePath, in: contents.packageURL),
                    to: stagedHistory.appendingPathComponent(filename)
                )
            }
        } catch {
            try? fileManager.removeItem(at: restoreDirectory)
            throw error
        }

        try fileManager.createDirectory(at: historyDirectory.deletingLastPathComponent(), withIntermediateDirectories: true)
        let hadHistory = fileManager.fileExists(atPath: historyDirectory.path)
        if hadHistory { try fileManager.moveItem(at: historyDirectory, to: previousHistory) }
        do {
            try fileManager.moveItem(at: stagedHistory, to: historyDirectory)
            let currentDrafts = try modelContext.fetch(FetchDescriptor<SermonDraft>())
            currentDrafts.forEach(modelContext.delete)
            restoredDrafts.forEach(modelContext.insert)
            do {
                try modelContext.save()
            } catch {
                modelContext.rollback()
                throw error
            }
        } catch {
            if fileManager.fileExists(atPath: historyDirectory.path) {
                try? fileManager.removeItem(at: historyDirectory)
            }
            if hadHistory, fileManager.fileExists(atPath: previousHistory.path) {
                try? fileManager.moveItem(at: previousHistory, to: historyDirectory)
            }
            try? fileManager.removeItem(at: restoreDirectory)
            throw PregarBackupError.restoreFailed(error.localizedDescription)
        }

        for key in preferenceKeys { defaults.removeObject(forKey: key) }
        for (key, value) in preferenceValues { defaults.set(value, forKey: key) }
        defaults.set(libraryData, forKey: "pregar.library.records.v1")
        defaults.set(currentLibraryRevision + 1, forKey: "pregar.library.records.revision.v1")
        defaults.set(readerData, forKey: "reader.session.v1")
        defaults.set(sectionLinksData, forKey: "reader.section-links.v1")
        try? fileManager.removeItem(at: restoreDirectory)

        return PregarBackupRestoreResult(
            draftCount: restoredDrafts.count,
            libraryCount: restoredRecords.count,
            readerArchive: readerArchive,
            rememberedPages: rememberedPages
        )
    }

    static var defaultApplicationSupportDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
    }

    private static func sourcePDFPaths(in snapshot: PregarBackupSnapshot) -> Set<String> {
        var paths = Set(snapshot.libraryRecords.map(\.path))
        paths.formUnion(snapshot.drafts.compactMap(\.tabletPDFPath))
        paths.formUnion(snapshot.readerArchive.tabs.filter { $0.kind == .pdf }.map(\.location))
        return paths
    }

    private static func copyHistory(
        from source: URL,
        to destination: URL,
        packageRoot: URL,
        checksums: inout [String: String]
    ) throws -> [String] {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: source.path) else { return [] }
        let entries = try fileManager.contentsOfDirectory(
            at: source,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        )
        var names: [String] = []
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let values = try entry.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true, entry.pathExtension == "json" else { continue }
            let relativePath = "History/\(entry.lastPathComponent)"
            let destinationURL = packageRoot.appendingPathComponent(relativePath)
            try fileManager.copyItem(at: entry, to: destinationURL)
            checksums[relativePath] = try checksum(at: destinationURL)
            names.append(relativePath)
        }
        return names
    }

    private static func remapRememberedPages(_ pages: [String: Int], paths: [String: String]) -> [String: Int] {
        var result: [String: Int] = [:]
        for (key, page) in pages {
            guard let separator = key.lastIndex(of: "|") else { continue }
            let sourcePath = String(key[..<separator])
            let reference = String(key[key.index(after: separator)...])
            guard let replacement = paths[sourcePath] ?? paths[standardizedFilePath(sourcePath)] else { continue }
            result["\(replacement)|\(reference)"] = page
        }
        return result
    }

    private static func rememberedAssetPath(in key: String) -> String? {
        guard let separator = key.lastIndex(of: "|") else { return nil }
        return String(key[..<separator])
    }

    private static func uniqueBackupURL(in directory: URL, date: Date) -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let baseName = "Pregar Backup \(formatter.string(from: date))"
        var candidate = directory.appendingPathComponent(baseName, isDirectory: true)
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directory.appendingPathComponent("\(baseName) (\(index))", isDirectory: true)
            index += 1
        }
        return candidate
    }

    private static func safeURL(_ relativePath: String, in root: URL) throws -> URL {
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !relativePath.hasPrefix("/"),
              !components.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0 != ".." && $0 != "." }) else {
            throw PregarBackupError.invalidPackage
        }
        let standardizedRoot = root.standardizedFileURL
        let candidate = standardizedRoot.appendingPathComponent(relativePath).standardizedFileURL
        guard candidate.path.hasPrefix(standardizedRoot.path + "/") else { throw PregarBackupError.invalidPackage }

        var parent = standardizedRoot
        for component in components.dropLast() {
            parent.appendPathComponent(component, isDirectory: true)
            guard let values = try? parent.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true,
                  values.isSymbolicLink != true else {
                throw PregarBackupError.invalidPackage
            }
        }
        guard let values = try? candidate.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true,
              values.isSymbolicLink != true else {
            throw PregarBackupError.invalidPackage
        }
        return candidate
    }

    private static let rootFileNames: Set<String> = [
        "Drafts.json", "Library.json", "Preferences.plist", "Reader.json", "SectionLinks.json"
    ]

    private static func isValidManifestPath(_ path: String) -> Bool {
        if rootFileNames.contains(path) || isValidAssetPath(path) { return true }
        guard path.hasPrefix("History/") else { return false }
        let filename = String(path.dropFirst("History/".count))
        return !filename.isEmpty && !filename.contains("/") && filename.hasSuffix(".json")
    }

    private static func isValidAssetPath(_ path: String) -> Bool {
        path.range(of: #"^Files/[0-9a-f]{64}\.pdf$"#, options: .regularExpression) != nil
    }

    private static func isValidDigest(_ digest: String) -> Bool {
        digest.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil
    }

    private static func standardizedFilePath(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }

    private static func checksum(at url: URL) throws -> String {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return digest(data)
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func encode<Value: Encodable>(_ value: Value) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(value)
    }

    private static func decode<Value: Decodable>(_ type: Value.Type, at path: String, root: URL) throws -> Value {
        try decoder().decode(type, from: Data(contentsOf: safeURL(path, in: root)))
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
