import AppKit
import PDFKit
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

private struct PDFLibraryRecord: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var path: String
    var pageCount: Int
    var bookmarkCount: Int
}

struct PDFLibraryView: View {
    @AppStorage("pregar.library.records.v1") private var savedRecords = Data()
    @State private var records: [PDFLibraryRecord] = []
    @State private var selectedID: String?
    @State private var isImporting = false
    @State private var isShowingPDF = false
    @State private var errorMessage: String?

    private var selectedRecord: PDFLibraryRecord? {
        records.first { $0.id == selectedID }
    }

    private var totalPages: Int { records.reduce(0) { $0 + $1.pageCount } }
    private var totalSections: Int { records.reduce(0) { $0 + $1.bookmarkCount } }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("Biblioteca").font(PrototypeStyle.serif(23, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Text("\(records.count) obras · \(totalPages.formatted()) páginas · \(totalSections.formatted()) bookmarks")
                    .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
                Spacer()
                Button("Reindexar", systemImage: "arrow.clockwise", action: reindex)
                    .buttonStyle(.bordered)
                Button("Importar PDF…", systemImage: "plus", action: { isImporting = true })
                    .buttonStyle(.borderedProminent)
                    .tint(PrototypeStyle.green)
            }
            .padding(.horizontal, 20)
            .frame(height: 57)
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
                    .padding(10)
                }
                .frame(minWidth: 300, idealWidth: 370, maxWidth: 430)
                .background(PrototypeStyle.canvas.opacity(0.58))

                detailView
                    .frame(minWidth: 450, maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(PrototypeStyle.paper)
        }
        .frame(minWidth: 1040, minHeight: 680)
        .background(PrototypeStyle.paper)
        .preferredColorScheme(.light)
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.pdf], allowsMultipleSelection: true, onCompletion: importFiles)
        .sheet(isPresented: $isShowingPDF) {
            if let selectedRecord {
                PDFPreviewSheet(title: selectedRecord.title, url: URL(fileURLWithPath: selectedRecord.path))
            }
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
                    Text(selectedRecord.title)
                        .font(PrototypeStyle.serif(30, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text("\(selectedRecord.pageCount) páginas físicas · \(selectedRecord.bookmarkCount) bookmarks")
                        .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
                    Text(selectedRecord.path)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PrototypeStyle.muted.opacity(0.72))
                        .textSelection(.enabled)

                    HStack(spacing: 8) {
                        Button("Corrigir metadados", systemImage: "pencil") {
                            errorMessage = "A edição de metadados estará disponível junto à indexação por passagem."
                        }
                        .buttonStyle(.bordered)
                        Button("Abrir no leitor", systemImage: "book") { isShowingPDF = true }
                            .buttonStyle(.bordered)
                    }

                    HStack {
                        Text("SEÇÕES ENCONTRADAS")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                        Rectangle().fill(PrototypeStyle.line).frame(height: 1)
                        Text("\(selectedRecord.bookmarkCount)")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.top, 8)

                    if let document = PDFDocument(url: URL(fileURLWithPath: selectedRecord.path)),
                       let outline = document.outlineRoot,
                       outline.numberOfChildren > 0 {
                        outlineTable(outline, document: document)
                    } else {
                        ContentUnavailableView {
                            Label("Sumário não encontrado", systemImage: "list.bullet.indent")
                        } description: {
                            Text("Este PDF ainda não tem bookmarks detectáveis. A localização por cabeçalhos e passagens virá com a indexação.")
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
            RoundedRectangle(cornerRadius: 4)
                .fill(coverColor(record.title))
                .frame(width: 48, height: 68)
                .shadow(color: .black.opacity(0.16), radius: 3, y: 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(record.title)
                    .font(PrototypeStyle.serif(16, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .multilineTextAlignment(.leading)
                Text("\(record.pageCount) p.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                Text(record.bookmarkCount > 0 ? "\(record.bookmarkCount) bookmarks" : "sem bookmarks")
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(selected ? PrototypeStyle.softGreen : .clear, in: RoundedRectangle(cornerRadius: 9))
        .contentShape(Rectangle())
    }

    private func outlineTable(_ outline: PDFOutline, document: PDFDocument) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("SEÇÃO / BOOKMARK")
                Spacer()
                Text("PÁGINA FÍSICA")
            }
            .font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
            .padding(.horizontal, 12).frame(height: 34)
            Divider()
            ForEach(flatten(outline, document: document), id: \.id) { entry in
                HStack {
                    Text(entry.title)
                        .font(.system(size: 12))
                        .foregroundStyle(PrototypeStyle.ink)
                        .lineLimit(1)
                    Spacer()
                    Text(entry.page.map(String.init) ?? "—")
                        .font(.system(size: 12, design: .rounded).monospacedDigit())
                        .foregroundStyle(PrototypeStyle.muted)
                }
                .padding(.horizontal, 12)
                .frame(height: 37)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
            }
        }
    }

    private struct OutlineEntry: Identifiable {
        let title: String
        let page: Int?
        let depth: Int
        var id: String { "\(depth):\(title):\(page ?? -1)" }
    }

    private func flatten(_ root: PDFOutline, document: PDFDocument) -> [OutlineEntry] {
        func walk(_ node: PDFOutline, depth: Int) -> [OutlineEntry] {
            (0..<node.numberOfChildren).flatMap { index -> [OutlineEntry] in
                guard let child = node.child(at: index) else { return [] }
                let page = child.destination?.page.map { document.index(for: $0) + 1 }
                let current = (child.label.map { [OutlineEntry(title: $0, page: page, depth: depth)] } ?? [])
                return current + walk(child, depth: depth + 1)
            }
        }
        return walk(root, depth: 0)
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
            var updated = records
            for url in urls {
                guard !updated.contains(where: { $0.path == url.path }), let document = PDFDocument(url: url) else { continue }
                let count = bookmarkCount(in: document.outlineRoot)
                updated.append(PDFLibraryRecord(
                    id: url.path,
                    title: url.deletingPathExtension().lastPathComponent,
                    path: url.path,
                    pageCount: document.pageCount,
                    bookmarkCount: count
                ))
            }
            records = updated.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            selectedID = selectedID ?? records.first?.id
            persistRecords()
        }
    }

    private func restoreRecords() {
        guard records.isEmpty, !savedRecords.isEmpty,
              let restored = try? JSONDecoder().decode([PDFLibraryRecord].self, from: savedRecords) else { return }
        records = restored.filter { FileManager.default.fileExists(atPath: $0.path) }
        selectedID = records.first?.id
    }

    private func reindex() {
        for index in records.indices {
            let document = PDFDocument(url: URL(fileURLWithPath: records[index].path))
            records[index].pageCount = document?.pageCount ?? records[index].pageCount
            records[index].bookmarkCount = bookmarkCount(in: document?.outlineRoot)
        }
        persistRecords()
    }

    private func bookmarkCount(in outline: PDFOutline?) -> Int {
        guard let outline else { return 0 }
        return (0..<outline.numberOfChildren).reduce(0) { total, index in
            guard let child = outline.child(at: index) else { return total }
            return total + 1 + bookmarkCount(in: child)
        }
    }

    private func persistRecords() {
        savedRecords = (try? JSONEncoder().encode(records)) ?? Data()
    }
}

private struct PDFPreviewSheet: View {
    let title: String
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title).font(.system(size: 13, weight: .medium)).lineLimit(1)
                Spacer()
                Button("Concluído") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 16).frame(height: 42).background(PrototypeStyle.canvas)
            Divider()
            PDFPageView(url: url)
        }
        .frame(width: 1040, height: 780)
    }
}

private struct PDFPageView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.document = PDFDocument(url: url)
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        guard view.document?.documentURL != url else { return }
        view.document = PDFDocument(url: url)
    }
}

private enum ArchiveSearchMode: String, CaseIterable {
    case passage = "Passagem"
    case occasion = "Ocasião"
    case date = "Data"
}

struct SermonArchiveView: View {
    @Query(sort: \SermonDraft.liturgicalDate, order: .reverse) private var drafts: [SermonDraft]
    @State private var searchMode: ArchiveSearchMode = .passage
    @State private var searchText = ""

    private var results: [SermonDraft] {
        guard !searchText.isEmpty else { return drafts }
        return drafts.filter { draft in
            let date = draft.liturgicalDate.formatted(date: .numeric, time: .omitted)
            let values: [String]
            switch searchMode {
            case .passage:
                values = [draft.mainReadingReference, draft.title].compactMap { $0 }
            case .occasion:
                values = [draft.title, draft.mainReadingReference].compactMap { $0 }
            case .date:
                values = [date, draft.liturgicalDate.formatted(date: .long, time: .omitted)]
            }
            return values.contains { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 15) {
                Text("Arquivo").font(PrototypeStyle.serif(24, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Spacer()
                Picker("Buscar por", selection: $searchMode) {
                    ForEach(ArchiveSearchMode.allCases, id: \.self) { mode in Text(mode.rawValue).tag(mode) }
                }
                .pickerStyle(.segmented)
                .frame(width: 300)
                TextField(searchMode == .passage ? "Mateus 21" : searchMode == .occasion ? "Próprio 22" : "04/10/2026", text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 300)
            }
            .padding(.horizontal, 20).frame(height: 58).background(PrototypeStyle.canvas)
            Divider()

            Table(results) {
                TableColumn("DATA") { draft in
                    Text(draft.liturgicalDate.formatted(.dateTime.day().month(.twoDigits).year().locale(Locale(identifier: "pt_BR"))))
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                }
                .width(min: 100, ideal: 130)
                TableColumn("OCASIÃO") { _ in
                    Text("LOC 2027")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .width(min: 105, ideal: 150)
                TableColumn("TÍTULO · PASSAGEM PRINCIPAL") { draft in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(draft.title.isEmpty ? draft.mainReadingReference ?? "Preparação sem título" : draft.title)
                            .font(PrototypeStyle.serif(15, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                        if let reference = draft.mainReadingReference {
                            Text(reference).font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                        }
                    }
                }
                .width(min: 280, ideal: 420)
                TableColumn("DRIVE") { _ in
                    Text("local").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .width(min: 90, ideal: 120)
            }
            .alternatingRowBackgrounds(.disabled)
        }
        .frame(minWidth: 1040, minHeight: 600)
        .background(PrototypeStyle.paper)
        .preferredColorScheme(.light)
    }
}
