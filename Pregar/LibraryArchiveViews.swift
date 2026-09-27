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
    @State private var isImportingPublicDriveFolder = false
    @State private var isIndexing = false
    @State private var didRestore = false
    @State private var sectionQuery = ""
    @State private var errorMessage: String?
    @State private var ocrNotice: String?
    @State private var ocrNoticeRecordID: String?
    @State private var ocrProgress: (completed: Int, total: Int)?
    @State private var ocrTargetID: String?
    @State private var ocrOperationID: UUID?
    @State private var ocrTask: Task<PDFLibraryOCRResult?, Never>?
    @State private var metadataRecord: PDFLibraryRecord?
    @State private var openingPDFRecordID: String?

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
                Button("Drive público…", systemImage: "arrow.down.doc") {
                    isImportingPublicDriveFolder = true
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
                            .disabled(isIndexing)
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
        .sheet(isPresented: $isImportingPublicDriveFolder) {
            GoogleDrivePublicFolderImportSheet(accent: PrototypeStyle.green, isLibraryIndexing: $isIndexing) { urls in
                index(paths: urls.map(\.path))
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
                            if let ocrPageNumbers = selectedRecord.ocrPageNumbers, !ocrPageNumbers.isEmpty {
                                Text("OCR · \(ocrPageNumbers.count) páginas examinadas")
                                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.green)
                            }
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
                        Button {
                            openInReader(selectedRecord, page: 1)
                        } label: {
                            if openingPDFRecordID == selectedRecord.id {
                                Label("Abrindo PDF…", systemImage: "book")
                            } else {
                                Label("Abrir no leitor", systemImage: "book")
                            }
                        }
                            .buttonStyle(.bordered)
                            .disabled(openingPDFRecordID != nil)
                        if let ocrProgress, ocrTargetID == selectedRecord.id {
                            HStack(spacing: 7) {
                                ProgressView().controlSize(.small)
                                Text(ocrProgress.total == 0
                                     ? "Preparando OCR…"
                                     : "OCR \(ocrProgress.completed)/\(ocrProgress.total)")
                                    .font(.system(size: 12))
                            }
                            Button("Cancelar OCR", systemImage: "xmark") {
                                ocrTask?.cancel()
                            }
                            .buttonStyle(.bordered)
                            .help("Interrompe o reconhecimento depois da página atual")
                        } else {
                            Button("OCR…", systemImage: "text.viewfinder") {
                                recognizeScannedPages(selectedRecord)
                            }
                            .buttonStyle(.bordered)
                            .disabled(isIndexing)
                            .help("Procura referências em páginas sem texto selecionável; o PDF original não é alterado.")
                        }
                    }
                    if let ocrNotice, ocrNoticeRecordID == selectedRecord.id {
                        Text(ocrNotice)
                            .font(.system(size: 12))
                            .foregroundStyle(PrototypeStyle.muted)
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
                .disabled(openingPDFRecordID != nil)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
            }
        }
    }

    private func filteredSections(_ sections: [PDFSectionLocation]) -> [PDFSectionLocation] {
        guard !sectionQuery.isEmpty else { return sections }
        return sections.filter { $0.matchesSearch(sectionQuery) }
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
        guard openingPDFRecordID == nil else { return }
        openingPDFRecordID = record.id
        Task { @MainActor in
            let opened = await readerSession.openPDF(
                title: record.displayTitle,
                path: record.path,
                page: page,
                reference: reference,
                indexedSections: record.sections
            )
            guard openingPDFRecordID == record.id else { return }
            openingPDFRecordID = nil
            guard opened else {
                errorMessage = "Este PDF não pôde ser aberto. Verifique se o arquivo ainda está disponível."
                return
            }
            openWindow(id: "reader")
        }
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
            index(paths: paths)
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
            index(paths: records.filter { pathsToReindex.contains($0.path) }.map(\.path))
        }
    }

    private func reindex() {
        index(paths: records.map(\.path))
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

    private func index(paths: [String]) {
        guard !isIndexing, !paths.isEmpty else { return }
        isIndexing = true
        let previousByPath = Dictionary(uniqueKeysWithValues: records.map { ($0.path, $0) })
        Task {
            let indexed = await Task.detached(priority: .utility) {
                paths.compactMap { path in
                    PDFLibraryIndexer.index(path: path, previousRecord: previousByPath[path])
                }
            }.value
            let indexedByPath = Dictionary(uniqueKeysWithValues: indexed.map { record in
                let refreshed = record.preservingMetadata(from: previousByPath[record.path])
                return (refreshed.path, refreshed)
            })
            var mergedByPath = Dictionary(records.map { ($0.path, $0) }, uniquingKeysWith: { _, later in later })
            for (path, record) in indexedByPath { mergedByPath[path] = record }
            records = Array(mergedByPath.values)
            records.sort { $0.displayTitle.localizedStandardCompare($1.displayTitle) == .orderedAscending }
            selectedID = selectedID ?? records.first?.id
            persistRecords()
            isIndexing = false
        }
    }

    private func recognizeScannedPages(_ record: PDFLibraryRecord) {
        guard !isIndexing else { return }
        isIndexing = true
        ocrNotice = nil
        ocrNoticeRecordID = nil
        ocrProgress = (0, 0)
        let operationID = UUID()
        ocrOperationID = operationID
        ocrTargetID = record.id
        let previousRecord = records.first(where: { $0.path == record.path }) ?? record
        let reportProgress: @Sendable (Int, Int) -> Void = { completed, total in
            Task { @MainActor in
                guard self.ocrOperationID == operationID else { return }
                self.ocrProgress = (completed, total)
            }
        }

        Task {
            let task = Task.detached(priority: .utility) {
                PDFLibraryIndexer.recognizeScannedPages(
                    path: record.path,
                    previousRecord: previousRecord,
                    progress: reportProgress
                )
            }
            ocrTask = task
            let result = await task.value
            let wasCancelled = task.isCancelled
            ocrTask = nil
            isIndexing = false
            ocrOperationID = nil
            ocrProgress = nil

            if wasCancelled {
                ocrNoticeRecordID = record.id
                ocrNotice = "OCR interrompido; o índice anterior foi preservado."
                return
            }

            guard let result,
                  let index = records.firstIndex(where: { $0.id == record.id }) else {
                errorMessage = "Não foi possível abrir o PDF para reconhecer o texto."
                return
            }
            records[index] = result.record.preservingMetadata(from: previousRecord)
            persistRecords()
            ocrNoticeRecordID = record.id

            if result.candidatePageCount == 0 {
                ocrNotice = "Nenhuma página sem texto selecionável foi encontrada."
            } else if result.scannedPageCount == 0 {
                ocrNotice = "As páginas digitalizadas deste arquivo já foram examinadas."
            } else {
                ocrNotice = "OCR examinou \(result.scannedPageCount) de \(result.candidatePageCount) páginas, reconheceu texto em \(result.recognizedTextPageCount) e identificou \(result.sectionsFound) novas referências."
            }
        }
    }

    private func persistRecords() {
        savedRecords = (try? JSONEncoder().encode(records)) ?? Data()
        savedLibraryRevision += 1
    }
}

private struct GoogleDrivePublicFolderImportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var importer: GoogleDrivePublicPDFImporter
    @State private var folderLink = ""
    @State private var apiKey = ""
    @State private var includeSubfolders = true
    @State private var errorMessage: String?
    @State private var importedCount: Int?
    @State private var skippedFiles: [String] = []
    let accent: Color
    @Binding var isLibraryIndexing: Bool
    let onImport: ([URL]) -> Void

    init(accent: Color, isLibraryIndexing: Binding<Bool>, onImport: @escaping ([URL]) -> Void) {
        self.accent = accent
        _isLibraryIndexing = isLibraryIndexing
        self.onImport = onImport
        _importer = StateObject(wrappedValue: GoogleDrivePublicPDFImporter())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Importar PDFs do Drive")
                    .font(PrototypeStyle.serif(21, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Text("Use o link de uma pasta compartilhada como “Qualquer pessoa com o link”.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            }

            Form {
                TextField("Link público da pasta", text: $folderLink)
                SecureField(importer.savedAPIKeyExists ? "Chave salva; deixe vazio para mantê-la" : "Chave de API Google", text: $apiKey)
                    .disabled(importer.isLoadingKey)
                Toggle("Incluir subpastas", isOn: $includeSubfolders)
            }

            Text("A chave deve ter a Drive API ativada; ela fica no Acesso às Chaves deste Mac. Os PDFs são copiados para a pasta de suporte local do Pregar.")
                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                .fixedSize(horizontal: false, vertical: true)

            if importer.isImporting {
                VStack(alignment: .leading, spacing: 7) {
                    if importer.totalCount > 0 {
                        ProgressView(value: Double(importer.completedCount), total: Double(importer.totalCount))
                    } else {
                        ProgressView()
                    }
                    Text(importer.status).font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted).lineLimit(2)
                }
            } else if let importedCount {
                Label("\(importedCount) PDF(s) importado(s); indexação iniciada.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(accent)
                if !skippedFiles.isEmpty {
                    Text("\(skippedFiles.count) arquivo(s) não foram baixados.")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
                if isLibraryIndexing {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Indexando PDFs na Biblioteca…").font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    }
                }
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 11)).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Fechar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button {
                    Task { await importFolder() }
                } label: {
                    if importer.isImporting { ProgressView().controlSize(.small) }
                    else { Label(importedCount == nil ? "Importar PDFs" : "Importar novamente", systemImage: "arrow.down.doc") }
                }
                .buttonStyle(.borderedProminent).tint(accent)
                .disabled(importer.isImporting || importer.isLoadingKey || isLibraryIndexing || folderLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .frame(width: 590, height: 450)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
    }

    @MainActor
    private func importFolder() async {
        errorMessage = nil
        importedCount = nil
        skippedFiles = []
        do {
            let result = try await importer.importPDFs(
                from: folderLink,
                apiKey: apiKey,
                includeSubfolders: includeSubfolders
            )
            importedCount = result.localURLs.count
            skippedFiles = result.failures
            onImport(result.localURLs)
        } catch {
            errorMessage = error.localizedDescription
        }
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
        SermonDateKey.string(from: draft.liturgicalDate)
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
                                        let reviewedCount = ReaderTab.countMarkedForReview(
                                            in: readerSession.tabs,
                                            reference: reference,
                                            sermonDateKey: archiveKey(for: draft)
                                        )
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
                                VStack(alignment: .leading, spacing: 2) {
                                    if let path = draft.tabletPDFPath, FileManager.default.fileExists(atPath: path) {
                                        Text("PDF salvo").foregroundStyle(PrototypeStyle.green)
                                        Text(draft.tabletPDFUpdatedAt?.formatted(date: .omitted, time: .shortened) ?? "")
                                            .foregroundStyle(PrototypeStyle.muted)
                                    } else {
                                        Text(draft.tabletPDFPath == nil ? "sem cópia" : "não encontrado")
                                            .foregroundStyle(PrototypeStyle.muted)
                                    }
                                }
                                .font(.system(size: 10)).frame(width: 110, alignment: .leading)
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
