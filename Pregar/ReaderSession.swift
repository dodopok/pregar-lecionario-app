import AppKit
import PDFKit
import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct ReaderTab: Codable, Identifiable, Equatable, Sendable {
    enum Kind: String, Codable, Sendable { case pdf, web }

    var id: UUID
    var title: String
    var kind: Kind
    var location: String
    var physicalPage: Int
    var reference: String?
    var sermonDateKey: String? = nil
    var includedInReview: Bool
    var reviewInclusionConfirmed: Bool? = nil
    var pdfPosition: ReaderPDFPosition? = nil
    var webPositions: [String: ReaderWebPosition]? = nil
    var navigationID: UUID? = nil

    var isIncludedForReview: Bool { includedInReview && reviewInclusionConfirmed == true }

    static func countMarkedForReview(in tabs: [ReaderTab], reference: String?, sermonDateKey: String?) -> Int {
        guard let reference, let sermonDateKey else { return 0 }
        return tabs.filter {
            $0.isIncludedForReview && $0.reference == reference && $0.sermonDateKey == sermonDateKey
        }.count
    }
}

struct ReaderPDFPosition: Codable, Equatable, Sendable {
    var page: Int
    var x: Double
    var y: Double
    var scale: Double
    var autoScales: Bool

    var isValid: Bool { page > 0 && x.isFinite && y.isFinite && abs(x) < 1e7 && abs(y) < 1e7 && scale.isFinite && scale > 0 && scale < 100 }
}

struct ReaderWebPosition: Codable, Equatable, Sendable {
    var x: Double
    var y: Double
    var isValid: Bool { x.isFinite && y.isFinite && x >= 0 && y >= 0 && x < 1e8 && y < 1e8 }
}

struct PDFSectionLocation: Codable, Identifiable, Equatable, Sendable {
    var id: String { "\(title)|\(startPage)" }
    let title: String
    let startPage: Int
    let endPage: Int
    let context: String?
    let components: [PDFSectionComponent]?
    let findingMethod: PDFSectionFindingMethod?

    func matchesSearch(_ query: String) -> Bool {
        let normalizedQuery = ScriptureReference.normalized(query)
        guard !normalizedQuery.isEmpty else { return true }
        return [title, context].compactMap { $0 }.contains {
            ScriptureReference.normalized($0).contains(normalizedQuery)
        }
    }

    var findingMethodLabel: String {
        switch findingMethod {
        case .bookmark: "bookmark do PDF"
        case .textHeading: "cabeçalho textual"
        case .ocrHeading: "cabeçalho reconhecido por OCR"
        case .unknown, nil: "não identificado"
        }
    }

    var confidenceLabel: String {
        switch findingMethod {
        case .bookmark: "alta"
        case .textHeading: "média"
        case .ocrHeading: "baixa · conferir"
        case .unknown, nil: "não verificada"
        }
    }

    var hasHighConfidence: Bool { findingMethod == .bookmark }

    init(
        title: String,
        startPage: Int,
        endPage: Int,
        context: String? = nil,
        components: [PDFSectionComponent]? = nil,
        findingMethod: PDFSectionFindingMethod? = .unknown
    ) {
        self.title = title
        self.startPage = startPage
        self.endPage = endPage
        self.context = context
        self.components = components
        self.findingMethod = findingMethod
    }
}

struct ReaderArchive: Codable, Sendable {
    var tabs: [ReaderTab]
    var selectedID: UUID?
    var activeSermonDateKey: String? = nil
    var selectedBySermon: [String: UUID]? = nil
    var closedTabs: [ReaderTab]? = nil
}

private final class LoadedPDF: @unchecked Sendable {
    let document: PDFDocument?

    init(_ document: PDFDocument?) {
        self.document = document
    }
}

@MainActor
final class ReaderSessionStore: ObservableObject {
    @Published private(set) var tabs: [ReaderTab] = []
    @Published private(set) var selectedID: UUID?
    @Published private(set) var activeSermonDateKey: String?
    @Published private(set) var activeReference: String?
    @Published private(set) var closedTabs: [ReaderTab] = []

    private let archiveKey = "reader.session.v1"
    private let linksKey = "reader.section-links.v1"
    private let userDefaults: UserDefaults
    private var pdfDocuments: [String: PDFDocument] = [:]
    private var pdfLoadTasks: [String: Task<LoadedPDF, Never>] = [:]
    private var pdfSections: [String: [PDFSectionLocation]] = [:]
    private var sectionTasks: [String: Task<[PDFSectionLocation], Never>] = [:]
    private var webSessions: [UUID: ReaderWebSession] = [:]
    private var rememberedPages: [String: Int] = [:]
    private var pendingPagePersistence: Task<Void, Never>?
    private var selectedBySermon: [String: UUID] = [:]
    private var pdfPositions: [UUID: ReaderPDFPosition] = [:]
    private var contextRevision = 0

    var visibleTabs: [ReaderTab] { tabs.filter { $0.sermonDateKey == activeSermonDateKey } }
    var canReopenClosedTab: Bool { closedTabs.contains { $0.sermonDateKey == activeSermonDateKey } }
    var savedSermonDates: [String] { Array(Set(tabs.compactMap(\.sermonDateKey))).sorted(by: >) }
    private func contextKey(_ date: String?) -> String { date ?? "general" }

    static func contextLabel(_ date: String?) -> String {
        guard let date else { return "Pesquisa geral" }
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let value = Calendar(identifier: .gregorian).date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return date }
        return value.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "pt_BR")))
    }

    func updateActiveReference(_ reference: String?) {
        if activeReference != reference { activeReference = reference }
    }

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        if let data = userDefaults.data(forKey: archiveKey),
           let archive = try? JSONDecoder().decode(ReaderArchive.self, from: data) {
            tabs = archive.tabs.filter { tab in
                switch tab.kind {
                case .pdf:
                    return !tab.location.isEmpty
                case .web:
                    return URL(string: tab.location)?.scheme == "https" || URL(string: tab.location)?.scheme == "http"
                }
            }
            activeSermonDateKey = archive.activeSermonDateKey ?? tabs.first(where: { $0.id == archive.selectedID })?.sermonDateKey
            selectedBySermon = archive.selectedBySermon ?? [:]
            selectedID = archive.selectedID.flatMap { id in visibleTabs.contains(where: { $0.id == id }) ? id : nil }
            closedTabs = Array((archive.closedTabs ?? []).suffix(20))
        }
        if let data = userDefaults.data(forKey: linksKey),
           let links = try? JSONDecoder().decode([String: Int].self, from: data) {
            rememberedPages = links
        }
        if selectedID == nil { selectedID = visibleTabs.last?.id }
        activeReference = selectedTab?.reference
    }

    var selectedTab: ReaderTab? { tabs.first { $0.id == selectedID } }

    func activateSermon(_ date: String?, reference: String? = nil) {
        if let selectedID { selectedBySermon[contextKey(activeSermonDateKey)] = selectedID }
        guard activeSermonDateKey != date else {
            if let reference { activeReference = reference }
            return
        }
        webSessions[selectedID ?? UUID()]?.captureScrollPosition()
        contextRevision += 1
        activeSermonDateKey = date
        selectedID = selectedBySermon[contextKey(date)].flatMap { id in visibleTabs.contains { $0.id == id } ? id : nil } ?? visibleTabs.last?.id
        activeReference = reference ?? selectedTab?.reference
        persist()
    }

    func preparePDF(for path: String) async -> PDFDocument? {
        let location = URL(fileURLWithPath: path).standardizedFileURL.path
        if let cached = pdfDocuments[location] { return cached }

        let task: Task<LoadedPDF, Never>
        if let existing = pdfLoadTasks[location] {
            task = existing
        } else {
            let url = URL(fileURLWithPath: location)
            task = Task.detached(priority: .userInitiated) {
                LoadedPDF(PDFDocument(url: url))
            }
            pdfLoadTasks[location] = task
        }

        let loaded = await task.value
        pdfLoadTasks[location] = nil
        guard let document = loaded.document, document.pageCount > 0 else { return nil }
        pdfDocuments[location] = document
        return document
    }

    func select(_ id: UUID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        contextRevision += 1
        webSessions[selectedID ?? UUID()]?.captureScrollPosition()
        if tab.sermonDateKey != activeSermonDateKey { activateSermon(tab.sermonDateKey, reference: tab.reference) }
        selectedID = id
        selectedBySermon[contextKey(activeSermonDateKey)] = id
        persist()
    }

    func openPDF(
        title: String,
        path: String,
        page: Int = 1,
        reference: String? = nil,
        sermonDateKey: String? = nil,
        indexedSections: [PDFSectionLocation]? = nil,
        preservePositionIfOpen: Bool = false,
        inBackground: Bool = false,
        forceNewTab: Bool = false,
        afterTabID: UUID? = nil
    ) async -> Bool {
        let date = sermonDateKey
        if !inBackground { contextRevision += 1 }
        let revision = contextRevision
        guard let document = await preparePDF(for: path) else { return false }
        return registerPDF(
            title: title,
            location: URL(fileURLWithPath: path).standardizedFileURL.path,
            page: page,
            reference: reference,
            sermonDateKey: date,
            indexedSections: indexedSections,
            preservePositionIfOpen: preservePositionIfOpen,
            inBackground: inBackground || revision != contextRevision,
            forceNewTab: forceNewTab,
            afterTabID: afterTabID,
            document: document
        )
    }

    private func registerPDF(
        title: String,
        location: String,
        page: Int,
        reference: String?,
        sermonDateKey: String?,
        indexedSections: [PDFSectionLocation]?,
        preservePositionIfOpen: Bool,
        inBackground: Bool,
        forceNewTab: Bool,
        afterTabID: UUID?,
        document: PDFDocument
    ) -> Bool {
        if let indexedSections { pdfSections[location] = indexedSections }

        var openedID: UUID
        if !forceNewTab, let index = tabs.firstIndex(where: { $0.kind == .pdf && $0.location == location && $0.sermonDateKey == sermonDateKey }) {
            let keepsPosition = preservePositionIfOpen
                && tabs[index].reference == reference
                && tabs[index].sermonDateKey == sermonDateKey
            let previousPage = tabs[index].physicalPage
            tabs[index].title = title
            tabs[index].reference = reference
            tabs[index].sermonDateKey = sermonDateKey
            let remembered = reference.flatMap { rememberedPages[sectionLinkKey(path: location, reference: $0)] }
            tabs[index].physicalPage = min(max(keepsPosition ? previousPage : (remembered ?? page), 1), document.pageCount)
            if !keepsPosition {
                pdfPositions[tabs[index].id] = nil
                tabs[index].pdfPosition = nil
                tabs[index].navigationID = UUID()
            }
            openedID = tabs[index].id
        } else {
            let remembered = reference.flatMap { rememberedPages[sectionLinkKey(path: location, reference: $0)] }
            let tab = ReaderTab(
                id: UUID(), title: title, kind: .pdf, location: location,
                physicalPage: min(max(remembered ?? page, 1), document.pageCount),
                reference: reference, sermonDateKey: sermonDateKey,
                includedInReview: false, reviewInclusionConfirmed: true
            )
            insert(tab, after: afterTabID)
            openedID = tab.id
        }
        if !inBackground { select(openedID) }
        persist()
        return true
    }

    @discardableResult
    func openWeb(title: String, url: URL, reference: String? = nil, sermonDateKey: String? = nil, inBackground: Bool = false, forceNewTab: Bool = false, afterTabID: UUID? = nil) -> Bool {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return false }
        let address = url.absoluteString
        let date = sermonDateKey
        var openedID: UUID
        if !forceNewTab, let existing = tabs.first(where: { $0.kind == .web && $0.location == address && $0.sermonDateKey == date }) {
            if let index = tabs.firstIndex(where: { $0.id == existing.id }) {
                tabs[index].title = title
                tabs[index].reference = reference
                tabs[index].sermonDateKey = date
            }
            openedID = existing.id
        } else {
            let tab = ReaderTab(
                id: UUID(), title: title, kind: .web, location: address,
                physicalPage: 1, reference: reference, sermonDateKey: date,
                includedInReview: false, reviewInclusionConfirmed: true
            )
            insert(tab, after: afterTabID)
            openedID = tab.id
        }
        if !inBackground { select(openedID) }
        persist()
        return true
    }

    func close(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        webSessions[id]?.captureScrollPosition()
        let saved = snapshot(tabs[index])
        closedTabs.append(saved)
        closedTabs = Array(closedTabs.suffix(20))
        let closed = tabs.remove(at: index)
        pdfPositions[id] = nil
        switch closed.kind {
        case .pdf:
            if !tabs.contains(where: { $0.kind == .pdf && $0.location == closed.location }) {
                pdfDocuments[closed.location] = nil
                pdfSections[closed.location] = nil
                sectionTasks[closed.location]?.cancel()
                sectionTasks[closed.location] = nil
            }
        case .web:
            webSessions[id]?.invalidate()
            webSessions[id] = nil
        }
        if selectedID == id {
            let remaining = visibleTabs
            selectedID = remaining.first(where: { candidate in (tabs.firstIndex(where: { $0.id == candidate.id }) ?? 0) >= index })?.id ?? remaining.last?.id
        }
        selectedBySermon = selectedBySermon.filter { $0.value != id }
        persist()
    }

    private func insert(_ tab: ReaderTab, after id: UUID?) {
        if let id, let index = tabs.firstIndex(where: { $0.id == id }) { tabs.insert(tab, at: index + 1) }
        else { tabs.append(tab) }
    }

    private func snapshot(_ tab: ReaderTab) -> ReaderTab {
        var copy = tab
        copy.pdfPosition = pdfPositions[tab.id] ?? tab.pdfPosition
        copy.webPositions = webSessions[tab.id]?.positions ?? tab.webPositions
        return copy
    }

    func pdfPosition(for tab: ReaderTab) -> ReaderPDFPosition? { pdfPositions[tab.id] ?? tab.pdfPosition }

    func recordPDFPosition(_ position: ReaderPDFPosition, for id: UUID) {
        guard position.isValid, let index = tabs.firstIndex(where: { $0.id == id && $0.kind == .pdf }) else { return }
        pdfPositions[id] = position
        if tabs[index].physicalPage != position.page { tabs[index].physicalPage = position.page }
        schedulePagePersistence()
    }

    func recordPDFPage(_ page: Int, for id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id && $0.kind == .pdf }), tabs[index].physicalPage != page else { return }
        tabs[index].physicalPage = page
        schedulePagePersistence()
    }

    func selectRelative(_ delta: Int) {
        let visible = visibleTabs
        guard !visible.isEmpty else { return }
        let index = visible.firstIndex { $0.id == selectedID } ?? 0
        select(visible[(index + delta + visible.count) % visible.count].id)
    }

    func reopenClosedTab() {
        guard let index = closedTabs.lastIndex(where: { $0.sermonDateKey == activeSermonDateKey }) else { return }
        var tab = closedTabs.remove(at: index)
        if tabs.contains(where: { $0.id == tab.id }) { tab.id = UUID() }
        insert(tab, after: selectedID)
        select(tab.id)
    }

    func duplicate(_ id: UUID, inBackground: Bool = false) {
        guard let original = tabs.first(where: { $0.id == id }) else { return }
        var copy = snapshot(original)
        copy.id = UUID()
        copy.includedInReview = false
        copy.reviewInclusionConfirmed = true
        insert(copy, after: id)
        if !inBackground { select(copy.id) }
        persist()
    }

    func openPDFTab(page: Int, position: ReaderPDFPosition? = nil, from id: UUID, inBackground: Bool) {
        guard let original = tabs.first(where: { $0.id == id && $0.kind == .pdf }), let document = pdfDocument(for: original) else { return }
        var copy = original
        copy.id = UUID()
        copy.physicalPage = min(document.pageCount, max(1, page))
        copy.pdfPosition = position?.isValid == true ? position : nil
        copy.navigationID = nil
        copy.includedInReview = false
        copy.reviewInclusionConfirmed = true
        insert(copy, after: id)
        if !inBackground { select(copy.id) }
        persist()
    }

    func closeOtherTabs(keeping id: UUID, toRightOnly: Bool = false) {
        guard let index = visibleTabs.firstIndex(where: { $0.id == id }) else { return }
        let ids = visibleTabs.enumerated().filter { toRightOnly ? $0.offset > index : $0.element.id != id }.map(\.element.id)
        for other in ids { close(other) }
    }

    func move(_ id: UUID, before target: UUID) {
        move(id, relativeTo: target, after: false)
    }

    func move(_ id: UUID, relativeTo target: UUID, after: Bool) {
        guard id != target, let from = tabs.firstIndex(where: { $0.id == id }),
              let destination = tabs.first(where: { $0.id == target }), tabs[from].sermonDateKey == destination.sermonDateKey else { return }
        let moved = tabs.remove(at: from)
        if let to = tabs.firstIndex(where: { $0.id == target }) { tabs.insert(moved, at: to + (after ? 1 : 0)) }
        persist()
    }

    func openLink(_ url: URL, from id: UUID, inBackground: Bool) {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let source = tabs.first(where: { $0.id == id }) else { return }
        let child = ReaderTab(id: UUID(), title: url.host ?? url.absoluteString, kind: .web, location: url.absoluteString,
                              physicalPage: 1, reference: source.reference, sermonDateKey: source.sermonDateKey,
                              includedInReview: false, reviewInclusionConfirmed: true)
        insert(child, after: id)
        if !inBackground { select(child.id) }
        persist()
    }

    func pdfDocument(for tab: ReaderTab) -> PDFDocument? {
        guard tab.kind == .pdf else { return nil }
        return pdfDocuments[URL(fileURLWithPath: tab.location).standardizedFileURL.path]
    }

    func webSession(for tab: ReaderTab) -> ReaderWebSession? {
        guard tab.kind == .web else { return nil }
        if let session = webSessions[tab.id] { return session }
        guard let url = URL(string: tab.location) else { return nil }
        let session = ReaderWebSession(url: url, positions: tab.webPositions ?? [:])
        session.onOpenTab = { [weak self] url, background in self?.openLink(url, from: tab.id, inBackground: background) }
        session.onStateChange = { [weak self, weak session] in
            guard let self, let session, let index = self.tabs.firstIndex(where: { $0.id == tab.id }) else { return }
            self.updateWebLocation(session.currentURL.absoluteString, for: tab.id)
            if !session.title.isEmpty, self.tabs[index].title != session.title { self.tabs[index].title = session.title }
            self.schedulePagePersistence()
        }
        session.onPositionChange = { [weak self] in self?.schedulePagePersistence() }
        webSessions[tab.id] = session
        return session
    }

    func sections(for tab: ReaderTab) async -> [PDFSectionLocation] {
        guard tab.kind == .pdf else { return [] }
        let path = tab.location
        let title = tab.title
        let storedRecords = userDefaults.data(forKey: "pregar.library.records.v1")
        if let cached = pdfSections[path] { return cached }

        let task: Task<[PDFSectionLocation], Never>
        if let existing = sectionTasks[path], !existing.isCancelled {
            task = existing
        } else {
            task = Task.detached(priority: .utility) {
                guard !Task.isCancelled else { return [] }
                if let data = storedRecords,
                   let records = try? JSONDecoder().decode([PDFLibraryRecord].self, from: data),
                   let sections = records.first(where: { $0.path == path })?.sections {
                    return sections
                }
                guard !Task.isCancelled else { return [] }
                guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else { return [] }
                return PDFLibraryIndexer.sections(for: document, title: title)
            }
            sectionTasks[path] = task
        }

        let sections = await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        guard !Task.isCancelled else { return [] }
        sectionTasks[path] = nil
        pdfSections[path] = sections
        return sections
    }

    func setPage(_ page: Int, for tabID: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == tabID }), tabs[index].kind == .pdf,
              let document = pdfDocument(for: tabs[index]) else { return }
        let boundedPage = min(max(page, 1), document.pageCount)
        tabs[index].physicalPage = boundedPage
        tabs[index].navigationID = UUID()
        tabs[index].pdfPosition = nil
        pdfPositions[tabID] = nil
        schedulePagePersistence()
    }

    func setReviewInclusion(_ included: Bool, for tabID: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == tabID }) else { return }
        tabs[index].includedInReview = included
        tabs[index].reviewInclusionConfirmed = true
        persist()
    }

    func materialsMarkedForReview(sermonDateKey: String? = nil) -> [ReaderTab] {
        let date = sermonDateKey ?? activeSermonDateKey
        return tabs.filter { $0.sermonDateKey == date && $0.isIncludedForReview }
    }

    func reviewSources(for reference: String?, sermonDateKey: String? = nil) async throws -> [SermonReviewSource] {
        var sources: [SermonReviewSource] = []
        for tab in materialsMarkedForReview(sermonDateKey: sermonDateKey) {
            try Task.checkCancellation()
            switch tab.kind {
            case .pdf:
                let extracted = try await Task.detached(priority: .utility) {
                    try PDFReviewSourceExtractor.extract(tab: tab, targetReference: reference)
                }.value
                sources.append(contentsOf: extracted)
            case .web:
                guard let session = webSession(for: tab) else { throw SermonReviewMaterialError.sourceUnavailable(tab.title) }
                let page = try await session.reviewPageText()
                guard page.text.utf8.count <= PDFReviewSourceExtractor.maximumBytesPerSource else {
                    throw SermonReviewMaterialError.sourceTooLarge(tab.title)
                }
                sources.append(SermonReviewSource(
                    id: "web:\(tab.id.uuidString)",
                    title: page.title.isEmpty ? tab.title : page.title,
                    citation: page.citation,
                    text: page.text
                ))
            }
        }
        return sources
    }

    func updateWebLocation(_ location: String, for tabID: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == tabID }), tabs[index].kind == .web,
              tabs[index].location != location else { return }
        let previous = URLComponents(string: tabs[index].location).map { parts -> String? in var p = parts; p.fragment = nil; return p.string } ?? nil
        let next = URLComponents(string: location).map { parts -> String? in var p = parts; p.fragment = nil; return p.string } ?? nil
        if previous != next { tabs[index].includedInReview = false }
        tabs[index].location = location
        persist()
    }

    func flushPagePersistence() {
        for session in webSessions.values { session.captureScrollPosition() }
        persist()
    }

    func restore(archive: ReaderArchive, rememberedPages: [String: Int]) {
        pendingPagePersistence?.cancel()
        pendingPagePersistence = nil
        for session in webSessions.values {
            session.invalidate()
        }
        sectionTasks.values.forEach { $0.cancel() }
        webSessions.removeAll()
        pdfPositions.removeAll()
        pdfDocuments.removeAll()
        pdfSections.removeAll()
        sectionTasks.removeAll()

        tabs = archive.tabs.filter { tab in
            switch tab.kind {
            case .pdf:
                !tab.location.isEmpty
            case .web:
                ["https", "http"].contains(URL(string: tab.location)?.scheme?.lowercased() ?? "")
            }
        }
        activeSermonDateKey = archive.activeSermonDateKey ?? tabs.first(where: { $0.id == archive.selectedID })?.sermonDateKey
        selectedBySermon = archive.selectedBySermon ?? [:]
        closedTabs = Array((archive.closedTabs ?? []).suffix(20))
        selectedID = archive.selectedID.flatMap { selected in visibleTabs.contains(where: { $0.id == selected }) ? selected : nil }
        if selectedID == nil { selectedID = visibleTabs.last?.id }
        activeReference = selectedTab?.reference
        self.rememberedPages = rememberedPages
        persistNow()
    }

    func rememberLink(for tab: ReaderTab, section: PDFSectionLocation? = nil, startPage: Int? = nil) {
        guard let reference = tab.reference ?? section?.title else { return }
        let page = startPage ?? section?.startPage ?? tab.physicalPage
        rememberedPages[sectionLinkKey(path: tab.location, reference: reference)] = page
        if let data = try? JSONEncoder().encode(rememberedPages) {
            userDefaults.set(data, forKey: linksKey)
        }
    }

    func printedPageLabel(_ pageNumber: Int, in document: PDFDocument) -> String? {
        guard let label = document.page(at: pageNumber - 1)?.label,
              !label.isEmpty, label != String(pageNumber) else { return nil }
        return label
    }

    private func sectionLinkKey(path: String, reference: String) -> String {
        "\(path)|\(reference.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current))"
    }

    private func persist() {
        pendingPagePersistence?.cancel()
        pendingPagePersistence = nil
        persistNow()
    }

    private func schedulePagePersistence() {
        pendingPagePersistence?.cancel()
        pendingPagePersistence = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let self else { return }
            self.persistNow()
            self.pendingPagePersistence = nil
        }
    }

    private func persistNow() {
        if let selectedID { selectedBySermon[contextKey(activeSermonDateKey)] = selectedID }
        let archive = ReaderArchive(tabs: tabs.map(snapshot), selectedID: selectedID,
                                    activeSermonDateKey: activeSermonDateKey, selectedBySermon: selectedBySermon, closedTabs: closedTabs)
        if let data = try? JSONEncoder().encode(archive) {
            userDefaults.set(data, forKey: archiveKey)
        }
        if let data = try? JSONEncoder().encode(rememberedPages) {
            userDefaults.set(data, forKey: linksKey)
        }
    }
}

enum ReaderLinkGesture {
    static func opensNewTab(button: Int, modifiers: NSEvent.ModifierFlags, newWindow: Bool = false) -> Bool? {
        if button == 2 || modifiers.contains(.command) { return !modifiers.contains(.shift) }
        return newWindow ? false : nil
    }
}

@MainActor
private final class ReaderScrollMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: ReaderWebSession?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveScroll(message.body)
    }
}

@MainActor
final class ReaderWebSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published private(set) var currentURL: URL
    @Published private(set) var title = ""
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = true
    @Published private(set) var estimatedProgress = 0.0
    @Published private(set) var errorMessage: String?
    private(set) var positions: [String: ReaderWebPosition]
    var onOpenTab: ((URL, Bool) -> Void)?
    var onStateChange: (() -> Void)?
    var onPositionChange: (() -> Void)?
    let webView: WKWebView
    private var observations: [NSKeyValueObservation] = []
    private var restoreTask: Task<Void, Never>?
    private var generation = 0
    private var restoring = true
    private var invalidated = false

    init(url: URL, positions: [String: ReaderWebPosition] = [:], configuration: WKWebViewConfiguration? = nil) {
        currentURL = url
        self.positions = positions.filter { $0.value.isValid }
        let configuration = configuration ?? WKWebViewConfiguration()
        if PregarRuntime.isIsolatedTestHost { configuration.websiteDataStore = .nonPersistent() }
        let handler = ReaderScrollMessageHandler()
        configuration.userContentController.add(handler, name: "pregarScroll")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.scrollScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        handler.owner = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        observations = [
            webView.observe(\.title, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in
                    guard let self, !self.invalidated else { return }
                    let title = view.title ?? ""
                    if self.title != title { self.title = title; self.onStateChange?() }
                }
            },
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.estimatedProgress = view.estimatedProgress }
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in
                    guard let self, !self.invalidated else { return }
                    self.isLoading = view.isLoading
                }
            },
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in
                Task { @MainActor in
                    guard let self, !self.invalidated else { return }
                    self.updateNavigationState()
                }
            }
        ]
        webView.load(URLRequest(url: url))
    }

    func goBack() { captureScrollPosition(); if webView.canGoBack { isLoading = true; webView.goBack() } }
    func goForward() { captureScrollPosition(); if webView.canGoForward { isLoading = true; webView.goForward() } }
    func reload() {
        captureScrollPosition()
        isLoading = true
        if webView.reload() == nil { webView.load(URLRequest(url: currentURL)) }
    }
    func stop() { webView.stopLoading(); isLoading = false; restoring = false }
    func load(_ url: URL) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        captureScrollPosition()
        isLoading = true
        errorMessage = nil
        currentURL = url
        onStateChange?()
        webView.load(URLRequest(url: url))
    }

    func invalidate() {
        invalidated = true
        restoreTask?.cancel()
        observations.removeAll()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "pregarScroll")
        onOpenTab = nil; onStateChange = nil; onPositionChange = nil
    }

    func captureScrollPosition() {
        guard !invalidated, !isLoading, !restoring else { return }
        webView.evaluateJavaScript("window.__pregarRestoring ? null : {url:location.href,x:scrollX,y:scrollY}") { [weak self] result, _ in
            guard let self, let result else { return }
            self.receiveScroll(result)
        }
    }

    fileprivate func receiveScroll(_ body: Any) {
        guard !invalidated, !restoring, !isLoading, let body = body as? [String: Any],
              let url = body["url"] as? String, url == currentURL.absoluteString,
              let x = body["x"] as? Double, let y = body["y"] as? Double else { return }
        let position = ReaderWebPosition(x: x, y: y)
        guard position.isValid, positions[url] != position else { return }
        positions[url] = position
        if positions.count > 50, let key = positions.keys.first(where: { $0 != url }) { positions[key] = nil }
        onPositionChange?()
    }

    private static let scrollScript = """
    (() => {
      let timer;
      window.__pregarSendScroll = () => {
        if (!window.__pregarRestoring) window.webkit.messageHandlers.pregarScroll.postMessage({url:location.href,x:scrollX,y:scrollY});
      };
      addEventListener('scroll', () => { clearTimeout(timer); timer=setTimeout(window.__pregarSendScroll,100); }, {passive:true});
      addEventListener('pagehide', window.__pregarSendScroll);
    })();
    """

    private func restorePosition() {
        restoreTask?.cancel()
        guard let position = positions[currentURL.absoluteString], position.isValid else { restoring = false; return }
        let generation = generation
        restoreTask = Task { @MainActor [weak self] in
            guard let self else { return }
            _ = try? await self.webView.callAsyncJavaScript("""
                window.__pregarCancelRestore?.();
                window.__pregarRestoring=true;
                const controller=new AbortController();
                let timer, observer, finished=false;
                const finish=()=>{
                  if(finished) return; finished=true;
                  clearTimeout(timer); observer?.disconnect(); controller.abort();
                  window.__pregarRestoring=false; window.__pregarSendScroll?.();
                };
                window.__pregarCancelRestore=finish;
                ['wheel','touchstart','pointerdown','keydown'].forEach(type=>addEventListener(type,finish,{once:true,passive:true,signal:controller.signal}));
                const apply=()=>{ if(!finished) scrollTo(x,y); };
                observer=new ResizeObserver(apply); observer.observe(document.documentElement);
                timer=setTimeout(finish,1500);
                await new Promise(resolve=>requestAnimationFrame(()=>{apply();resolve();}));
                return true;
                """, arguments: ["x": position.x, "y": position.y], in: nil, contentWorld: .page)
            guard !Task.isCancelled, self.generation == generation, !self.invalidated else { return }
            self.restoring = false
        }
    }

    func reviewPageText() async throws -> (title: String, citation: String, text: String) {
        guard !isLoading else { throw SermonReviewMaterialError.pageStillLoading }
        return try await withCheckedThrowingContinuation { continuation in
            let script = """
            (() => {
              const article = document.querySelector('article') || document.querySelector('main');
              return { title: document.title || '', text: (article || document.body)?.innerText || '' };
            })()
            """
            webView.evaluateJavaScript(script) { result, error in
                if error != nil {
                    continuation.resume(throwing: SermonReviewMaterialError.pageUnavailable)
                    return
                }
                guard let value = result as? [String: Any],
                      let text = value["text"] as? String,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    continuation.resume(throwing: SermonReviewMaterialError.pageUnavailable)
                    return
                }
                var components = URLComponents(url: self.currentURL, resolvingAgainstBaseURL: false)
                components?.query = nil
                components?.fragment = nil
                let citation = components?.string ?? self.currentURL.host ?? self.currentURL.absoluteString
                continuation.resume(returning: (value["title"] as? String ?? "", citation, text))
            }
        }
    }

    private func updateNavigationState() {
        currentURL = webView.url ?? currentURL
        title = webView.title ?? title
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        onStateChange?()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateNavigationState()
        isLoading = false
        estimatedProgress = 1
        errorMessage = nil
        restorePosition()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        generation += 1
        restoreTask?.cancel()
        restoring = true
        isLoading = true
        errorMessage = nil
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { updateNavigationState() }

    private func failed(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled {
            isLoading = webView.isLoading
            if !isLoading { restoring = false }
            return
        }
        updateNavigationState()
        isLoading = false
        restoring = false
        if (error as NSError).code != NSURLErrorCancelled { errorMessage = error.localizedDescription }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isLoading = false
        errorMessage = "A página foi interrompida. Recarregue para continuar a leitura."
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if let background = ReaderLinkGesture.opensNewTab(button: action.buttonNumber, modifiers: action.modifierFlags, newWindow: action.targetFrame == nil),
           ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            onOpenTab?(url, background)
            decisionHandler(.cancel)
        } else if ["http", "https", "about"].contains(url.scheme?.lowercased() ?? "") {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            onOpenTab?(url, ReaderLinkGesture.opensNewTab(button: action.buttonNumber, modifiers: action.modifierFlags) ?? false)
        }
        return nil
    }
}

struct ReaderWindowView: View {
    @EnvironmentObject private var reader: ReaderSessionStore
    @EnvironmentObject private var appearance: AppAppearanceStore
    @Environment(\.openWindow) private var openWindow
    @State private var showingNewTab = false
    @State private var showingPageCorrection = false
    @State private var correctionPage = 1
    @State private var selectedText = ""
    @State private var pageField = "1"
    @State private var sections: [PDFSectionLocation] = []
    @State private var loadingPDFTabID: UUID?
    @State private var failedPDFTabID: UUID?
    @State private var pdfLoadRevision = 0
    @State private var showingSections = true
    @State private var showingContext = false
    @State private var addressFocusID = UUID()
    @StateObject private var pdfControls = ReaderPDFControls()

    private var tab: ReaderTab? { reader.selectedTab }
    private var document: PDFDocument? { tab.flatMap { reader.pdfDocument(for: $0) } }
    private var webSession: ReaderWebSession? { tab.flatMap { reader.webSession(for: $0) } }
    private var sectionLoadKey: String? { tab?.kind == .pdf ? tab?.location : nil }
    private var pdfLoadKey: String { "\(sectionLoadKey ?? "")|\(pdfLoadRevision)" }
    private var activeSection: PDFSectionLocation? {
        guard let tab else { return nil }
        return sections.last { $0.startPage <= tab.physicalPage }
    }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Divider()
            contextBar
            Divider()
            if let tab {
                HStack(spacing: 0) {
                    if showingSections && tab.kind == .pdf {
                        sectionSidebar(tab).frame(width: 210)
                        Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                    }
                    documentPane(tab)
                        .frame(minWidth: 300, maxWidth: .infinity, maxHeight: .infinity)
                    if showingContext {
                        Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                        locationSidebar(tab).frame(width: 300)
                    }
                }
            } else {
                emptyState
            }
        }
        .frame(minWidth: 820, minHeight: 600)
        .background(ReaderKeyboardShortcuts(handler: handleKeyboard).frame(width: 0, height: 0))
        .background(PrototypeStyle.paper)
        .onChange(of: reader.selectedID) { _, _ in
            selectedText = ""
            pageField = String(tab?.physicalPage ?? 1)
        }
        .onAppear {
            pageField = String(tab?.physicalPage ?? 1)
        }
        .onDisappear { reader.flushPagePersistence() }
        .onChange(of: tab?.physicalPage) { _, page in
            pageField = String(page ?? 1)
        }
        .onChange(of: webSession?.currentURL) { _, url in
            guard let tab, let url else { return }
            reader.updateWebLocation(url.absoluteString, for: tab.id)
        }
        .task(id: sectionLoadKey) {
            sections = []
            guard let tab, tab.kind == .pdf else { return }
            sections = await reader.sections(for: tab)
        }
        .task(id: pdfLoadKey) {
            guard let tab, tab.kind == .pdf else {
                loadingPDFTabID = nil
                failedPDFTabID = nil
                return
            }
            loadingPDFTabID = tab.id
            failedPDFTabID = nil
            let loaded = await reader.preparePDF(for: tab.location)
            guard !Task.isCancelled else { return }
            loadingPDFTabID = nil
            if loaded == nil { failedPDFTabID = tab.id }
        }
        .sheet(isPresented: $showingNewTab) {
            ReaderNewTabSheet(accent: appearance.accent) { url in
                _ = reader.openWeb(
                    title: url.host ?? url.absoluteString,
                    url: url,
                    reference: reader.activeReference,
                    sermonDateKey: reader.activeSermonDateKey
                )
            }
        }
        .sheet(isPresented: $showingPageCorrection) {
            if let tab, let document {
                PageCorrectionSheet(
                    title: tab.title,
                    accent: appearance.accent,
                    page: $correctionPage,
                    pageCount: document.pageCount
                ) { page in
                    reader.setPage(page, for: tab.id)
                    reader.rememberLink(for: tab, section: activeSection, startPage: page)
                }
            }
        }
    }

    private var contextBar: some View {
        HStack(spacing: 12) {
            Menu {
                Button("Pesquisa geral") { reader.activateSermon(nil) }
                ForEach(reader.savedSermonDates, id: \.self) { date in
                    Button(ReaderSessionStore.contextLabel(date)) { reader.activateSermon(date) }
                }
            } label: {
                Label(reader.activeSermonDateKey.map { "Pesquisa · \(ReaderSessionStore.contextLabel($0))" } ?? "Pesquisa geral", systemImage: "books.vertical")
                    .font(.system(size: 12, weight: .semibold))
            }
            .menuStyle(.borderlessButton).fixedSize()
            if let reference = reader.activeReference {
                Text(reference).font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            if tab?.kind == .pdf {
                Button { showingSections.toggle() } label: { Image(systemName: "sidebar.left") }
                    .buttonStyle(.hoverHighlight).help(showingSections ? "Ocultar seções do PDF" : "Mostrar seções do PDF")
                    .accessibilityLabel("Alternar painel de seções")
            }
            Button { showingContext.toggle() } label: { Image(systemName: "sidebar.right") }
                .buttonStyle(.hoverHighlight).help(showingContext ? "Ocultar informações do material" : "Mostrar informações e opções de revisão")
                .accessibilityLabel("Alternar informações do material")
            Menu {
                ForEach(reader.visibleTabs) { item in
                    Button { reader.select(item.id) } label: {
                        Label(item.title, systemImage: item.id == reader.selectedID ? "checkmark" : (item.kind == .pdf ? "doc.text" : "globe"))
                    }
                }
                Divider()
                Button("Reabrir aba fechada", systemImage: "arrow.uturn.backward") { reader.reopenClosedTab() }
                    .disabled(!reader.canReopenClosedTab)
            } label: { Image(systemName: "list.bullet") }
            .menuStyle(.borderlessButton).fixedSize().help("Todas as abas desta pesquisa · reabrir aba fechada")
        }
        .foregroundStyle(PrototypeStyle.ink)
        .padding(.horizontal, 15).frame(height: 34).background(PrototypeStyle.canvas)
    }

    private var tabBar: some View {
        HStack(spacing: 6) {
            Button(action: navigateBack) { Image(systemName: "chevron.left").frame(width: 28, height: 28).contentShape(Rectangle()) }
                .buttonStyle(.hoverHighlight).disabled(!canNavigateBack).keyboardShortcut("[", modifiers: .command).help("Voltar (⌘[)")
            Button(action: navigateForward) { Image(systemName: "chevron.right").frame(width: 28, height: 28).contentShape(Rectangle()) }
                .buttonStyle(.hoverHighlight).disabled(!canNavigateForward).keyboardShortcut("]", modifiers: .command).help("Avançar (⌘])")
            GeometryReader { geometry in
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: true) {
                        HStack(spacing: 4) {
                            ForEach(reader.visibleTabs) { item in
                                tabButton(item, width: ReaderTabLayout.width(available: geometry.size.width, count: reader.visibleTabs.count))
                                    .id(item.id)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .onAppear { if let id = reader.selectedID { proxy.scrollTo(id, anchor: .center) } }
                    .onChange(of: reader.selectedID) { _, id in if let id { proxy.scrollTo(id, anchor: .center) } }
                    .onChange(of: reader.visibleTabs.map(\.id)) { _, _ in if let id = reader.selectedID { proxy.scrollTo(id, anchor: .center) } }
                    .onChange(of: geometry.size.width) { _, _ in if let id = reader.selectedID { proxy.scrollTo(id, anchor: .center) } }
                    .task { await Task.yield(); if let id = reader.selectedID { proxy.scrollTo(id, anchor: .center) } }
                }
            }
            .frame(height: 44)
            Button { showingNewTab = true } label: { Image(systemName: "plus").frame(width: 28, height: 30).contentShape(Rectangle()) }
                .buttonStyle(.hoverHighlight).keyboardShortcut("t", modifiers: .command).help("Nova aba (⌘T)")
            Button(action: copyWithSource) { Image(systemName: "doc.on.doc").frame(width: 28, height: 30) }
                .buttonStyle(.hoverHighlight).disabled(tab == nil).help("Copiar seleção com a origem")
        }
        .padding(.leading, PrototypeStyle.Layout.windowControlsInset)
        .padding(.trailing, 12).frame(height: PrototypeStyle.Layout.headerHeight).background(PrototypeStyle.canvas)
    }

    private func tabButton(_ item: ReaderTab, width: CGFloat) -> some View {
        HStack(spacing: 0) {
            Button { reader.select(item.id) } label: {
                HStack(spacing: 6) {
                    Image(systemName: item.kind == .pdf ? "doc.text" : "globe").font(.system(size: 12))
                    Text(item.title).lineLimit(1).truncationMode(.tail)
                }
                .font(.system(size: 12, weight: item.id == reader.selectedID ? .semibold : .regular))
                .foregroundStyle(item.id == reader.selectedID ? PrototypeStyle.ink : PrototypeStyle.muted)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(Rectangle()).padding(.leading, 9)
            }
            .buttonStyle(.plain)
            Button { reader.close(item.id) } label: { Image(systemName: "xmark").font(.system(size: 10)).frame(width: 22, height: 24).contentShape(Rectangle()) }
                .buttonStyle(.hoverHighlight(cornerRadius: 5)).help("Fechar aba (⌘W ou botão do meio)").accessibilityLabel("Fechar \(item.title)")
        }
        .frame(width: width)
        .background(item.id == reader.selectedID ? PrototypeStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 7))
        .help(item.title + (item.kind == .pdf ? " · página \(item.physicalPage)" : " · \(item.location)"))
        .readerTabGesture(includeCommandClick: false) { _ in reader.close(item.id) }
        .onDrag { NSItemProvider(object: item.id.uuidString as NSString) }
        .onDrop(of: [.text], delegate: ReaderTabDropDelegate(reader: reader, target: item.id, width: width))
        .contextMenu {
            Button("Duplicar aba") { reader.duplicate(item.id) }
            Button("Fechar aba") { reader.close(item.id) }
            Button("Fechar outras abas") { reader.closeOtherTabs(keeping: item.id) }.disabled(reader.visibleTabs.count < 2)
            Button("Fechar abas à direita") { reader.closeOtherTabs(keeping: item.id, toRightOnly: true) }
            Divider()
            Button("Reabrir aba fechada") { reader.reopenClosedTab() }.disabled(!reader.canReopenClosedTab)
        }
    }

    private func handleKeyboard(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .control, .option])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        if event.keyCode == 48 && (flags == [.control] || flags == [.control, .shift]) {
            reader.selectRelative(flags.contains(.shift) ? -1 : 1); return true
        }
        if flags == [.command, .shift], key == "t" { reader.reopenClosedTab(); return true }
        guard flags == [.command] else { return false }
        switch key {
        case "w": guard let tab else { return false }; reader.close(tab.id); return true
        case "l": guard tab?.kind == .web else { return false }; addressFocusID = UUID(); return true
        case "r": guard let webSession else { return false }; webSession.reload(); return true
        case "+", "=": guard tab?.kind == .pdf else { return false }; pdfControls.zoom(1.2); return true
        case "-": guard tab?.kind == .pdf else { return false }; pdfControls.zoom(1 / 1.2); return true
        default: return false
        }
    }

    @ViewBuilder
    private func sectionSidebar(_ tab: ReaderTab) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            if tab.kind == .pdf {
                Text(tab.title).font(PrototypeStyle.serif(17, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Text(pdfMetadata(for: tab))
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                SectionLabel("Seções desta obra")
                    .padding(.top, 5)
                ScrollView {
                    LazyVStack(spacing: 3) {
                        ForEach(sections) { section in
                            Button {
                                reader.setPage(section.startPage, for: tab.id)
                                selectedText = ""
                            } label: {
                                HStack(spacing: 8) {
                                    Text(section.title).lineLimit(2).multilineTextAlignment(.leading)
                                    Spacer(minLength: 4)
                                    Text(document.flatMap { reader.printedPageLabel(section.startPage, in: $0) } ?? String(section.startPage))
                                        .monospacedDigit().foregroundStyle(PrototypeStyle.muted)
                                }
                                .font(.system(size: 12, weight: section.id == activeSection?.id ? .semibold : .regular))
                                .foregroundStyle(PrototypeStyle.ink)
                                .padding(.horizontal, 10).padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(section.id == activeSection?.id ? PrototypeStyle.softAccent(appearance.accent) : .clear, in: RoundedRectangle(cornerRadius: 7))
                            }
                            .buttonStyle(.hoverHighlight)
                            .readerTabGesture { background in reader.openPDFTab(page: section.startPage, from: tab.id, inBackground: background) }
                            .contextMenu { Button("Abrir seção em nova aba") { reader.openPDFTab(page: section.startPage, from: tab.id, inBackground: false) } }
                        }
                    }
                }
            } else {
                Text(tab.title).font(PrototypeStyle.serif(19, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                SectionLabel("Leitura web")
                Text(webSession?.currentURL.host ?? tab.location)
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    .textSelection(.enabled)
                if let reference = tab.reference {
                    SectionLabel("Passagem da preparação")
                    Text(reference).font(PrototypeStyle.serif(14)).foregroundStyle(PrototypeStyle.ink)
                }
                Spacer()
            }
        }
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(PrototypeStyle.paper)
    }

    @ViewBuilder
    private func documentPane(_ tab: ReaderTab) -> some View {
        if tab.kind == .pdf {
            if let document {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text("Página física").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        TextField("1", text: $pageField)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 58)
                            .accessibilityLabel("Página física do PDF")
                            .help("Posição da página no arquivo. A numeração impressa pode ser diferente. Pressione Enter ou clique em Ir.")
                            .onSubmit { commitPageField(document, tab: tab) }
                        Button("Ir") { commitPageField(document, tab: tab) }
                            .buttonStyle(.secondaryAction)
                            .help("Ir para a página física informada")
                        Text("de \(document.pageCount)")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        if let printed = reader.printedPageLabel(tab.physicalPage, in: document) {
                            Text("impressa \(printed)").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        }
                        Spacer()
                        Button { pdfControls.zoom(1 / 1.2) } label: { Image(systemName: "minus.magnifyingglass") }.buttonStyle(.hoverHighlight).help("Diminuir zoom (⌘−)")
                        Button { pdfControls.fit() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.buttonStyle(.hoverHighlight).help("Ajustar página à janela")
                        Button { pdfControls.zoom(1.2) } label: { Image(systemName: "plus.magnifyingglass") }.buttonStyle(.hoverHighlight).help("Aumentar zoom (⌘+)")
                        if let activeSection {
                            Label(tab.reference == nil ? activeSection.title : "Mesma passagem · seção \(activeSection.title)", systemImage: "text.book.closed")
                                .font(.system(size: 11, weight: .medium)).foregroundStyle(appearance.accent)
                                .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 15).frame(height: 47).background(PrototypeStyle.canvas)
                    Divider()
                    ReaderPDFView(
                        document: document,
                        pageNumber: tab.physicalPage,
                        position: reader.pdfPosition(for: tab), navigationID: tab.navigationID,
                        onPositionChange: { reader.recordPDFPosition($0, for: tab.id) },
                        onOpenURL: { reader.openLink($0, from: tab.id, inBackground: $1) },
                        onOpenDestination: { reader.openPDFTab(page: $0.page, position: $0, from: tab.id, inBackground: $1) },
                        onReady: { pdfControls.view = $0 },
                        onPageChange: { reader.recordPDFPage($0, for: tab.id) },
                        onSelectionChange: { selectedText = $0 }
                    )
                    .id(tab.id)
                    .background(Color(red: 0.49, green: 0.48, blue: 0.45))
                }
            } else if failedPDFTabID == tab.id {
                ContentUnavailableView {
                    Label("PDF indisponível", systemImage: "doc.questionmark")
                } description: {
                    Text("O arquivo não pôde ser aberto. Confira se ele ainda está disponível neste Mac.")
                } actions: {
                    Button("Tentar novamente", systemImage: "arrow.clockwise") { pdfLoadRevision += 1 }
                        .buttonStyle(.secondaryAction)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 9) {
                    ProgressView()
                    Text(loadingPDFTabID == tab.id ? "Abrindo PDF…" : "Preparando PDF…")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if tab.kind == .web, let session = reader.webSession(for: tab) {
            ReaderWebDocumentPane(session: session, focusRequest: addressFocusID).id(tab.id)
        } else {
            ContentUnavailableView("Não foi possível abrir o material", systemImage: "doc.questionmark")
        }
    }

    private func locationSidebar(_ tab: ReaderTab) -> some View {
        VStack(alignment: .leading, spacing: 15) {
            if tab.kind == .pdf {
                HStack {
                    SectionLabel("Onde está")
                    Rectangle().fill(PrototypeStyle.line).frame(height: 1)
                }
                if let section = activeSection {
                    locationRow("Páginas", value: pageRange(section, document: document))
                    locationRow("Achado por", value: section.findingMethodLabel)
                    locationRow("Confiança", value: section.confidenceLabel, green: section.hasHighConfidence)
                } else {
                    Text("Nenhuma seção foi detectada neste ponto do PDF.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button("Corrigir página inicial", systemImage: "pencil") {
                    correctionPage = activeSection?.startPage ?? tab.physicalPage
                    showingPageCorrection = true
                }
                .buttonStyle(.secondaryAction)
                .disabled(document == nil)
                Button("Lembrar este vínculo", systemImage: "bookmark") {
                    reader.rememberLink(for: tab, section: activeSection)
                }
                .buttonStyle(.secondaryAction)
            } else {
                HStack {
                    SectionLabel("Onde está")
                    Rectangle().fill(PrototypeStyle.line).frame(height: 1)
                }
                locationRow("Endereço", value: webSession?.currentURL.absoluteString ?? tab.location)
                locationRow("Site", value: webSession?.currentURL.host ?? "")
                Button("Lembrar este vínculo", systemImage: "bookmark") {
                    reader.rememberLink(for: tab)
                }
                .buttonStyle(.secondaryAction)
            }

            Divider().overlay(PrototypeStyle.line)
            HStack {
                SectionLabel("Para a revisão")
                Rectangle().fill(PrototypeStyle.line).frame(height: 1)
            }
            if let section = activeSection {
                Text("Trecho da seção (física \(section.startPage)) até antes da próxima seção (física \(section.endPage + 1)).")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(tab.kind == .pdf ? "Selecione uma seção para delimitar o material." : "A página atual será usada como referência da fonte.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            }
            Toggle("Incluído", isOn: Binding(
                get: { reader.selectedTab?.isIncludedForReview ?? false },
                set: { reader.setReviewInclusion($0, for: tab.id) }
            ))
            .font(.system(size: 13))
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(PrototypeStyle.paper)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Nenhuma aba aberta", systemImage: "book.pages")
        } description: {
            Text("Abra um PDF da Biblioteca ou adicione uma página web.")
        } actions: {
            HStack {
                Button("Nova aba", systemImage: "plus") { showingNewTab = true }
                    .buttonStyle(.primaryAction(appearance.accent))
                Button("Biblioteca de PDFs", systemImage: "books.vertical") { openWindow(id: "library") }
                    .buttonStyle(.secondaryAction)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var canNavigateBack: Bool {
        guard let tab else { return false }
        if let session = webSession { return session.canGoBack }
        return tab.physicalPage > 1
    }

    private var canNavigateForward: Bool {
        guard let tab else { return false }
        if let session = webSession { return session.canGoForward }
        return tab.physicalPage < (document?.pageCount ?? 1)
    }

    private func navigateBack() {
        guard let tab else { return }
        if let session = reader.webSession(for: tab) { session.goBack() }
        else { reader.setPage(tab.physicalPage - 1, for: tab.id) }
    }

    private func navigateForward() {
        guard let tab else { return }
        if let session = reader.webSession(for: tab) { session.goForward() }
        else { reader.setPage(tab.physicalPage + 1, for: tab.id) }
    }

    private func commitPageField(_ document: PDFDocument, tab: ReaderTab) {
        guard let page = Int(pageField) else {
            pageField = String(tab.physicalPage)
            return
        }
        let boundedPage = min(max(page, 1), document.pageCount)
        pageField = String(boundedPage)
        reader.setPage(boundedPage, for: tab.id)
    }

    private func pageRange(_ section: PDFSectionLocation, document: PDFDocument?) -> String {
        let printStart = document.flatMap { reader.printedPageLabel(section.startPage, in: $0) }
        let printEnd = document.flatMap { reader.printedPageLabel(section.endPage, in: $0) }
        let physical = section.startPage == section.endPage ? "física \(section.startPage)" : "físicas \(section.startPage)–\(section.endPage)"
        guard let printStart, let printEnd else { return physical }
        return "\(physical) · impressas \(printStart)–\(printEnd)"
    }

    private func pdfMetadata(for tab: ReaderTab) -> String {
        guard let document = reader.pdfDocument(for: tab) else { return "PDF local" }
        let author = document.documentAttributes?[PDFDocumentAttribute.authorAttribute] as? String
        return [author, "\(document.pageCount) páginas físicas"].compactMap { $0 }.joined(separator: " · ")
    }

    private func locationRow(_ label: String, value: String, green: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(PrototypeStyle.muted).frame(width: 76, alignment: .leading)
            Text(value).foregroundStyle(green ? appearance.accent : PrototypeStyle.ink)
                .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }
        .font(.system(size: 12))
    }

    private func copyWithSource() {
        guard let tab else { return }
        if tab.kind == .web, let webView = webSession?.webView {
            webView.evaluateJavaScript("window.getSelection().toString()") { value, _ in
                guard let text = value as? String else { return }
                copy(text, source: webSession?.currentURL.absoluteString ?? tab.location)
            }
        } else {
            copy(selectedText, source: "\(tab.title), página física \(tab.physicalPage)")
        }
    }

    private func copy(_ text: String, source: String) {
        let passage = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !passage.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("\(passage)\n\n— \(source)", forType: .string)
    }
}

struct ReaderPDFView: NSViewRepresentable {
    let document: PDFDocument
    let pageNumber: Int
    var position: ReaderPDFPosition? = nil
    var navigationID: UUID? = nil
    var onPositionChange: (ReaderPDFPosition) -> Void = { _ in }
    var onOpenURL: (URL, Bool) -> Void = { _, _ in }
    var onOpenDestination: (ReaderPDFPosition, Bool) -> Void = { _, _ in }
    var onReady: (ReaderPDFNavigationView) -> Void = { _ in }
    let onPageChange: (Int) -> Void
    let onSelectionChange: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> ReaderPDFNavigationView {
        let view = ReaderPDFNavigationView()
        view.autoScales = true
        view.minScaleFactor = 0.1
        view.maxScaleFactor = 8
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.onLayout = { [weak coordinator = context.coordinator, weak view] in
            guard let view else { return }
            coordinator?.observeScrolling(in: view)
            coordinator?.scheduleNavigation(in: view)
        }
        let coordinator = context.coordinator
        coordinator.observers = [
            NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator, weak view] _ in
                Task { @MainActor in if let view { coordinator?.publishPage(in: view); coordinator?.schedulePosition(in: view) } }
            },
            NotificationCenter.default.addObserver(forName: .PDFViewScaleChanged, object: view, queue: .main) { [weak coordinator, weak view] _ in
                Task { @MainActor in if let view { coordinator?.schedulePosition(in: view) } }
            },
            NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak coordinator, weak view] _ in
                Task { @MainActor in if let view { coordinator?.onSelectionChange?(view.currentSelection?.string ?? "") } }
            }
        ]
        updateNSView(view, context: context)
        onReady(view)
        return view
    }

    func updateNSView(_ view: ReaderPDFNavigationView, context: Context) {
        context.coordinator.onPageChange = onPageChange
        context.coordinator.onSelectionChange = onSelectionChange
        context.coordinator.onPositionChange = onPositionChange
        view.onOpenURL = onOpenURL
        view.onOpenDestination = onOpenDestination
        context.coordinator.update(view, document: document, page: pageNumber, position: position, navigationID: navigationID)
    }

    static func dismantleNSView(_ view: ReaderPDFNavigationView, coordinator: Coordinator) {
        coordinator.publishPosition(in: view)
        view.onLayout = nil
        view.onOpenURL = nil
        view.onOpenDestination = nil
        coordinator.navigationTask?.cancel()
        coordinator.positionTask?.cancel()
        coordinator.observers.forEach { NotificationCenter.default.removeObserver($0) }
        if let observer = coordinator.scrollObserver { NotificationCenter.default.removeObserver(observer) }
        coordinator.onPageChange = nil
        coordinator.onSelectionChange = nil
        coordinator.onPositionChange = nil
    }

    @MainActor
    final class Coordinator {
        var observers: [NSObjectProtocol] = []
        var scrollObserver: NSObjectProtocol?
        private weak var observedClip: NSClipView?
        var onPageChange: ((Int) -> Void)?
        var onSelectionChange: ((String) -> Void)?
        var onPositionChange: ((ReaderPDFPosition) -> Void)?
        var navigationTask: Task<Void, Never>?
        var positionTask: Task<Void, Never>?
        private var lastRequestedPage: Int?
        private var lastPublishedPage: Int?
        private var lastNavigationID: UUID?
        private var pendingPage: Int?
        private var pendingPosition: ReaderPDFPosition?

        func update(_ view: ReaderPDFNavigationView, document: PDFDocument, page: Int, position: ReaderPDFPosition?, navigationID: UUID?) {
            let target = min(max(page, 1), document.pageCount)
            let documentChanged = view.document !== document
            let explicitNavigation = navigationID != lastNavigationID
            let pageChanged = lastRequestedPage != target
            lastRequestedPage = target
            lastNavigationID = navigationID
            if documentChanged || explicitNavigation || (pageChanged && lastPublishedPage != target) {
                navigationTask?.cancel()
                navigationTask = nil
                pendingPage = target
                pendingPosition = documentChanged && position?.isValid == true && position?.page == target ? position : nil
                if documentChanged { view.document = document }
                if !documentChanged, !explicitNavigation, let current = view.currentPage, document.index(for: current) + 1 == target { pendingPage = nil }
                view.needsLayout = true
            }
            observeScrolling(in: view)
            scheduleNavigation(in: view)
        }

        func observeScrolling(in view: PDFView) {
            guard let clip = view.documentView?.enclosingScrollView?.contentView, clip !== observedClip else { return }
            if let scrollObserver { NotificationCenter.default.removeObserver(scrollObserver) }
            observedClip = clip
            clip.postsBoundsChangedNotifications = true
            scrollObserver = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification, object: clip, queue: .main) { [weak self, weak view] _ in
                Task { @MainActor in if let view { self?.schedulePosition(in: view) } }
            }
        }

        func scheduleNavigation(in view: ReaderPDFNavigationView) {
            guard pendingPage != nil, navigationTask == nil, view.window != nil, view.bounds.width > 0, view.bounds.height > 0 else { return }
            navigationTask = Task { @MainActor [weak self, weak view] in
                guard !Task.isCancelled, let self, let view, let target = self.pendingPage else { return }
                if let saved = self.pendingPosition {
                    view.autoScales = saved.autoScales
                    if !saved.autoScales { view.scaleFactor = min(view.maxScaleFactor, max(view.minScaleFactor, saved.scale)) }
                }
                view.layoutSubtreeIfNeeded()
                view.layoutDocumentView()
                if let page = view.document?.page(at: target - 1) {
                    if let saved = self.pendingPosition { view.go(to: PDFDestination(page: page, at: NSPoint(x: saved.x, y: saved.y))) }
                    else { view.go(to: page) }
                }
                self.pendingPosition = nil
                self.pendingPage = nil
                self.navigationTask = nil
                self.observeScrolling(in: view)
            }
        }

        func schedulePosition(in view: PDFView) {
            guard pendingPage == nil else { return }
            positionTask?.cancel()
            positionTask = Task { @MainActor [weak self, weak view] in
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
                if let view { self?.publishPosition(in: view) }
            }
        }

        func publishPosition(in view: PDFView) {
            guard pendingPage == nil, view.window != nil, let document = view.document, let destination = view.currentDestination, let page = destination.page else { return }
            let index = document.index(for: page)
            guard (0..<document.pageCount).contains(index) else { return }
            let point = destination.point
            let position = ReaderPDFPosition(page: index + 1, x: point.x, y: point.y, scale: view.scaleFactor, autoScales: view.autoScales)
            guard position.isValid else { return }
            lastPublishedPage = position.page
            onPositionChange?(position)
        }

        func publishPage(in view: PDFView) {
            guard pendingPage == nil, view.window != nil, let document = view.document, let current = view.currentPage else { return }
            let index = document.index(for: current)
            guard (0..<document.pageCount).contains(index) else { return }
            lastPublishedPage = index + 1
            onPageChange?(index + 1)
        }
    }
}

final class ReaderPDFNavigationView: PDFView {
    var onLayout: (() -> Void)?
    var onOpenURL: ((URL, Bool) -> Void)?
    var onOpenDestination: ((ReaderPDFPosition, Bool) -> Void)?
    private var mouseMonitor: Any?

    override func layout() { super.layout(); onLayout?() }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
        mouseMonitor = nil
        if window != nil {
            mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: [.otherMouseDown, .otherMouseUp]) { [weak self] event in
                guard let self, let window = self.window, event.window === window, event.buttonNumber == 2,
                      self.link(at: self.localPoint(for: event)) != nil else { return event }
                if event.type == .otherMouseUp { self.otherMouseUp(with: event) }
                return nil
            }
        }
        onLayout?()
    }
    private func localPoint(for event: NSEvent) -> NSPoint {
        let point = event.window == nil ? (window?.convertPoint(fromScreen: event.locationInWindow) ?? event.locationInWindow) : event.locationInWindow
        return convert(point, from: nil)
    }
    private func link(at point: NSPoint) -> PDFAnnotation? {
        guard bounds.contains(point), let page = page(for: point, nearest: false) else { return nil }
        return page.annotation(at: convert(point, to: page))
    }
    override func perform(_ action: PDFAction) {
        if let action = action as? PDFActionURL, let url = action.url { onOpenURL?(url, false) }
        else { super.perform(action) }
    }
    override func otherMouseDown(with event: NSEvent) {
        if event.buttonNumber != 2 { super.otherMouseDown(with: event) }
    }
    override func otherMouseUp(with event: NSEvent) {
        guard event.buttonNumber == 2 else { super.otherMouseUp(with: event); return }
        guard let annotation = link(at: localPoint(for: event)) else { return }
        let background = !event.modifierFlags.contains(.shift)
        if let action = annotation.action as? PDFActionURL, let url = action.url { onOpenURL?(url, background) }
        else if let destination = (annotation.action as? PDFActionGoTo)?.destination, let page = destination.page, let document {
            onOpenDestination?(ReaderPDFPosition(page: document.index(for: page) + 1, x: destination.point.x, y: destination.point.y, scale: scaleFactor, autoScales: autoScales), background)
        }
    }
}

@MainActor
final class ReaderPDFControls: ObservableObject {
    weak var view: ReaderPDFNavigationView?
    func zoom(_ multiplier: CGFloat) {
        guard let view else { return }
        view.autoScales = false
        view.scaleFactor = min(view.maxScaleFactor, max(view.minScaleFactor, view.scaleFactor * multiplier))
    }
    func fit() { view?.autoScales = true }
}

struct ReaderSermonContextBinder: View {
    @EnvironmentObject private var reader: ReaderSessionStore
    let dateKey: String
    let reference: String?
    var body: some View {
        Color.clear.onAppear(perform: update)
            .onChange(of: dateKey) { _, _ in update() }
            .onChange(of: reference) { _, _ in update() }
    }
    private func update() {
        guard !PregarRuntime.isIsolatedTestHost else { return }
        reader.activateSermon(dateKey, reference: reference)
        reader.updateActiveReference(reference)
    }
}

enum ReaderTabLayout {
    static func width(available: CGFloat, count: Int) -> CGFloat {
        guard count > 0 else { return 220 }
        return min(220, max(108, (available - CGFloat(count - 1) * 4) / CGFloat(count)))
    }
}

private struct ReaderTabDropDelegate: DropDelegate {
    let reader: ReaderSessionStore
    let target: UUID
    let width: CGFloat
    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [.text]).first else { return false }
        let after = info.location.x > width / 2
        _ = provider.loadObject(ofClass: NSString.self) { value, _ in
            guard let string = value as? String, let id = UUID(uuidString: string) else { return }
            Task { @MainActor in reader.move(id, relativeTo: target, after: after) }
        }
        return true
    }
}

private struct ReaderTabGesture: NSViewRepresentable {
    var enabled: Bool
    var includeCommandClick: Bool
    var action: (Bool) -> Void
    func makeNSView(context: Context) -> ReaderTabGestureView { ReaderTabGestureView() }
    func updateNSView(_ view: ReaderTabGestureView, context: Context) {
        view.includeCommandClick = includeCommandClick
        view.enabled = enabled
        view.action = action
    }
}

final class ReaderTabGestureView: NSView {
    var enabled = true
    var includeCommandClick = true
    var action: ((Bool) -> Void)?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard enabled, let event = NSApp.currentEvent else { return nil }
        let middle = [.otherMouseDown, .otherMouseUp].contains(event.type) && event.buttonNumber == 2
        let command = includeCommandClick && [.leftMouseDown, .leftMouseUp].contains(event.type) && event.modifierFlags.contains(.command)
        return middle || command ? super.hitTest(point) : nil
    }
    override func otherMouseDown(with event: NSEvent) {}
    override func mouseDown(with event: NSEvent) {}
    override func otherMouseUp(with event: NSEvent) {
        if event.buttonNumber == 2, bounds.contains(convert(event.locationInWindow, from: nil)) { action?(!event.modifierFlags.contains(.shift)) }
    }
    override func mouseUp(with event: NSEvent) {
        if includeCommandClick, event.modifierFlags.contains(.command), bounds.contains(convert(event.locationInWindow, from: nil)) { action?(!event.modifierFlags.contains(.shift)) }
    }
}

extension View {
    func readerTabGesture(enabled: Bool = true, includeCommandClick: Bool = true, action: @escaping (Bool) -> Void) -> some View {
        overlay(ReaderTabGesture(enabled: enabled, includeCommandClick: includeCommandClick, action: action))
    }
}

private struct ReaderKeyboardShortcuts: NSViewRepresentable {
    let handler: (NSEvent) -> Bool
    func makeNSView(context: Context) -> ReaderKeyboardView { ReaderKeyboardView() }
    func updateNSView(_ view: ReaderKeyboardView, context: Context) { view.handler = handler }
    static func dismantleNSView(_ view: ReaderKeyboardView, coordinator: ()) { view.removeMonitor() }
}

private final class ReaderKeyboardView: NSView {
    var handler: ((NSEvent) -> Bool)?
    private var monitor: Any?
    func removeMonitor() { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        removeMonitor()
        guard window != nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let window = self.window, window.isKeyWindow, event.window === window, window.attachedSheet == nil else { return event }
            return self.handler?(event) == true ? nil : event
        }
    }
}

enum ReaderWebAddress {
    static func url(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let value = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host, !host.isEmpty else { return nil }
        return url
    }
}

private struct ReaderWebDocumentPane: View {
    @ObservedObject var session: ReaderWebSession
    let focusRequest: UUID
    @State private var address = ""
    @State private var invalidAddress = false
    @FocusState private var addressFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Button {
                    if session.isLoading { session.stop() } else { session.reload() }
                } label: { Image(systemName: session.isLoading ? "xmark" : "arrow.clockwise").frame(width: 24, height: 24) }
                .buttonStyle(.hoverHighlight).help(session.isLoading ? "Interromper carregamento" : "Recarregar (⌘R)")
                TextField("Endereço do site", text: $address)
                    .font(.system(size: 12)).textFieldStyle(.roundedBorder).focused($addressFocused)
                    .accessibilityLabel("Endereço do site (⌘L)")
                    .onSubmit {
                        guard let url = ReaderWebAddress.url(from: address) else { invalidAddress = true; return }
                        invalidAddress = false; addressFocused = false; session.load(url)
                    }
                    .onExitCommand { address = session.currentURL.absoluteString; invalidAddress = false; addressFocused = false }
                Button { NSWorkspace.shared.open(session.currentURL) } label: { Image(systemName: "arrow.up.right.square").frame(width: 24, height: 24) }
                    .buttonStyle(.hoverHighlight).help("Abrir esta página no navegador padrão")
            }
            .padding(.horizontal, 12).frame(height: 41).background(PrototypeStyle.canvas)
            ProgressView(value: session.estimatedProgress).progressViewStyle(.linear).frame(height: 2).opacity(session.isLoading ? 1 : 0)
            if invalidAddress { Text("Informe um endereço http ou https válido.").font(.system(size: 11)).foregroundStyle(.red).padding(6) }
            ZStack {
                ReaderWebView(session: session)
                if let error = session.errorMessage {
                    ContentUnavailableView {
                        Label("Não foi possível carregar a página", systemImage: "wifi.exclamationmark")
                    } description: { Text(error) } actions: {
                        Button("Tentar novamente") { session.reload() }.buttonStyle(.secondaryAction)
                    }
                    .background(PrototypeStyle.paper)
                }
            }
        }
        .onAppear { address = session.currentURL.absoluteString }
        .onChange(of: session.currentURL) { _, url in if !addressFocused { address = url.absoluteString } }
        .onChange(of: focusRequest) { _, _ in
            address = session.currentURL.absoluteString; addressFocused = true
            weak var window = session.webView.window
            DispatchQueue.main.async {
                if window?.isKeyWindow == true, let editor = window?.firstResponder as? NSTextView, editor.isFieldEditor { editor.selectAll(nil) }
            }
        }
    }
}

private struct ReaderWebView: NSViewRepresentable {
    @ObservedObject var session: ReaderWebSession

    func makeNSView(context: Context) -> WKWebView { session.webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
    static func dismantleNSView(_ view: WKWebView, coordinator: ()) {
        view.evaluateJavaScript("window.__pregarSendScroll?.()", completionHandler: nil)
    }
}

private struct ReaderNewTabSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var address = "https://"
    @State private var errorMessage: String?
    let accent: Color
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetHeader(
                title: "Nova aba",
                subtitle: "Abra um artigo ou site no Leitor, ao lado dos PDFs da Biblioteca.",
                symbol: "globe",
                accent: accent
            )
            TextField("Endereço web", text: $address)
                .textFieldStyle(.roundedBorder).onSubmit(add)
            if let errorMessage { Text(errorMessage).font(.system(size: 12)).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.buttonStyle(.secondaryAction).keyboardShortcut(.cancelAction)
                Button("Abrir", systemImage: "arrow.right", action: add)
                    .buttonStyle(.primaryAction(accent))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 500)
        .background(PrototypeStyle.canvas)
    }

    private func add() {
        let raw = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = raw.contains("://") ? raw : "https://\(raw)"
        guard let url = URL(string: normalized), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
            errorMessage = "Informe um endereço http ou https válido."
            return
        }
        open(url)
        dismiss()
    }
}

private struct PageCorrectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let accent: Color
    @Binding var page: Int
    let pageCount: Int
    let save: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetHeader(
                title: "Corrigir página inicial",
                subtitle: title,
                symbol: "pencil",
                accent: accent
            )
            Stepper(value: $page, in: 1...max(pageCount, 1)) {
                Text("Página física \(page) de \(pageCount)").monospacedDigit()
            }
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.buttonStyle(.secondaryAction).keyboardShortcut(.cancelAction)
                Button("Salvar") { save(page); dismiss() }
                    .buttonStyle(.primaryAction(accent))
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 500)
        .background(PrototypeStyle.canvas)
    }
}
