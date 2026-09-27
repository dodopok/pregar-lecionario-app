import AppKit
import Foundation
import SwiftUI

struct SermonRevisionSnapshot: Equatable, Sendable {
    let title: String
    let mainReadingReference: String?
    let mainReadingSlot: String?
    let rtfData: Data?
    let wordCount: Int

    init(
        title: String,
        mainReadingReference: String?,
        mainReadingSlot: String?,
        rtfData: Data?,
        wordCount: Int
    ) {
        self.title = title
        self.mainReadingReference = mainReadingReference
        self.mainReadingSlot = mainReadingSlot
        self.rtfData = rtfData
        self.wordCount = wordCount
    }

    init(draft: SermonDraft, wordCount: Int? = nil) {
        self.init(
            title: draft.title,
            mainReadingReference: draft.mainReadingReference,
            mainReadingSlot: draft.mainReadingSlot,
            rtfData: draft.rtfData,
            wordCount: wordCount ?? SermonRevisionText.wordCount(from: draft.rtfData)
        )
    }

    func matches(_ revision: SermonRevision) -> Bool {
        title == revision.title
            && mainReadingReference == revision.mainReadingReference
            && mainReadingSlot == revision.mainReadingSlot
            && rtfData == revision.rtfData
    }
}

struct SermonRevision: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let version: Int
    let createdAt: Date
    let summary: String
    let title: String
    let mainReadingReference: String?
    let mainReadingSlot: String?
    let rtfData: Data?
    let wordCount: Int

    init(
        id: UUID = UUID(),
        version: Int,
        createdAt: Date = .now,
        summary: String,
        snapshot: SermonRevisionSnapshot
    ) {
        self.id = id
        self.version = version
        self.createdAt = createdAt
        self.summary = summary
        self.title = snapshot.title
        self.mainReadingReference = snapshot.mainReadingReference
        self.mainReadingSlot = snapshot.mainReadingSlot
        self.rtfData = snapshot.rtfData
        self.wordCount = snapshot.wordCount
    }

    func matches(_ snapshot: SermonRevisionSnapshot) -> Bool {
        snapshot.matches(self)
    }

    var snapshot: SermonRevisionSnapshot {
        SermonRevisionSnapshot(
            title: title,
            mainReadingReference: mainReadingReference,
            mainReadingSlot: mainReadingSlot,
            rtfData: rtfData,
            wordCount: wordCount
        )
    }
}

actor SermonRevisionStore {
    static let shared = SermonRevisionStore()

    private static let retentionLimit = 100
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? Self.defaultDirectoryURL()
    }

    static func defaultDirectoryURL() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)
        return support
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Pregar", isDirectory: true)
            .appendingPathComponent("SermonHistory", isDirectory: true)
    }

    func revisions(for liturgicalDate: Date) throws -> [SermonRevision] {
        let url = fileURL(for: liturgicalDate)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        return try JSONDecoder().decode([SermonRevision].self, from: data)
            .sorted { $0.version < $1.version }
    }

    @discardableResult
    func capture(
        _ snapshot: SermonRevisionSnapshot,
        for liturgicalDate: Date,
        summary: String = "Edição salva",
        force: Bool = false
    ) throws -> [SermonRevision] {
        var revisions = try revisions(for: liturgicalDate)
        if !force, let latest = revisions.last, latest.matches(snapshot) { return revisions }

        let revision = SermonRevision(
            version: (revisions.last?.version ?? 0) + 1,
            summary: summary,
            snapshot: snapshot
        )
        revisions.append(revision)
        if revisions.count > Self.retentionLimit {
            revisions.removeFirst(revisions.count - Self.retentionLimit)
        }

        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(revisions)
        try data.write(to: fileURL(for: liturgicalDate), options: .atomic)
        return revisions
    }

    private func fileURL(for date: Date) -> URL {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        let key = String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
        return directory.appendingPathComponent("\(key).json", isDirectory: false)
    }
}

private enum SermonRevisionText {
    static func plainText(from data: Data?) -> String {
        guard let data,
              let text = try? NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.rtf],
                documentAttributes: nil
              ) else { return "" }
        return text.string
    }

    static func wordCount(from data: Data?) -> Int {
        plainText(from: data).split(whereSeparator: \.isWhitespace).count
    }
}

struct SermonHistorySheet: View {
    @Bindable var draft: SermonDraft
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var revisions: [SermonRevision] = []
    @State private var comparison: SermonRevision?
    @State private var errorMessage: String?
    @State private var isLoading = true

    let accent: Color
    private let store = SermonRevisionStore.shared

    private var currentSnapshot: SermonRevisionSnapshot { SermonRevisionSnapshot(draft: draft) }

    private var currentVersion: Int {
        guard let latest = revisions.last else { return 1 }
        return latest.matches(currentSnapshot) ? latest.version : latest.version + 1
    }

    private var previousRevisions: [SermonRevision] {
        revisions.reversed().filter { revision in
            !(revision.id == revisions.last?.id && revision.matches(currentSnapshot))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Histórico deste sermão")
                        .font(PrototypeStyle.serif(22, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text("Cada versão é recuperável. Restaurar cria uma versão nova; nada se perde.")
                        .font(.system(size: 12))
                        .foregroundStyle(PrototypeStyle.muted)
                }
                Spacer()
                Button("Fechar") { dismiss() }
                    .buttonStyle(.bordered)
            }
            .padding(.bottom, 18)

            Divider()

            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        currentVersionRow
                        ForEach(previousRevisions) { revision in
                            revisionRow(revision)
                        }
                    }
                }
            }
        }
        .padding(24)
        .frame(minWidth: 700, minHeight: 440)
        .background(PrototypeStyle.canvas)
        .task { await reload() }
        .sheet(item: $comparison) { revision in
            SermonRevisionComparisonSheet(
                current: currentSnapshot,
                currentVersion: currentVersion,
                previous: revision
            )
        }
        .alert(
            "Histórico de sermões",
            isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })
        ) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var currentVersionRow: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("v\(currentVersion)")
                        .font(PrototypeStyle.serif(17, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text("Edição em curso")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(accent)
                }
                Text("agora · \(currentSnapshot.wordCount.formatted()) palavras")
                    .font(.system(size: 12))
                    .foregroundStyle(PrototypeStyle.muted)
            }
            Spacer()
            Image(systemName: "pencil.line")
                .foregroundStyle(accent)
                .padding(.top, 2)
        }
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    private func revisionRow(_ revision: SermonRevision) -> some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text("v\(revision.version)")
                        .font(PrototypeStyle.serif(17, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text(revision.summary)
                        .font(.system(size: 13))
                        .foregroundStyle(PrototypeStyle.muted)
                        .lineLimit(1)
                }
                Text("\(revision.createdAt.formatted(date: .abbreviated, time: .shortened)) · \(revision.wordCount.formatted()) palavras")
                    .font(.system(size: 12))
                    .foregroundStyle(PrototypeStyle.muted)
            }
            Spacer(minLength: 8)
            Button("Comparar", systemImage: "arrow.left.arrow.right") { comparison = revision }
                .buttonStyle(.bordered)
            Button("Restaurar", systemImage: "arrow.uturn.backward") { restore(revision) }
                .buttonStyle(.bordered)
        }
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    @MainActor
    private func reload() async {
        do {
            revisions = try await store.revisions(for: draft.liturgicalDate)
        } catch {
            errorMessage = "Não foi possível abrir o histórico: \(error.localizedDescription)"
        }
        isLoading = false
    }

    private func restore(_ revision: SermonRevision) {
        Task { @MainActor in
            do {
                let date = draft.liturgicalDate
                _ = try await store.capture(currentSnapshot, for: date, summary: "Antes da restauração")

                draft.title = revision.title
                draft.mainReadingReference = revision.mainReadingReference
                draft.mainReadingSlot = revision.mainReadingSlot
                draft.rtfData = revision.rtfData
                draft.modifiedAt = .now
                try modelContext.save()

                revisions = try await store.capture(
                    SermonRevisionSnapshot(draft: draft),
                    for: date,
                    summary: "Restaurada de v\(revision.version)",
                    force: true
                )
            } catch {
                errorMessage = "Não foi possível restaurar esta versão: \(error.localizedDescription)"
            }
        }
    }
}

private struct SermonRevisionComparisonSheet: View {
    let current: SermonRevisionSnapshot
    let currentVersion: Int
    let previous: SermonRevision

    private var currentText: String { SermonRevisionText.plainText(from: current.rtfData) }
    private var previousText: String { SermonRevisionText.plainText(from: previous.rtfData) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Comparar versões")
                    .font(PrototypeStyle.serif(20, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Spacer()
            }
            .padding(22)
            Divider()

            HStack(spacing: 0) {
                column(title: "v\(currentVersion) · edição atual", text: currentText)
                Divider()
                column(title: "v\(previous.version) · \(previous.summary)", text: previousText)
            }
        }
        .frame(minWidth: 760, minHeight: 540)
        .background(PrototypeStyle.canvas)
    }

    private func column(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PrototypeStyle.ink)
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
            Divider()
            ScrollView {
                Text(text.isEmpty ? "Esta versão não contém texto." : text)
                    .font(.system(size: 14))
                    .foregroundStyle(PrototypeStyle.ink)
                    .lineSpacing(5)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
