import AppKit
import SwiftData
import SwiftUI

struct PreparationWorkspace: View {
    @EnvironmentObject private var settingsStore: APISettingsStore
    @EnvironmentObject private var appearanceStore: AppAppearanceStore
    @EnvironmentObject private var bibleSession: BibleWindowSession
    @EnvironmentObject private var googleDrive: GoogleDriveStore
    @EnvironmentObject private var navigation: WorkspaceNavigationStore
    @Environment(\.openWindow) private var openWindow
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SermonDraft.modifiedAt, order: .reverse) private var drafts: [SermonDraft]

    @State private var selectedDate = Calendar.current.startOfDay(for: .now)
    @State private var calendarMonth = Calendar.current.startOfDay(for: .now)
    @State private var day: LiturgicalDay?
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var showingSettingsOnLaunch = false
    @State private var showingReview = false
    @State private var showingQuestions = false
    @State private var showingTablet = false
    @State private var showingDriveConnection = false
    @State private var showingHistory = false
    @State private var historyRevisions: [SermonRevision] = []
    @State private var historyDirty = false
    @State private var historySaveTask: Task<Void, Never>?
    @State private var driveSyncTask: Task<Void, Never>?
    @State private var historyErrorMessage: String?
    @State private var reviewReports: [SermonReviewReport] = []
    @State private var isSidebarVisible = true
    @State private var isReadingsVisible = true
    @State private var isContextVisible = true
    @State private var focusMode = false
    @AppStorage("pregar.onboarding.dismissed.v1") private var onboardingDismissed = false
    @State private var selectedBible = "nvt"
    @State private var alternativeTexts: [String: [String: BiblePassageText]] = [:]
    @State private var loadingTranslations: Set<String> = []
    @State private var expandedReadingIDs: Set<String> = []
    @State private var contextTab: ContextPaneTab = .materials
    @StateObject private var editorCommands = EditorCommands()
    private let revisionStore = SermonRevisionStore.shared
    private let reviewReportStore = SermonReviewReportStore.shared

    private var selectedDayKey: String {
        SermonDateKey.string(from: selectedDate)
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

    private var selectedDay: LiturgicalDay? {
        day?.date == selectedDayKey ? day : nil
    }

    private var displayedDay: LiturgicalDay? {
        selectedDay ?? (isLoading ? day : nil)
    }

    private var displayingPreviousDay: Bool {
        displayedDay?.date != selectedDayKey
    }

    var body: some View {
        HStack(spacing: 0) {
            if isSidebarVisible && !focusMode {
                CalendarSidebarView(
                    selectedDate: $selectedDate,
                    calendarMonth: $calendarMonth,
                    liturgicalDay: selectedDay,
                    accent: accentColor,
                    openArchive: { openWindow(id: "archive") },
                    openLibrary: { openWindow(id: "library") }
                )
                .frame(width: 236)
                Divider()
            }

            VStack(spacing: 0) {
                workspaceToolbar
                if !focusMode { dayHeader }
                Divider()

                HStack(spacing: 0) {
                    if isReadingsVisible && !focusMode {
                        readingsColumn(for: activeDraft)
                            .frame(width: 300)
                        Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                    } else if !focusMode {
                        collapsedPanelRail(
                            title: "Leituras",
                            symbol: "sidebar.left",
                            shortcut: "2",
                            topPadding: 14,
                            trailingPadding: 16,
                            dividerOnLeadingEdge: false
                        ) {
                            withAnimation(.easeInOut(duration: 0.16)) { isReadingsVisible = true }
                        }
                    }

                    if let draft = activeDraft {
                        sermonEditor(draft: draft)
                            .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        editorPlaceholder
                    }

                    if isContextVisible && !focusMode {
                        Rectangle().fill(PrototypeStyle.line).frame(width: 1)
                        ResourceContextPanel(
                            selectedTab: $contextTab,
                            reference: activeDraft?.mainReadingReference ?? "",
                            occasion: selectedDay?.sundayName ?? selectedDay?.celebration?.name,
                            liturgicalDate: selectedDate,
                            isSunday: selectedDay?.isSunday == true,
                            reviewReports: reviewReports,
                            manuscript: activeDraft.map { SermonReviewText.plainText(from: $0.rtfData) } ?? "",
                            accent: accentColor,
                            openSettings: openPreferences,
                            openDriveConnection: { showingDriveConnection = true },
                            openLibrary: { openWindow(id: "library") },
                            newReview: { showingReview = true },
                            selectQuote: { editorCommands.selectQuote($0) },
                            insertText: { editorCommands.insertText($0) },
                            emergencyQuestions: { showingQuestions = true },
                            collapse: { withAnimation(.easeInOut(duration: 0.16)) { isContextVisible = false } }
                        )
                        .frame(width: 320)
                    } else if !focusMode {
                        collapsedPanelRail(
                            title: "Materiais",
                            symbol: "sidebar.right",
                            shortcut: "3",
                            topPadding: 3,
                            trailingPadding: 12,
                            dividerOnLeadingEdge: true
                        ) {
                            withAnimation(.easeInOut(duration: 0.16)) { isContextVisible = true }
                        }
                    }
                }
                .background(PrototypeStyle.canvas)
                .tint(accentColor)

                if let draft = activeDraft {
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
        .sheet(isPresented: $showingReview) {
            if let draft = activeDraft {
                ReviewRequestSheet(
                    accent: accentColor,
                    context: reviewContext(for: draft),
                    bibleSources: reviewBibleSources(for: draft),
                    onReport: { report in
                        reviewReports.append(report)
                        contextTab = .review
                    },
                    selectQuote: { editorCommands.selectQuote($0) },
                    configureAI: {
                        showingReview = false
                        openPreferences()
                    }
                )
            }
        }
        .sheet(isPresented: $showingQuestions) {
            if let draft = activeDraft {
                EmergencyQuestionsSheet(
                    accent: accentColor,
                    context: SermonQuestionContext(
                        dateKey: selectedDayKey,
                        title: draft.title,
                        mainReference: draft.mainReadingReference ?? "",
                        manuscript: SermonReviewText.plainText(from: draft.rtfData)
                    ),
                    bibleSources: reviewBibleSources(for: draft),
                    selectQuote: { editorCommands.selectQuote($0) },
                    configureAI: {
                        showingQuestions = false
                        openPreferences()
                    }
                )
            }
        }
        .sheet(isPresented: $showingTablet) {
            TabletPreparationSheet(draft: activeDraft, accent: accentColor)
        }
        .sheet(isPresented: $showingDriveConnection) {
            GoogleDriveConnectionSheet(accent: accentColor)
        }
        .sheet(isPresented: $showingHistory) {
            if let draft = activeDraft {
                SermonHistorySheet(draft: draft, accent: accentColor)
            }
        }
        .alert(
            "Histórico de sermões",
            isPresented: Binding(get: { historyErrorMessage != nil }, set: { if !$0 { historyErrorMessage = nil } })
        ) {
            Button("OK") { historyErrorMessage = nil }
        } message: {
            Text(historyErrorMessage ?? "")
        }
        .task(id: requestKey) {
            guard !PregarRuntime.isIsolatedTestHost else { return }
            await loadDay()
        }
        .onAppear {
            guard !PregarRuntime.isIsolatedTestHost else { return }
            consumeNavigationRequest()
            ensureDraft(for: selectedDate)
            Task { await loadHistory(for: selectedDate) }
            Task { await loadReviewReports(for: selectedDayKey) }
            selectedBible = settingsStore.settings.bible
            appearanceStore.accent = accentColor
            if !settingsStore.isLoadingCredential && !settingsStore.hasAPIKey { showingSettingsOnLaunch = true }
        }
        .onChange(of: day?.color) { _, _ in appearanceStore.accent = accentColor }
        .onChange(of: navigation.dateRequest) { _, _ in consumeNavigationRequest() }
        .onChange(of: settingsStore.isLoadingCredential) { _, loading in
            if !loading && !settingsStore.hasAPIKey { showingSettingsOnLaunch = true }
        }
        .onChange(of: selectedDayKey) { _, _ in
            guard !PregarRuntime.isIsolatedTestHost else { return }
            historySaveTask?.cancel()
            driveSyncTask?.cancel()
            historyRevisions = []
            historyDirty = false
            ensureDraft(for: selectedDate)
            Task { await loadHistory(for: selectedDate) }
            Task { await loadReviewReports(for: selectedDayKey) }
            if !Calendar.current.isDate(selectedDate, equalTo: calendarMonth, toGranularity: .month) {
                calendarMonth = selectedDate
            }
        }
        .onChange(of: activeDraft?.modifiedAt) { _, _ in
            scheduleHistorySnapshot()
            scheduleDriveSync()
        }
        .onChange(of: googleDrive.isConnected) { _, connected in
            if connected { scheduleDriveSync() }
        }
        .onChange(of: showingSettingsOnLaunch) { _, shouldPresent in
            if shouldPresent {
                openPreferences()
                showingSettingsOnLaunch = false
            }
        }
    }

    private var workspaceToolbar: some View {
        HStack(spacing: PrototypeStyle.Spacing.sm) {
            Button {
                withAnimation(.easeInOut(duration: 0.16)) { isSidebarVisible.toggle() }
            } label: {
                Image(systemName: "sidebar.left")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(isSidebarVisible || focusMode ? PrototypeStyle.muted : accentColor)
                    .frame(width: PrototypeStyle.Layout.iconButtonSize, height: PrototypeStyle.Layout.iconButtonSize)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight)
            .keyboardShortcut("1", modifiers: [.command, .option])
            .help("Mostrar ou ocultar calendário (⌥⌘1)")
            .accessibilityLabel(isSidebarVisible ? "Ocultar calendário" : "Mostrar calendário")

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
            .padding(.leading, PrototypeStyle.Spacing.xs)

            Spacer(minLength: PrototypeStyle.Spacing.sm)

            HStack(spacing: 2) {
                toolbarAction("book.closed", title: "Bíblia", help: "Abrir a Bíblia com o texto principal (⌘1)") {
                    bibleSession.reference = activeDraft?.mainReadingReference ?? ""
                    openWindow(id: "bible")
                }
                toolbarAction("doc.text", title: "Leitor", help: "Abrir o Leitor de PDFs e sites (⌘2)") {
                    openWindow(id: "reader")
                }
                toolbarAction("ipad.landscape", title: "Tablet", help: "Preparar a cópia para pregar (⇧⌘T)") { showingTablet = true }
                    .keyboardShortcut("t", modifiers: [.command, .shift])
            }

            toolbarDivider

            Button {
                withAnimation(.easeInOut(duration: 0.16)) { focusMode.toggle() }
            } label: {
                Label("Foco", systemImage: focusMode ? "arrow.up.left.and.arrow.down.right" : "rectangle.compress.vertical")
                    .font(.system(size: 12, weight: focusMode ? .semibold : .regular))
                    .foregroundStyle(focusMode ? accentColor : PrototypeStyle.muted)
                    .padding(.horizontal, PrototypeStyle.Spacing.sm)
                    .frame(height: PrototypeStyle.Layout.iconButtonSize)
                    .background(focusMode ? PrototypeStyle.softAccent(accentColor) : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight)
            .keyboardShortcut("f", modifiers: [.command, .shift])
            .help(focusMode ? "Sair do modo de escrita (⇧⌘F)" : "Modo de escrita: recolhe calendário, leituras e materiais (⇧⌘F)")
            .accessibilityLabel(focusMode ? "Sair do modo de escrita" : "Entrar no modo de escrita")

            toolbarDivider

            Button {
                contextTab = .review
                isContextVisible = true
                showingReview = true
            } label: {
                Label("Revisar", systemImage: "checkmark")
            }
            .buttonStyle(.primaryAction(accentColor))
            .keyboardShortcut("r", modifiers: [.command, .shift])
            .help("Solicitar uma revisão do manuscrito (⇧⌘R)")

            Button {
                openPreferences()
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 15))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: PrototypeStyle.Layout.iconButtonSize, height: PrototypeStyle.Layout.iconButtonSize)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight)
            .help("Preferências (⌘,)")
            .accessibilityLabel("Preferências")
        }
        .padding(.leading, isSidebarVisible && !focusMode ? 18 : PrototypeStyle.Layout.windowControlsInset)
        .padding(.trailing, 18)
        .frame(height: PrototypeStyle.Layout.headerHeight)
        .background(PrototypeStyle.canvas)
        .overlay(alignment: .top) { Rectangle().fill(accentColor).frame(height: 2) }
    }

    private var toolbarDivider: some View {
        Rectangle()
            .fill(PrototypeStyle.line)
            .frame(width: 1, height: 18)
            .padding(.horizontal, 2)
            .accessibilityHidden(true)
    }

    private var toolbarSubtitle: String {
        let date = selectedDate.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "pt_BR")))
        let occasion = selectedDay?.sundayName ?? selectedDay?.season?.name
        let proper = LiturgicalDateContext.properDay(
            occasion: occasion,
            date: selectedDate,
            isSunday: selectedDay?.isSunday == true
        )?.shortDesignation
        return [date, proper ?? selectedDay?.sundayName].compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder
    private func readingsColumn(for draft: SermonDraft?) -> some View {
        if let displayedDay {
            ScripturePanelView(
                day: displayedDay,
                mainReference: draft?.mainReadingReference,
                mainSlot: draft?.mainReadingSlot,
                primaryBible: settingsStore.settings.bible,
                selectedBible: selectedBible,
                displayedTexts: alternativeTexts[selectedBible] ?? [:],
                isLoadingTranslation: loadingTranslations.contains(selectedBible),
                accent: accentColor,
                expandedReadingIDs: $expandedReadingIDs,
                chooseReading: { reading in
                    if let draft { chooseMainReading(reading, for: draft) }
                },
                chooseBible: loadTranslation,
                collapse: { withAnimation(.easeInOut(duration: 0.16)) { isReadingsVisible = false } }
            )
            .overlay {
                if displayingPreviousDay {
                    ZStack {
                        PrototypeStyle.paper.opacity(0.88)
                        VStack(spacing: 9) {
                            ProgressView().controlSize(.small).tint(accentColor)
                            Text("Atualizando leituras para \(selectedDate.formatted(.dateTime.day().month(.wide).locale(Locale(identifier: "pt_BR"))))…")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(PrototypeStyle.muted)
                        }
                        .padding(18)
                    }
                    .transition(.opacity)
                }
            }
            .allowsHitTesting(!displayingPreviousDay)
            .animation(.easeInOut(duration: 0.14), value: displayingPreviousDay)
        } else {
            VStack(spacing: 0) {
                HStack {
                    SectionLabel("Leituras")
                    Spacer()
                    if settingsStore.hasAPIKey, isLoading { ProgressView().controlSize(.small).tint(accentColor) }
                }
                .padding(.horizontal, 16)
                .frame(height: 45)
                VStack(spacing: 10) {
                    if settingsStore.isLoadingCredential || isLoading {
                        ProgressView().tint(accentColor)
                        Text(settingsStore.isLoadingCredential ? "Preparando a conexão…" : "Consultando o calendário…")
                    } else if let loadError {
                        Image(systemName: "calendar.badge.exclamationmark")
                        Text("Não foi possível carregar este dia")
                        Text(loadError).multilineTextAlignment(.center).lineLimit(4)
                        Button("Tentar novamente", systemImage: "arrow.clockwise") { Task { await loadDay() } }
                            .buttonStyle(.secondaryAction)
                    } else {
                        Image(systemName: "key.horizontal")
                        Text("Conecte a Estêvão API para carregar as leituras do dia")
                            .multilineTextAlignment(.center)
                        Button("Configurar chave", systemImage: "key") { openPreferences() }
                            .buttonStyle(.primaryAction(accentColor))
                            .help("Abre as Preferências na seção Estêvão API (⌘,)")
                    }
                }
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
                .padding(18)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(PrototypeStyle.paper)
            }
            .background(PrototypeStyle.paper)
        }
    }

    private var editorPlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "text.alignleft").font(.system(size: 22)).foregroundStyle(PrototypeStyle.muted)
            Text("Preparando o manuscrito").font(PrototypeStyle.serif(18, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            if isLoading { ProgressView().controlSize(.small).tint(accentColor) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PrototypeStyle.editorSurface)
    }

    private func openPreferences() {
        openWindow(id: "preferences")
    }

    private func toolbarAction(_ symbol: String, title: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
                .padding(.horizontal, 8)
                .frame(height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .help(help)
    }

    private func collapsedPanelRail(
        title: String,
        symbol: String,
        shortcut: KeyEquivalent,
        topPadding: CGFloat,
        trailingPadding: CGFloat,
        dividerOnLeadingEdge: Bool,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                Button(action: action) {
                    Image(systemName: symbol)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(accentColor)
                        .frame(width: 32, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight)
                .keyboardShortcut(shortcut, modifiers: [.command, .option])
                .help("Mostrar painel de \(title.lowercased()) (⌥⌘\(shortcut.character))")
                .accessibilityLabel("Mostrar painel de \(title.lowercased())")
            }
            Spacer(minLength: 0)
        }
        .padding(.top, topPadding)
        .padding(.trailing, trailingPadding)
        .frame(width: 56)
        .frame(maxHeight: .infinity)
        .background(PrototypeStyle.paper)
        .overlay(alignment: dividerOnLeadingEdge ? .leading : .trailing) {
            Rectangle().fill(PrototypeStyle.line).frame(width: 1)
        }
    }

    private var dayHeader: some View {
        HStack(spacing: 13) {
            Circle()
                .fill(accentColor)
                .frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(PrototypeStyle.ink.opacity(0.14), lineWidth: 1))
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(selectedDate.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "pt_BR"))).lowercased())
                    .font(PrototypeStyle.serif(24, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Text("de \(selectedDate.formatted(.dateTime.year().locale(Locale(identifier: "pt_BR"))))")
                    .font(PrototypeStyle.serif(24))
                    .foregroundStyle(PrototypeStyle.muted.opacity(0.64))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .layoutPriority(2)
            Text(dayHeaderContext)
                .font(.system(size: 13))
                .foregroundStyle(PrototypeStyle.muted)
                .lineLimit(1)
                .layoutPriority(1)
            if let color = LiturgicalColor.displayName(selectedDay?.color) {
                Text(color)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(accentColor)
            }
            Spacer(minLength: 8)
            if isLoading { ProgressView().controlSize(.small).tint(accentColor) }
            if let celebration = selectedDay?.celebration {
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
        .padding(.horizontal, 26)
        .padding(.vertical, 14)
        .frame(height: 56)
        .background(PrototypeStyle.canvas)
    }

    private var dayHeaderContext: String {
        guard let selectedDay else { return "" }
        let occasion = selectedDay.sundayName ?? selectedDay.season?.name
        let normalizedName = ScriptureReference.normalized(selectedDay.sundayName ?? "")
        let hasProperNumber = normalizedName.range(
            of: #"(?:proprio|proper)\s+\d+"#,
            options: .regularExpression
        ) != nil
        let hasYearLetter = normalizedName.range(
            of: #"(?:ano|year)\s+[abc]|(?:proprio|proper)\s+\d+\s*[abc]"#,
            options: .regularExpression
        ) != nil
        var parts = [selectedDay.sundayName ?? selectedDay.season?.name]
        if !hasProperNumber,
           let proper = LiturgicalDateContext.properDay(
               occasion: occasion,
               date: selectedDate,
               isSunday: selectedDay.isSunday == true
            ) {
            parts.append(proper.designation)
        }
        if !hasYearLetter, let year = LiturgicalDateContext.yearLetter(for: selectedDate) {
            parts.append("Ano \(year)")
        }
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    private func sermonEditor(draft: SermonDraft) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 5) {
                editorButton("bold", title: "Negrito", isActive: editorCommands.isBoldActive, shortcut: "b", action: editorCommands.bold)
                editorButton("italic", title: "Itálico", isActive: editorCommands.isItalicActive, shortcut: "i", action: editorCommands.italic)
                Divider().frame(height: 22).padding(.horizontal, 6)
                Menu {
                    ForEach(EditorCommands.fontFamilies, id: \.self) { family in
                        Button(family) { editorCommands.setFontFamily(family) }
                    }
                } label: {
                    Text(editorCommands.selectedFontFamily)
                        .font(.system(size: 11))
                        .lineLimit(1)
                        .frame(width: 72, height: 32, alignment: .leading)
                }
                .menuStyle(.borderlessButton)
                .help("Fonte: \(editorCommands.selectedFontFamily)")

                Menu {
                    ForEach(EditorCommands.fontSizes, id: \.self) { size in
                        Button("\(size) pt") { editorCommands.setFontSize(size) }
                    }
                } label: {
                    Text("\(editorCommands.selectedFontSize) pt")
                        .font(.system(size: 11))
                        .frame(width: 42, height: 32)
                }
                .menuStyle(.borderlessButton)
                .help("Tamanho da fonte")
                Divider().frame(height: 22).padding(.horizontal, 4)
                editorTextButton("Título", help: "Transformar o parágrafo em título", isActive: editorCommands.isHeadingActive, action: editorCommands.heading)
                editorTextButton("Citação", help: "Destacar o parágrafo como citação em bloco", isActive: editorCommands.isQuoteActive, action: editorCommands.quotation)
                editorTextButton("Lista", help: "Alternar marcadores de lista no parágrafo", isActive: editorCommands.isListActive, action: editorCommands.bulletedList)
                editorTextButton("Nota", help: "Inserir nota de rodapé no ponto do cursor", action: editorCommands.footnote)
            }
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(PrototypeStyle.paper.opacity(0.94), in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous).stroke(PrototypeStyle.line.opacity(0.6), lineWidth: 1))
            .shadow(color: .black.opacity(0.07), radius: 14, y: 4)
            .padding(.top, 14)
            .padding(.bottom, 12)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Formatação do manuscrito")

            if !onboardingDismissed && editorCommands.isEmpty {
                onboardingCard
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    TextField("Título do sermão", text: Binding(
                        get: { draft.title },
                        set: { title in
                            guard draft.title != title else { return }
                            draft.title = title
                            draft.modifiedAt = .now
                        }
                    ))
                        .font(PrototypeStyle.serif(28, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                        .textFieldStyle(.plain)
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
                .padding(.bottom, 12)

                Divider().padding(.horizontal, 46)

                RichTextEditor(
                    rtfData: Bindable(draft).rtfData,
                    modifiedAt: Bindable(draft).modifiedAt,
                    commands: editorCommands
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(alignment: .topLeading) {
                    if editorCommands.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Comece a escrever seu sermão…")
                                .font(.custom("Arial", size: 10))
                                .foregroundStyle(PrototypeStyle.muted.opacity(0.85))
                            Text("Negrito ⌘B · Itálico ⌘I · Título, citação, lista e nota na barra acima")
                                .font(.system(size: 10))
                                .foregroundStyle(PrototypeStyle.muted.opacity(0.6))
                        }
                        .padding(.leading, 53)
                        .padding(.top, 22)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
            }
            .frame(maxWidth: 640, maxHeight: .infinity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(PrototypeStyle.manuscript, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(PrototypeStyle.line.opacity(0.35), lineWidth: 1))
            .shadow(color: .black.opacity(0.05), radius: 16, y: 5)
            .padding(.horizontal, 32)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(PrototypeStyle.editorSurface)
    }

    private func editorButton(_ symbol: String, title: String, isActive: Bool, shortcut: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .foregroundStyle(isActive ? accentColor : PrototypeStyle.ink)
                .frame(width: 32, height: 32)
                .background(isActive ? PrototypeStyle.softAccent(accentColor) : .clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .contentShape(Rectangle())
        }
        .keyboardShortcut(shortcut, modifiers: .command)
        .buttonStyle(.hoverHighlight(cornerRadius: 5))
        .help(symbol == "bold" ? "\(title) (⌘B)" : "\(title) (⌘I)")
        .accessibilityLabel(title)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private func editorTextButton(_ title: String, help: String, isActive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? accentColor : PrototypeStyle.ink)
                .padding(.horizontal, 8)
                .frame(height: 32)
                .background(isActive ? PrototypeStyle.softAccent(accentColor) : .clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: 5))
        .help(help)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    /// Orientação de primeiro uso. Aparece enquanto o manuscrito está vazio e some
    /// definitivamente ao ser dispensada; não cobre nem interrompe a escrita.
    private var onboardingCard: some View {
        VStack(alignment: .leading, spacing: PrototypeStyle.Spacing.md) {
            HStack(alignment: .center) {
                Text("Como funciona a Mesa")
                    .font(PrototypeStyle.serif(16, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { onboardingDismissed = true }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.muted)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight)
                .help("Ocultar esta orientação")
                .accessibilityLabel("Ocultar orientação de primeiro uso")
            }
            HStack(alignment: .top, spacing: PrototypeStyle.Spacing.lg) {
                onboardingStep(1, symbol: "calendar", title: "Escolha o domingo", detail: "O calendário à esquerda carrega as leituras e a coleta do dia.")
                onboardingStep(2, symbol: "text.book.closed", title: "Marque o texto principal", detail: "O círculo ao lado de uma leitura guia os materiais e a revisão.")
                onboardingStep(3, symbol: "pencil.line", title: "Escreva e revise", detail: "Tudo é salvo neste Mac. Revisar aponta problemas, nunca reescreve.")
            }
        }
        .panelCard(padding: PrototypeStyle.Spacing.lg, background: PrototypeStyle.manuscript)
        .frame(maxWidth: 640)
        .padding(.horizontal, 32)
        .padding(.bottom, PrototypeStyle.Spacing.md)
    }

    private func onboardingStep(_ number: Int, symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: PrototypeStyle.Spacing.sm) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(accentColor)
                .frame(width: 28, height: 28)
                .background(PrototypeStyle.softAccent(accentColor), in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(number). \(title)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statusBar(draft: SermonDraft) -> some View {
        let words = editorCommands.wordCount
        let pages = Double(words) / 720
        // ~2.100 palavras renderam 20–24 min na prática do usuário; ≈ 96 palavras por minuto.
        let minutes = Int((Double(words) / 96).rounded())
        let driveStatus: String = {
            if googleDrive.isLoading { return "Drive · verificando" }
            if googleDrive.isSaving { return "Drive · salvando" }
            if !googleDrive.isConnected { return "Drive não conectado" }
            if let error = draft.googleDriveSyncError {
                return error.localizedCaseInsensitiveContains("mudou fora") ? "Drive · conflito" : "Drive · erro"
            }
            if let syncedAt = draft.googleDriveSyncedAt { return "Drive · atualizado \(syncedAt.formatted(date: .omitted, time: .shortened))" }
            if draft.googleDriveDocumentID != nil { return "Drive · aguardando sincronização" }
            return "Drive · sem documento"
        }()
        let driveColor: Color = draft.googleDriveSyncError == nil ? accentColor : .orange
        return HStack(spacing: 12) {
            Text("\(words.formatted()) palavras · ≈ \(pages.formatted(.number.precision(.fractionLength(1)))) páginas · ≈ \(minutes) min")
                .foregroundStyle(PrototypeStyle.muted)
                .monospacedDigit()
                .help("Estimativa a partir do seu ritmo habitual: 3 páginas rendem 20–24 minutos")
            Text("seu habitual: 3 páginas ≈ 20–24 min")
                .foregroundStyle(PrototypeStyle.muted.opacity(0.72))
            Spacer()
            Button { showingDriveConnection = true } label: {
                HStack(spacing: 6) {
                    Circle().fill(googleDrive.isConnected ? driveColor : PrototypeStyle.muted.opacity(0.42)).frame(width: 6, height: 6)
                    Text(driveStatus).foregroundStyle(googleDrive.isConnected ? driveColor : PrototypeStyle.muted)
                }
                .padding(.horizontal, PrototypeStyle.Spacing.sm)
                .frame(height: PrototypeStyle.Layout.compactControlHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight(cornerRadius: 5))
            .help(googleDrive.isConnected ? "Gerenciar conexão com o Google Drive" : "Conectar Google Drive para manter uma cópia do sermão")
            Button {
                showingHistory = true
            } label: {
                Label("v\(currentRevisionNumber) · histórico", systemImage: "clock.arrow.circlepath")
                    .foregroundStyle(accentColor)
                    .padding(.horizontal, PrototypeStyle.Spacing.sm)
                    .frame(height: PrototypeStyle.Layout.compactControlHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.hoverHighlight(cornerRadius: 5))
            .keyboardShortcut("h", modifiers: [.command, .shift])
            .help("Abrir histórico recuperável deste sermão (⇧⌘H)")
        }
        .font(.system(size: 11))
        .padding(.horizontal, PrototypeStyle.Spacing.md)
        .frame(height: 34)
        .background(PrototypeStyle.canvas)
        .overlay(alignment: .top) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    private var currentRevisionNumber: Int {
        max(1, (historyRevisions.last?.version ?? 0) + (historyDirty ? 1 : 0))
    }

    @MainActor
    private func loadHistory(for date: Date) async {
        do {
            let revisions = try await revisionStore.revisions(for: date)
            guard Calendar.current.isDate(date, inSameDayAs: selectedDate) else { return }
            historyRevisions = revisions
            if let draft = activeDraft {
                historyDirty = revisions.last.map { !$0.matches(SermonRevisionSnapshot(draft: draft)) } ?? false
            }
        } catch {
            historyErrorMessage = "Não foi possível carregar o histórico: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func scheduleHistorySnapshot() {
        historySaveTask?.cancel()
        guard let draft = activeDraft else { return }
        historyDirty = true
        let date = draft.liturgicalDate
        historySaveTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(12))
                try Task.checkCancellation()
                let revisions = try await revisionStore.capture(
                    SermonRevisionSnapshot(draft: draft),
                    for: date
                )
                guard Calendar.current.isDate(date, inSameDayAs: selectedDate) else { return }
                historyRevisions = revisions
                historyDirty = false
            } catch is CancellationError {
                return
            } catch {
                historyErrorMessage = "Não foi possível salvar uma versão local: \(error.localizedDescription)"
            }
        }
    }

    @MainActor
    private func scheduleDriveSync() {
        driveSyncTask?.cancel()
        guard googleDrive.isConnected,
              let draft = activeDraft,
              googleDrive.hasUnsyncedChanges(draft) else { return }
        let draftID = draft.persistentModelID
        driveSyncTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(2))
                try Task.checkCancellation()
                while googleDrive.isSaving {
                    try await Task.sleep(for: .milliseconds(300))
                    try Task.checkCancellation()
                }
                guard let latest = activeDraft, latest.persistentModelID == draftID else { return }
                try await googleDrive.saveSermon(latest, modelContext: modelContext)
                if googleDrive.hasUnsyncedChanges(latest) { scheduleDriveSync() }
            } catch is CancellationError {
            } catch {
                // The draft keeps the sync error; the status bar exposes it without interrupting writing.
            }
        }
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

    private func reviewContext(for draft: SermonDraft) -> SermonReviewContext {
        SermonReviewContext(
            dateKey: selectedDayKey,
            title: draft.title,
            mainReference: draft.mainReadingReference ?? "",
            manuscript: SermonReviewText.plainText(from: draft.rtfData),
            criteria: []
        )
    }

    private func reviewBibleSources(for draft: SermonDraft) -> [SermonReviewSource] {
        guard let readings = selectedDay?.readings,
              let reference = draft.mainReadingReference,
              let reading = readings.first(where: {
                  $0.reference == reference && ($0.slot == draft.mainReadingSlot || draft.mainReadingSlot == nil)
              }) ?? readings.first(where: { $0.reference == reference }) else { return [] }

        func source(_ text: BiblePassageText?, bible: String) -> SermonReviewSource? {
            let content: String
            if let verses = text?.verses, !verses.isEmpty {
                content = verses.map { "\($0.number) \($0.text)" }.joined(separator: "\n")
            } else {
                content = text?.content ?? ""
            }
            guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return SermonReviewSource(
                id: "bible:\(bible.lowercased())",
                title: bible.uppercased(),
                citation: "\(reading.reference) · \(bible.uppercased())",
                text: content
            )
        }

        var sources = [source(reading.text, bible: settingsStore.settings.bible)].compactMap { $0 }
        for (bible, texts) in alternativeTexts.sorted(by: { $0.key < $1.key }) {
            guard let passage = texts[reading.id], let translated = source(passage, bible: bible) else { continue }
            sources.append(translated)
        }
        return sources
    }

    @MainActor
    private func loadReviewReports(for dateKey: String) async {
        do {
            let loaded = try await reviewReportStore.reports(for: dateKey)
            guard selectedDayKey == dateKey else { return }
            reviewReports = loaded
        } catch {
            reviewReports = []
        }
    }

    /// Atende pedidos de outras janelas (Arquivo) para abrir a preparação de uma data.
    private func consumeNavigationRequest() {
        guard let requested = navigation.consumeDateRequest() else { return }
        let day = Calendar.current.startOfDay(for: requested)
        if focusMode { focusMode = false }
        selectedDate = day
        calendarMonth = day
    }

    private func ensureDraft(for date: Date) {
        guard !drafts.contains(where: { Calendar.current.isDate($0.liturgicalDate, inSameDayAs: date) }) else { return }
        modelContext.insert(SermonDraft(liturgicalDate: date))
        try? modelContext.save()
    }

    private func loadTranslation(_ bible: String) {
        selectedBible = bible
        guard bible != settingsStore.settings.bible,
              let day = selectedDay,
              let key = settingsStore.credential else { return }
        let missingReadings = (day.readings ?? []).filter { alternativeTexts[bible]?[$0.id] == nil }
        guard !missingReadings.isEmpty, !loadingTranslations.contains(bible) else { return }
        loadingTranslations.insert(bible)
        Task { @MainActor in
            defer { loadingTranslations.remove(bible) }
            let client = LiturgicalAPIClient(settings: settingsStore.settings, apiKey: key)
            for reading in missingReadings {
                do {
                    let text = try await client.fetchPassage(reference: reading.reference, bible: bible)
                    alternativeTexts[bible, default: [:]][reading.id] = text
                } catch {
                    continue
                }
            }
        }
    }

    @MainActor
    private func loadDay() async {
        guard !settingsStore.isLoadingCredential else {
            isLoading = true
            return
        }
        selectedBible = settingsStore.settings.bible
        guard settingsStore.hasAPIKey, let key = settingsStore.credential else {
            loadError = nil
            isLoading = false
            return
        }
        isLoading = true
        loadError = nil
        do {
            let loadedDay = try await LiturgicalAPIClient(settings: settingsStore.settings, apiKey: key).fetchDay(selectedDate)
            try Task.checkCancellation()
            day = loadedDay
            let draft = activeDraft
            var draftChanged = false
            if let draft {
                let occasion = loadedDay.sundayName
                let celebration = loadedDay.celebration?.name ?? loadedDay.celebrations?.first?.name
                let season = loadedDay.season?.name
                let prayerBookID = settingsStore.settings.prayerBook
                draftChanged = draft.liturgicalOccasion != occasion
                    || draft.liturgicalCelebration != celebration
                    || draft.liturgicalSeason != season
                    || draft.prayerBookID != prayerBookID
                draft.liturgicalOccasion = occasion
                draft.liturgicalCelebration = celebration
                draft.liturgicalSeason = season
                draft.prayerBookID = prayerBookID
            }
            let preferred = loadedDay.readings?.first(where: { $0.slot == "gospel" }) ?? loadedDay.readings?.first
            if let draft, draft.mainReadingReference == nil, let preferred {
                draft.mainReadingReference = preferred.reference
                draft.mainReadingSlot = preferred.slot
                if draft.title.isEmpty { draft.title = preferred.reference }
                draft.modifiedAt = .now
                draftChanged = true
            }
            if let draft,
               let selected = loadedDay.readings?.first(where: {
                   $0.reference == draft.mainReadingReference && $0.slot == draft.mainReadingSlot
               }) {
                expandedReadingIDs = [selected.id]
            } else {
                expandedReadingIDs = []
            }
            if draftChanged { try? modelContext.save() }
        } catch is CancellationError {
            return
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

private enum LiturgicalColor {
    static func displayName(_ value: String?) -> String? {
        switch value?.lowercased().folding(options: [.diacriticInsensitive], locale: .current) {
        case "verde", "green": return "Verde"
        case "roxo", "violeta", "purple", "violet": return "Roxo"
        case "vermelho", "red": return "Vermelho"
        case "rosa", "rose", "pink": return "Rosa"
        case "preto", "negro", "black": return "Preto"
        case "branco", "white": return "Branco"
        default: return value?.capitalized
        }
    }

    static func resolve(_ value: String?) -> Color {
        switch value?.lowercased().folding(options: [.diacriticInsensitive], locale: .current) {
        case "verde", "green": return PrototypeStyle.green
        case "roxo", "violeta", "purple", "violet": return Color(red: 0.47, green: 0.34, blue: 0.67)
        case "vermelho", "red": return Color(red: 0.76, green: 0.25, blue: 0.23)
        case "rosa", "rose", "pink": return Color(red: 0.83, green: 0.43, blue: 0.57)
        case "preto", "negro", "black": return Color(nsColor: .secondaryLabelColor)
        case "branco", "white": return Color(red: 0.72, green: 0.59, blue: 0.28)
        default: return PrototypeStyle.green
        }
    }
}
