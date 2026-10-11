import AppKit
import PDFKit
import SwiftUI
import WebKit

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

    var isIncludedForReview: Bool { includedInReview && reviewInclusionConfirmed == true }

    static func countMarkedForReview(in tabs: [ReaderTab], reference: String?, sermonDateKey: String?) -> Int {
        guard let reference, let sermonDateKey else { return 0 }
        return tabs.filter {
            $0.isIncludedForReview && $0.reference == reference && $0.sermonDateKey == sermonDateKey
        }.count
    }
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

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        if let data = userDefaults.data(forKey: archiveKey),
           let archive = try? JSONDecoder().decode(ReaderArchive.self, from: data) {
            tabs = archive.tabs.filter { tab in
                switch tab.kind {
                case .pdf:
                    return FileManager.default.fileExists(atPath: tab.location)
                case .web:
                    return URL(string: tab.location)?.scheme == "https" || URL(string: tab.location)?.scheme == "http"
                }
            }
            selectedID = archive.selectedID.flatMap { id in tabs.contains(where: { $0.id == id }) ? id : nil }
        }
        if let data = userDefaults.data(forKey: linksKey),
           let links = try? JSONDecoder().decode([String: Int].self, from: data) {
            rememberedPages = links
        }
        if selectedID == nil { selectedID = tabs.last?.id }
    }

    var selectedTab: ReaderTab? { tabs.first { $0.id == selectedID } }

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
        guard tabs.contains(where: { $0.id == id }) else { return }
        selectedID = id
        persist()
    }

    func openPDF(
        title: String,
        path: String,
        page: Int = 1,
        reference: String? = nil,
        sermonDateKey: String? = nil,
        indexedSections: [PDFSectionLocation]? = nil
    ) async -> Bool {
        guard let document = await preparePDF(for: path) else { return false }
        return registerPDF(
            title: title,
            location: URL(fileURLWithPath: path).standardizedFileURL.path,
            page: page,
            reference: reference,
            sermonDateKey: sermonDateKey,
            indexedSections: indexedSections,
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
        document: PDFDocument
    ) -> Bool {
        if let indexedSections { pdfSections[location] = indexedSections }

        if let index = tabs.firstIndex(where: { $0.kind == .pdf && $0.location == location }) {
            tabs[index].title = title
            tabs[index].reference = reference
            tabs[index].sermonDateKey = sermonDateKey
            let remembered = reference.flatMap { rememberedPages[sectionLinkKey(path: location, reference: $0)] }
            tabs[index].physicalPage = min(max(remembered ?? page, 1), document.pageCount)
            selectedID = tabs[index].id
        } else {
            let remembered = reference.flatMap { rememberedPages[sectionLinkKey(path: location, reference: $0)] }
            let tab = ReaderTab(
                id: UUID(), title: title, kind: .pdf, location: location,
                physicalPage: min(max(remembered ?? page, 1), document.pageCount),
                reference: reference, sermonDateKey: sermonDateKey,
                includedInReview: false, reviewInclusionConfirmed: true
            )
            tabs.append(tab)
            selectedID = tab.id
        }
        persist()
        return true
    }

    @discardableResult
    func openWeb(title: String, url: URL, reference: String? = nil, sermonDateKey: String? = nil) -> Bool {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return false }
        let address = url.absoluteString
        if let existing = tabs.first(where: { $0.kind == .web && $0.location == address }) {
            if let index = tabs.firstIndex(where: { $0.id == existing.id }) {
                tabs[index].title = title
                tabs[index].reference = reference
                tabs[index].sermonDateKey = sermonDateKey
            }
            selectedID = existing.id
        } else {
            let tab = ReaderTab(
                id: UUID(), title: title, kind: .web, location: address,
                physicalPage: 1, reference: reference, sermonDateKey: sermonDateKey,
                includedInReview: false, reviewInclusionConfirmed: true
            )
            tabs.append(tab)
            selectedID = tab.id
        }
        persist()
        return true
    }

    func close(_ id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closed = tabs.remove(at: index)
        switch closed.kind {
        case .pdf:
            pdfDocuments[closed.location] = nil
            pdfSections[closed.location] = nil
            sectionTasks[closed.location]?.cancel()
            sectionTasks[closed.location] = nil
        case .web:
            webSessions[id]?.webView.stopLoading()
            webSessions[id]?.webView.navigationDelegate = nil
            webSessions[id] = nil
        }
        if selectedID == id {
            selectedID = tabs.isEmpty ? nil : tabs[min(index, tabs.count - 1)].id
        }
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
        let session = ReaderWebSession(url: url)
        webSessions[tab.id] = session
        return session
    }

    func sections(for tab: ReaderTab) async -> [PDFSectionLocation] {
        guard tab.kind == .pdf else { return [] }
        let path = tab.location
        let title = tab.title
        if let cached = pdfSections[path] { return cached }

        let task: Task<[PDFSectionLocation], Never>
        if let existing = sectionTasks[path], !existing.isCancelled {
            task = existing
        } else {
            task = Task.detached(priority: .utility) {
                guard !Task.isCancelled else { return [] }
                if let data = UserDefaults.standard.data(forKey: "pregar.library.records.v1"),
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
        guard tabs[index].physicalPage != boundedPage else { return }
        tabs[index].physicalPage = boundedPage
        schedulePagePersistence()
    }

    func setReviewInclusion(_ included: Bool, for tabID: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == tabID }) else { return }
        tabs[index].includedInReview = included
        tabs[index].reviewInclusionConfirmed = true
        persist()
    }

    func materialsMarkedForReview() -> [ReaderTab] {
        tabs.filter(\.isIncludedForReview)
    }

    func reviewSources(for reference: String?) async throws -> [SermonReviewSource] {
        var sources: [SermonReviewSource] = []
        for tab in materialsMarkedForReview() {
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
        tabs[index].location = location
        persist()
    }

    func flushPagePersistence() {
        guard pendingPagePersistence != nil else { return }
        persist()
    }

    func restore(archive: ReaderArchive, rememberedPages: [String: Int]) {
        pendingPagePersistence?.cancel()
        pendingPagePersistence = nil
        for session in webSessions.values {
            session.webView.stopLoading()
            session.webView.navigationDelegate = nil
        }
        sectionTasks.values.forEach { $0.cancel() }
        webSessions.removeAll()
        pdfDocuments.removeAll()
        pdfSections.removeAll()
        sectionTasks.removeAll()

        tabs = archive.tabs.filter { tab in
            switch tab.kind {
            case .pdf:
                FileManager.default.fileExists(atPath: tab.location)
            case .web:
                ["https", "http"].contains(URL(string: tab.location)?.scheme?.lowercased() ?? "")
            }
        }
        selectedID = archive.selectedID.flatMap { selected in tabs.contains(where: { $0.id == selected }) ? selected : nil }
        if selectedID == nil { selectedID = tabs.last?.id }
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
        let archive = ReaderArchive(tabs: tabs, selectedID: selectedID)
        if let data = try? JSONEncoder().encode(archive) {
            userDefaults.set(data, forKey: archiveKey)
        }
        if let data = try? JSONEncoder().encode(rememberedPages) {
            userDefaults.set(data, forKey: linksKey)
        }
    }
}

@MainActor
final class ReaderWebSession: NSObject, ObservableObject, WKNavigationDelegate {
    @Published private(set) var currentURL: URL
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var isLoading = true

    let webView: WKWebView

    init(url: URL) {
        currentURL = url
        webView = WKWebView(frame: .zero)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
    }

    func goBack() { if webView.canGoBack { webView.goBack() } }
    func goForward() { if webView.canGoForward { webView.goForward() } }

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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        currentURL = webView.url ?? currentURL
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = false
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        currentURL = webView.url ?? currentURL
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = false
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
            if let tab {
                HStack(spacing: 0) {
                    sectionSidebar(tab)
                        .frame(width: 235)
                    Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                    documentPane(tab)
                        .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                    Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                    locationSidebar(tab)
                        .frame(width: 380)
                }
            } else {
                emptyState
            }
        }
        .frame(minWidth: 1020, minHeight: 640)
        .background(PrototypeStyle.paper)
        .preferredColorScheme(.light)
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
                    reference: tab?.reference,
                    sermonDateKey: tab?.sermonDateKey
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

    private var tabBar: some View {
        HStack(spacing: 8) {
            Button(action: navigateBack) {
                Image(systemName: "chevron.left").frame(width: 28, height: 28).contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight).disabled(!canNavigateBack)
            .keyboardShortcut("[", modifiers: .command)
            .help("Voltar (⌘[)")
            Button(action: navigateForward) {
                Image(systemName: "chevron.right").frame(width: 28, height: 28).contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight).disabled(!canNavigateForward)
            .keyboardShortcut("]", modifiers: .command)
            .help("Avançar (⌘])")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(reader.tabs) { item in
                        HStack(spacing: 0) {
                            Button { reader.select(item.id) } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: item.kind == .pdf ? "doc.text" : "globe")
                                        .foregroundStyle(item.id == reader.selectedID ? PrototypeStyle.ink : PrototypeStyle.muted)
                                    Text(item.title).lineLimit(1)
                                        .foregroundStyle(item.id == reader.selectedID ? PrototypeStyle.ink : PrototypeStyle.muted)
                                }
                                .font(.system(size: 13, weight: item.id == reader.selectedID ? .semibold : .regular))
                                .frame(minWidth: 120, maxWidth: 230, minHeight: 32, alignment: .leading)
                                .padding(.leading, 11)
                            }
                            .buttonStyle(.plain)
                            Button { reader.close(item.id) } label: {
                                Image(systemName: "xmark").font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .frame(width: 18, height: 18)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.hoverHighlight(cornerRadius: 5))
                            .padding(.trailing, 6)
                            .help("Fechar aba")
                        }
                        .background(item.id == reader.selectedID ? .white : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .shadow(color: item.id == reader.selectedID ? .black.opacity(0.12) : .clear, radius: 3, y: 1)
                    }
                }
            }

            Button { showingNewTab = true } label: {
                Image(systemName: "plus").frame(width: 28, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight)
            .keyboardShortcut("t", modifiers: .command)
            .help("Nova aba (⌘T)")
            Spacer(minLength: 4)
            Button(action: copyWithSource) {
                Label("Copiar com origem", systemImage: "doc.on.doc")
                    .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.bordered)
            .disabled(tab == nil)
        }
        .padding(.leading, PrototypeStyle.Layout.windowControlsInset)
        .padding(.trailing, 12)
        .frame(height: PrototypeStyle.Layout.headerHeight)
        .background(PrototypeStyle.canvas)
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
                        Text("Página").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        TextField("1", text: $pageField)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 58)
                            .onSubmit { commitPageField(document, tab: tab) }
                        Text("de \(document.pageCount)")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        if let printed = reader.printedPageLabel(tab.physicalPage, in: document) {
                            Text("impressa \(printed)").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        }
                        Spacer()
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
                        onPageChange: { reader.setPage($0, for: tab.id) },
                        onSelectionChange: { selectedText = $0 }
                    )
                    .background(Color(red: 0.49, green: 0.48, blue: 0.45))
                }
            } else if failedPDFTabID == tab.id {
                ContentUnavailableView {
                    Label("PDF indisponível", systemImage: "doc.questionmark")
                } description: {
                    Text("O arquivo não pôde ser aberto. Confira se ele ainda está disponível neste Mac.")
                } actions: {
                    Button("Tentar novamente", systemImage: "arrow.clockwise") { pdfLoadRevision += 1 }
                        .buttonStyle(.bordered)
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
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    if session.isLoading { ProgressView().controlSize(.small) }
                    Text(session.currentURL.absoluteString)
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(PrototypeStyle.muted)
                        .lineLimit(1).textSelection(.enabled)
                    Spacer(minLength: 0)
                    Button("Abrir no navegador", systemImage: "arrow.up.right.square") {
                        NSWorkspace.shared.open(session.currentURL)
                    }
                    .buttonStyle(.plain).font(.system(size: 11)).help("Abrir esta página no navegador padrão")
                }
                .padding(.horizontal, 14).frame(height: 41).background(PrototypeStyle.canvas)
                Divider()
                ReaderWebView(session: session)
                    .id(tab.id)
            }
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
                .buttonStyle(.bordered).font(.system(size: 12))
                .disabled(document == nil)
                Button("Lembrar este vínculo", systemImage: "bookmark") {
                    reader.rememberLink(for: tab, section: activeSection)
                }
                .buttonStyle(.bordered).font(.system(size: 12))
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
                .buttonStyle(.bordered).font(.system(size: 12))
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
                    .buttonStyle(.borderedProminent).tint(appearance.accent)
                Button("Biblioteca de PDFs", systemImage: "books.vertical") { openWindow(id: "library") }
                    .buttonStyle(.bordered)
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
        reader.setPage(min(max(page, 1), document.pageCount), for: tab.id)
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

private struct ReaderPDFView: NSViewRepresentable {
    let document: PDFDocument
    let pageNumber: Int
    let onPageChange: (Int) -> Void
    let onSelectionChange: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = document
        showPage(pageNumber, in: view)
        context.coordinator.observers = [
            NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak coordinator = context.coordinator] notification in
                guard let coordinator, let view = notification.object as? PDFView,
                      let page = view.currentPage, let document = view.document else { return }
                coordinator.onPageChange?(document.index(for: page) + 1)
            },
            NotificationCenter.default.addObserver(forName: .PDFViewSelectionChanged, object: view, queue: .main) { [weak coordinator = context.coordinator] notification in
                guard let coordinator, let view = notification.object as? PDFView else { return }
                coordinator.onSelectionChange?(view.currentSelection?.string ?? "")
            }
        ]
        context.coordinator.onPageChange = onPageChange
        context.coordinator.onSelectionChange = onSelectionChange
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        context.coordinator.onPageChange = onPageChange
        context.coordinator.onSelectionChange = onSelectionChange
        if view.document !== document { view.document = document }
        guard let current = view.currentPage, let currentDocument = view.document,
              currentDocument.index(for: current) + 1 != pageNumber else { return }
        showPage(pageNumber, in: view)
    }

    static func dismantleNSView(_ view: PDFView, coordinator: Coordinator) {
        coordinator.observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    private func showPage(_ number: Int, in view: PDFView) {
        guard let page = document.page(at: min(max(number - 1, 0), document.pageCount - 1)) else { return }
        view.go(to: page)
    }

    final class Coordinator {
        var observers: [NSObjectProtocol] = []
        var onPageChange: ((Int) -> Void)?
        var onSelectionChange: ((String) -> Void)?
    }
}

private struct ReaderWebView: NSViewRepresentable {
    @ObservedObject var session: ReaderWebSession

    func makeNSView(context: Context) -> WKWebView { session.webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
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
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Abrir", systemImage: "arrow.right", action: add)
                    .buttonStyle(.borderedProminent).tint(accent)
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
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Salvar") { save(page); dismiss() }
                    .buttonStyle(.borderedProminent).tint(accent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 500)
        .background(PrototypeStyle.canvas)
    }
}
