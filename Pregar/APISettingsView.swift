import SwiftUI
import UniformTypeIdentifiers

private enum PreferencesSection: String, CaseIterable, Identifiable {
    case api = "Estêvão API"
    case intelligence = "Inteligência artificial"
    case tablet = "Tablet"
    case library = "Biblioteca"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .api: "plus"
        case .intelligence: "sparkle"
        case .tablet: "ipad.landscape"
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
    @State private var prayerBooks: [PrayerBookCatalogEntry] = []
    @State private var isLoadingPrayerBooks = false
    @State private var prayerBookLoadError: String?
    @State private var showsPrayerBookPicker = false

    @AppStorage("drive.targets") private var tabletTargets = "Android e iPad"
    @AppStorage("drive.font") private var tabletFont = "Arial"
    @AppStorage("drive.fontSize") private var tabletFontSize = 14.0
    @AppStorage("library.pdfFolder") private var pdfFolder = ""
    @AppStorage(FavoriteReferenceLibrary.sitesKey) private var favoriteSitesData = Data()
    @AppStorage(FavoriteReferenceLibrary.authorsKey) private var favoriteAuthorsData = Data()
    @State private var selectingPDFFolder = false
    @State private var editingSite: FavoriteSite?
    @State private var editingAuthor: FavoriteAuthor?
    @State private var sitePendingDeletion: FavoriteSite?
    @State private var authorPendingDeletion: FavoriteAuthor?
    @State private var confirmsSiteDeletion = false
    @State private var confirmsAuthorDeletion = false

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
        .sheet(item: $editingSite) { site in
            FavoriteSiteEditor(site: site, accent: accent) { saveSite($0) }
        }
        .sheet(item: $editingAuthor) { author in
            FavoriteAuthorEditor(author: author, accent: accent) { saveAuthor($0) }
        }
        .confirmationDialog("Remover fonte favorita?", isPresented: $confirmsSiteDeletion, titleVisibility: .visible) {
            Button("Remover", role: .destructive) {
                if let sitePendingDeletion { saveSites(favoriteSites.filter { $0.id != sitePendingDeletion.id }) }
                sitePendingDeletion = nil
            }
        } message: {
            Text(sitePendingDeletion?.title ?? "A fonte será removida deste Mac.")
        }
        .confirmationDialog("Remover autor favorito?", isPresented: $confirmsAuthorDeletion, titleVisibility: .visible) {
            Button("Remover", role: .destructive) {
                if let authorPendingDeletion { saveAuthors(favoriteAuthors.filter { $0.id != authorPendingDeletion.id }) }
                authorPendingDeletion = nil
            }
        } message: {
            Text(authorPendingDeletion?.name ?? "O autor será removido deste Mac.")
        }
        .sheet(isPresented: $showsPrayerBookPicker) {
            PrayerBookPickerSheet(
                books: prayerBooks,
                selectedCode: settings.prayerBook,
                isLoading: isLoadingPrayerBooks,
                loadError: prayerBookLoadError,
                hasAPIKey: store.hasAPIKey,
                accent: accent,
                onSelect: { code in
                    settings.prayerBook = code
                    showsPrayerBookPicker = false
                },
                onRetry: { Task { await loadPrayerBooks() } }
            )
        }
        .task(id: store.revision) {
            await loadPrayerBooks()
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
        case .tablet: tabletContent
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
                    Button { showsPrayerBookPicker = true } label: {
                        HStack(spacing: 10) {
                            PrayerBookCover(book: selectedPrayerBook, width: 38, height: 50, accent: accent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(selectedPrayerBook.name)
                                    .font(PrototypeStyle.serif(14, weight: .semibold))
                                    .foregroundStyle(PrototypeStyle.ink)
                                    .lineLimit(1)
                                Text(prayerBookSubtitle(selectedPrayerBook))
                                    .font(.system(size: 11))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(PrototypeStyle.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Escolher livro de oração")
                    .accessibilityLabel("Livro de oração: \(selectedPrayerBook.name). Escolher outro.")
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
            Text("Revisão e perguntas usam o provedor de revisão; a busca de materiais usa o provedor de pesquisa. A busca envia apenas passagem e ocasião, nunca o manuscrito.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
        }
        .onChange(of: reviewProvider) { _, provider in reviewModel = provider.suggestedModel }
        .onChange(of: researchProvider) { _, provider in researchModel = provider.suggestedModel }
    }

    private var tabletContent: some View {
        VStack(alignment: .leading, spacing: 22) {
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
                ForEach(Array(favoriteSites.enumerated()), id: \.element.id) { index, site in
                    favoriteSitePreferenceRow(site)
                    if index < favoriteSites.count - 1 { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
                HStack {
                    Label("As fontes ficam neste Mac e aparecem na Mesa.", systemImage: "info.circle")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    Spacer()
                    Button("Adicionar site", systemImage: "plus") { editingSite = .newSite() }
                }
                .frame(minHeight: 46)
            }

            Text("AUTORES FAVORITOS").font(.system(size: 12, weight: .bold)).tracking(1.2).foregroundStyle(PrototypeStyle.muted)
                .padding(.bottom, -12)
            PreferenceGroup {
                ForEach(Array(favoriteAuthors.enumerated()), id: \.element.id) { index, author in
                    favoriteAuthorPreferenceRow(author)
                    if index < favoriteAuthors.count - 1 { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
                HStack {
                    Label("A IA os prioriza ao localizar fontes; não recebe o sermão.", systemImage: "sparkle.magnifyingglass")
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    Spacer()
                    Button("Adicionar autor", systemImage: "plus") { editingAuthor = .newAuthor() }
                }
                .frame(minHeight: 46)
            }
        }
    }

    private var favoriteSites: [FavoriteSite] { FavoriteReferenceLibrary.sites(from: favoriteSitesData) }
    private var favoriteAuthors: [FavoriteAuthor] { FavoriteReferenceLibrary.authors(from: favoriteAuthorsData) }

    private var selectedPrayerBook: PrayerBookCatalogEntry {
        if let selected = prayerBooks.first(where: { $0.code == settings.prayerBook }) { return selected }
        if settings.prayerBook == "loc_2027" {
            return PrayerBookCatalogEntry(
                code: "loc_2027",
                name: "REB - 2027",
                description: "Livro de Oração Comum da Rede Episcopal Brasileira (2027)",
                language: "pt-BR",
                jurisdiction: "Rede Episcopal Brasileira",
                year: 2027,
                isRecommended: false,
                imageUrl: nil,
                thumbnailUrl: nil
            )
        }
        return PrayerBookCatalogEntry(
            code: settings.prayerBook,
            name: "Livro de oração selecionado",
            description: nil,
            language: nil,
            jurisdiction: nil,
            year: nil,
            isRecommended: nil,
            imageUrl: nil,
            thumbnailUrl: nil
        )
    }

    private func prayerBookSubtitle(_ book: PrayerBookCatalogEntry) -> String {
        book.displaySubtitle
    }

    private func favoriteSitePreferenceRow(_ site: FavoriteSite) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "globe").foregroundStyle(accent).frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(site.title).font(.system(size: 13, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                Text("\(site.adapter.title) · \(site.baseURL.host ?? site.baseURL.absoluteString)")
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            Button { editingSite = site } label: {
                Image(systemName: "pencil").frame(width: 30, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain).help("Editar \(site.title)")
            Button(role: .destructive) {
                sitePendingDeletion = site
                confirmsSiteDeletion = true
            } label: {
                Image(systemName: "trash").frame(width: 30, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain).help("Remover \(site.title)")
        }
        .font(.system(size: 12))
        .frame(minHeight: 52)
    }

    private func favoriteAuthorPreferenceRow(_ author: FavoriteAuthor) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "person.text.rectangle").foregroundStyle(accent).frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(author.name).font(.system(size: 13, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                if let referenceURL = author.referenceURL {
                    Text(referenceURL.host ?? referenceURL.absoluteString).font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                }
            }
            Spacer(minLength: 8)
            Button { editingAuthor = author } label: {
                Image(systemName: "pencil").frame(width: 30, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain).help("Editar \(author.name)")
            Button(role: .destructive) {
                authorPendingDeletion = author
                confirmsAuthorDeletion = true
            } label: {
                Image(systemName: "trash").frame(width: 30, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain).help("Remover \(author.name)")
        }
        .font(.system(size: 12))
        .frame(minHeight: 52)
    }

    private func saveSite(_ site: FavoriteSite) {
        var values = favoriteSites
        if let index = values.firstIndex(where: { $0.id == site.id }) { values[index] = site }
        else { values.append(site) }
        saveSites(values)
        editingSite = nil
    }

    private func saveSites(_ sites: [FavoriteSite]) {
        favoriteSitesData = (try? JSONEncoder().encode(sites)) ?? Data()
    }

    private func saveAuthor(_ author: FavoriteAuthor) {
        var values = favoriteAuthors
        if let index = values.firstIndex(where: { $0.id == author.id }) { values[index] = author }
        else { values.append(author) }
        saveAuthors(values)
        editingAuthor = nil
    }

    private func saveAuthors(_ authors: [FavoriteAuthor]) {
        favoriteAuthorsData = (try? JSONEncoder().encode(authors)) ?? Data()
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
        case .tablet: "Formato de leitura no tablet."
        case .library: "Comentários em PDF e fontes de pesquisa."
        }
    }

    private var footerNote: String {
        switch section {
        case .api: "A chave fica salva no Acesso às Chaves deste Mac."
        case .intelligence: "Credenciais no Acesso às Chaves; preferências neste Mac."
        case .tablet: "Preferências locais de leitura no tablet."
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

    @MainActor
    private func loadPrayerBooks() async {
        guard let key = store.credential, !key.isEmpty else {
            prayerBooks = []
            prayerBookLoadError = nil
            isLoadingPrayerBooks = false
            return
        }
        isLoadingPrayerBooks = true
        prayerBookLoadError = nil
        do {
            prayerBooks = try await LiturgicalAPIClient(settings: settings, apiKey: key).fetchPrayerBooks()
        } catch {
            prayerBookLoadError = error.localizedDescription
        }
        isLoadingPrayerBooks = false
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

private struct PrayerBookPickerSheet: View {
    let books: [PrayerBookCatalogEntry]
    let selectedCode: String
    let isLoading: Bool
    let loadError: String?
    let hasAPIKey: Bool
    let accent: Color
    let onSelect: (String) -> Void
    let onRetry: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

    private var filteredBooks: [PrayerBookCatalogEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let matching = books.filter { book in
            query.isEmpty || [book.name, book.code, book.description, book.jurisdiction, book.language]
                .compactMap { $0 }
                .contains { $0.localizedCaseInsensitiveContains(query) }
        }
        return matching.sorted {
            if $0.isRecommended != $1.isRecommended { return $0.isRecommended == true }
            if $0.year != $1.year { return ($0.year ?? 0) > ($1.year ?? 0) }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Livro de oração")
                        .font(PrototypeStyle.serif(22, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text("Escolha pelo nome, jurisdição e descrição.")
                        .font(.system(size: 12))
                        .foregroundStyle(PrototypeStyle.muted)
                }
                Spacer()
                Button("Fechar") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 22)
            .padding(.top, 20)
            .padding(.bottom, 14)

            HStack(spacing: 9) {
                Image(systemName: "magnifyingglass").foregroundStyle(PrototypeStyle.muted)
                TextField("Buscar nome, jurisdição ou descrição", text: $searchText)
                    .textFieldStyle(.plain)
                    .accessibilityLabel("Buscar livros de oração")
            }
            .padding(.horizontal, 11)
            .frame(height: 36)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PrototypeStyle.line, lineWidth: 1))
            .padding(.horizontal, 22)
            .padding(.bottom, 10)

            if let loadError {
                HStack(alignment: .top, spacing: 10) {
                    Label(loadError, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 12)).foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Tentar novamente", action: onRetry)
                        .disabled(isLoading)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 10)
            }

            if isLoading && books.isEmpty {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Carregando livros de oração…")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if books.isEmpty {
                emptyCatalogue
            } else if filteredBooks.isEmpty {
                ContentUnavailableView.search(text: searchText)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filteredBooks) { book in
                            prayerBookRow(book)
                            if book.id != filteredBooks.last?.id {
                                Rectangle().fill(PrototypeStyle.line).frame(height: 1)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 4)
                }
            }
        }
        .frame(width: 720, height: 630)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
        .tint(accent)
    }

    private var emptyCatalogue: some View {
        VStack(spacing: 9) {
            Image(systemName: hasAPIKey ? "books.vertical" : "key.fill")
                .font(.system(size: 24)).foregroundStyle(accent)
            Text(hasAPIKey ? "Catálogo indisponível" : "Conecte a Estêvão API")
                .font(PrototypeStyle.serif(17, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text(hasAPIKey
                 ? (loadError ?? "Não foi possível carregar os livros agora.")
                 : "Salve sua chave da API nas Preferências para carregar os livros disponíveis.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 390)
            if hasAPIKey {
                Button("Tentar novamente", action: onRetry).disabled(isLoading)
                    .padding(.top, 3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
    }

    private func prayerBookRow(_ book: PrayerBookCatalogEntry) -> some View {
        let isSelected = selectedCode == book.code
        return Button { onSelect(book.code) } label: {
            HStack(spacing: 13) {
                PrayerBookCover(book: book, width: 54, height: 72, accent: accent)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(book.name)
                            .font(PrototypeStyle.serif(16, weight: .semibold))
                            .foregroundStyle(PrototypeStyle.ink)
                            .lineLimit(1)
                        if book.isRecommended == true {
                            Text("RECOMENDADO")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(accent)
                                .fixedSize()
                        }
                    }
                    Text(book.displaySubtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PrototypeStyle.muted)
                        .lineLimit(1)
                    Text(book.displayDescription)
                        .font(.system(size: 12))
                        .foregroundStyle(PrototypeStyle.ink.opacity(0.84))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 5)
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(accent)
                        .accessibilityLabel("Selecionado")
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.muted.opacity(0.75))
                }
            }
            .padding(9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? accent.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Selecionar \(book.name)")
    }
}

private struct PrayerBookCover: View {
    let book: PrayerBookCatalogEntry
    let width: CGFloat
    let height: CGFloat
    let accent: Color

    var body: some View {
        Group {
            if let url = book.coverURL {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: height)
        .background(accent.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(PrototypeStyle.line, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4).fill(Color(red: 0.15, green: 0.31, blue: 0.25))
            RoundedRectangle(cornerRadius: 3)
                .stroke(Color.white.opacity(0.48), lineWidth: 0.7)
                .padding(3)
            VStack(spacing: 2) {
                if height > 60 {
                    Text("LIVRO DE ORAÇÃO")
                        .font(.system(size: 5.5, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                Text(book.coverMonogram)
                    .font(PrototypeStyle.serif(width > 45 ? 20 : 14, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Rectangle().frame(width: width * 0.46, height: 0.7)
                Text(book.year.map(String.init) ?? "LOC")
                    .font(.system(size: width > 45 ? 7 : 6, weight: .medium))
                    .lineLimit(1)
                if width > 45, let jurisdictionMonogram = book.jurisdictionMonogram {
                    Text(jurisdictionMonogram)
                        .font(.system(size: 6, weight: .semibold))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(Color(red: 0.97, green: 0.95, blue: 0.88))
            .padding(.horizontal, width * 0.12)
            .padding(.vertical, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

private struct FavoriteSiteEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var site: FavoriteSite
    @State private var baseURLText: String
    @State private var searchURLText: String
    @State private var feedURLText: String
    @State private var validationMessage: String?
    let accent: Color
    let onSave: (FavoriteSite) -> Void

    init(site: FavoriteSite, accent: Color, onSave: @escaping (FavoriteSite) -> Void) {
        _site = State(initialValue: site)
        _baseURLText = State(initialValue: site.baseURL.absoluteString)
        _searchURLText = State(initialValue: site.searchURLTemplate)
        _feedURLText = State(initialValue: site.feedURL?.absoluteString ?? "")
        self.accent = accent
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(site.title.isEmpty ? "Adicionar site favorito" : "Editar site favorito")
                .font(PrototypeStyle.serif(20, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Form {
                TextField("Nome", text: $site.title)
                TextField("Endereço base (HTTPS)", text: $baseURLText)
                TextField("Descrição", text: $site.detail)
                TextField("Idioma", text: $site.language)
                Picker("Tipo de site", selection: $site.adapter) {
                    ForEach(FavoriteSiteAdapter.allCases) { adapter in
                        Text(adapter.title).tag(adapter)
                    }
                }
                if site.adapter == .rssAtom {
                    TextField("URL do feed (vazio = /feed)", text: $feedURLText)
                }
                if site.adapter != .workingPreacherArchive && site.adapter != .anglicanCompass {
                    TextField("URL de busca", text: $searchURLText)
                    Text("Variáveis: {query}, {reference}, {book}, {chapter}, {occasion}, {date}")
                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                }
            }
            if let validationMessage {
                Label(validationMessage, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 11)).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Salvar") { save() }
                    .buttonStyle(.borderedProminent).tint(accent)
                    .disabled(site.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 590, height: 510)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
    }

    private func save() {
        guard let baseURL = httpsURL(baseURLText) else {
            validationMessage = "Informe um endereço HTTPS válido para o site."
            return
        }
        let template = (site.adapter == .workingPreacherArchive || site.adapter == .anglicanCompass)
            ? searchURLText
            : searchURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let exampleURL = URL(string: template.replacingOccurrences(of: "{query}", with: "Matthew%2021")),
              exampleURL.scheme?.lowercased() == "https",
              exampleURL.host != nil else {
            validationMessage = "A URL de busca precisa começar com https:// e conter um endereço válido."
            return
        }
        let feed: URL?
        if site.adapter == .rssAtom, !feedURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let parsedFeed = httpsURL(feedURLText) else {
                validationMessage = "O feed RSS/Atom precisa usar um endereço HTTPS válido."
                return
            }
            feed = parsedFeed
        } else {
            feed = nil
        }
        site.baseURL = baseURL
        site.searchURLTemplate = template
        site.feedURL = feed
        site.title = site.title.trimmingCharacters(in: .whitespacesAndNewlines)
        site.detail = site.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        site.language = site.language.trimmingCharacters(in: .whitespacesAndNewlines)
        onSave(site)
        dismiss()
    }

    private func httpsURL(_ value: String) -> URL? {
        guard let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host, host.contains("."),
              components.user == nil, components.password == nil else { return nil }
        return components.url
    }
}

private struct FavoriteAuthorEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var author: FavoriteAuthor
    @State private var referenceURLText: String
    @State private var validationMessage: String?
    let accent: Color
    let onSave: (FavoriteAuthor) -> Void

    init(author: FavoriteAuthor, accent: Color, onSave: @escaping (FavoriteAuthor) -> Void) {
        _author = State(initialValue: author)
        _referenceURLText = State(initialValue: author.referenceURL?.absoluteString ?? "")
        self.accent = accent
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(author.name.isEmpty ? "Adicionar autor favorito" : "Editar autor favorito")
                .font(PrototypeStyle.serif(20, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Form {
                TextField("Nome do autor", text: $author.name)
                TextField("Site do autor (opcional)", text: $referenceURLText)
            }
            if let validationMessage {
                Label(validationMessage, systemImage: "exclamationmark.triangle")
                    .font(.system(size: 11)).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Salvar") { save() }
                    .buttonStyle(.borderedProminent).tint(accent)
                    .disabled(author.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 500, height: 270)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
    }

    private func save() {
        let cleanedURL = referenceURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanedURL.isEmpty {
            guard let url = URL(string: cleanedURL), url.scheme?.lowercased() == "https", url.host != nil else {
                validationMessage = "O site do autor precisa usar HTTPS."
                return
            }
            author.referenceURL = url
        } else {
            author.referenceURL = nil
        }
        author.name = author.name.trimmingCharacters(in: .whitespacesAndNewlines)
        onSave(author)
        dismiss()
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
