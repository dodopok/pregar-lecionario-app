import AppKit
import SwiftData
import SwiftUI

struct PreparationWorkspace: View {
    @EnvironmentObject private var settingsStore: APISettingsStore
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SermonDraft.modifiedAt, order: .reverse) private var drafts: [SermonDraft]

    @State private var selectedDate = Calendar.current.startOfDay(for: .now)
    @State private var calendarMonth = Calendar.current.startOfDay(for: .now)
    @State private var day: LiturgicalDay?
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var showingSettings = false
    @State private var showingSettingsOnLaunch = false
    @State private var showingBible = false
    @State private var showingReview = false
    @State private var showingQuestions = false
    @State private var showingTablet = false
    @State private var showingArchive = false
    @State private var showingLibrary = false
    @State private var isSidebarVisible = true
    @State private var isReadingsVisible = true
    @State private var isContextVisible = true
    @State private var focusMode = false
    @State private var selectedBible = "nvt"
    @State private var alternativeTexts: [String: BiblePassageText] = [:]
    @State private var expandedReadingIDs: Set<String> = []
    @State private var contextTab: ContextPaneTab = .materials
    @StateObject private var editorCommands = EditorCommands()

    private var selectedDayKey: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: selectedDate)
    }

    private var requestKey: String {
        "\(selectedDayKey)|\(settingsStore.settings.requestVersion)|\(settingsStore.revision)"
    }

    private var activeDraft: SermonDraft? {
        drafts.first { Calendar.current.isDate($0.liturgicalDate, inSameDayAs: selectedDate) }
    }

    private var accentColor: Color {
        LiturgicalColor.resolve(day?.color)
    }

    var body: some View {
        HStack(spacing: 0) {
            if isSidebarVisible && !focusMode {
                CalendarSidebarView(
                    selectedDate: $selectedDate,
                    calendarMonth: $calendarMonth,
                    liturgicalDay: day,
                    accent: accentColor,
                    openArchive: { showingArchive = true },
                    openLibrary: { showingLibrary = true }
                )
                .frame(width: 236)
                Divider()
            }

            VStack(spacing: 0) {
                workspaceToolbar
                Rectangle().fill(accentColor).frame(height: 2)
                dayHeader
                Divider()

                if let loadError {
                    ContentUnavailableView {
                        Label("Não foi possível carregar o dia", systemImage: "calendar.badge.exclamationmark")
                    } description: {
                        Text(loadError).frame(maxWidth: 440)
                    } actions: {
                        Button("Configurar conexão") { showingSettings = true }
                        Button("Tentar novamente") { Task { await loadDay() } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if isLoading || day == nil {
                    VStack(spacing: 12) {
                        ProgressView().tint(accentColor)
                        Text(settingsStore.hasAPIKey ? "Consultando o calendário…" : "Configure sua chave da Estêvão API")
                            .font(.system(size: 13)).foregroundStyle(PrototypeStyle.muted)
                        if !settingsStore.hasAPIKey {
                            Button("Configurar Estêvão API") { showingSettings = true }
                                .buttonStyle(.borderedProminent)
                                .tint(accentColor)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(PrototypeStyle.canvas)
                } else if let day, let draft = activeDraft {
                    HSplitView {
                        if isReadingsVisible && !focusMode {
                            ScripturePanelView(
                                day: day,
                                mainReference: draft.mainReadingReference,
                                mainSlot: draft.mainReadingSlot,
                                primaryBible: settingsStore.settings.bible,
                                selectedBible: selectedBible,
                                displayedTexts: alternativeTexts,
                                accent: accentColor,
                                expandedReadingIDs: $expandedReadingIDs,
                                chooseReading: { chooseMainReading($0, for: draft) },
                                chooseBible: loadTranslation,
                                collapse: { isReadingsVisible = false }
                            )
                            .frame(minWidth: 260, idealWidth: 320, maxWidth: 400)
                        }

                        sermonEditor(draft: draft)
                            .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)

                        if isContextVisible && !focusMode {
                            ResourceContextPanel(
                                selectedTab: $contextTab,
                                reference: draft.mainReadingReference ?? "esta preparação",
                                accent: accentColor,
                                openSettings: { showingSettings = true },
                                openLibrary: { showingLibrary = true },
                                newReview: { showingReview = true },
                                emergencyQuestions: { showingQuestions = true },
                                collapse: { isContextVisible = false }
                            )
                            .frame(minWidth: 290, idealWidth: 345, maxWidth: 430)
                        }
                    }
                    .background(PrototypeStyle.canvas)
                    .tint(accentColor)
                }

                if let draft = activeDraft, day != nil {
                    statusBar(draft: draft)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PrototypeStyle.canvas)
        }
        .frame(minWidth: 1220, minHeight: 740)
        .background(PrototypeStyle.canvas)
        .preferredColorScheme(.light)
        .tint(accentColor)
        .toolbar(.hidden, for: .windowToolbar)
        .sheet(isPresented: $showingSettings) {
            APISettingsView(store: settingsStore)
        }
        .sheet(isPresented: $showingBible) {
            BibleComparisonView(
                reference: activeDraft?.mainReadingReference ?? "",
                settings: settingsStore.settings,
                apiKey: settingsStore.credential ?? "",
                accent: accentColor
            )
        }
        .sheet(isPresented: $showingReview) {
            ReviewRequestSheet(accent: accentColor) {
                showingReview = false
                showingSettings = true
            }
        }
        .sheet(isPresented: $showingQuestions) {
            EmergencyQuestionsSheet(accent: accentColor) {
                showingQuestions = false
                showingSettings = true
            }
        }
        .sheet(isPresented: $showingTablet) {
            TabletPreparationSheet(draft: activeDraft, accent: accentColor, openSettings: { showingSettings = true })
        }
        .sheet(isPresented: $showingArchive) {
            SermonArchiveView()
        }
        .sheet(isPresented: $showingLibrary) {
            PDFLibraryView()
        }
        .task(id: requestKey) { await loadDay() }
        .onAppear {
            ensureDraft(for: selectedDate)
            selectedBible = settingsStore.settings.bible
            if !settingsStore.hasAPIKey { showingSettingsOnLaunch = true }
        }
        .onChange(of: selectedDayKey) { _, _ in
            ensureDraft(for: selectedDate)
            if !Calendar.current.isDate(selectedDate, equalTo: calendarMonth, toGranularity: .month) {
                calendarMonth = selectedDate
            }
        }
        .onChange(of: showingSettingsOnLaunch) { _, shouldPresent in
            if shouldPresent {
                showingSettings = true
                showingSettingsOnLaunch = false
            }
        }
    }

    private var workspaceToolbar: some View {
        HStack(spacing: 14) {
            Button {
                isSidebarVisible.toggle()
            } label: {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: 27, height: 30)
            }
            .buttonStyle(.plain)
            .help("Barra lateral")

            if !isReadingsVisible && !focusMode {
                Button {
                    isReadingsVisible = true
                } label: {
                    Image(systemName: "book.closed")
                        .font(.system(size: 14))
                        .foregroundStyle(PrototypeStyle.muted)
                        .frame(width: 25, height: 30)
                }
                .buttonStyle(.plain)
                .help("Mostrar leituras")
            }

            if !isContextVisible && !focusMode {
                Button {
                    isContextVisible = true
                } label: {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 14))
                        .foregroundStyle(PrototypeStyle.muted)
                        .frame(width: 25, height: 30)
                }
                .buttonStyle(.plain)
                .help("Mostrar painel contextual")
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(activeDraft?.mainReadingReference ?? "Preparação do sermão")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .lineLimit(1)
                Text(toolbarSubtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            toolbarAction("book.closed", title: "Bíblia") { showingBible = true }
            toolbarAction("doc.text", title: "Leitor") {
                isContextVisible = true
                contextTab = .materials
            }
            toolbarAction("ipad.landscape", title: "Tablet") { showingTablet = true }

            Button {
                focusMode.toggle()
            } label: {
                Label("Foco", systemImage: focusMode ? "arrow.up.left.and.arrow.down.right" : "rectangle.compress.vertical")
                    .font(.system(size: 12))
                    .foregroundStyle(focusMode ? accentColor : PrototypeStyle.muted)
            }
            .buttonStyle(.plain)
            .help("Modo de escrita")

            Button {
                contextTab = .review
                isContextVisible = true
                showingReview = true
            } label: {
                Label("Revisar", systemImage: "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 31)
                    .background(accentColor, in: RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .help("Solicitar uma revisão")

            Button {
                showingSettings = true
            } label: {
                Image(systemName: "sun.max")
                    .font(.system(size: 15))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: 26, height: 30)
            }
            .buttonStyle(.plain)
            .help("Preferências")
        }
        .padding(.horizontal, 18)
        .frame(height: 48)
        .background(PrototypeStyle.canvas)
    }

    private var toolbarSubtitle: String {
        let date = selectedDate.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "pt_BR")))
        return [date, day?.sundayName].compactMap { $0 }.joined(separator: " · ")
    }

    private func toolbarAction(_ symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
        }
        .buttonStyle(.plain)
    }

    private var dayHeader: some View {
        HStack(spacing: 13) {
            Circle()
                .fill(accentColor)
                .frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(PrototypeStyle.ink.opacity(0.14), lineWidth: 1))
            Text(selectedDate.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "pt_BR"))).lowercased())
                .font(PrototypeStyle.serif(27, weight: .semibold))
                .foregroundStyle(PrototypeStyle.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(selectedDate.formatted(.dateTime.year().locale(Locale(identifier: "pt_BR"))))
                .font(PrototypeStyle.serif(25))
                .foregroundStyle(PrototypeStyle.muted.opacity(0.64))
                .lineLimit(1)
            Text([day?.season?.name, day?.sundayName].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
                .lineLimit(1)
            Text(day?.color ?? "")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(accentColor)
            Spacer(minLength: 8)
            if isLoading { ProgressView().controlSize(.small).tint(accentColor) }
            if let celebration = day?.celebration {
                HStack(spacing: 7) {
                    Image(systemName: "sparkle").font(.system(size: 12)).foregroundStyle(accentColor)
                    Text(celebration.name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    if let type = celebration.type {
                        Text("· \(type)").font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                }
                .lineLimit(1)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(height: 63)
        .background(PrototypeStyle.canvas)
    }

    private func sermonEditor(draft: SermonDraft) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 5) {
                editorButton("bold", title: "Negrito", action: editorCommands.bold)
                editorButton("italic", title: "Itálico", action: editorCommands.italic)
                Divider().frame(height: 22).padding(.horizontal, 6)
                editorTextButton("Título", symbol: "textformat.size", action: editorCommands.heading)
                editorTextButton("Citação", symbol: "text.quote", action: editorCommands.quotation)
                editorTextButton("Lista", symbol: "list.bullet", action: editorCommands.bulletedList)
                editorTextButton("Nota", symbol: "text.badge.plus", action: editorCommands.footnote)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.white.opacity(0.93), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PrototypeStyle.line, lineWidth: 1))
            .padding(.top, 14)
            .padding(.bottom, 12)

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    TextField("Título do sermão", text: Bindable(draft).title)
                        .font(PrototypeStyle.serif(29, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                        .textFieldStyle(.plain)
                        .onChange(of: draft.title) { _, _ in draft.modifiedAt = .now }
                    Spacer(minLength: 8)
                }
                .padding(.top, 46)
                .padding(.horizontal, 46)
                .padding(.bottom, 8)

                HStack {
                    Text(draft.mainReadingReference.map { "Texto principal · \($0)" } ?? "Texto principal ainda não escolhido")
                    Spacer()
                    Text("Salvo neste Mac · \(draft.modifiedAt.formatted(date: .omitted, time: .shortened))")
                }
                .font(.system(size: 11))
                .foregroundStyle(PrototypeStyle.muted)
                .padding(.horizontal, 46)
                .padding(.bottom, 13)

                Divider().padding(.horizontal, 46)

                RichTextEditor(
                    rtfData: Bindable(draft).rtfData,
                    modifiedAt: Bindable(draft).modifiedAt,
                    commands: editorCommands
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
            }
            .frame(maxWidth: 760, maxHeight: .infinity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(PrototypeStyle.line.opacity(0.65), lineWidth: 1))
            .shadow(color: .black.opacity(0.035), radius: 12, y: 3)
            .padding(.horizontal, 32)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(PrototypeStyle.canvas)
    }

    private func editorButton(_ symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 28, height: 27)
                .contentShape(Rectangle())
        }
        .help(title)
        .accessibilityLabel(title)
    }

    private func editorTextButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12))
                .padding(.horizontal, 5)
                .frame(height: 27)
        }
        .help(title)
    }

    private func statusBar(draft: SermonDraft) -> some View {
        let words = plainText(from: draft.rtfData).split(whereSeparator: \.isWhitespace).count
        let pages = Double(words) / 720
        return HStack(spacing: 12) {
            Text("\(words.formatted()) palavras · ≈ \(pages.formatted(.number.precision(.fractionLength(1)))) páginas")
                .foregroundStyle(PrototypeStyle.muted)
            Text("seu habitual: 3 páginas ≈ 20–24 min")
                .foregroundStyle(PrototypeStyle.muted.opacity(0.72))
            Spacer()
            Circle().fill(PrototypeStyle.muted.opacity(0.42)).frame(width: 6, height: 6)
            Text("Drive não conectado")
                .foregroundStyle(PrototypeStyle.muted)
            Button("\(draft.modifiedAt.formatted(date: .omitted, time: .shortened)) · local") {
                showingArchive = true
            }
            .buttonStyle(.plain)
            .foregroundStyle(accentColor)
            .help("Abrir histórico de sermões")
        }
        .font(.system(size: 11))
        .padding(.horizontal, 20)
        .frame(height: 34)
        .background(PrototypeStyle.canvas)
        .overlay(alignment: .top) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    private func plainText(from data: Data?) -> String {
        guard let data,
              let text = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) else {
            return ""
        }
        return text.string
    }

    private func chooseMainReading(_ reading: LiturgicalReading, for draft: SermonDraft) {
        if draft.mainReadingReference == reading.reference && draft.mainReadingSlot == reading.slot {
            draft.mainReadingReference = nil
            draft.mainReadingSlot = nil
        } else {
            let previousTitle = draft.mainReadingReference
            draft.mainReadingReference = reading.reference
            draft.mainReadingSlot = reading.slot
            if draft.title.isEmpty || draft.title == previousTitle {
                draft.title = reading.reference
            }
            if !expandedReadingIDs.contains(reading.id) {
                expandedReadingIDs.insert(reading.id)
            }
        }
        draft.modifiedAt = .now
    }

    private func ensureDraft(for date: Date) {
        guard !drafts.contains(where: { Calendar.current.isDate($0.liturgicalDate, inSameDayAs: date) }) else { return }
        modelContext.insert(SermonDraft(liturgicalDate: date))
        try? modelContext.save()
    }

    private func loadTranslation(_ bible: String) {
        selectedBible = bible
        alternativeTexts = [:]
        guard bible != settingsStore.settings.bible,
              let day,
              let key = settingsStore.credential else { return }
        Task { @MainActor in
            let client = LiturgicalAPIClient(settings: settingsStore.settings, apiKey: key)
            for reading in day.readings ?? [] {
                do {
                    let text = try await client.fetchPassage(reference: reading.reference, bible: bible)
                    alternativeTexts[reading.id] = text
                } catch {
                    continue
                }
            }
        }
    }

    @MainActor
    private func loadDay() async {
        guard settingsStore.hasAPIKey, let key = settingsStore.credential else {
            day = nil
            loadError = nil
            isLoading = false
            return
        }
        isLoading = true
        loadError = nil
        day = nil
        alternativeTexts = [:]
        selectedBible = settingsStore.settings.bible
        do {
            let loadedDay = try await LiturgicalAPIClient(settings: settingsStore.settings, apiKey: key).fetchDay(selectedDate)
            try Task.checkCancellation()
            day = loadedDay
            let preferred = loadedDay.readings?.first(where: { $0.slot == "gospel" }) ?? loadedDay.readings?.first
            if let draft = activeDraft, draft.mainReadingReference == nil, let preferred {
                draft.mainReadingReference = preferred.reference
                draft.mainReadingSlot = preferred.slot
                if draft.title.isEmpty { draft.title = preferred.reference }
                draft.modifiedAt = .now
            }
            if let draft = activeDraft,
               let selected = loadedDay.readings?.first(where: {
                   $0.reference == draft.mainReadingReference && $0.slot == draft.mainReadingSlot
               }) {
                expandedReadingIDs = [selected.id]
            } else {
                expandedReadingIDs = []
            }
        } catch is CancellationError {
            return
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

private enum LiturgicalColor {
    static func resolve(_ value: String?) -> Color {
        switch value?.lowercased().folding(options: [.diacriticInsensitive], locale: .current) {
        case "verde", "green": return Color(red: 0.22, green: 0.56, blue: 0.36)
        case "roxo", "violeta", "purple", "violet": return Color(red: 0.47, green: 0.34, blue: 0.67)
        case "vermelho", "red": return Color(red: 0.76, green: 0.25, blue: 0.23)
        case "rosa", "rose", "pink": return Color(red: 0.83, green: 0.43, blue: 0.57)
        case "preto", "negro", "black": return Color(nsColor: .secondaryLabelColor)
        case "branco", "white": return Color(red: 0.72, green: 0.59, blue: 0.28)
        default: return PrototypeStyle.green
        }
    }
}
