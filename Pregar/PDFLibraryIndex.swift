import AppKit
import Foundation
import PDFKit

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

    static func parse(_ value: String) -> ScriptureReference? {
        parseAll(value).first
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
        .init(canonical: "psalms", english: "Psalms", aliases: ["psalms", "psalm", "ps", "salmos", "salmo"]),
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
        .init(canonical: "zechariah", english: "Zechariah", aliases: ["zechariah", "zacarias"]),
        .init(canonical: "malachi", english: "Malachi", aliases: ["malachi", "malaquias"]),
        .init(canonical: "matthew", english: "Matthew", aliases: ["matthew", "matt", "mateus", "mt"]),
        .init(canonical: "mark", english: "Mark", aliases: ["mark", "marcos", "mk"]),
        .init(canonical: "luke", english: "Luke", aliases: ["luke", "lucas", "lk"]),
        .init(canonical: "john", english: "John", aliases: ["john", "joao", "jn"]),
        .init(canonical: "acts", english: "Acts", aliases: ["acts", "atos"]),
        .init(canonical: "romans", english: "Romans", aliases: ["romans", "rom", "romanos"]),
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
    static let currentVersion = 2

    static func index(path: String) -> PDFLibraryRecord? {
        let url = URL(fileURLWithPath: path)
        guard let document = PDFDocument(url: url), document.pageCount > 0 else { return nil }
        let bookmarks = flatten(document.outlineRoot, document: document)
        let sections = bookmarks.isEmpty ? scanHeadings(document) : bookmarks
        let attributes = document.documentAttributes ?? [:]
        let filename = url.deletingPathExtension().lastPathComponent
        let metadataTitle = stringAttribute(PDFDocumentAttribute.titleAttribute, in: attributes)
        let title = displayTitle(metadataTitle: metadataTitle, filename: filename)
        let author = displayAuthors(stringAttribute(PDFDocumentAttribute.authorAttribute, in: attributes), title: title)
        let copyLabel: String? = {
            guard let regex = try? NSRegularExpression(pattern: #"\s\((\d+)\)$"#),
                  let match = regex.firstMatch(in: filename, range: NSRange(filename.startIndex..., in: filename)),
                  let numberRange = Range(match.range(at: 1), in: filename),
                  let number = Int(filename[numberRange]) else { return nil }
            return "Cópia \(number + 1)"
        }()

        return PDFLibraryRecord(
            id: url.path,
            title: title,
            path: url.path,
            pageCount: document.pageCount,
            bookmarkCount: countBookmarks(document.outlineRoot),
            author: author,
            coverJPEG: makeCover(document),
            sections: sections,
            indexVersion: currentVersion,
            copyLabel: copyLabel
        )
    }

    static func sections(for document: PDFDocument) -> [PDFSectionLocation] {
        let bookmarks = flatten(document.outlineRoot, document: document)
        return bookmarks.isEmpty ? scanHeadings(document) : bookmarks
    }

    static func match(_ section: PDFSectionLocation, reference: String) -> PDFSectionMatchKind? {
        guard let target = ScriptureReference.parse(reference) else { return nil }
        return match(section, target: target)
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
        var entries: [(title: String, page: Int, context: String?, order: Int)] = []
        var order = 0
        func walk(_ node: PDFOutline, ancestors: [String]) {
            for index in 0..<node.numberOfChildren {
                guard let child = node.child(at: index) else { continue }
                let title = child.label?.trimmingCharacters(in: .whitespacesAndNewlines)
                let page = child.destination?.page.map { document.index(for: $0) + 1 }
                if let title, !title.isEmpty, let page, page > 0 {
                    entries.append((title, page, ancestors.last, order))
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

    private static func addPageRanges(_ entries: [(title: String, page: Int, context: String?, order: Int)], pageCount: Int) -> [PDFSectionLocation] {
        let sorted = entries.sorted { $0.page == $1.page ? $0.order < $1.order : $0.page < $1.page }
        return sorted.enumerated().map { index, entry in
            let nextPage = index + 1 < sorted.count ? sorted[index + 1].page : pageCount + 1
            return PDFSectionLocation(title: entry.title, startPage: entry.page, endPage: max(entry.page, nextPage - 1), context: entry.context)
        }
    }

    private static func scanHeadings(_ document: PDFDocument) -> [PDFSectionLocation] {
        var entries: [(title: String, page: Int, context: String?, order: Int)] = []
        var seen: Set<String> = []
        for pageNumber in 1...document.pageCount {
            if pageNumber.isMultiple(of: 32), Task.isCancelled { return [] }
            guard let text = document.page(at: pageNumber - 1)?.string else { continue }
            let lines = text.components(separatedBy: .newlines).prefix(12)
            for line in lines {
                let candidate = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard candidate.count <= 100,
                      let parsed = ScriptureReference.parse(candidate),
                      parsed.startVerse != nil else { continue }
                let key = ScriptureReference.normalized(candidate)
                guard seen.insert(key).inserted else { continue }
                entries.append((candidate, pageNumber, nil, entries.count))
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
