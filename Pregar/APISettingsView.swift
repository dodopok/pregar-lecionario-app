import SwiftUI
import UniformTypeIdentifiers

private enum PreferencesSection: String, CaseIterable, Identifiable {
    case api = "Estêvão API"
    case intelligence = "Inteligência artificial"
    case drive = "Drive e tablet"
    case library = "Biblioteca"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .api: "plus"
        case .intelligence: "sparkle"
        case .drive: "square.and.arrow.down"
        case .library: "book.closed"
        }
    }
}

struct APISettingsView: View {
    @ObservedObject var store: APISettingsStore
    @ObservedObject var aiStore: AISettingsStore
    let accent: Color

    @Environment(\.dismiss) private var dismiss
    @State private var section: PreferencesSection = .api
    @State private var settings: APISettings
    @State private var enteredKey = ""
    @State private var reviewProvider: AIProvider
    @State private var researchProvider: AIProvider
    @State private var reviewModel: String
    @State private var researchModel: String
    @State private var isTesting = false
    @State private var resultMessage: String?
    @State private var testSucceeded = false

    @AppStorage("drive.sermonFolder") private var sermonFolder = "Sermões"
    @AppStorage("drive.ideasDocument") private var ideasDocument = "Ideias de sermões"
    @AppStorage("drive.targets") private var tabletTargets = "Android e iPad"
    @AppStorage("drive.font") private var tabletFont = "Arial"
    @AppStorage("drive.fontSize") private var tabletFontSize = 14.0
    @AppStorage("library.pdfFolder") private var pdfFolder = ""
    @State private var selectingPDFFolder = false

    init(store: APISettingsStore, aiStore: AISettingsStore, accent: Color) {
        self.store = store
        self.aiStore = aiStore
        self.accent = accent
        _settings = State(initialValue: store.settings)
        _reviewProvider = State(initialValue: aiStore.reviewProvider)
        _researchProvider = State(initialValue: aiStore.researchProvider)
        _reviewModel = State(initialValue: aiStore.reviewModel)
        _researchModel = State(initialValue: aiStore.researchModel)
    }

    var body: some View {
        VStack(spacing: 0) {
            navigation
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    pageHeading
                    sectionContent
                }
                .frame(maxWidth: 980, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .background(PrototypeStyle.canvas)
            Divider()
            footer
        }
        .frame(minWidth: 620, minHeight: 640)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
        .tint(accent)
        .fileImporter(isPresented: $selectingPDFFolder, allowedContentTypes: [.folder], allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first { pdfFolder = url.path }
        }
    }

    private var navigation: some View {
        HStack(spacing: 8) {
            ForEach(PreferencesSection.allCases) { item in
                Button {
                    section = item
                    resultMessage = nil
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: item.symbol).font(.system(size: 18, weight: .regular))
                        Text(item.rawValue).font(.system(size: 12, weight: section == item ? .semibold : .regular))
                            .lineLimit(1).minimumScaleFactor(0.85)
                    }
                    .foregroundStyle(section == item ? accent : PrototypeStyle.muted)
                    .padding(.horizontal, 12)
                    .frame(height: 48)
                    .background(section == item ? accent.opacity(0.11) : .clear, in: RoundedRectangle(cornerRadius: 10))
                    .contentShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(section == item ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.leading, 82)
        .padding(.trailing, 22)
        .padding(.vertical, 7)
    }

    private var pageHeading: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(section.rawValue).font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text(sectionSubtitle).font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
        }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .api: apiContent
        case .intelligence: intelligenceContent
        case .drive: driveContent
        case .library: libraryContent
        }
    }

    private var apiContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            PreferenceGroup {
                PreferenceRow(label: "Endereço") {
                    Text("https://api.caminhoanglicano.com.br")
                        .font(.system(size: 14, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                PreferenceRow(label: "Chave X-API-Key") {
                    SecureField(keyPlaceholder, text: $enteredKey)
                        .textFieldStyle(.roundedBorder)
                }
                HStack {
                    Label(apiKeyStatus, systemImage: apiKeyStatusSymbol)
                        .foregroundStyle(store.credentialReadTimedOut ? .orange : (store.hasAPIKey ? accent : PrototypeStyle.muted))
                    Spacer()
                    if store.hasAPIKey {
                        Button("Remover chave", systemImage: "trash", role: .destructive) {
                            Task { await removeAPIKey() }
                        }
                            .buttonStyle(.plain)
                    }
                }
                .font(.system(size: 13))
                .padding(.top, 3)
            }

            Text("CONTEXTO LITÚRGICO").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                PreferenceRow(label: "Livro de oração") {
                    TextField("loc_2027", text: $settings.prayerBook).textFieldStyle(.roundedBorder).frame(maxWidth: 220)
                }
                PreferenceRow(label: "Leituras dominicais") {
                    Picker("Leituras dominicais", selection: $settings.readingType) {
                        Text("Padrão do LOC").tag("")
                        Text("Complementar").tag("complementary")
                        Text("Semicontínua").tag("semicontinuous")
                    }
                    .labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Tradução principal") {
                    Picker("Tradução principal", selection: $settings.bible) {
                        Text("NVT").tag("nvt")
                        Text("NVI").tag("nvi")
                        Text("NAA").tag("naa")
                        Text("ARA").tag("ara")
                    }
                    .labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Idioma") {
                    TextField("pt-BR", text: $settings.language).textFieldStyle(.roundedBorder).frame(maxWidth: 220)
                }
            }
            if let resultMessage { statusMessage(resultMessage, success: testSucceeded) }
        }
    }

    private var intelligenceContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 5) {
                Text("As chaves ficam salvas no Acesso às Chaves deste Mac.")
                    .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
                Text("A revisão deve apontar problemas sem reescrever o sermão nem propor interpretações ou aplicações.")
                    .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
            }
            PreferenceGroup {
                ForEach(AIProvider.allCases) { provider in
                    AIProviderKeyRow(provider: provider, store: aiStore, accent: accent)
                    if provider != AIProvider.allCases.last { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
            }
            Text("REVISÃO E PESQUISA").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                PreferenceRow(label: "Provedor de revisão") {
                    Picker("Provedor de revisão", selection: $reviewProvider) {
                        ForEach(AIProvider.allCases) { Text($0.name).tag($0) }
                    }.labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Modelo de revisão") {
                    Picker("Modelo de revisão", selection: $reviewModel) {
                        ForEach(reviewProvider.models, id: \.self) { Text($0).tag($0) }
                    }.labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Pesquisa de materiais") {
                    Picker("Provedor de pesquisa", selection: $researchProvider) {
                        ForEach(AIProvider.allCases) { Text($0.name).tag($0) }
                    }.labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Modelo de pesquisa") {
                    Picker("Modelo de pesquisa", selection: $researchModel) {
                        ForEach(researchProvider.models, id: \.self) { Text($0).tag($0) }
                    }.labelsHidden().frame(width: 220, alignment: .leading)
                }
            }
            Text("Revisão e perguntas de emergência usam o provedor escolhido. A pesquisa de materiais ainda não está conectada.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
        }
        .onChange(of: reviewProvider) { _, provider in reviewModel = provider.suggestedModel }
        .onChange(of: researchProvider) { _, provider in researchModel = provider.suggestedModel }
    }

    private var driveContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            PreferenceGroup {
                HStack(spacing: 12) {
                    Image(systemName: "person.crop.circle.badge.questionmark").font(.system(size: 24)).foregroundStyle(PrototypeStyle.muted)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Google Drive não conectado").font(.system(size: 15, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                        Text("A autenticação e a sincronização ainda não estão disponíveis.").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    Spacer()
                    Button("Conectar") {}.disabled(true)
                }
            }
            Text("DOCUMENTOS").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                PreferenceRow(label: "Pasta dos sermões") {
                    TextField("Sermões", text: $sermonFolder).textFieldStyle(.roundedBorder).frame(maxWidth: 270)
                }
                PreferenceRow(label: "Documento de ideias") {
                    TextField("Ideias de sermões", text: $ideasDocument).textFieldStyle(.roundedBorder).frame(maxWidth: 270)
                }
            }
            Text("TABLET").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                PreferenceRow(label: "Dispositivos") {
                    Picker("Dispositivos", selection: $tabletTargets) {
                        Text("Android").tag("Android")
                        Text("iPad").tag("iPad")
                        Text("Android e iPad").tag("Android e iPad")
                    }.labelsHidden().frame(width: 220, alignment: .leading)
                }
                PreferenceRow(label: "Fonte de leitura") {
                    HStack(spacing: 10) {
                        TextField("Arial", text: $tabletFont).textFieldStyle(.roundedBorder).frame(maxWidth: 150)
                        Stepper(value: $tabletFontSize, in: 8...24, step: 1) {
                            Text("\(tabletFontSize.formatted(.number.precision(.fractionLength(0)))) pt")
                                .monospacedDigit().frame(width: 45, alignment: .trailing)
                        }.frame(maxWidth: 130)
                    }
                }
            }
            Text("PDFs podem ser salvos em uma pasta local ou sincronizada pelo Google Drive para computador. Google Docs e o documento de ideias dependem da autenticação Google.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
        }
    }

    private var libraryContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            PreferenceGroup {
                PreferenceRow(label: "Pasta de PDFs") {
                    HStack {
                        Text(pdfFolder.isEmpty ? "Escolha uma pasta para referência" : pdfFolder)
                            .font(.system(size: 12, design: .monospaced)).foregroundStyle(pdfFolder.isEmpty ? PrototypeStyle.muted : PrototypeStyle.ink)
                            .lineLimit(1).truncationMode(.middle)
                        Button("Escolher…", systemImage: "folder", action: { selectingPDFFolder = true })
                    }
                }
                HStack(spacing: 9) {
                    Image(systemName: "info.circle").foregroundStyle(accent)
                    Text("Os PDFs importados hoje continuam nos caminhos originais e são abertos neste Mac.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .padding(.top, 4)
            }
            Text("RECURSOS WEB").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                ResourcePreferenceRow(name: "Working Preacher", detail: "Comentários · Lecionário Comum Revisado", accent: accent)
                ResourcePreferenceRow(name: "Anglican Compass", detail: "Recursos anglicanos · ACNA", accent: accent)
                ResourcePreferenceRow(name: "My Pastoral Ponderings", detail: "Sermões e reflexões", accent: accent)
                ResourcePreferenceRow(name: "Ponderings on a Faith Journey", detail: "Bob Cornwall · reflexão pastoral", accent: accent)
            }
            Text("A navegação web já abre os sites na Mesa. Busca por passagem, indexação de capítulos e OCR ainda não estão ativos.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Text(footerNote).font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer()
            if section == .api {
                Button {
                    Task { await saveAndTest() }
                } label: {
                    if isTesting { ProgressView().controlSize(.small) }
                    else { Label("Salvar e testar", systemImage: "checkmark.arrow.trianglehead.counterclockwise") }
                }
                .buttonStyle(.borderedProminent).tint(accent).disabled(isTesting)
                .keyboardShortcut(.defaultAction)
            } else if section == .intelligence {
                Button("Salvar") { saveAISettings() }.buttonStyle(.borderedProminent).tint(accent)
            }
            Button("Concluído") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 22).padding(.vertical, 12)
        .background(PrototypeStyle.canvas)
    }

    private var sectionSubtitle: String {
        switch section {
        case .api: "A conexão usa sempre a Estêvão API v2."
        case .intelligence: "Provedores externos com suas próprias chaves."
        case .drive: "Sincronização e formato de leitura."
        case .library: "Comentários em PDF e fontes de pesquisa."
        }
    }

    private var footerNote: String {
        switch section {
        case .api: "A chave fica salva no Acesso às Chaves deste Mac."
        case .intelligence: "Credenciais no Acesso às Chaves; preferências neste Mac."
        case .drive: "Preferências locais; Google Drive ainda não conectado."
        case .library: "Os arquivos PDF permanecem na pasta original."
        }
    }

    private var keyPlaceholder: String {
        if store.hasAPIKey { return "Chave salva; deixe vazio para mantê-la" }
        if store.credentialReadTimedOut { return "Informe novamente a chave deste Mac" }
        return "estevao_…"
    }

    private var apiKeyStatus: String {
        if store.isLoadingCredential { return "Verificando Acesso às Chaves…" }
        if store.hasAPIKey { return "Chave salva neste Mac" }
        if store.credentialReadTimedOut { return "A leitura demorou; você pode informar a chave novamente" }
        return "Nenhuma chave salva"
    }

    private var apiKeyStatusSymbol: String {
        if store.isLoadingCredential { return "hourglass" }
        if store.hasAPIKey { return "key.fill" }
        return store.credentialReadTimedOut ? "exclamationmark.triangle.fill" : "key"
    }

    private func statusMessage(_ message: String, success: Bool) -> some View {
        Label(message, systemImage: success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .font(.system(size: 13)).foregroundStyle(success ? accent : .orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14).background(success ? accent.opacity(0.10) : Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }

    @MainActor
    private func saveAndTest() async {
        isTesting = true
        resultMessage = nil
        do {
            try await store.save(settings: settings, enteredKey: enteredKey)
            enteredKey = ""
            guard let key = store.credential else {
                throw LiturgicalAPIError(message: "Informe sua chave pessoal da Estêvão API para consultar a v2.")
            }
            let day = try await LiturgicalAPIClient(settings: settings, apiKey: key).fetchDay(.now)
            resultMessage = "Conectado. A API respondeu para \(day.date)."
            testSucceeded = true
        } catch {
            resultMessage = error.localizedDescription
            testSucceeded = false
        }
        isTesting = false
    }

    private func saveAISettings() {
        aiStore.save(reviewProvider: reviewProvider, reviewModel: reviewModel, researchProvider: researchProvider, researchModel: researchModel)
        resultMessage = "Preferências de IA salvas neste Mac. Nenhuma solicitação foi enviada."
        testSucceeded = true
    }

    @MainActor
    private func removeAPIKey() async {
        do {
            try await store.removeKey()
            resultMessage = "Chave removida deste Mac."
            testSucceeded = true
        } catch {
            resultMessage = error.localizedDescription
            testSucceeded = false
        }
    }
}

struct PreferencesSceneView: View {
    @EnvironmentObject private var store: APISettingsStore
    @EnvironmentObject private var aiStore: AISettingsStore
    @EnvironmentObject private var appearance: AppAppearanceStore

    var body: some View {
        APISettingsView(store: store, aiStore: aiStore, accent: appearance.accent)
    }
}

private struct AIProviderKeyRow: View {
    let provider: AIProvider
    @ObservedObject var store: AISettingsStore
    let accent: Color
    @State private var key = ""
    @State private var feedback: String?

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(provider.name).font(.system(size: 14, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                Label(keyStatus, systemImage: store.hasKey(for: provider) ? "key.fill" : "key")
                    .font(.system(size: 11)).foregroundStyle(store.hasKey(for: provider) ? accent : PrototypeStyle.muted)
                if let feedback { Text(feedback).font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            .frame(width: 185, alignment: .leading)
            SecureField("Cole a chave da API", text: $key)
                .textFieldStyle(.roundedBorder)
            Button("Salvar") { Task { await saveKey() } }.disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if !store.isLoadingKeys && store.hasKey(for: provider) {
                Button("Remover", systemImage: "trash", role: .destructive) { Task { await removeKey() } }
                    .labelStyle(.iconOnly).help("Remover chave de \(provider.name)")
            }
        }
        .frame(minHeight: 54)
    }

    private var keyStatus: String {
        if store.isLoadingKeys { return "Verificando Acesso às Chaves…" }
        if store.keyReadTimedOut { return "Leitura demorou; salve a chave novamente" }
        return store.hasKey(for: provider) ? "Chave salva neste Mac" : "Sem chave"
    }

    @MainActor
    private func saveKey() async {
        do {
            try await store.saveKey(key, for: provider)
            key = ""
            feedback = "Salva no Acesso às Chaves."
        } catch { feedback = error.localizedDescription }
    }

    @MainActor
    private func removeKey() async {
        do {
            try await store.removeKey(for: provider)
            feedback = "Chave removida."
        } catch { feedback = error.localizedDescription }
    }
}

private struct ResourcePreferenceRow: View {
    let name: String
    let detail: String
    let accent: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "globe").foregroundStyle(accent).frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(name).font(.system(size: 14, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                Text(detail).font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill").foregroundStyle(accent)
        }
        .frame(minHeight: 46)
    }
}

private struct PreferenceGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .padding(.horizontal, 14).padding(.vertical, 4)
            .background(.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PrototypeStyle.line, lineWidth: 1))
    }
}

private struct PreferenceRow<Control: View>: View {
    let label: String
    @ViewBuilder var control: Control

    var body: some View {
        HStack(spacing: 20) {
            Text(label).font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted).frame(width: 150, alignment: .leading)
            control.frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 49)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }
}
