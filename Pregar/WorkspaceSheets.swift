import AppKit
import SwiftUI

@MainActor
final class BibleWindowSession: ObservableObject {
    @Published var reference = ""
}

struct BibleComparisonSceneView: View {
    @EnvironmentObject private var settingsStore: APISettingsStore
    @EnvironmentObject private var appearance: AppAppearanceStore
    @EnvironmentObject private var session: BibleWindowSession

    var body: some View {
        BibleComparisonView(
            reference: $session.reference,
            settings: settingsStore.settings,
            apiKey: settingsStore.credential ?? "",
            accent: appearance.accent
        )
    }
}

struct BibleComparisonView: View {
    private enum PassageScope: String {
        case pericope = "Perícope"
        case chapter = "Capítulo"
    }

    @Binding var reference: String
    let settings: APISettings
    let apiKey: String
    let accent: Color
    @Environment(\.dismiss) private var dismiss
    @State private var inputReference: String
    @State private var queryReference: String
    @State private var scope: PassageScope = .pericope
    @State private var comparisonBible = "naa"
    @State private var additionalBible: String?
    @State private var passages: [String: BiblePassageText] = [:]
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var activeLoadID: UUID?

    init(reference: Binding<String>, settings: APISettings, apiKey: String, accent: Color) {
        _reference = reference
        _inputReference = State(initialValue: reference.wrappedValue)
        _queryReference = State(initialValue: reference.wrappedValue)
        self.settings = settings
        self.apiKey = apiKey
        self.accent = accent
    }

    private var chapterReference: String {
        guard let range = queryReference.range(of: #"[.:]\d+[a-z]?([–-].*)?$"#, options: .regularExpression) else { return queryReference }
        return String(queryReference[..<range.lowerBound])
    }

    private var requestReference: String {
        scope == .chapter ? chapterReference : queryReference
    }

    private var requestKey: String {
        "\(requestReference)|\(settings.bible)|\(comparisonBible)|\(additionalBible ?? "")"
    }

    private func passageKey(for bible: String) -> String { "\(requestReference)|\(bible)" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                TextField("Referência bíblica", text: $inputReference)
                    .font(PrototypeStyle.serif(16, weight: .semibold))
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 13)
                    .frame(width: 222, height: 30)
                    .background(.white, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
                    .onSubmit { commitReference() }

                HStack(spacing: 2) {
                    scopeButton(.pericope)
                    scopeButton(.chapter)
                }
                .padding(2)
                .background(PrototypeStyle.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))

                Spacer(minLength: 6)

                translationBadge(settings.bible.uppercased(), active: true)
                Menu {
                    ForEach(["nvi", "naa", "ara"].filter { $0 != settings.bible }, id: \.self) { version in
                        Button(version.uppercased()) { comparisonBible = version }
                    }
                } label: {
                    Text(comparisonBible.uppercased())
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PrototypeStyle.ink)
                        .padding(.horizontal, 14)
                        .frame(height: 26)
                        .background(.white, in: Capsule())
                        .overlay(Capsule().stroke(PrototypeStyle.line, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                if let additionalBible {
                    translationBadge(additionalBible.uppercased(), active: false)
                } else {
                    Button("+ ARA") { additionalBible = "ara" }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PrototypeStyle.muted)
                        .padding(.horizontal, 13)
                        .frame(height: 28)
                        .overlay(Capsule().stroke(PrototypeStyle.muted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        .buttonStyle(.plain)
                }
            }
            .padding(.leading, 104)
            .padding(.trailing, 22)
            .frame(height: 52)
            .background(PrototypeStyle.canvas)

            Divider()

            HSplitView {
                ForEach([settings.bible, comparisonBible] + (additionalBible.map { [$0] } ?? []), id: \.self) { version in
                    passageColumn(
                        passages[passageKey(for: version)],
                        version: version,
                        isLoading: isLoading,
                        errorMessage: errorMessage
                    )
                }
            }
            .background(PrototypeStyle.paper)

            HStack {
                Text("Texto ilustrativo — a versão real vem da Estêvão API v2.")
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                if let errorMessage {
                    Text(errorMessage).font(.system(size: 10)).foregroundStyle(.red).lineLimit(1)
                }
                Spacer()
                if isLoading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 16)
            .frame(height: 29)
            .background(PrototypeStyle.canvas)
        }
        .frame(minWidth: 820, minHeight: 760)
        .background(PrototypeStyle.paper)
        .tint(accent)
        .task(id: requestKey) { await loadPassages() }
        .onChange(of: reference) { _, value in
            inputReference = value
            queryReference = value
        }
    }

    private func scopeButton(_ value: PassageScope) -> some View {
        Button {
            scope = value
        } label: {
            Text(value == .pericope ? value.rawValue : "Capítulo \(chapterReference.components(separatedBy: " ").last ?? "")")
                .font(.system(size: 12, weight: scope == value ? .semibold : .regular))
                .foregroundStyle(scope == value ? PrototypeStyle.ink : PrototypeStyle.muted)
                .padding(.horizontal, 11)
                .frame(height: 26)
                .background(scope == value ? .white : .clear, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }

    private func translationBadge(_ title: String, active: Bool) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active ? .white : PrototypeStyle.ink)
            .padding(.horizontal, 14)
            .frame(height: 26)
            .background(active ? accent : .white, in: Capsule())
    }

    private func passageColumn(_ text: BiblePassageText?, version: String, isLoading: Bool, errorMessage: String?) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 17) {
                if let verses = text?.verses, !verses.isEmpty {
                    ForEach(verses) { verse in
                        HStack(alignment: .firstTextBaseline, spacing: 13) {
                            Text("\(verse.number)")
                                .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
                                .foregroundStyle(version == settings.bible ? accent : PrototypeStyle.muted)
                                .frame(width: 18, alignment: .trailing)
                            Text(verse.text)
                                .font(PrototypeStyle.serif(23))
                                .foregroundStyle(PrototypeStyle.ink.opacity(version == settings.bible ? 0.92 : 0.48))
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                } else if let content = text?.content {
                    Text(content)
                        .font(PrototypeStyle.serif(23))
                        .foregroundStyle(PrototypeStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                } else if isLoading {
                    VStack(alignment: .leading, spacing: 8) {
                        ProgressView().controlSize(.small).tint(accent)
                        Text("Consultando \(version.uppercased())…")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.top, 24)
                } else {
                    ContentUnavailableView {
                        Label("Texto indisponível", systemImage: "text.book.closed")
                    } description: {
                        Text(errorMessage ?? "Envie uma referência para carregar esta tradução.")
                    } actions: {
                        Button("Tentar novamente") { Task { await loadPassages() } }
                    }
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 30)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(version == settings.bible ? .white : PrototypeStyle.canvas.opacity(0.45))
    }

    @MainActor
    private func loadPassages() async {
        let loadID = UUID()
        activeLoadID = loadID
        guard !apiKey.isEmpty else {
            errorMessage = "Configure sua chave da Estêvão API nas Preferências."
            isLoading = false
            return
        }
        guard !requestReference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = nil
            isLoading = false
            return
        }
        isLoading = true
        errorMessage = nil
        defer {
            if activeLoadID == loadID { isLoading = false }
        }
        do {
            let client = LiturgicalAPIClient(settings: settings, apiKey: apiKey)
            let primaryKey = passageKey(for: settings.bible)
            let comparisonKey = passageKey(for: comparisonBible)
            if passages[primaryKey] == nil && passages[comparisonKey] == nil {
                async let primary = client.fetchPassage(reference: requestReference, bible: settings.bible)
                async let comparison = client.fetchPassage(reference: requestReference, bible: comparisonBible)
                let (first, second) = try await (primary, comparison)
                try Task.checkCancellation()
                passages[primaryKey] = first
                passages[comparisonKey] = second
            } else {
                if passages[primaryKey] == nil {
                    passages[primaryKey] = try await client.fetchPassage(reference: requestReference, bible: settings.bible)
                }
                if passages[comparisonKey] == nil {
                    passages[comparisonKey] = try await client.fetchPassage(reference: requestReference, bible: comparisonBible)
                }
            }
            if let additionalBible {
                let additionalKey = passageKey(for: additionalBible)
                if passages[additionalKey] == nil {
                    passages[additionalKey] = try await client.fetchPassage(reference: requestReference, bible: additionalBible)
                }
            }
        } catch is CancellationError {
            return
        } catch {
            if activeLoadID == loadID { errorMessage = error.localizedDescription }
        }
    }

    private func commitReference() {
        let trimmed = inputReference.trimmingCharacters(in: .whitespacesAndNewlines)
        inputReference = trimmed
        queryReference = trimmed
        reference = trimmed
    }
}

struct ReviewRequestSheet: View {
    let accent: Color
    let context: SermonReviewContext
    let bibleSources: [SermonReviewSource]
    let onReport: (SermonReviewReport) -> Void
    let selectQuote: (String) -> Void
    let configureAI: () -> Void
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var readerSession: ReaderSessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var selected = Set(SermonReviewCriterion.allCases)
    @State private var isSending = false
    @State private var report: SermonReviewReport?
    @State private var errorMessage: String?

    private var selectedCriteria: [SermonReviewCriterion] {
        selected.sorted { $0.rawValue < $1.rawValue }
    }

    private var selectedMaterials: [ReaderTab] { readerSession.materialsMarkedForReview() }
    private var configuredProvider: AIProvider { aiSettings.reviewProvider }
    private var needsBible: Bool { selected.contains(.fidelity) }
    private var canSend: Bool {
        !isSending
            && !context.manuscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !selected.isEmpty
            && aiSettings.hasKey(for: configuredProvider)
            && (!needsBible || bibleSources.contains(where: { $0.id.hasPrefix("bible:") && !$0.text.isEmpty }))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            if let report {
                reportView(report)
            } else {
                Text("Nova revisão").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Text("Aponta e fundamenta. Não escreve, não completa, não sugere frases.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)

                LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 8) {
                    ForEach(SermonReviewCriterion.allCases) { criterion in
                        Toggle(criterion.title, isOn: Binding(
                            get: { selected.contains(criterion) },
                        set: { isSelected in
                                if isSelected { selected.insert(criterion) }
                                else { selected.remove(criterion) }
                            }
                        ))
                        .toggleStyle(.checkbox)
                        .font(.system(size: 12))
                    }
                }
                .padding(13)
                .background(.white, in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(PrototypeStyle.line, lineWidth: 1))

                VStack(alignment: .leading, spacing: 7) {
                    Text("PARA A REVISÃO").font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                    Text(payloadDescription)
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
                    if !needsBible {
                        Text("Os materiais marcados só serão enviados quando Fidelidade estiver selecionada.")
                            .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    } else {
                        if selectedMaterials.isEmpty {
                            Text("Nenhum material do Leitor está marcado.")
                                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                        } else {
                            Text(selectedMaterials.prefix(4).map(\.title).joined(separator: " · "))
                                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.ink).lineLimit(2)
                            if selectedMaterials.count > 4 {
                                Text("e mais \(selectedMaterials.count - 4) materiais")
                                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                            }
                        }
                    }
                }
                .padding(13)
                .background(.white, in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(PrototypeStyle.line, lineWidth: 1))

                HStack(spacing: 8) {
                    Image(systemName: "key.fill").foregroundStyle(accent)
                    Text(aiSettings.hasKey(for: configuredProvider)
                         ? "\(configuredProvider.name) · \(aiSettings.reviewModel) · chave salva neste Mac"
                         : "Nenhuma chave salva para \(configuredProvider.name).")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    Spacer(minLength: 0)
                    Button("Configurar") { configureAI() }
                        .font(.system(size: 11, weight: .medium))
                        .buttonStyle(.plain)
                        .foregroundStyle(accent)
                }
                if needsBible && !bibleSources.contains(where: { $0.id.hasPrefix("bible:") && !$0.text.isEmpty }) {
                    Label("O texto bíblico ainda não foi carregado; Fidelidade ficará indisponível.", systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
                if let errorMessage {
                    Text(errorMessage).font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    Spacer()
                    Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                    Button {
                        Task { await sendReview() }
                    } label: {
                        if isSending {
                            Label("Revisando…", systemImage: "hourglass")
                        } else {
                            Text("Enviar revisão")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    .disabled(!canSend)
                    .help("O manuscrito e as fontes listadas serão enviados ao provedor selecionado")
                }
            }
        }
        .padding(22)
        .frame(width: 540)
        .frame(minHeight: 300)
        .background(PrototypeStyle.canvas)
    }

    private var payloadDescription: String {
        var sourceParts: [String] = []
        if needsBible {
            sourceParts.append("a leitura bíblica e as traduções disponíveis")
            if !selectedMaterials.isEmpty { sourceParts.append("os materiais marcados") }
        }
        let selectedDescription = sourceParts.isEmpty
            ? "O manuscrito"
            : "O manuscrito, " + sourceParts.joined(separator: " e ")
        return "\(selectedDescription) serão enviados diretamente a \(configuredProvider.name) ao clicar em Enviar revisão. A chamada usa sua chave, não passa pelo app Pregar, e nunca altera o manuscrito. Aplicam-se as regras de retenção do provedor."
    }

    @ViewBuilder
    private func reportView(_ report: SermonReviewReport) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Revisão").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Spacer()
                Text("\(report.provider.name) · \(report.model)")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
            }
            if report.isEmpty {
                ContentUnavailableView("Nenhuma observação", systemImage: "checkmark.circle", description: Text("Não encontrei apontamentos fundamentados nos critérios escolhidos."))
                    .frame(minHeight: 150)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(report.findings) { finding in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(finding.criterion.title.uppercased())
                                        .font(.system(size: 10, weight: .bold)).foregroundStyle(accent)
                                    Spacer()
                                    Text(finding.severity == .attention ? "verificar" : "nota")
                                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                                }
                                if !finding.manuscriptQuote.isEmpty {
                                    Text("“\(finding.manuscriptQuote)”")
                                        .font(.system(size: 12, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Button("Ir ao trecho", systemImage: "text.viewfinder") {
                                        selectQuote(finding.manuscriptQuote)
                                        dismiss()
                                    }
                                    .font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(accent)
                                }
                                Text(finding.observation)
                                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                if !finding.correction.isEmpty {
                                    Text("Grafia: \(finding.correction)")
                                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(accent)
                                }
                                if !finding.evidenceQuote.isEmpty {
                                    Text("“\(finding.evidenceQuote)”")
                                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text([finding.evidenceSourceTitle, finding.evidenceCitation].compactMap { $0 }.joined(separator: " · "))
                                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                                }
                            }
                            .padding(.vertical, 9)
                            .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                        }
                    }
                }
                .frame(maxHeight: 430)
            }
            HStack {
                Text("Relatório salvo neste Mac · \(report.createdAt.formatted(date: .omitted, time: .shortened))")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                Spacer()
                Button("Concluído") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
    }

    @MainActor
    private func sendReview() async {
        guard canSend else { return }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        let provider = configuredProvider
        do {
            guard let key = await aiSettings.key(for: provider), !key.isEmpty else { throw SermonReviewError.noKey }
            var sources = needsBible ? bibleSources : []
            if needsBible {
                sources.append(contentsOf: try await readerSession.reviewSources(for: context.mainReference))
            }
            let criteria = selectedCriteria
            let requestContext = SermonReviewContext(
                dateKey: context.dateKey,
                title: context.title,
                mainReference: context.mainReference,
                manuscript: context.manuscript,
                criteria: criteria
            )
            let findings = try await SermonAIReviewClient().review(
                context: requestContext,
                sources: sources,
                configuration: SermonReviewConfiguration(
                    provider: provider,
                    model: aiSettings.reviewModel,
                    apiKey: key
                )
            )
            let completed = SermonReviewReport(
                id: UUID(),
                createdAt: .now,
                dateKey: context.dateKey,
                title: context.title,
                mainReference: context.mainReference,
                provider: provider,
                model: aiSettings.reviewModel,
                manuscriptFingerprint: SermonReviewReport.fingerprint(context.manuscript),
                criteria: criteria,
                findings: findings
            )
            do {
                _ = try await SermonReviewReportStore.shared.save(completed)
                onReport(completed)
                report = completed
            } catch {
                report = completed
                errorMessage = "Revisão concluída, mas não foi possível guardar o relatório: \(error.localizedDescription)"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct EmergencyQuestionsSheet: View {
    let accent: Color
    let configureAI: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("Perguntas de emergência").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text("Perguntas sobre o que você já escreveu. Sem ideias novas, sem aplicação, sem redação.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            VStack(alignment: .leading, spacing: 7) {
                Text("ESCOPO").font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                Text("As perguntas partirão apenas do manuscrito, da leitura principal e dos materiais que você marcar para revisão.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            }
            .padding(13)
            .background(.white, in: RoundedRectangle(cornerRadius: 9))

            HStack(spacing: 8) {
                Image(systemName: "key.fill").foregroundStyle(accent)
                Text("Configure um provedor de IA para usar esta ação.")
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                Spacer()
                Button("Configurar") { configureAI() }.buttonStyle(.plain).foregroundStyle(accent)
            }
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Pedir perguntas") {}
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    .disabled(true)
            }
        }
        .padding(22)
        .frame(width: 540)
        .background(PrototypeStyle.canvas)
    }
}

struct TabletPreparationSheet: View {
    let draft: SermonDraft?
    let accent: Color
    let openSettings: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var format = "Google Doc"
    @State private var readingSize = 14.0
    @State private var includeFootnotes = true
    @State private var availableOffline = true

    private var manuscript: String {
        guard let data = draft?.rtfData,
              let text = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) else { return "" }
        return text.string
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Preparar para pregar").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text("Uma versão de leitura no Drive, para o tablet. O manuscrito não muda.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)

            HStack(spacing: 14) {
                Text("Formato").foregroundStyle(PrototypeStyle.muted)
                Picker("Formato", selection: $format) {
                    Text("Google Doc").tag("Google Doc")
                    Text("PDF").tag("PDF")
                }
                .labelsHidden()
                Spacer()
                Text("Fonte de leitura").foregroundStyle(PrototypeStyle.muted)
                Stepper("\(Int(readingSize)) pt", value: $readingSize, in: 12...24)
                    .frame(width: 116)
            }
            .font(.system(size: 12))

            Toggle("Notas de rodapé no fim", isOn: $includeFootnotes)
                .toggleStyle(.checkbox)
            Toggle("Disponível offline no tablet antes do domingo", isOn: $availableOffline)
                .toggleStyle(.checkbox)

            VStack(alignment: .leading, spacing: 5) {
                Text("CÓPIA NO DRIVE").font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                Text("Nenhuma conta Google conectada.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))

            ScrollView {
                Text(manuscript.isEmpty ? "O manuscrito está vazio." : manuscript)
                    .font(.system(size: readingSize))
                    .foregroundStyle(PrototypeStyle.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
            .frame(height: 170)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))

            HStack {
                Button("Configurar Drive") { openSettings() }
                    .buttonStyle(.plain)
                    .foregroundStyle(accent)
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Atualizar cópia no Drive") {}
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    .disabled(true)
                    .help("Conecte uma conta Google nas Preferências")
            }
        }
        .font(.system(size: 12))
        .padding(22)
        .frame(width: 650, height: 620)
        .background(PrototypeStyle.canvas)
    }
}
