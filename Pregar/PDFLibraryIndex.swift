import AppKit
import Foundation
import PDFKit
import Vision

struct PDFLibraryRecord: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var path: String
    var pageCount: Int
    var bookmarkCount: Int
    var author: String? = nil
    var coverJPEG: Data? = nil
    var sections: [PDFSectionLocation]? = nil
    var indexVersion: Int? = nil
    var copyLabel: String? = nil
    var metadataOverrides: PDFLibraryMetadataOverrides? = nil
    var ocrPageNumbers: [Int]? = nil
    var ocrTextByPage: [Int: String]? = nil
    var fileSizeBytes: Int64? = nil
    var fileModificationDate: Date? = nil

    var displayTitle: String {
        nonEmpty(metadataOverrides?.title) ?? title
    }

    var displayAuthor: String? {
        metadataOverrides.map { nonEmpty($0.author) } ?? author
    }

    var displayPublisher: String? { metadataOverrides.flatMap { nonEmpty($0.publisher) } }
    var displayYear: String? { metadataOverrides.flatMap { nonEmpty($0.year) } }
    var displayVolume: String? { metadataOverrides.flatMap { nonEmpty($0.volume) } }
    var displayEdition: String? { metadataOverrides.flatMap { nonEmpty($0.edition) } }
    var displayLanguage: String? { metadataOverrides.flatMap { nonEmpty($0.language) } }

    var displayCredits: [String] {
        [displayAuthor, displayPublisher, displayYear, displayVolume, displayEdition, displayLanguage, copyLabel]
            .compactMap { $0 }
    }

    func preservingMetadata(from previous: PDFLibraryRecord?) -> PDFLibraryRecord {
        var refreshed = self
        refreshed.metadataOverrides = previous?.metadataOverrides
        return refreshed
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}

struct PDFLibraryMetadataOverrides: Codable, Equatable, Sendable {
    var title: String
    var author: String
    var publisher: String
    var year: String
    var volume: String
    var edition: String
    var language: String

    init(title: String, author: String, publisher: String, year: String, volume: String, edition: String, language: String) {
        self.title = title
        self.author = author
        self.publisher = publisher
        self.year = year
        self.volume = volume
        self.edition = edition
        self.language = language
    }

    init(record: PDFLibraryRecord) {
        title = record.displayTitle
        author = record.displayAuthor ?? ""
        publisher = record.displayPublisher ?? ""
        year = record.displayYear ?? ""
        volume = record.displayVolume ?? ""
        edition = record.displayEdition ?? ""
        language = record.displayLanguage ?? ""
    }
}

struct PDFTextPosition: Codable, Equatable, Sendable {
    let page: Int
    let utf16Offset: Int
}

struct PDFTextSpan: Codable, Equatable, Sendable {
    let start: PDFTextPosition
    let end: PDFTextPosition
}

enum PDFSectionComponentKind: String, Codable, Sendable {
    case biblicalText
    case theological
    case pastoral
    case exegetical
    case homiletical
}

enum PDFSectionFindingMethod: String, Codable, Sendable {
    case bookmark
    case textHeading
    case ocrHeading
    case unknown
}

struct PDFLibraryOCRResult: Sendable {
    let record: PDFLibraryRecord
    let candidatePageCount: Int
    let scannedPageCount: Int
    let recognizedTextPageCount: Int
    let sectionsFound: Int
}

struct PDFSectionComponent: Codable, Equatable, Identifiable, Sendable {
    var id: String { "\(kind.rawValue)|\(location.start.page)|\(location.start.utf16Offset)" }

    let kind: PDFSectionComponentKind
    let title: String
    let author: String?
    let location: PDFTextSpan
    let content: PDFTextSpan
}

struct ScriptureReference: Equatable, Sendable {
    let book: String
    let chapter: Int
    let startVerse: Int?
    let endChapter: Int?
    let endVerse: Int?

    var englishBookName: String {
        ScriptureReference.books.first(where: { $0.canonical == book })?.english ?? book
    }

    var englishReference: String {
        var value = "\(englishBookName) \(chapter)"
        let finalChapter = endChapter ?? chapter
        if let startVerse {
            value += ":\(startVerse)"
            if finalChapter != chapter {
                value += endVerse.map { "-\(finalChapter):\($0)" } ?? "-\(finalChapter)"
            } else if let endVerse, endVerse != startVerse {
                value += "-\(endVerse)"
            }
        } else if finalChapter != chapter {
            value += "-\(finalChapter)"
        }
        return value
    }

    static func parse(_ value: String) -> ScriptureReference? {
        parseAll(value).first
    }

    static func parseHeading(_ value: String) -> ScriptureReference? {
        let normalized = value.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        guard let match = matches(in: normalized).first,
              match.range.location == 0,
              match.reference.startVerse != nil,
              parseAll(value).count == 1,
              let tailRange = Range(NSRange(location: NSMaxRange(match.range), length: (normalized as NSString).length - NSMaxRange(match.range)), in: normalized) else { return nil }
        let title = normalized[tailRange].trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.first?.isUppercase ?? true else { return nil }
        return match.reference
    }

    static func parseAll(_ value: String) -> [ScriptureReference] {
        let normalized = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let explicitMatches = matches(in: normalized)
        let continuation = try? NSRegularExpression(pattern: #"[,;]\s*(\d+)(?:\s*[-–—]\s*(\d+))?"#)
        var references: [ScriptureReference] = []

        for (index, item) in explicitMatches.enumerated() {
            references.append(item.reference)
            guard item.reference.startVerse != nil, let continuation else { continue }
            let tailEnd = index + 1 < explicitMatches.count ? explicitMatches[index + 1].range.location : (normalized as NSString).length
            guard tailEnd >= item.range.location + item.range.length,
                  let tailStart = Range(NSRange(location: item.range.location + item.range.length, length: tailEnd - item.range.location - item.range.length), in: normalized) else { continue }
            let tail = String(normalized[tailStart])
            for match in continuation.matches(in: tail, range: NSRange(tail.startIndex..., in: tail)) {
                guard let startRange = Range(match.range(at: 1), in: tail),
                      let continuationStart = Int(tail[startRange]),
                      continuationStart <= 200 else { continue }
                let continuationEnd = Range(match.range(at: 2), in: tail).flatMap { Int(tail[$0]) } ?? continuationStart
                references.append(ScriptureReference(
                    book: item.reference.book,
                    chapter: item.reference.chapter,
                    startVerse: continuationStart,
                    endChapter: item.reference.chapter,
                    endVerse: continuationEnd
                ))
            }
        }
        var seen: Set<String> = []
        return references.filter { seen.insert("\($0.book)|\($0.chapter)|\($0.startVerse ?? 0)|\($0.endChapter ?? 0)|\($0.endVerse ?? 0)").inserted }
    }

    static func normalized(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "–", with: "-")
            .replacingOccurrences(of: "—", with: "-")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private struct ExplicitMatch {
        let reference: ScriptureReference
        let range: NSRange
    }

    private static func matches(in normalized: String) -> [ExplicitMatch] {
        let searchRange = NSRange(normalized.startIndex..., in: normalized)
        var matches: [ExplicitMatch] = []
        for item in patterns {
            for match in item.regex.matches(in: normalized, range: searchRange) {
                guard let chapterRange = Range(match.range(at: 1), in: normalized),
                      let chapter = Int(normalized[chapterRange]) else { continue }
                let startVerse = Range(match.range(at: 2), in: normalized).flatMap { Int(normalized[$0]) }
                let endChapter = Range(match.range(at: 3), in: normalized).flatMap { Int(normalized[$0]) }
                let endVerse = Range(match.range(at: 4), in: normalized).flatMap { Int(normalized[$0]) }
                matches.append(ExplicitMatch(
                    reference: ScriptureReference(book: item.book, chapter: chapter, startVerse: startVerse, endChapter: endChapter, endVerse: endVerse),
                    range: match.range
                ))
            }
        }
        matches.sort {
            $0.range.location == $1.range.location ? $0.range.length > $1.range.length : $0.range.location < $1.range.location
        }

        var accepted: [ExplicitMatch] = []
        for match in matches where !accepted.contains(where: { NSIntersectionRange($0.range, match.range).length > 0 }) {
            accepted.append(match)
        }
        return accepted
    }

    private struct Book {
        let canonical: String
        let english: String
        let aliases: [String]
    }

    private struct BookPattern {
        let book: String
        let regex: NSRegularExpression
    }

    private static let patterns: [BookPattern] = books
        .flatMap { book in
            book.aliases.map { alias -> (String, String) in
                let escaped = NSRegularExpression.escapedPattern(for: alias)
                let pattern = #"(?<![\p{L}\d])\#(escaped)(?![\p{L}])\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(?:(\d+)\s*[:.]\s*)?(\d+))?)?"#
                return (book.canonical, pattern)
            }
        }
        .sorted { $0.1.count > $1.1.count }
        .compactMap { item -> BookPattern? in
            guard let regex = try? NSRegularExpression(pattern: item.1, options: [.caseInsensitive]) else { return nil }
            return BookPattern(book: item.0, regex: regex)
        }

    private static let books: [Book] = [
        .init(canonical: "genesis", english: "Genesis", aliases: ["genesis", "gen", "gn"]),
        .init(canonical: "exodus", english: "Exodus", aliases: ["exodus", "exod", "exodo", "ex"]),
        .init(canonical: "leviticus", english: "Leviticus", aliases: ["leviticus", "lev", "levitico"]),
        .init(canonical: "numbers", english: "Numbers", aliases: ["numbers", "num", "numeros", "nm"]),
        .init(canonical: "deuteronomy", english: "Deuteronomy", aliases: ["deuteronomy", "deut", "deuteronomio", "dt"]),
        .init(canonical: "joshua", english: "Joshua", aliases: ["joshua", "josh", "josue"]),
        .init(canonical: "judges", english: "Judges", aliases: ["judges", "judg", "juizes"]),
        .init(canonical: "ruth", english: "Ruth", aliases: ["ruth", "rute"]),
        .init(canonical: "1 samuel", english: "1 Samuel", aliases: ["1 samuel", "i samuel", "1 sam", "1sm"]),
        .init(canonical: "2 samuel", english: "2 Samuel", aliases: ["2 samuel", "ii samuel", "2 sam", "2sm"]),
        .init(canonical: "1 kings", english: "1 Kings", aliases: ["1 kings", "i kings", "1 kgs", "1 reis"]),
        .init(canonical: "2 kings", english: "2 Kings", aliases: ["2 kings", "ii kings", "2 kgs", "2 reis"]),
        .init(canonical: "1 chronicles", english: "1 Chronicles", aliases: ["1 chronicles", "i chronicles", "1 chron", "1 cronicas"]),
        .init(canonical: "2 chronicles", english: "2 Chronicles", aliases: ["2 chronicles", "ii chronicles", "2 chron", "2 cronicas"]),
        .init(canonical: "ezra", english: "Ezra", aliases: ["ezra", "esdras"]),
        .init(canonical: "nehemiah", english: "Nehemiah", aliases: ["nehemiah", "neh", "neemias"]),
        .init(canonical: "esther", english: "Esther", aliases: ["esther", "ester"]),
        .init(canonical: "job", english: "Job", aliases: ["job", "jo"]),
        .init(canonical: "psalms", english: "Psalms", aliases: ["psalms", "psalm", "ps", "sl", "salmos", "salmo"]),
        .init(canonical: "proverbs", english: "Proverbs", aliases: ["proverbs", "prov", "proverbios"]),
        .init(canonical: "ecclesiastes", english: "Ecclesiastes", aliases: ["ecclesiastes", "eccl", "eclesiastes"]),
        .init(canonical: "song of solomon", english: "Song of Solomon", aliases: ["song of solomon", "song of songs", "cantares"]),
        .init(canonical: "isaiah", english: "Isaiah", aliases: ["isaiah", "isa", "isaias"]),
        .init(canonical: "jeremiah", english: "Jeremiah", aliases: ["jeremiah", "jer", "jeremias"]),
        .init(canonical: "lamentations", english: "Lamentations", aliases: ["lamentations", "lam", "lamentacoes"]),
        .init(canonical: "ezekiel", english: "Ezekiel", aliases: ["ezekiel", "ezek", "ezequiel"]),
        .init(canonical: "daniel", english: "Daniel", aliases: ["daniel", "dan"]),
        .init(canonical: "hosea", english: "Hosea", aliases: ["hosea", "os"]),
        .init(canonical: "joel", english: "Joel" , aliases: ["joel"]),
        .init(canonical: "amos", english: "Amos", aliases: ["amos"]),
        .init(canonical: "obadiah", english: "Obadiah", aliases: ["obadiah", "obadias"]),
        .init(canonical: "jonah", english: "Jonah", aliases: ["jonah", "jonas"]),
        .init(canonical: "micah", english: "Micah", aliases: ["micah", "miqueias"]),
        .init(canonical: "nahum", english: "Nahum", aliases: ["nahum", "naum"]),
        .init(canonical: "habakkuk", english: "Habakkuk", aliases: ["habakkuk", "habacuque"]),
        .init(canonical: "zephaniah", english: "Zephaniah", aliases: ["zephaniah", "sofonias"]),
        .init(canonical: "haggai", english: "Haggai", aliases: ["haggai", "ageu"]),
        .init(canonical: "zechariah", english: "Zechariah", aliases: ["zechariah", "zc", "zacarias"]),
        .init(canonical: "malachi", english: "Malachi", aliases: ["malachi", "malaquias"]),
        .init(canonical: "matthew", english: "Matthew", aliases: ["matthew", "matt", "mateus", "mt"]),
        .init(canonical: "mark", english: "Mark", aliases: ["mark", "marcos", "mk"]),
        .init(canonical: "luke", english: "Luke", aliases: ["luke", "lucas", "lk"]),
        .init(canonical: "john", english: "John", aliases: ["john", "joao", "jn"]),
        .init(canonical: "acts", english: "Acts", aliases: ["acts", "atos"]),
        .init(canonical: "romans", english: "Romans", aliases: ["romans", "rom", "rm", "romanos"]),
        .init(canonical: "1 corinthians", english: "1 Corinthians", aliases: ["1 corinthians", "i corinthians", "1 cor", "1 corintios"]),
        .init(canonical: "2 corinthians", english: "2 Corinthians", aliases: ["2 corinthians", "ii corinthians", "2 cor", "2 corintios"]),
        .init(canonical: "galatians", english: "Galatians", aliases: ["galatians", "gal", "galatas"]),
        .init(canonical: "ephesians", english: "Ephesians", aliases: ["ephesians", "eph", "efesios"]),
        .init(canonical: "philippians", english: "Philippians", aliases: ["philippians", "phil", "filipenses"]),
        .init(canonical: "colossians", english: "Colossians", aliases: ["colossians", "col", "colossenses"]),
        .init(canonical: "1 thessalonians", english: "1 Thessalonians", aliases: ["1 thessalonians", "i thessalonians", "1 thess", "1 tessalonicenses"]),
        .init(canonical: "2 thessalonians", english: "2 Thessalonians", aliases: ["2 thessalonians", "ii thessalonians", "2 thess", "2 tessalonicenses"]),
        .init(canonical: "1 timothy", english: "1 Timothy", aliases: ["1 timothy", "i timothy", "1 tim", "1 timoteo"]),
        .init(canonical: "2 timothy", english: "2 Timothy", aliases: ["2 timothy", "ii timothy", "2 tim", "2 timoteo"]),
        .init(canonical: "titus", english: "Titus", aliases: ["titus", "tito"]),
        .init(canonical: "philemon", english: "Philemon", aliases: ["philemon", "filemom"]),
        .init(canonical: "hebrews", english: "Hebrews", aliases: ["hebrews", "heb", "hebreus"]),
        .init(canonical: "james", english: "James", aliases: ["james", "tiago"]),
        .init(canonical: "1 peter", english: "1 Peter", aliases: ["1 peter", "i peter", "1 pet", "1 pedro"]),
        .init(canonical: "2 peter", english: "2 Peter", aliases: ["2 peter", "ii peter", "2 pet", "2 pedro"]),
        .init(canonical: "1 john", english: "1 John", aliases: ["1 john", "i john", "1 jn", "1 joao"]),
        .init(canonical: "2 john", english: "2 John", aliases: ["2 john", "ii john", "2 jn", "2 joao"]),
        .init(canonical: "3 john", english: "3 John", aliases: ["3 john", "iii john", "3 jn", "3 joao"]),
        .init(canonical: "jude", english: "Jude", aliases: ["jude", "judas"]),
        .init(canonical: "revelation", english: "Revelation", aliases: ["revelation", "rev", "apocalipse"])
    ]
}

enum PDFSectionMatchKind: Int, Sendable {
    case exact = 0
    case partial = 1
    case context = 2
}

enum PDFLibraryIndexer {
    static let currentVersion = 4

    static func index(path: String, previousRecord: PDFLibraryRecord? = nil) -> PDFLibraryRecord? {
        let url = URL(fileURLWithPath: path)
        guard let document = PDFDocument(url: url), document.pageCount > 0 else { return nil }
        return makeRecord(document, url: url, previousRecord: previousRecord)
    }

    static func recognizeScannedPages(
        path: String,
        previousRecord: PDFLibraryRecord?,
        progress: (@Sendable (Int, Int) -> Void)? = nil
    ) -> PDFLibraryOCRResult? {
        let url = URL(fileURLWithPath: path)
        guard let document = PDFDocument(url: url), document.pageCount > 0,
              var record = makeRecord(document, url: url, previousRecord: previousRecord) else { return nil }

        let scannedPages = record.ocrPageNumbers ?? []
        let scannedSet = Set(scannedPages)
        let candidatePages = (0..<document.pageCount).compactMap { index -> Int? in
            guard let text = document.page(at: index)?.string,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return index + 1 }
            return nil
        }
        let pagesToScan = candidatePages.filter { !scannedSet.contains($0) }
        var recognizedText: [Int: String] = [:]
        var attemptedPages = scannedSet
        progress?(0, pagesToScan.count)

        for (offset, pageNumber) in pagesToScan.enumerated() {
            if Task.isCancelled { return nil }
            if let page = document.page(at: pageNumber - 1),
               let text = recognizeText(on: page), !text.isEmpty {
                recognizedText[pageNumber] = text
            }
            attemptedPages.insert(pageNumber)
            if (offset + 1).isMultiple(of: 8) || offset + 1 == pagesToScan.count {
                progress?(offset + 1, pagesToScan.count)
            }
        }

        let recognizedSections = recognizedText.isEmpty
            ? []
            : scanHeadings(document, ocrTextByPage: recognizedText, documentTitle: record.title)
        let previousSectionCount = record.sections?.count ?? 0
        let mergedSections = mergingOCRSections(recognizedSections, into: record.sections ?? [])
        let allOCRText = (record.ocrTextByPage ?? [:]).merging(recognizedText) { _, new in new }
        record.sections = enrichFeastingSections(
            mergedSections,
            document: document,
            title: record.title,
            ocrTextByPage: allOCRText
        )
        record.ocrPageNumbers = attemptedPages.sorted()
        record.ocrTextByPage = allOCRText
        return PDFLibraryOCRResult(
            record: record,
            candidatePageCount: candidatePages.count,
            scannedPageCount: pagesToScan.count,
            recognizedTextPageCount: recognizedText.count,
            sectionsFound: max(0, (record.sections?.count ?? 0) - previousSectionCount)
        )
    }

    private static func makeRecord(
        _ document: PDFDocument,
        url: URL,
        previousRecord: PDFLibraryRecord?,
        ocrTextByPage: [Int: String] = [:]
    ) -> PDFLibraryRecord? {
        guard document.pageCount > 0 else { return nil }
        let attributes = document.documentAttributes ?? [:]
        let filename = url.deletingPathExtension().lastPathComponent
        let metadataTitle = stringAttribute(PDFDocumentAttribute.titleAttribute, in: attributes)
        let title = displayTitle(metadataTitle: metadataTitle, filename: filename)
        let author = displayAuthors(stringAttribute(PDFDocumentAttribute.authorAttribute, in: attributes), title: title)
        let bookmarks = flatten(document.outlineRoot, document: document)
        let textSections = bookmarks.isEmpty ? scanHeadings(document) : bookmarks
        let rawSections = ocrTextByPage.isEmpty
            ? textSections
            : mergingOCRSections(
                scanHeadings(document, ocrTextByPage: ocrTextByPage, documentTitle: title),
                into: textSections
            )
        let sections = enrichFeastingSections(rawSections, document: document, title: title)
        let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let copyLabel: String? = {
            guard let regex = try? NSRegularExpression(pattern: #"\s\((\d+)\)$"#),
                  let match = regex.firstMatch(in: filename, range: NSRange(filename.startIndex..., in: filename)),
                  let numberRange = Range(match.range(at: 1), in: filename),
                  let number = Int(filename[numberRange]) else { return nil }
            return "Cópia \(number + 1)"
        }()

        var record = PDFLibraryRecord(
            id: url.path,
            title: title,
            path: url.path,
            pageCount: document.pageCount,
            bookmarkCount: countBookmarks(document.outlineRoot),
            author: author,
            coverJPEG: makeCover(document),
            sections: sections,
            indexVersion: currentVersion,
            copyLabel: copyLabel,
            fileSizeBytes: values?.fileSize.map(Int64.init),
            fileModificationDate: values?.contentModificationDate
        )

        if hasSameFileContents(record, previousRecord),
           let previousRecord {
            record.ocrPageNumbers = previousRecord.ocrPageNumbers
            record.ocrTextByPage = previousRecord.ocrTextByPage
            let mergedSections = mergingOCRSections(
                (previousRecord.sections ?? []).filter { $0.findingMethod == .ocrHeading },
                into: record.sections ?? []
            )
            record.sections = enrichFeastingSections(
                mergedSections,
                document: document,
                title: title,
                ocrTextByPage: previousRecord.ocrTextByPage ?? [:]
            )
        }
        return record
    }

    private static func hasSameFileContents(_ record: PDFLibraryRecord, _ previousRecord: PDFLibraryRecord?) -> Bool {
        guard let previousRecord,
              let fileSize = record.fileSizeBytes,
              let previousFileSize = previousRecord.fileSizeBytes,
              let modificationDate = record.fileModificationDate,
              let previousModificationDate = previousRecord.fileModificationDate else { return false }
        return record.path == previousRecord.path
            && fileSize == previousFileSize
            && modificationDate == previousModificationDate
    }

    private static func mergingOCRSections(
        _ ocrSections: [PDFSectionLocation],
        into sections: [PDFSectionLocation]
    ) -> [PDFSectionLocation] {
        var merged = sections
        for candidate in ocrSections where candidate.findingMethod == .ocrHeading {
            guard let reference = ScriptureReference.parseHeading(candidate.title) else { continue }
            let alreadyIndexed = merged.contains { section in
                [section.title, section.context].compactMap { $0 }
                    .flatMap(ScriptureReference.parseAll)
                    .contains { sameReference($0, reference) }
            }
            if !alreadyIndexed { merged.append(candidate) }
        }
        return merged.sorted {
            $0.startPage == $1.startPage
                ? $0.title.localizedStandardCompare($1.title) == .orderedAscending
                : $0.startPage < $1.startPage
        }
    }

    private static func recognizeText(on page: PDFPage) -> String? {
        let image = page.thumbnail(of: CGSize(width: 1500, height: 2100), for: .mediaBox)
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US", "pt-BR"]
        do {
            try VNImageRequestHandler(cgImage: cgImage).perform([request])
        } catch {
            return nil
        }
        return (request.results ?? [])
            .sorted {
                if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.012 {
                    return $0.boundingBox.midY > $1.boundingBox.midY
                }
                return $0.boundingBox.minX < $1.boundingBox.minX
            }
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    static func sections(for document: PDFDocument, title: String? = nil) -> [PDFSectionLocation] {
        let bookmarks = flatten(document.outlineRoot, document: document)
        let rawSections = bookmarks.isEmpty ? scanHeadings(document) : bookmarks
        let documentTitle = title ?? displayTitle(
            metadataTitle: stringAttribute(PDFDocumentAttribute.titleAttribute, in: document.documentAttributes ?? [:]),
            filename: document.documentURL?.deletingPathExtension().lastPathComponent ?? ""
        )
        return enrichFeastingSections(rawSections, document: document, title: documentTitle)
    }

    static func requiresReindex(_ record: PDFLibraryRecord) -> Bool {
        guard record.sections != nil else { return true }
        let version = record.indexVersion ?? 0
        if version < 2 { return true }
        return version < currentVersion && (isFeastingTitle(record.title) || record.bookmarkCount == 0)
    }

    static func backfillingBookmarkMethod(
        in sections: [PDFSectionLocation],
        bookmarkCount: Int
    ) -> [PDFSectionLocation] {
        guard bookmarkCount > 0 else { return sections }
        return sections.map { section in
            guard section.findingMethod == nil || section.findingMethod == .unknown else { return section }
            return PDFSectionLocation(
                title: section.title,
                startPage: section.startPage,
                endPage: section.endPage,
                context: section.context,
                components: section.components,
                findingMethod: .bookmark
            )
        }
    }

    static func match(_ section: PDFSectionLocation, reference: String) -> PDFSectionMatchKind? {
        guard let target = ScriptureReference.parse(reference) else { return nil }
        return match(section, target: target)
    }

    static func matchingSectionCount(in records: [PDFLibraryRecord], reference: String?) -> Int {
        guard let reference, let target = ScriptureReference.parse(reference) else { return 0 }
        return records.reduce(0) { count, record in
            count + (record.sections ?? []).filter { match($0, target: target) != nil }.count
        }
    }

    static func match(_ section: PDFSectionLocation, target: ScriptureReference) -> PDFSectionMatchKind? {
        let candidates = [section.title, section.context].compactMap { $0 }.flatMap(ScriptureReference.parseAll)
        var hasPartial = false
        for candidate in candidates where candidate.book == target.book {
            guard let targetStart = target.startVerse else {
                if target.chapter >= candidate.chapter && target.chapter <= (candidate.endChapter ?? candidate.chapter) { return .context }
                continue
            }
            guard let candidateStart = candidate.startVerse else {
                if target.chapter >= candidate.chapter && target.chapter <= (candidate.endChapter ?? candidate.chapter) { return .context }
                continue
            }
            let targetEndChapter = target.endChapter ?? target.chapter
            let targetEndVerse = target.endVerse ?? targetStart
            let candidateEndChapter = candidate.endChapter ?? candidate.chapter
            let candidateEndVerse = candidate.endVerse ?? candidateStart
            let targetStartsBeforeCandidateEnds = target.chapter < candidateEndChapter || (target.chapter == candidateEndChapter && targetStart <= candidateEndVerse)
            let candidateStartsBeforeTargetEnds = candidate.chapter < targetEndChapter || (candidate.chapter == targetEndChapter && candidateStart <= targetEndVerse)
            guard targetStartsBeforeCandidateEnds && candidateStartsBeforeTargetEnds else { continue }
            let containsStart = candidate.chapter < target.chapter || (candidate.chapter == target.chapter && candidateStart <= targetStart)
            let containsEnd = candidateEndChapter > targetEndChapter || (candidateEndChapter == targetEndChapter && candidateEndVerse >= targetEndVerse)
            if containsStart && containsEnd { return .exact }
            hasPartial = true
        }
        return hasPartial ? .partial : nil
    }

    private static func flatten(_ root: PDFOutline?, document: PDFDocument) -> [PDFSectionLocation] {
        guard let root else { return [] }
        var entries: [(title: String, page: Int, context: String?, method: PDFSectionFindingMethod, order: Int)] = []
        var order = 0
        func walk(_ node: PDFOutline, ancestors: [String]) {
            for index in 0..<node.numberOfChildren {
                guard let child = node.child(at: index) else { continue }
                let title = child.label?.trimmingCharacters(in: .whitespacesAndNewlines)
                let page = child.destination?.page.map { document.index(for: $0) + 1 }
                if let title, !title.isEmpty, let page, page > 0 {
                    entries.append((title, page, ancestors.last, .bookmark, order))
                    order += 1
                }
                walk(child, ancestors: title.map { ancestors + [$0] } ?? ancestors)
            }
        }
        walk(root, ancestors: [])
        return addPageRanges(entries, pageCount: document.pageCount)
    }

    private static func addPageRanges(_ entries: [PDFSectionLocation], pageCount: Int) -> [PDFSectionLocation] {
        let sorted = entries.enumerated().sorted {
            $0.element.startPage == $1.element.startPage ? $0.offset < $1.offset : $0.element.startPage < $1.element.startPage
        }.map(\.element)
        return sorted.enumerated().map { index, item in
            let nextPage = index + 1 < sorted.count ? sorted[index + 1].startPage : pageCount + 1
            return PDFSectionLocation(
                title: item.title,
                startPage: item.startPage,
                endPage: max(item.startPage, nextPage - 1),
                context: item.context
            )
        }
    }

    private static func addPageRanges(_ entries: [(title: String, page: Int, context: String?, method: PDFSectionFindingMethod, order: Int)], pageCount: Int) -> [PDFSectionLocation] {
        let sorted = entries.sorted { $0.page == $1.page ? $0.order < $1.order : $0.page < $1.page }
        return sorted.enumerated().map { index, entry in
            let nextPage = index + 1 < sorted.count ? sorted[index + 1].page : pageCount + 1
            return PDFSectionLocation(
                title: entry.title,
                startPage: entry.page,
                endPage: max(entry.page, nextPage - 1),
                context: entry.context,
                findingMethod: entry.method
            )
        }
    }

    private struct IndexedPDFLine {
        let page: Int
        let range: NSRange
        let text: String

        var start: PDFTextPosition { PDFTextPosition(page: page, utf16Offset: range.location) }
        var end: PDFTextPosition { PDFTextPosition(page: page, utf16Offset: NSMaxRange(range)) }
    }

    private static let feastingPerspectives: [(kind: PDFSectionComponentKind, title: String)] = [
        (.theological, "Theological Perspective"),
        (.pastoral, "Pastoral Perspective"),
        (.exegetical, "Exegetical Perspective"),
        (.homiletical, "Homiletical Perspective")
    ]

    private static func isFeastingTitle(_ title: String) -> Bool {
        title.localizedCaseInsensitiveContains("Feasting on the Word")
    }

    private static func enrichFeastingSections(
        _ sections: [PDFSectionLocation],
        document: PDFDocument,
        title: String,
        ocrTextByPage: [Int: String] = [:]
    ) -> [PDFSectionLocation] {
        guard isFeastingTitle(title) else { return sections }
        var pageTextCache: [Int: String] = [:]

        return sections.map { section in
            let lastPage = min(section.endPage + 1, document.pageCount)
            guard section.startPage <= lastPage,
                  let target = ScriptureReference.parse(section.title),
                  target.startVerse != nil else { return section }

            var pageTexts: [Int: String] = [:]
            for pageNumber in section.startPage...lastPage {
                if let cached = pageTextCache[pageNumber] {
                    pageTexts[pageNumber] = cached
                } else if let text = nonempty(document.page(at: pageNumber - 1)?.string)
                    ?? nonempty(ocrTextByPage[pageNumber]) {
                    pageTextCache[pageNumber] = text
                    pageTexts[pageNumber] = text
                }
            }
            guard let components = feastingComponents(for: section, target: target, pageTexts: pageTexts),
                  let end = components.last?.location.end else { return section }
            let lastIncludedPage = end.utf16Offset == 0 ? max(section.startPage, end.page - 1) : end.page
            return PDFSectionLocation(
                title: section.title,
                startPage: section.startPage,
                endPage: max(section.endPage, lastIncludedPage),
                context: section.context,
                components: components,
                findingMethod: section.findingMethod
            )
        }
    }

    static func feastingComponents(
        for section: PDFSectionLocation,
        target: ScriptureReference,
        pageTexts: [Int: String]
    ) -> [PDFSectionComponent]? {
        let lines = pageTexts.keys.sorted().flatMap { page in
            indexedLines(in: pageTexts[page] ?? "", page: page)
        }
        guard let scriptureIndex = lines.firstIndex(where: {
            $0.page >= section.startPage && isReferenceHeading($0.text, matching: target)
        }) else { return nil }

        var perspectiveIndexes: [(kind: PDFSectionComponentKind, title: String, index: Int)] = []
        var searchFrom = scriptureIndex + 1
        for perspective in feastingPerspectives {
            guard let index = lines.indices.first(where: {
                $0 >= searchFrom && isPerspectiveHeading(lines[$0].text, expected: perspective.title)
            }) else { return nil }
            perspectiveIndexes.append((perspective.kind, perspective.title, index))
            searchFrom = index + 1
        }

        let followingReferenceIndex = lines.indices.first(where: { index in
            index > perspectiveIndexes[perspectiveIndexes.count - 1].index
                && isReferenceHeading(lines[index].text)
                && !isReferenceHeading(lines[index].text, matching: target)
        })
        let sectionBoundaryIndex = followingReferenceIndex ?? lines.count
        guard let firstPerspective = perspectiveIndexes.first else { return nil }
        var components = [PDFSectionComponent(
            kind: .biblicalText,
            title: "Texto bíblico",
            author: nil,
            location: PDFTextSpan(start: lines[scriptureIndex].start, end: lines[firstPerspective.index].start),
            content: PDFTextSpan(start: lines[scriptureIndex].end, end: lines[firstPerspective.index].start)
        )]

        for index in perspectiveIndexes.indices {
            let heading = perspectiveIndexes[index]
            let boundaryIndex = index + 1 < perspectiveIndexes.count
                ? perspectiveIndexes[index + 1].index
                : sectionBoundaryIndex
            let boundary = boundaryIndex < lines.count ? lines[boundaryIndex] : lines.last
            guard let boundary else { return nil }
            let authorLine = lines[(heading.index + 1)..<boundaryIndex]
                .reversed()
                .first { normalizedAuthor(from: $0.text) != nil }
            let author = authorLine.flatMap { normalizedAuthor(from: $0.text) }
            let contentEnd = author == nil ? boundary.start : authorLine!.start
            components.append(PDFSectionComponent(
                kind: heading.kind,
                title: heading.title,
                author: author,
                location: PDFTextSpan(start: lines[heading.index].start, end: boundary.start),
                content: PDFTextSpan(start: lines[heading.index].end, end: contentEnd)
            ))
        }
        return components
    }

    static func extractedText(
        in span: PDFTextSpan,
        from document: PDFDocument,
        ocrTextByPage: [Int: String] = [:]
    ) -> String {
        guard span.start.page > 0,
              span.start.page <= span.end.page,
              span.end.page <= document.pageCount else { return "" }
        var fragments: [String] = []
        for pageNumber in span.start.page...span.end.page {
            let pdfText = document.page(at: pageNumber - 1)?.string
            let text = nonempty(pdfText) ?? nonempty(ocrTextByPage[pageNumber]) ?? ""
            let pageText = text as NSString
            let start = pageNumber == span.start.page ? min(span.start.utf16Offset, pageText.length) : 0
            let end = pageNumber == span.end.page ? min(span.end.utf16Offset, pageText.length) : pageText.length
            guard end >= start else { return "" }
            fragments.append(pageText.substring(with: NSRange(location: start, length: end - start)))
        }
        return fragments.joined(separator: "\n")
    }

    static func reviewText(on pageNumber: Int, in document: PDFDocument, ocrTextByPage: [Int: String]) -> String? {
        guard pageNumber > 0, pageNumber <= document.pageCount else { return nil }
        return nonempty(document.page(at: pageNumber - 1)?.string)
            ?? nonempty(ocrTextByPage[pageNumber])
    }

    private static func nonempty(_ text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private static func indexedLines(in text: String, page: Int) -> [IndexedPDFLine] {
        let pageText = text as NSString
        var lines: [IndexedPDFLine] = []
        var offset = 0
        while offset < pageText.length {
            let range = pageText.lineRange(for: NSRange(location: offset, length: 0))
            guard range.length > 0 else { break }
            lines.append(IndexedPDFLine(page: page, range: range, text: pageText.substring(with: range)))
            offset = NSMaxRange(range)
        }
        return lines
    }

    private static func isPerspectiveHeading(_ line: String, expected: String) -> Bool {
        line.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare(expected) == .orderedSame
    }

    private static func isReferenceHeading(_ line: String, matching target: ScriptureReference? = nil) -> Bool {
        let value = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 80,
              let regex = try? NSRegularExpression(pattern: #"^(?:(?:1|2|3|I|II|III)\s+)?[\p{L}][\p{L}.]*(?:\s+[\p{L}][\p{L}.]*){0,3}\s+\d+\s*[:.]\s*\d+(?:\s*[-–—]\s*(?:\d+\s*[:.]\s*)?\d+)?\s*$"#),
              regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil,
              let reference = ScriptureReference.parse(value),
              reference.startVerse != nil else { return false }
        guard let target else { return true }
        return sameReference(reference, target)
    }

    private static func sameReference(_ lhs: ScriptureReference, _ rhs: ScriptureReference) -> Bool {
        lhs.book == rhs.book
            && lhs.chapter == rhs.chapter
            && lhs.startVerse == rhs.startVerse
            && (lhs.endChapter ?? lhs.chapter) == (rhs.endChapter ?? rhs.chapter)
            && lhs.endVerse == rhs.endVerse
    }

    private static func normalizedAuthor(from line: String) -> String? {
        let name = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let letters = name.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard letters.count >= 4,
              name.split(whereSeparator: \.isWhitespace).count >= 2,
              name == name.uppercased(),
              name.unicodeScalars.allSatisfy({
                  CharacterSet.letters.contains($0)
                      || CharacterSet.whitespacesAndNewlines.contains($0)
                      || ".-'’".unicodeScalars.contains($0)
              }) else { return nil }
        return name
    }

    private static func scanHeadings(
        _ document: PDFDocument,
        ocrTextByPage: [Int: String] = [:],
        documentTitle: String? = nil
    ) -> [PDFSectionLocation] {
        var entries: [(title: String, page: Int, context: String?, method: PDFSectionFindingMethod, order: Int)] = []
        var seen: Set<String> = []
        for pageNumber in 1...document.pageCount {
            if pageNumber.isMultiple(of: 32), Task.isCancelled { return [] }
            guard let text = ocrTextByPage[pageNumber] ?? document.page(at: pageNumber - 1)?.string else { continue }
            let findingMethod: PDFSectionFindingMethod = ocrTextByPage[pageNumber] == nil ? .textHeading : .ocrHeading
            let usesOCR = ocrTextByPage[pageNumber] != nil
            let lineLimit = usesOCR && documentTitle.map(isFeastingTitle) == true ? 48 : 12
            let lines = text.components(separatedBy: .newlines).prefix(lineLimit)
            var pageEntries: [(title: String, reference: ScriptureReference)] = []
            for line in lines {
                let candidate = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard candidate.count <= 100,
                      let parsed = ScriptureReference.parseHeading(candidate) else { continue }
                pageEntries.append((candidate, parsed))
            }
            let uniquePageReferences = Set(pageEntries.map { entry in
                "\(entry.reference.book)|\(entry.reference.chapter)|\(entry.reference.startVerse ?? 0)|\(entry.reference.endChapter ?? entry.reference.chapter)|\(entry.reference.endVerse ?? entry.reference.startVerse ?? 0)"
            })
            guard uniquePageReferences.count < 3 else { continue }
            for entry in pageEntries {
                let parsed = entry.reference
                let key = "\(parsed.book)|\(parsed.chapter)|\(parsed.startVerse ?? 0)|\(parsed.endChapter ?? parsed.chapter)|\(parsed.endVerse ?? parsed.startVerse ?? 0)"
                guard seen.insert(key).inserted else { continue }
                entries.append((entry.title, pageNumber, nil, findingMethod, entries.count))
            }
        }
        return addPageRanges(entries, pageCount: document.pageCount)
    }

    private static func countBookmarks(_ root: PDFOutline?) -> Int {
        guard let root else { return 0 }
        return (0..<root.numberOfChildren).reduce(0) { total, index in
            guard let child = root.child(at: index) else { return total }
            return total + 1 + countBookmarks(child)
        }
    }

    private static func makeCover(_ document: PDFDocument) -> Data? {
        guard let page = document.page(at: 0) else { return nil }
        let image = page.thumbnail(of: CGSize(width: 150, height: 210), for: .cropBox)
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.72])
    }

    private static func stringAttribute(_ key: PDFDocumentAttribute, in attributes: [AnyHashable: Any]) -> String? {
        (attributes[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isUseful(_ value: String) -> Bool {
        !value.isEmpty && value.lowercased() != "untitled" && value.lowercased() != "unknown"
    }

    private static func displayTitle(metadataTitle: String?, filename: String) -> String {
        if let metadataTitle {
            let normalized = normalizeTitle(metadataTitle)
            if isUseful(normalized), !isGenericMetadataTitle(normalized) { return normalized }
        }

        let cleanedFilename = cleanFilename(filename)
        if let match = firstMatch(#"(?i)feasting[-_ ]on[-_ ]the[-_ ]word.*?year[-_ ]?([abc]).*?volume[-_ ]?([1-4])"#, in: filename),
           match.count == 2,
           let year = match.first,
           let volume = match.last {
            return "Feasting on the Word: Year \(year.uppercased()), Volume \(volume)"
        }
        if cleanedFilename.localizedCaseInsensitiveContains("connections") {
            return "Connections: A Lectionary Commentary for Preaching and Worship"
        }
        return cleanedFilename
    }

    private static func normalizeTitle(_ value: String) -> String {
        value
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isGenericMetadataTitle(_ value: String) -> Bool {
        let normalized = value.lowercased()
        return normalized.hasPrefix("microsoft word -")
            || normalized.hasPrefix("about:blank")
            || normalized.hasSuffix(".indd")
            || normalized.count > 140
    }

    private static func firstMatch(_ pattern: String, in value: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { return nil }
        return (1..<match.numberOfRanges).compactMap { index in
            guard let range = Range(match.range(at: index), in: value) else { return nil }
            return String(value[range])
        }
    }

    private static func displayAuthors(_ value: String?, title: String) -> String? {
        guard let value, isUseful(value) else { return nil }
        let people = value.split(separator: ";").map { raw -> String in
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "."))
            let parts = name.split(separator: ",", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            guard parts.count == 2 else { return name }
            return "\(parts[1]) \(parts[0])"
        }.filter { !$0.isEmpty }
        guard !people.isEmpty else { return nil }
        let isFeasting = title.localizedCaseInsensitiveContains("Feasting on the Word")
        if people.count > 3 { return "\(people.prefix(2).joined(separator: ", ")) et al." }
        let names = people.joined(separator: " & ")
        return isFeasting && people.count > 1 ? "\(names) (orgs.)" : names
    }

    private static func cleanFilename(_ filename: String) -> String {
        filename
            .replacingOccurrences(of: #"\s*\(\d+\)$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: " - ", with: ": ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
