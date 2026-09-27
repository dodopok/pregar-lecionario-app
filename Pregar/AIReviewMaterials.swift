import Foundation
import PDFKit

enum SermonReviewMaterialError: LocalizedError {
    case pageStillLoading
    case pageUnavailable
    case sourceUnavailable(String)
    case sectionNotFound(String)

    var errorDescription: String? {
        switch self {
        case .pageStillLoading: "Uma página marcada para revisão ainda está carregando. Aguarde e tente novamente."
        case .pageUnavailable: "Não foi possível extrair o texto da página marcada para revisão."
        case let .sourceUnavailable(title): "Não foi possível abrir o material “\(title)” marcado para revisão."
        case let .sectionNotFound(title): "Não encontrei uma seção legível em “\(title)”. Desmarque-a ou escolha a seção no Leitor."
        }
    }
}

enum PDFReviewSourceExtractor {
    static let maximumCharactersPerSource = 24_000

    static func extract(tab: ReaderTab, targetReference: String?) throws -> [SermonReviewSource] {
        guard let document = PDFDocument(url: URL(fileURLWithPath: tab.location)), document.pageCount > 0 else {
            throw SermonReviewMaterialError.sourceUnavailable(tab.title)
        }

        let record = libraryRecord(at: tab.location)
        let sections = record?.sections?.isEmpty == false
            ? record!.sections!
            : PDFLibraryIndexer.sections(for: document, title: record?.displayTitle ?? tab.title)
        let preferredReference = targetReference?.isEmpty == false ? targetReference : tab.reference
        let selectedIndex = selectedSectionIndex(
            sections,
            reference: preferredReference,
            page: tab.physicalPage
        )
        guard let selectedIndex else { throw SermonReviewMaterialError.sectionNotFound(tab.title) }
        let section = sections[selectedIndex]
        let workTitle = record?.displayTitle ?? tab.title
        let author = record?.displayAuthor

        if let components = section.components, !components.isEmpty {
            let comments = components.filter { $0.kind != .biblicalText }
            let sources = comments.enumerated().compactMap { index, component -> SermonReviewSource? in
                let text = PDFLibraryIndexer.extractedText(in: component.content, from: document)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                let authorLine = component.author.map { " · \($0)" } ?? ""
                let page = component.location.start.page
                return SermonReviewSource(
                    id: "pdf:\(tab.id.uuidString):\(index)",
                    title: "\(workTitle) — \(component.title)\(authorLine)",
                    citation: "\(section.title) · página física \(page)",
                    text: String(text.prefix(maximumCharactersPerSource))
                )
            }
            if !sources.isEmpty { return sources }
        }

        var pages: [String] = []
        let lastPage = min(section.endPage, section.startPage + 35, document.pageCount)
        let nextSection = sections.indices.contains(selectedIndex + 1) ? sections[selectedIndex + 1] : nil
        if section.startPage <= lastPage {
            for pageNumber in section.startPage...lastPage {
                guard let pageText = document.page(at: pageNumber - 1)?.string else { continue }
                let pageRange = sectionBoundedText(
                    pageText,
                    pageNumber: pageNumber,
                    section: section,
                    nextSection: nextSection
                )
                if !pageRange.isEmpty { pages.append(pageRange) }
            }
        }
        let text = pages.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw SermonReviewMaterialError.sectionNotFound(tab.title) }

        let authorLine = author.map { " · \($0)" } ?? ""
        let pageRange = section.startPage == section.endPage
            ? "física \(section.startPage)"
            : "físicas \(section.startPage)–\(section.endPage)"
        return [SermonReviewSource(
            id: "pdf:\(tab.id.uuidString):section",
            title: "\(workTitle)\(authorLine)",
            citation: "\(section.title) · páginas \(pageRange)",
            text: String(text.prefix(maximumCharactersPerSource))
        )]
    }

    private static func libraryRecord(at path: String) -> PDFLibraryRecord? {
        guard let data = UserDefaults.standard.data(forKey: "pregar.library.records.v1"),
              let records = try? JSONDecoder().decode([PDFLibraryRecord].self, from: data) else { return nil }
        return records.first { $0.path == path }
    }

    private static func selectedSectionIndex(_ sections: [PDFSectionLocation], reference: String?, page: Int) -> Int? {
        if let reference, let target = ScriptureReference.parse(reference) {
            if let exact = sections.firstIndex(where: { PDFLibraryIndexer.match($0, target: target) == .exact }) {
                return exact
            }
            if let partial = sections.firstIndex(where: { PDFLibraryIndexer.match($0, target: target) == .partial }) {
                return partial
            }
        }
        return sections.firstIndex { page >= $0.startPage && page <= $0.endPage }
    }

    private static func sectionBoundedText(
        _ pageText: String,
        pageNumber: Int,
        section: PDFSectionLocation,
        nextSection: PDFSectionLocation?
    ) -> String {
        let source = pageText as NSString
        var start = 0
        var end = source.length
        let lines = lineRanges(in: source)

        if pageNumber == section.startPage, let target = ScriptureReference.parse(section.title),
           let heading = lines.first(where: { line in
               ScriptureReference.parse(line.text) == target
           }) {
            start = NSMaxRange(heading.range)
        }
        if let nextSection, pageNumber == nextSection.startPage,
           let target = ScriptureReference.parse(nextSection.title),
           let heading = lines.first(where: { line in
               ScriptureReference.parse(line.text) == target
           }) {
            end = heading.range.location
        }
        guard end >= start else { return "" }
        return source.substring(with: NSRange(location: start, length: end - start))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func lineRanges(in text: NSString) -> [(text: String, range: NSRange)] {
        var results: [(String, NSRange)] = []
        var location = 0
        while location < text.length {
            let line = text.lineRange(for: NSRange(location: location, length: 0))
            let contentLength = max(0, line.length - (text.substring(with: line).hasSuffix("\n") ? 1 : 0))
            let contentRange = NSRange(location: line.location, length: contentLength)
            results.append((text.substring(with: contentRange).trimmingCharacters(in: .whitespacesAndNewlines), line))
            location = NSMaxRange(line)
        }
        return results
    }
}
