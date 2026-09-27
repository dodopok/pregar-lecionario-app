import AppKit
import PDFKit
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

private enum PDFLibraryCoverCache {
    private static let images: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 32
        return cache
    }()

    static func image(for record: PDFLibraryRecord) -> NSImage? {
        guard let data = record.coverJPEG else { return nil }
        let key = "\(record.id)|\(record.indexVersion ?? 0)|\(data.hashValue)" as NSString
        if let image = images.object(forKey: key) { return image }
        guard let image = NSImage(data: data) else { return nil }
        images.setObject(image, forKey: key)
        return image
    }
}

struct PDFLibraryView: View {
    @EnvironmentObject private var readerSession: ReaderSessionStore
    @Environment(\.openWindow) private var openWindow
    @AppStorage("pregar.library.records.v1") private var savedRecords = Data()
    @AppStorage("pregar.library.records.revision.v1") private var savedLibraryRevision = 0
    @State private var records: [PDFLibraryRecord] = []
    @State private var selectedID: String?
    @State private var isImporting = false
    @State private var isIndexing = false
    @State private var didRestore = false
    @State private var sectionQuery = ""
    @State private var errorMessage: String?
    @State private var metadataRecord: PDFLibraryRecord?

    private var selectedRecord: PDFLibraryRecord? {
        records.first { $0.id == selectedID }
    }

    private var totalPages: Int { records.reduce(0) { $0 + $1.pageCount } }
    private var totalSections: Int { records.reduce(0) { $0 + ($1.sections?.count ?? $1.bookmarkCount) } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("Biblioteca").font(PrototypeStyle.serif(16, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Text("\(records.count) obras · \(totalPages.formatted()) páginas · \(totalSections.formatted()) seções")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                Spacer()
                Button(action: reindex) {
                    if isIndexing {
                        ProgressView().controlSize(.small).frame(width: 18)
                    } else {
                        Label("Reindexar", systemImage: "arrow.clockwise")
                    }
                }
                    .buttonStyle(.bordered)
                    .disabled(isIndexing)
                Button("Importar PDF…", systemImage: "plus", action: { isImporting = true })
                    .buttonStyle(.borderedProminent)
                    .tint(PrototypeStyle.green)
            }
            .padding(.leading, 100)
            .padding(.trailing, 18)
            .frame(height: 52)
            .background(PrototypeStyle.canvas)

            Divider()

            HSplitView {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(records) { record in
                            Button {
                                selectedID = record.id
                            } label: {
                                recordRow(record, selected: record.id == selectedID)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(7)
                }
                .frame(width: 385)
                .background(PrototypeStyle.canvas)

                detailView
                    .frame(minWidth: 450, maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(PrototypeStyle.paper)
        }
        .frame(minWidth: 1040, minHeight: 640)
        .background(PrototypeStyle.paper)
        .preferredColorScheme(.light)
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.pdf], allowsMultipleSelection: true, onCompletion: importFiles)
        .sheet(item: $metadataRecord) { record in
            PDFLibraryMetadataEditor(record: record) { metadata in
                saveMetadata(metadata, for: record)
            }
            .frame(width: 560, height: 360)
        }
        .alert("Biblioteca de PDFs", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .onAppear(perform: restoreRecords)
    }

    @ViewBuilder
    private var detailView: some View {
        if let selectedRecord {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 17) {
                        coverImage(selectedRecord, width: 76, height: 104)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(selectedRecord.displayTitle)
                                .font(PrototypeStyle.serif(22, weight: .semibold))
                                .foregroundStyle(PrototypeStyle.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(metadataLine(for: selectedRecord))
                                .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
                            Text("\((selectedRecord.sections?.count ?? selectedRecord.bookmarkCount).formatted()) seções encontradas")
                                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        }
                    }
                    Text(selectedRecord.path)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PrototypeStyle.muted.opacity(0.72))
                        .textSelection(.enabled)

                    HStack(spacing: 8) {
                        Button("Corrigir metadados", systemImage: "pencil") {
                            metadataRecord = selectedRecord
                        }
                        .buttonStyle(.bordered)
                        if selectedRecord.metadataOverrides != nil {
                            Button("Usar dados do PDF", systemImage: "arrow.uturn.backward") {
                                resetMetadata(for: selectedRecord)
                            }
                            .buttonStyle(.bordered)
                            .help("Descartar as correções e voltar aos metadados do arquivo")
                        }
                        Button("Abrir no leitor", systemImage: "book") {
                            openInReader(selectedRecord, page: 1)
                        }
                            .buttonStyle(.bordered)
                    }

                    HStack(spacing: 10) {
                        Text("SEÇÕES ENCONTRADAS")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                        Rectangle().fill(PrototypeStyle.line).frame(height: 1)
                        Text("\((selectedRecord.sections?.count ?? selectedRecord.bookmarkCount).formatted())")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.top, 8)

                    if let sections = selectedRecord.sections, !sections.isEmpty {
                        TextField("Filtrar seções ou passagens", text: $sectionQuery)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 320)
                        outlineTable(filteredSections(sections))
                    } else {
                        ContentUnavailableView {
                            Label("Passagens não encontradas", systemImage: "list.bullet.indent")
                        } description: {
                            Text("Este arquivo não tem um sumário legível nem cabeçalhos extraíveis. PDFs digitalizados podem precisar de OCR.")
                        }
                        .frame(minHeight: 180)
                    }
                }
                .padding(28)
            }
            .background(PrototypeStyle.paper)
        } else {
            ContentUnavailableView {
                Label("Biblioteca vazia", systemImage: "books.vertical")
            } description: {
                Text("Importe os comentários em PDF que usa na preparação.")
            } actions: {
                Button("Importar PDF…") { isImporting = true }
                    .buttonStyle(.borderedProminent)
                    .tint(PrototypeStyle.green)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func recordRow(_ record: PDFLibraryRecord, selected: Bool) -> some View {
        HStack(spacing: 11) {
            coverImage(record, width: 43, height: 59)
            VStack(alignment: .leading, spacing: 3) {
                Text(record.displayTitle)
                    .font(PrototypeStyle.serif(16, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .multilineTextAlignment(.leading)
                Text([record.displayAuthor, "\(record.pageCount) p."].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).lineLimit(1)
                Text(record.copyLabel ?? (record.sections?.isEmpty == false ? "\(record.sections?.count ?? 0) seções" : (record.bookmarkCount > 0 ? "\(record.bookmarkCount) bookmarks" : "sem sumário")))
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(selected ? PrototypeStyle.softGreen : .clear, in: RoundedRectangle(cornerRadius: 9))
        .contentShape(Rectangle())
    }

    private func outlineTable(_ sections: [PDFSectionLocation]) -> some View {
        LazyVStack(spacing: 0) {
            HStack {
                Text("PASSAGEM / SEÇÃO")
                Spacer()
                Text("PÁGINAS FÍSICAS")
            }
            .font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
            .padding(.horizontal, 12).frame(height: 34)
            Divider()
            ForEach(sections) { section in
                Button {
                    guard let selectedRecord else { return }
                    openInReader(selectedRecord, page: section.startPage, reference: section.title)
                } label: {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.title)
                                .font(.system(size: 12, weight: ScriptureReference.parse(section.title) == nil ? .regular : .medium))
                                .foregroundStyle(PrototypeStyle.ink)
                                .lineLimit(1)
                            if let context = section.context {
                                Text(context).font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 8)
                        Text(section.startPage == section.endPage ? "\(section.startPage)" : "\(section.startPage)–\(section.endPage)")
                            .font(.system(size: 12, design: .rounded).monospacedDigit())
                            .foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.horizontal, 12)
                    .frame(minHeight: section.context == nil ? 37 : 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
            }
        }
    }

    private func filteredSections(_ sections: [PDFSectionLocation]) -> [PDFSectionLocation] {
        guard !sectionQuery.isEmpty else { return sections }
        return sections.filter { section in
            [section.title, section.context].compactMap { $0 }.contains { $0.localizedCaseInsensitiveContains(sectionQuery) }
        }
    }

    private func coverImage(_ record: PDFLibraryRecord, width: CGFloat, height: CGFloat) -> some View {
        Group {
            if let image = PDFLibraryCoverCache.image(for: record) {
                Image(nsImage: image).resizable().scaledToFill()
            } else {
                Rectangle().fill(coverColor(record.displayTitle))
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(PrototypeStyle.ink.opacity(0.08), lineWidth: 1))
        .shadow(color: .black.opacity(0.13), radius: 3, y: 2)
    }

    private func metadataLine(for record: PDFLibraryRecord) -> String {
        let credits = record.displayCredits
        return credits.isEmpty
            ? "\(record.pageCount) páginas físicas"
            : "\(credits.joined(separator: " · ")) · \(record.pageCount) páginas físicas"
    }

    private func openInReader(_ record: PDFLibraryRecord, page: Int, reference: String? = nil) {
        guard readerSession.openPDF(
            title: record.displayTitle,
            path: record.path,
            page: page,
            reference: reference,
            indexedSections: record.sections
        ) else {
            errorMessage = "Este PDF não pôde ser aberto. Verifique se o arquivo ainda está disponível."
            return
        }
        openWindow(id: "reader")
    }

    private func coverColor(_ title: String) -> Color {
        if title.localizedCaseInsensitiveContains("Feasting") { return Color(red: 0.19, green: 0.38, blue: 0.51) }
        if title.localizedCaseInsensitiveContains("Wright") || title.localizedCaseInsensitiveContains("Everyone") { return Color(red: 0.48, green: 0.34, blue: 0.21) }
        return Color(red: 0.48, green: 0.47, blue: 0.42)
    }

    private func importFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let urls):
            let paths = urls.map(\.path).filter { path in !records.contains(where: { $0.path == path }) }
            guard !paths.isEmpty else { return }
            index(paths: paths, replacingAll: false)
        }
    }

    private func restoreRecords() {
        guard !didRestore else { return }
        didRestore = true
        guard !savedRecords.isEmpty,
              let restored = try? JSONDecoder().decode([PDFLibraryRecord].self, from: savedRecords) else { return }
        records = restored.filter { FileManager.default.fileExists(atPath: $0.path) }
        selectedID = records.first?.id
        let pathsToReindex = Set(records.filter(PDFLibraryIndexer.requiresReindex).map(\.path))
        records = records.map { record in
            guard !pathsToReindex.contains(record.path) else { return record }
            var current = record
            if let sections = current.sections {
                current.sections = PDFLibraryIndexer.backfillingBookmarkMethod(
                    in: sections,
                    bookmarkCount: current.bookmarkCount
                )
            }
            current.indexVersion = PDFLibraryIndexer.currentVersion
            return current
        }
        if pathsToReindex.isEmpty {
            persistRecords()
        } else {
            index(paths: records.filter { pathsToReindex.contains($0.path) }.map(\.path), replacingAll: true)
        }
    }

    private func reindex() {
        index(paths: records.map(\.path), replacingAll: true)
    }

    private func saveMetadata(_ metadata: PDFLibraryMetadataOverrides, for record: PDFLibraryRecord) {
        guard let index = records.firstIndex(where: { $0.id == record.id }) else { return }
        records[index].metadataOverrides = metadata
        records.sort { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        persistRecords()
        metadataRecord = nil
    }

    private func resetMetadata(for record: PDFLibraryRecord) {
        guard let index = records.firstIndex(where: { $0.id == record.id }) else { return }
        records[index].metadataOverrides = nil
        records.sort { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
        persistRecords()
    }

    private func index(paths: [String], replacingAll: Bool) {
        guard !isIndexing, !paths.isEmpty else { return }
        isIndexing = true
        Task {
            let indexed = await Task.detached(priority: .utility) {
                paths.compactMap { PDFLibraryIndexer.index(path: $0) }
            }.value
            let previousByPath = Dictionary(uniqueKeysWithValues: records.map { ($0.path, $0) })
            let indexedByPath = Dictionary(uniqueKeysWithValues: indexed.map { record in
                let refreshed = record.preservingMetadata(from: previousByPath[record.path])
                return (refreshed.path, refreshed)
            })
            if replacingAll {
                records = records.map { indexedByPath[$0.path] ?? $0 }
            } else {
                records.append(contentsOf: indexed)
            }
            records.sort { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            selectedID = selectedID ?? records.first?.id
            persistRecords()
            isIndexing = false
        }
    }

    private func persistRecords() {
        savedRecords = (try? JSONEncoder().encode(records)) ?? Data()
        savedLibraryRevision += 1
    }
}

private struct PDFLibraryMetadataEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var metadata: PDFLibraryMetadataOverrides

    let record: PDFLibraryRecord
    let onSave: (PDFLibraryMetadataOverrides) -> Void

    init(record: PDFLibraryRecord, onSave: @escaping (PDFLibraryMetadataOverrides) -> Void) {
        self.record = record
        self.onSave = onSave
        _metadata = State(initialValue: PDFLibraryMetadataOverrides(record: record))
    }

    private var hasTitle: Bool {
        !metadata.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Corrigir metadados")
                    .font(PrototypeStyle.serif(21, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
            }
            .padding(.bottom, 19)

            Divider()

            VStack(spacing: 11) {
                metadataField("Título", text: $metadata.title)
                metadataField("Autor", text: $metadata.author)
                metadataField("Editora", text: $metadata.publisher)
                HStack(spacing: 12) {
                    metadataField("Ano", text: $metadata.year)
                    metadataField("Volume", text: $metadata.volume)
                }
                HStack(spacing: 12) {
                    metadataField("Edição", text: $metadata.edition)
                    metadataField("Idioma", text: $metadata.language)
                }
            }
            .padding(.vertical, 18)

            Spacer(minLength: 0)
            Divider()
            HStack {
                Text(URL(fileURLWithPath: record.path).lastPathComponent)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 12)
                Button("Cancelar") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Salvar metadados") {
                    onSave(cleanedMetadata)
                }
                .buttonStyle(.borderedProminent)
                .tint(PrototypeStyle.green)
                .keyboardShortcut(.defaultAction)
                .disabled(!hasTitle)
            }
            .padding(.top, 14)
        }
        .padding(24)
        .background(PrototypeStyle.paper)
    }

    private var cleanedMetadata: PDFLibraryMetadataOverrides {
        func clean(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
        return PDFLibraryMetadataOverrides(
            title: clean(metadata.title),
            author: clean(metadata.author),
            publisher: clean(metadata.publisher),
            year: clean(metadata.year),
            volume: clean(metadata.volume),
            edition: clean(metadata.edition),
            language: clean(metadata.language)
        )
    }

    private func metadataField(_ title: String, text: Binding<String>) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PrototypeStyle.muted)
                .frame(width: 74, alignment: .leading)
            TextField(title, text: text)
                .textFieldStyle(.roundedBorder)
        }
        .frame(maxWidth: .infinity)
    }
}

enum ArchiveSearchMode: String, CaseIterable {
    case passage = "Passagem"
    case occasion = "Ocasião"
    case date = "Data"

    var placeholder: String {
        switch self {
        case .passage: "Mateus 21"
        case .occasion: "Próprio 22"
        case .date: "04/10/2026"
        }
    }

    func matches(_ draft: SermonDraft, query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        let values: [String]
        switch self {
        case .passage:
            values = [draft.mainReadingReference, draft.title].compactMap { $0 }
        case .occasion:
            values = [draft.liturgicalOccasion, draft.liturgicalCelebration, draft.liturgicalSeason].compactMap { $0 }
        case .date:
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "pt_BR")
            formatter.timeZone = TimeZone.current
            formatter.dateFormat = "dd/MM/yyyy"
            let numeric = formatter.string(from: draft.liturgicalDate)
            formatter.dateFormat = "yyyy-MM-dd"
            values = [numeric, formatter.string(from: draft.liturgicalDate)]
        }
        return values.contains { $0.localizedCaseInsensitiveContains(trimmed) }
    }
}

private struct ArchiveMaterialCountRequest: Sendable {
    let key: String
    let reference: String?
}

struct SermonArchiveView: View {
    @EnvironmentObject private var readerSession: ReaderSessionStore
    @Query(sort: \SermonDraft.liturgicalDate, order: .reverse) private var drafts: [SermonDraft]
    @AppStorage("pregar.library.records.v1") private var savedPDFRecords = Data()
    @AppStorage("pregar.library.records.revision.v1") private var savedLibraryRevision = 0
    @State private var searchMode: ArchiveSearchMode = .passage
    @State private var searchText = ""
    @State private var pdfMatchCounts: [String: Int] = [:]

    private var results: [SermonDraft] {
        drafts.filter { searchMode.matches($0, query: searchText) }
    }

    private var materialCountTaskID: String {
        let draftStamp = drafts.map {
            "\(archiveKey(for: $0)):\($0.mainReadingReference ?? "")"
        }.joined(separator: "|")
        return "\(savedLibraryRevision)|\(draftStamp)"
    }

    private func archiveKey(for draft: SermonDraft) -> String {
        String(Int64(draft.liturgicalDate.timeIntervalSince1970))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 15) {
                Text("Arquivo").font(PrototypeStyle.serif(16, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Spacer()
                Picker("Buscar por", selection: $searchMode) {
                    ForEach(ArchiveSearchMode.allCases, id: \.self) { mode in Text(mode.rawValue).tag(mode) }
                }
                .pickerStyle(.segmented)
                .frame(width: 185)
                TextField(searchMode.placeholder, text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 250)
            }
            .padding(.leading, 100).padding(.trailing, 18).frame(height: 52).background(PrototypeStyle.canvas)
            Divider()

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    archiveHeader("DATA", width: 100)
                    archiveHeader("OCASIÃO", width: 200)
                    archiveHeader("TÍTULO · PASSAGEM PRINCIPAL", flexible: true)
                    archiveHeader("APARECE COMO", width: 190)
                    archiveHeader("MATERIAIS", width: 80)
                    archiveHeader("DRIVE", width: 110)
                }
                .padding(.horizontal, 22)
                .frame(height: 34)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }

                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(results) { draft in
                            HStack(spacing: 12) {
                                Text(draft.liturgicalDate.formatted(.dateTime.day().month(.twoDigits).year().locale(Locale(identifier: "pt_BR"))))
                                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                                    .frame(width: 100, alignment: .leading)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(draft.liturgicalOccasion ?? draft.liturgicalCelebration ?? "—")
                                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                                    let context = [draft.liturgicalSeason, draft.liturgicalCelebration == draft.liturgicalOccasion ? nil : draft.liturgicalCelebration]
                                        .compactMap { $0 }.joined(separator: " · ")
                                    if !context.isEmpty {
                                        Text(context).font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted).lineLimit(1)
                                    }
                                }
                                .frame(width: 200, alignment: .leading)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(draft.title.isEmpty ? draft.mainReadingReference ?? "Preparação sem título" : draft.title)
                                        .font(PrototypeStyle.serif(15, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                                    if let reference = draft.mainReadingReference {
                                        Text(reference).font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(draft.mainReadingReference == nil ? "—" : "passagem principal")
                                    .font(.system(size: 12, weight: .medium)).foregroundStyle(draft.mainReadingReference == nil ? PrototypeStyle.muted : PrototypeStyle.green)
                                    .frame(width: 190, alignment: .leading)
                                if let reference = draft.mainReadingReference {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(pdfMatchCounts[archiveKey(for: draft)] ?? 0) PDFs")
                                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                                        let reviewedCount = readerSession.tabs.filter {
                                            $0.isIncludedForReview && $0.reference == reference
                                        }.count
                                        if reviewedCount > 0 {
                                            Text("\(reviewedCount) na revisão")
                                                .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                                        }
                                    }
                                    .frame(width: 80, alignment: .leading)
                                } else {
                                    Text("—").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                                        .frame(width: 80, alignment: .leading)
                                }
                                Text("local").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                                    .frame(width: 110, alignment: .leading)
                            }
                            .padding(.horizontal, 22)
                            .frame(minHeight: 58)
                            .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
        .frame(minWidth: 1000, minHeight: 600)
        .background(PrototypeStyle.paper)
        .preferredColorScheme(.light)
        .task(id: materialCountTaskID) {
            let data = savedPDFRecords
            let requests = drafts.map { ArchiveMaterialCountRequest(key: archiveKey(for: $0), reference: $0.mainReadingReference) }
            let counts = await Task.detached(priority: .utility) {
                let records = (try? JSONDecoder().decode([PDFLibraryRecord].self, from: data)) ?? []
                return Dictionary(uniqueKeysWithValues: requests.map { request in
                    (request.key, PDFLibraryIndexer.matchingSectionCount(in: records, reference: request.reference))
                })
            }.value
            guard !Task.isCancelled else { return }
            pdfMatchCounts = counts
        }
    }

    private func archiveHeader(_ title: String, width: CGFloat? = nil, flexible: Bool = false) -> some View {
        Group {
            if flexible {
                Text(title).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(title).frame(width: width ?? 100, alignment: .leading)
            }
        }
        .font(.system(size: 10, weight: .bold))
        .tracking(0.5)
        .foregroundStyle(PrototypeStyle.muted)
    }
}
