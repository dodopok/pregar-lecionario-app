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
    @State private var selectedComparisonBibles = ["naa"]
    @State private var availableVersions: [BibleVersion] = []
    @State private var isLoadingVersions = false
    @State private var catalogError: String?
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
        "\(requestReference)|\(displayedVersionCodes.joined(separator: ","))"
    }

    private func passageKey(for bible: String) -> String { "\(requestReference)|\(bible)" }

    private var displayedVersionCodes: [String] {
        [settings.bible] + selectedComparisonBibles.filter { $0 != settings.bible }
    }

    private var versionsAvailableToAdd: [BibleVersion] {
        availableVersions.filter { !displayedVersionCodes.contains($0.code) }
    }

    private var requestedScripture: ScriptureReference? {
        ScriptureReference.parse(requestReference)
    }

    private var spansMultipleChapters: Bool {
        guard let requestedScripture else { return false }
        return (requestedScripture.endChapter ?? requestedScripture.chapter) != requestedScripture.chapter
    }

    private var fallbackChapter: Int? {
        spansMultipleChapters ? nil : requestedScripture?.chapter
    }

    private var chapterCoordinatesUnavailable: Bool {
        guard spansMultipleChapters, !isLoading else { return false }
        return displayedVersionCodes.contains { code in
            guard let passage = passages[passageKey(for: code)] else { return false }
            guard let verses = passage.verses, !verses.isEmpty else { return true }
            return verses.contains { $0.chapter == nil }
        }
    }

    private var versePositions: [BibleVersePosition] {
        guard !chapterCoordinatesUnavailable else { return [] }
        let positions = displayedVersionCodes.flatMap { code in
            passages[passageKey(for: code)]?.verses?.map { $0.position(fallbackChapter: fallbackChapter) } ?? []
        }
        if !positions.isEmpty { return Array(Set(positions)).sorted() }
        return displayedVersionCodes.contains { code in
            !(passages[passageKey(for: code)]?.content?.isEmpty ?? true)
        } ? [BibleVersePosition(chapter: fallbackChapter, number: 0)] : []
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PrototypeStyle.muted)
                        .accessibilityHidden(true)
                    TextField("Referência, ex. João 3:16", text: $inputReference)
                        .font(PrototypeStyle.serif(16, weight: .semibold))
                        .textFieldStyle(.plain)
                        .onSubmit { commitReference() }
                        .accessibilityLabel("Referência bíblica")
                }
                .padding(.horizontal, 12)
                .frame(width: 250, height: 30, alignment: .center)
                .background(.white, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous).stroke(PrototypeStyle.line, lineWidth: 1))
                .help("Digite a referência e pressione Enter")

                HStack(spacing: 2) {
                    scopeButton(.pericope)
                    scopeButton(.chapter)
                }
                .padding(2)
                .background(PrototypeStyle.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))

                Spacer(minLength: 6)

                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(displayedVersionCodes, id: \.self) { code in
                            translationChip(code, isPrimary: code == settings.bible)
                        }
                        Menu {
                            if isLoadingVersions {
                                Label("Carregando traduções…", systemImage: "arrow.triangle.2.circlepath")
                            } else if !availableVersions.isEmpty {
                                if versionsAvailableToAdd.isEmpty {
                                    Text("Todas as traduções disponíveis já estão abertas")
                                } else {
                                    Section("Adicionar tradução") {
                                        ForEach(versionsAvailableToAdd) { version in
                                            Button(versionMenuTitle(version)) {
                                                setTranslation(version.code, selected: true)
                                            }
                                        }
                                    }
                                }
                            } else {
                                Text(catalogError ?? "Catálogo indisponível")
                                Button("Tentar novamente") { Task { await loadBibleVersions() } }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                    .font(.system(size: 11, weight: .medium))
                                Text(versionsAvailableToAdd.first?.code.uppercased() ?? "Bíblia")
                                    .font(.system(size: 13, weight: .medium))
                            }
                            .foregroundStyle(PrototypeStyle.muted)
                            .padding(.horizontal, 11)
                            .frame(height: 26)
                            .overlay {
                                Capsule().strokeBorder(
                                    PrototypeStyle.muted.opacity(0.42),
                                    style: StrokeStyle(lineWidth: 1, dash: [3, 2])
                                )
                            }
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                        .menuStyle(.borderlessButton)
                        .help("Adicionar tradução à comparação")
                        .accessibilityLabel(versionsAvailableToAdd.first.map { "Adicionar tradução \($0.code.uppercased())" } ?? "Adicionar tradução")
                    }
                }
                .scrollIndicators(.hidden)
                .frame(maxWidth: 220)
            }
            .padding(.leading, PrototypeStyle.Layout.windowControlsInset)
            .padding(.trailing, 22)
            .frame(height: PrototypeStyle.Layout.headerHeight)
            .background(PrototypeStyle.canvas)

            Divider()

            GeometryReader { geometry in
                let columnWidth = max(280, geometry.size.width / CGFloat(max(displayedVersionCodes.count, 1)))
                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(spacing: 0) {
                        HStack(spacing: 0) {
                            ForEach(displayedVersionCodes, id: \.self) { version in
                                Text(versionHeader(version))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(version == settings.bible ? accent : PrototypeStyle.ink)
                                    .frame(width: columnWidth, height: 42, alignment: .leading)
                                    .padding(.horizontal, 18)
                                    .overlay(alignment: .trailing) { Rectangle().fill(PrototypeStyle.line).frame(width: 1) }
                            }
                        }
                        .background(PrototypeStyle.canvas)

                        if versePositions.isEmpty {
                            VStack(spacing: 10) {
                                if isLoading {
                                    ProgressView().controlSize(.small).tint(accent)
                                } else {
                                    Image(systemName: "text.book.closed").foregroundStyle(PrototypeStyle.muted)
                                }
                                Text(isLoading
                                     ? "Carregando as traduções…"
                                     : (chapterCoordinatesUnavailable
                                        ? "A resposta da Estêvão API não informa o capítulo de cada versículo. Atualize a API para comparar referências entre capítulos."
                                        : (errorMessage ?? "Nenhum texto disponível para esta referência.")))
                                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                                    .multilineTextAlignment(.center)
                                    .frame(maxWidth: 520)
                                if !isLoading {
                                    Button("Tentar novamente") { Task { await loadPassages() } }
                                        .buttonStyle(.bordered)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 150)
                        } else {
                            ForEach(versePositions) { position in
                                HStack(alignment: .top, spacing: 0) {
                                    ForEach(displayedVersionCodes, id: \.self) { version in
                                        verseCell(version: version, position: position, width: columnWidth)
                                            .overlay(alignment: .trailing) { Rectangle().fill(PrototypeStyle.line).frame(width: 1) }
                                    }
                                }
                                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                            }
                        }
                    }
                }
                .background(PrototypeStyle.paper)
            }

            HStack(spacing: 10) {
                Text(footerStatus)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(1)
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
        .task(id: apiKey) { await loadBibleVersions() }
        .task(id: requestKey) { await loadPassages() }
        .onChange(of: reference) { _, value in
            inputReference = value
            queryReference = value
        }
    }

    private var footerStatus: String {
        let trimmed = requestReference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Digite uma referência e pressione Enter para comparar traduções." }
        let count = displayedVersionCodes.count
        return "\(trimmed) · \(count) \(count == 1 ? "tradução" : "traduções") · Estêvão API v2"
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
        .buttonStyle(.hoverHighlight)
        .frame(minHeight: 34)
        .contentShape(Rectangle())
        .accessibilityAddTraits(scope == value ? .isSelected : [])
    }

    @ViewBuilder
    private func translationChip(_ code: String, isPrimary: Bool) -> some View {
        if isPrimary {
            Text(code.uppercased())
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 26)
                .background(accent, in: Capsule())
                .padding(.vertical, 4)
                .contentShape(Rectangle())
        } else {
            Button {
                setTranslation(code, selected: false)
            } label: {
                HStack(spacing: 5) {
                    Text(code.uppercased())
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PrototypeStyle.ink)
                .padding(.horizontal, 12)
                .frame(height: 26)
                .background(.white, in: Capsule())
                .overlay(Capsule().stroke(PrototypeStyle.line, lineWidth: 1))
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Remover \(code.uppercased()) da comparação")
            .accessibilityLabel("Remover \(code.uppercased()) da comparação")
        }
    }

    private func verseCell(version: String, position: BibleVersePosition, width: CGFloat) -> some View {
        let passage = passages[passageKey(for: version)]
        let text = position.number == 0
            ? passage?.content
            : passage?.verses?.first(where: { $0.position(fallbackChapter: fallbackChapter) == position })?.text
        return HStack(alignment: .top, spacing: 13) {
            if position.number > 0 {
                Text(verseLabel(position))
                    .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(accent)
                    .frame(width: spansMultipleChapters ? 34 : 18, alignment: .trailing)
            }
            if let text {
                Text(text)
                    .font(PrototypeStyle.serif(19))
                    .foregroundStyle(PrototypeStyle.ink)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            } else if isLoading {
                Text("Consultando…")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            } else {
                Text("Versículo indisponível")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .frame(width: width, alignment: .leading)
        .frame(minHeight: 62, alignment: .topLeading)
        .background(PrototypeStyle.paper)
    }

    private func verseLabel(_ position: BibleVersePosition) -> String {
        guard spansMultipleChapters, let chapter = position.chapter else { return "\(position.number)" }
        return "\(chapter):\(position.number)"
    }

    @MainActor
    private func loadBibleVersions() async {
        guard !apiKey.isEmpty else {
            catalogError = "Configure a chave da Estêvão API para carregar o catálogo."
            isLoadingVersions = false
            return
        }
        isLoadingVersions = true
        catalogError = nil
        defer { isLoadingVersions = false }
        do {
            let versions = try await LiturgicalAPIClient(settings: settings, apiKey: apiKey).fetchBibleVersions()
            try Task.checkCancellation()
            availableVersions = versions
            selectedComparisonBibles.removeAll { code in
                !versions.contains(where: { $0.code == code })
            }
            if selectedComparisonBibles.isEmpty,
               let recommended = versions.first(where: { $0.code != settings.bible && $0.isRecommended == true }) {
                selectedComparisonBibles = [recommended.code]
            }
        } catch is CancellationError {
            return
        } catch {
            catalogError = error.localizedDescription
        }
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
            let reference = requestReference
            let missingVersions = displayedVersionCodes.filter { passages[passageKey(for: $0)] == nil }
            let requests = missingVersions.map { version in
                Task { @MainActor in
                    (version, try? await client.fetchPassage(reference: reference, bible: version))
                }
            }
            for request in requests {
                let (version, passage) = await request.value
                try Task.checkCancellation()
                if let passage { passages["\(reference)|\(version)"] = passage }
            }
            if displayedVersionCodes.allSatisfy({ passages[passageKey(for: $0)] == nil }) {
                errorMessage = "Não foi possível carregar nenhuma tradução desta passagem."
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

    private func setTranslation(_ code: String, selected: Bool) {
        guard code != settings.bible else { return }
        if selected {
            if !selectedComparisonBibles.contains(code) { selectedComparisonBibles.append(code) }
        } else {
            selectedComparisonBibles.removeAll { $0 == code }
        }
    }

    private func versionMenuTitle(_ version: BibleVersion) -> String {
        let language = version.language.map { " · \($0)" } ?? ""
        let fullName = version.fullName.map { " — \($0)" } ?? ""
        return "\(version.name)\(fullName)\(language)"
    }

    private func versionHeader(_ code: String) -> String {
        guard let version = availableVersions.first(where: { $0.code == code }) else { return code.uppercased() }
        return "\(version.name) · \(version.fullName ?? version.language ?? "")"
    }
}

struct ReviewRequestSheet: View {
    let accent: Color
    let context: SermonReviewContext
    let bibleSources: [SermonReviewSource]
    /// Critérios pré-marcados ao abrir; "Checar estrutura" abre só com Estrutura.
    var initialCriteria: Set<SermonReviewCriterion> = Set(SermonReviewCriterion.allCases)
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
                SheetHeader(
                    title: "Nova revisão",
                    subtitle: "Aponta e fundamenta. Não escreve, não completa, não sugere frases.",
                    symbol: "checkmark.seal",
                    accent: accent
                )

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(SermonReviewCriterion.allCases) { criterion in
                        Toggle(isOn: Binding(
                            get: { selected.contains(criterion) },
                            set: { isSelected in
                                if isSelected { selected.insert(criterion) }
                                else { selected.remove(criterion) }
                            }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(criterion.title)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(PrototypeStyle.ink)
                                Text(criterion.guidance)
                                    .font(.system(size: 11))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .toggleStyle(.checkbox)
                    }
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "list.bullet.below.rectangle")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(accent)
                            .padding(.top, 1)
                        Text("O mapa do sermão acompanha toda revisão: onde começam introdução, desenvolvimento e conclusão, a ideia dominante, os movimentos e onde a Boa Nova aparece.")
                            .font(.system(size: 11))
                            .foregroundStyle(PrototypeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
                .panelCard()

                VStack(alignment: .leading, spacing: 7) {
                    SectionLabel("Para a revisão")
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
                .panelCard()

                HStack(spacing: 8) {
                    Image(systemName: "key.fill").foregroundStyle(accent)
                    Text(aiSettings.hasKey(for: configuredProvider)
                         ? "\(configuredProvider.name) · \(aiSettings.reviewModel) · chave salva neste Mac"
                         : "Nenhuma chave salva para \(configuredProvider.name).")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    Spacer(minLength: 0)
                    Button("Configurar") { configureAI() }
                        .buttonStyle(.linkAction(accent, compact: true))
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
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 560)
        .frame(minHeight: 300)
        .background(PrototypeStyle.canvas)
        .onAppear { selected = initialCriteria }
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
            if report.isEmpty && report.structure == nil {
                if let validationNotice = report.validationNotice {
                    ContentUnavailableView(
                        "Nenhuma observação verificável",
                        systemImage: "exclamationmark.shield",
                        description: Text(validationNotice)
                    )
                    .frame(minHeight: 150)
                } else {
                    ContentUnavailableView(
                        "Nenhuma observação",
                        systemImage: "checkmark.circle",
                        description: Text("Não encontrei apontamentos fundamentados nos critérios escolhidos.")
                    )
                    .frame(minHeight: 150)
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let validationNotice = report.validationNotice {
                            Label(validationNotice, systemImage: "checkmark.shield")
                                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let structure = report.structure {
                            SermonStructureMapView(
                                structure: structure,
                                accent: accent,
                                isStale: false,
                                compact: false
                            ) { quote in
                                selectQuote(quote)
                                dismiss()
                            }
                        }
                        if report.isEmpty {
                            Label("Nenhum apontamento além do mapa nos critérios escolhidos.", systemImage: "checkmark.circle")
                                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                        } else {
                            SectionLabel("Apontamentos")
                                .padding(.top, 4)
                        }
                        ForEach(report.findings) { finding in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(finding.criterion.title.uppercased())
                                        .font(.system(size: 10, weight: .bold)).foregroundStyle(accent)
                                    Spacer()
                                    Text(finding.severity == .attention ? "verificar" : "nota")
                                        .font(.system(size: 10)).foregroundStyle(finding.severity == .attention ? PrototypeStyle.warning : PrototypeStyle.muted)
                                }
                                if !finding.manuscriptQuote.isEmpty {
                                    Text("“\(finding.manuscriptQuote)”")
                                        .font(.system(size: 12, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Button("Ir ao trecho", systemImage: "text.viewfinder") {
                                        selectQuote(finding.manuscriptQuote)
                                        dismiss()
                                    }
                                    .buttonStyle(.linkAction(accent, compact: true))
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
                .frame(maxHeight: 480)
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
            let result = try await SermonAIReviewClient().review(
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
                findings: result.findings,
                validationNotice: result.validationNotice,
                structure: result.structure
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
    let context: SermonQuestionContext
    let bibleSources: [SermonReviewSource]
    let selectQuote: (String) -> Void
    let configureAI: () -> Void
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var readerSession: ReaderSessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var questions: [SermonAIQuestion]?
    @State private var isSending = false
    @State private var errorMessage: String?

    private var selectedMaterials: [ReaderTab] { readerSession.materialsMarkedForReview() }
    private var provider: AIProvider { aiSettings.reviewProvider }
    private var canSend: Bool {
        !isSending
            && !context.manuscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && aiSettings.hasKey(for: provider)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            if let questions {
                resultView(questions)
            } else {
                SheetHeader(
                    title: "Perguntas de emergência",
                    subtitle: "Perguntas sobre o que você já escreveu. Sem ideias novas, sem aplicação, sem redação.",
                    symbol: "questionmark.circle",
                    accent: accent
                )
                VStack(alignment: .leading, spacing: 7) {
                    SectionLabel("Escopo")
                    Text(payloadDescription)
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
                    if !selectedMaterials.isEmpty {
                        Text(selectedMaterials.prefix(4).map(\.title).joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(PrototypeStyle.ink).lineLimit(2)
                        if selectedMaterials.count > 4 {
                            Text("e mais \(selectedMaterials.count - 4) materiais")
                                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                        }
                    }
                }
                .panelCard()

                HStack(spacing: 8) {
                    Image(systemName: "key.fill").foregroundStyle(accent)
                    Text(aiSettings.hasKey(for: provider)
                         ? "\(provider.name) · \(aiSettings.reviewModel) · chave salva neste Mac"
                         : "Nenhuma chave salva para \(provider.name).")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    Spacer(minLength: 0)
                    Button("Configurar") { configureAI() }
                        .buttonStyle(.linkAction(accent, compact: true))
                }
                if context.manuscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Label("Escreva no manuscrito antes de pedir perguntas.", systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
                if let errorMessage {
                    Text(errorMessage).font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    Spacer()
                    Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                    Button {
                        Task { await requestQuestions() }
                    } label: {
                        if isSending {
                            Label("Pensando…", systemImage: "hourglass")
                        } else {
                            Text("Pedir perguntas")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    .disabled(!canSend)
                    .help("O manuscrito e as fontes listadas serão enviados ao provedor selecionado")
                }
            }
        }
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 560)
        .frame(minHeight: 300)
        .background(PrototypeStyle.canvas)
    }

    private var payloadDescription: String {
        var included: [String] = []
        if !context.mainReference.isEmpty { included.append("leitura principal") }
        if !bibleSources.isEmpty { included.append("traduções bíblicas carregadas") }
        if !selectedMaterials.isEmpty { included.append("materiais marcados no Leitor") }
        let scope = (["manuscrito"] + included).joined(separator: ", ")
        return "\(scope) serão enviados diretamente a \(provider.name) ao clicar em Pedir perguntas. A chamada usa sua chave, não passa pelo app Pregar, e nada é escrito no manuscrito. Aplicam-se as regras de retenção do provedor."
    }

    @ViewBuilder
    private func resultView(_ questions: [SermonAIQuestion]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Perguntas").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
                Spacer()
                Text("\(provider.name) · \(aiSettings.reviewModel)")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
            }
            if questions.isEmpty {
                ContentUnavailableView("Sem perguntas adicionais", systemImage: "text.bubble", description: Text("Não encontrei uma pergunta neutra que respeitasse os limites definidos."))
                    .frame(minHeight: 150)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(questions) { item in
                            VStack(alignment: .leading, spacing: 7) {
                                Text("“\(item.manuscriptQuote)”")
                                    .font(.system(size: 11, weight: .medium)).foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(item.question)
                                    .font(.system(size: 13, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button("Ir ao trecho", systemImage: "text.viewfinder") { selectQuote(item.manuscriptQuote) }
                                    .buttonStyle(.linkAction(accent, compact: true))
                                if !item.evidenceQuote.isEmpty {
                                    Text("“\(item.evidenceQuote)”")
                                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text([item.evidenceSourceTitle, item.evidenceCitation].compactMap { $0 }.joined(separator: " · "))
                                        .font(.system(size: 9)).foregroundStyle(PrototypeStyle.muted)
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
                Text("Perguntas temporárias · nada foi acrescentado ao manuscrito")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                Spacer()
                Button("Concluído") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
    }

    @MainActor
    private func requestQuestions() async {
        guard canSend else { return }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        do {
            guard let key = await aiSettings.key(for: provider), !key.isEmpty else {
                throw SermonAIQuestionError.noKey
            }
            let sources = bibleSources + (try await readerSession.reviewSources(for: context.mainReference))
            questions = try await SermonAIQuestionClient().questions(
                context: context,
                sources: sources,
                configuration: SermonReviewConfiguration(
                    provider: provider,
                    model: aiSettings.reviewModel,
                    apiKey: key
                )
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct GoogleDriveConnectionSheet: View {
    let accent: Color
    @EnvironmentObject private var googleDrive: GoogleDriveStore
    @Environment(\.dismiss) private var dismiss
    @State private var clientID: String

    init(accent: Color) {
        self.accent = accent
        _clientID = State(initialValue: UserDefaults.standard.string(forKey: "drive.oauthClientID") ?? "")
    }

    private var clientIDIsValid: Bool {
        clientID.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix(".apps.googleusercontent.com")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SheetHeader(
                title: "Google Drive",
                subtitle: googleDrive.isConnected
                    ? "Conectado neste Mac. A cópia do sermão e o documento de ideias ficam na sua conta."
                    : "Mantém uma cópia do sermão no Drive e lê o documento de ideias anotado pelo iPhone.",
                symbol: googleDrive.isConnected ? "checkmark.icloud" : "icloud",
                accent: accent
            )

            if googleDrive.isConnected {
                HStack(spacing: 10) {
                    Image(systemName: "person.crop.circle.fill").foregroundStyle(accent)
                    Text("Google Drive conectado").font(.system(size: 13, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                    Spacer()
                    Button("Desconectar", role: .destructive) {
                        Task { await googleDrive.disconnect() }
                    }
                    .disabled(googleDrive.isConnecting || googleDrive.isSaving)
                }
                .panelCard()
                Text("Os documentos ligados continuam identificados nos sermões deste Mac. Ao reconectar, use a mesma conta Google.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("OAuth Client ID").font(.system(size: 12, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                    TextField("000000000000-….apps.googleusercontent.com", text: $clientID)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))
                    Text("Identificador público do app para OAuth de desktop. Não use client secret.")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                }
                .panelCard()
                Text("A autorização abre no navegador padrão e retorna para esta janela. O token de renovação fica no Acesso às Chaves deste Mac.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            }

            if let error = googleDrive.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12)).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Fechar") { dismiss() }.keyboardShortcut(.cancelAction)
                if !googleDrive.isConnected {
                    Button {
                        Task {
                            await googleDrive.connect(clientID: clientID)
                            if googleDrive.isConnected { dismiss() }
                        }
                    } label: {
                        if googleDrive.isConnecting { ProgressView().controlSize(.small) }
                        else { Label("Conectar", systemImage: "person.crop.circle.badge.checkmark") }
                    }
                    .buttonStyle(.borderedProminent).tint(accent)
                    .disabled(!clientIDIsValid || googleDrive.isConnecting || googleDrive.isLoading)
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 560, height: 360)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
    }
}

struct TabletPreparationSheet: View {
    let draft: SermonDraft?
    let accent: Color
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var googleDrive: GoogleDriveStore
    @AppStorage("drive.lastTabletFolder") private var lastTabletFolder = ""
    @AppStorage("drive.font") private var readingFont = "Arial"
    @AppStorage("drive.fontSize") private var readingSize = 14.0
    @State private var format = "PDF"
    @State private var includeFootnotes = true
    @State private var isExporting = false
    @State private var showingDriveConnection = false
    @State private var showingOverwriteConfirmation = false
    @State private var alertMessage: String?

    private var manuscript: String {
        guard let data = draft?.rtfData,
              let text = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) else { return "" }
        return text.string
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SheetHeader(
                title: "Preparar para pregar",
                subtitle: "Uma cópia paginada para leitura no tablet. O manuscrito original não muda.",
                symbol: "ipad.landscape",
                accent: accent
            )

            HStack(spacing: 14) {
                Text("Formato").foregroundStyle(PrototypeStyle.muted)
                Picker("Formato", selection: $format) {
                    Text("Google Doc").tag("Google Doc")
                    Text("PDF").tag("PDF")
                }
                .labelsHidden()
                Spacer()
                Text("Fonte de leitura").foregroundStyle(PrototypeStyle.muted)
                Stepper("\(Int(readingSize)) pt", value: $readingSize, in: 8...24)
                    .frame(width: 116)
            }
            .font(.system(size: 12))

            Toggle("Notas de rodapé no fim", isOn: $includeFootnotes)
                .toggleStyle(.checkbox)
            Toggle("Disponível offline no tablet antes do domingo", isOn: .constant(false))
                .toggleStyle(.checkbox)
                .disabled(true)
                .help("A disponibilidade offline é controlada no aplicativo Google Drive do tablet.")

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(format == "PDF" ? "Cópia PDF para o tablet" : "Google Doc")
                if format == "Google Doc" {
                    if googleDrive.isLoading {
                        Label("Verificando conexão…", systemImage: "hourglass")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    } else if !googleDrive.isConnected {
                        Label("Google Drive não conectado.", systemImage: "icloud")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    } else if let draft, let syncedAt = draft.googleDriveSyncedAt {
                        Label("Documento vinculado · atualizado \(syncedAt.formatted(date: .omitted, time: .shortened))", systemImage: "checkmark.icloud.fill")
                            .font(.system(size: 12)).foregroundStyle(accent)
                    } else {
                        Label("O Google Doc será criado na pasta de sermões.", systemImage: "doc.badge.plus")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    if let error = draft?.googleDriveSyncError {
                        Text(error).font(.system(size: 11)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    }
                    if let id = draft?.googleDriveDocumentID, let url = googleDrive.documentURL(for: id) {
                        Button("Abrir no Google Docs", systemImage: "arrow.up.right.square") {
                            NSWorkspace.shared.open(url)
                        }
                        .buttonStyle(.plain).foregroundStyle(accent)
                    }
                } else if let path = draft?.tabletPDFPath, FileManager.default.fileExists(atPath: path) {
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text.fill").foregroundStyle(accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(URL(fileURLWithPath: path).lastPathComponent)
                                .font(.system(size: 12, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                                .lineLimit(1).truncationMode(.middle)
                            Text(draft?.tabletPDFUpdatedAt?.formatted(date: .abbreviated, time: .shortened) ?? "PDF salvo neste Mac")
                                .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                        }
                        Spacer()
                        Button {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                        } label: {
                            Image(systemName: "folder")
                        }
                        .buttonStyle(.plain)
                        .help("Mostrar no Finder")
                    }
                    Text(URL(fileURLWithPath: path).deletingLastPathComponent().path)
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(PrototypeStyle.muted)
                        .lineLimit(1).truncationMode(.middle)
                } else if draft?.tabletPDFPath == nil {
                    Text("Nenhuma cópia em PDF exportada.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                } else {
                    Text("O PDF salvo não foi encontrado neste local.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panelCard()

            VStack(alignment: .leading, spacing: 6) {
                SectionLabel("Prévia da leitura")
                ScrollView {
                    Text(manuscript.isEmpty ? "O manuscrito está vazio." : manuscript)
                        .font(.custom(readingFont, size: readingSize))
                        .foregroundStyle(PrototypeStyle.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(PrototypeStyle.Spacing.lg)
                }
                .frame(height: 160)
                .background(.white, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous).stroke(PrototypeStyle.line, lineWidth: 1))
            }

            HStack {
                if format == "Google Doc" && !googleDrive.isConnected {
                    Button("Conectar Google Drive", systemImage: "icloud") { showingDriveConnection = true }
                        .buttonStyle(.linkAction(accent))
                }
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button {
                    if format == "Google Doc" { saveGoogleDoc() }
                    else { exportPDF() }
                } label: {
                    if isExporting || googleDrive.isSaving { ProgressView().controlSize(.small) }
                    else if format == "Google Doc" {
                        Label(draft?.googleDriveDocumentID == nil ? "Criar Google Doc" : "Atualizar Google Doc", systemImage: "arrow.up.doc")
                    } else { Label("Exportar PDF", systemImage: "square.and.arrow.up") }
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
                .disabled(isExporting || googleDrive.isSaving || manuscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (format == "Google Doc" && !googleDrive.isConnected))
                .help(format == "PDF" ? "Salvar uma cópia paginada para leitura no tablet" : "Criar ou atualizar o manuscrito no Google Drive")
            }
        }
        .font(.system(size: 12))
        .padding(PrototypeStyle.Spacing.xxl)
        .frame(width: 650, height: 640)
        .background(PrototypeStyle.canvas)
        .alert("Preparar para pregar", isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button("OK") { alertMessage = nil }
        } message: {
            Text(alertMessage ?? "")
        }
        .confirmationDialog("O Google Doc mudou desde a última sincronização.", isPresented: $showingOverwriteConfirmation, titleVisibility: .visible) {
            if let id = draft?.googleDriveDocumentID, let url = googleDrive.documentURL(for: id) {
                Button("Abrir Google Doc para comparar") { NSWorkspace.shared.open(url) }
            }
            Button("Substituir versão do Drive", role: .destructive) { saveGoogleDoc(overwriteRemote: true) }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("A versão local foi preservada. Só substitua a cópia do Drive depois de comparar as alterações.")
        }
        .sheet(isPresented: $showingDriveConnection) {
            GoogleDriveConnectionSheet(accent: accent)
        }
    }

    @MainActor
    private func saveGoogleDoc(overwriteRemote: Bool = false) {
        guard let draft else { return }
        Task {
            do {
                try await googleDrive.saveSermon(draft, modelContext: modelContext, overwriteRemote: overwriteRemote)
            } catch let error as GoogleDriveError {
                if case .documentConflict = error { showingOverwriteConfirmation = true }
                else { alertMessage = error.localizedDescription }
            } catch {
                alertMessage = error.localizedDescription
            }
        }
    }

    @MainActor
    private func exportPDF() {
        guard let draft, let rtfData = draft.rtfData else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.nameFieldStringValue = suggestedFileName(for: draft)

        if let savedPath = draft.tabletPDFPath {
            let savedURL = URL(fileURLWithPath: savedPath)
            panel.directoryURL = savedURL.deletingLastPathComponent()
            panel.nameFieldStringValue = savedURL.lastPathComponent
        } else if !lastTabletFolder.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: lastTabletFolder, isDirectory: true)
        } else if let driveRoot = googleDriveRoot {
            panel.directoryURL = driveRoot
        }
        guard panel.runModal() == .OK, let destination = panel.url else { return }

        let subtitle = [SermonDateKey.string(from: draft.liturgicalDate), draft.liturgicalOccasion]
            .compactMap { $0 }.joined(separator: " · ")
        let title = draft.title.isEmpty ? draft.mainReadingReference ?? "Sermão" : draft.title
        let fontSize = CGFloat(readingSize)
        let fontName = readingFont
        let footnotes = includeFootnotes
        isExporting = true
        Task { @MainActor in
            defer { isExporting = false }
            do {
                let data = try await Task.detached(priority: .userInitiated) {
                    try TabletPDFExporter.makePDF(
                        rtfData: rtfData,
                        title: title,
                        subtitle: subtitle,
                        fontName: fontName,
                        fontSize: fontSize,
                        includeFootnotes: footnotes
                    )
                }.value
                try data.write(to: destination, options: .atomic)
                draft.tabletPDFPath = destination.path
                draft.tabletPDFUpdatedAt = .now
                try modelContext.save()
                lastTabletFolder = destination.deletingLastPathComponent().path
            } catch {
                alertMessage = error.localizedDescription
            }
        }
    }

    private func suggestedFileName(for draft: SermonDraft) -> String {
        let label = draft.mainReadingReference ?? (draft.title.isEmpty ? "Sermão" : draft.title)
        let raw = "\(SermonDateKey.string(from: draft.liturgicalDate)) - \(label)"
        let invalid = CharacterSet(charactersIn: "/:\\")
        let safe = raw.components(separatedBy: invalid).filter { !$0.isEmpty }.joined(separator: "-")
        return "\(safe).pdf"
    }

    private var googleDriveRoot: URL? {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/CloudStorage", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        ))?.first { $0.lastPathComponent.hasPrefix("GoogleDrive-") }
    }
}
