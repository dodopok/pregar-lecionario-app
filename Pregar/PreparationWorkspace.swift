import SwiftData
import SwiftUI

struct PreparationWorkspace: View {
    @EnvironmentObject private var settingsStore: APISettingsStore
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SermonDraft.modifiedAt, order: .reverse) private var drafts: [SermonDraft]

    @State private var selectedDate = Calendar.current.startOfDay(for: .now)
    @State private var day: LiturgicalDay?
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var showingSettings = false
    @State private var showingSettingsOnLaunch = false
    @State private var expandedReadingIDs: Set<String> = []
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

    var body: some View {
        NavigationSplitView {
            dateSidebar
                .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 310)
        } detail: {
            workspace
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showingSettings = true } label: {
                    Label("Configurar Estêvão API", systemImage: "gearshape")
                }
                .help("Configurar a chave e as leituras da Estêvão API")
            }
        }
        .sheet(isPresented: $showingSettings) {
            APISettingsView(store: settingsStore)
        }
        .task(id: requestKey) { await loadDay() }
        .onAppear {
            ensureDraft(for: selectedDate)
            if !settingsStore.hasAPIKey { showingSettingsOnLaunch = true }
        }
        .onChange(of: selectedDayKey) { _, _ in ensureDraft(for: selectedDate) }
        .onChange(of: showingSettingsOnLaunch) { _, shouldPresent in
            if shouldPresent {
                showingSettings = true
                showingSettingsOnLaunch = false
            }
        }
    }

    private var dateSidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Image(systemName: "book.closed.fill")
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pregar").font(.headline)
                    Text("Preparação").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }

            DatePicker("Data litúrgica", selection: $selectedDate, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()

            HStack(spacing: 8) {
                Button {
                    moveDate(by: -7)
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 32, height: 30)
                }
                .help("Semana anterior")

                Button("Hoje") { selectedDate = Calendar.current.startOfDay(for: .now) }
                    .frame(maxWidth: .infinity)

                Button {
                    moveDate(by: 7)
                } label: {
                    Image(systemName: "chevron.right")
                        .frame(width: 32, height: 30)
                }
                .help("Próxima semana")
            }
            .buttonStyle(.bordered)

            Spacer(minLength: 0)

            if let day {
                HStack(spacing: 8) {
                    Circle().fill(LiturgicalColor.resolve(day.color)).frame(width: 9, height: 9)
                    Text(day.season?.name ?? "Calendário litúrgico")
                        .font(.callout)
                        .lineLimit(2)
                }
                .foregroundStyle(.secondary)
            }
            Text("LOC 2027")
                .font(.caption.weight(.medium))
                .foregroundStyle(.tertiary)
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var workspace: some View {
        VStack(spacing: 0) {
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
                    ProgressView()
                    Text(settingsStore.hasAPIKey ? "Consultando o calendário…" : "Configure sua chave da Estêvão API")
                        .font(.callout).foregroundStyle(.secondary)
                    if !settingsStore.hasAPIKey {
                        Button("Configurar Estêvão API") { showingSettings = true }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let day, let draft = activeDraft {
                HStack(spacing: 0) {
                    scripturePanel(day: day, draft: draft)
                        .frame(minWidth: 290, idealWidth: 370, maxWidth: 480)
                    Divider()
                    sermonEditor(draft: draft)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var dayHeader: some View {
        HStack(alignment: .center, spacing: 18) {
            Circle()
                .fill(LiturgicalColor.resolve(day?.color))
                .frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(.primary.opacity(0.14), lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                Text(selectedDate.formatted(.dateTime.weekday(.wide).day().month(.wide).year().locale(Locale(identifier: "pt_BR"))))
                    .font(.title2.weight(.semibold))
                Text(dayTitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 10)
            if isLoading { ProgressView().controlSize(.small) }
            if let day, let celebration = day.celebration {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(celebration.name).font(.callout.weight(.medium))
                    Text(day.season?.name ?? day.sundayName ?? "")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .lineLimit(1)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 17)
    }

    private var dayTitle: String {
        guard let day else { return "LOC 2027" }
        if let celebration = day.celebration?.name { return celebration }
        if let sundayName = day.sundayName { return sundayName }
        return day.dayOfWeek?.capitalized ?? "LOC 2027"
    }

    private func scripturePanel(day: LiturgicalDay, draft: SermonDraft) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Text("LEITURAS").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(day.readings?.count ?? 0)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
                }

                if let readings = day.readings, !readings.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(readings) { reading in
                            readingRow(reading, draft: draft)
                            if reading.id != readings.last?.id { Divider().padding(.vertical, 10) }
                        }
                    }
                } else {
                    Text("Esta data não tem leituras publicadas no lecionário selecionado.")
                        .font(.callout).foregroundStyle(.secondary)
                }

                if let collects = day.collect, !collects.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 12) {
                        Text("COLETAS").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(collects) { collect in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(collect.title ?? collect.subtitle ?? "Do dia")
                                    .font(.callout.weight(.medium))
                                if let text = collect.text {
                                    Text(text).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                }

                if let celebrations = day.celebrations, !celebrations.isEmpty {
                    Divider()
                    VStack(alignment: .leading, spacing: 9) {
                        Text("COMEMORAÇÕES").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(Array(celebrations.enumerated()), id: \.offset) { _, celebration in
                            Label(celebration.name, systemImage: "sparkle")
                                .font(.callout)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(22)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.42))
    }

    private func readingRow(_ reading: LiturgicalReading, draft: SermonDraft) -> some View {
        let isPrimary = draft.mainReadingSlot == reading.slot && draft.mainReadingReference == reading.reference
        let isExpanded = expandedReadingIDs.contains(reading.id)

        return VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 8) {
                Button {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        if isExpanded { expandedReadingIDs.remove(reading.id) }
                        else { expandedReadingIDs.insert(reading.id) }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(reading.label.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            if reading.slot == "gospel" {
                                Text("EVANGELHO").font(.system(size: 9, weight: .bold)).foregroundStyle(.orange)
                            }
                        }
                        Text(reading.reference)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(isExpanded ? "Recolher o texto" : "Ler o texto bíblico")

                Button {
                    draft.mainReadingSlot = isPrimary ? nil : reading.slot
                    draft.mainReadingReference = isPrimary ? nil : reading.reference
                    draft.modifiedAt = .now
                } label: {
                    Image(systemName: isPrimary ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(isPrimary ? Color.accentColor : Color.secondary)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(isPrimary ? "Desmarcar texto principal" : "Usar como texto principal")
                .accessibilityLabel(isPrimary ? "Desmarcar texto principal" : "Usar \(reading.label) como texto principal")
            }

            if isPrimary {
                Text("TEXTO PRINCIPAL")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.accentColor)
            }

            if isExpanded {
                if let verses = reading.text?.verses, !verses.isEmpty {
                    VStack(alignment: .leading, spacing: 11) {
                        ForEach(verses) { verse in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(verse.number)")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.tertiary)
                                    .frame(width: 18, alignment: .trailing)
                                Text(verse.text)
                                    .font(.system(size: 13))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.top, 5)
                    .padding(.leading, 1)
                } else if let content = reading.text?.content {
                    Text(content)
                        .font(.system(size: 13))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 5)
                } else {
                    Text("O texto desta leitura não está disponível nesta tradução.")
                        .font(.caption).foregroundStyle(.secondary).padding(.top, 4)
                }
            }
        }
        .padding(.vertical, 5)
    }

    private func sermonEditor(draft: SermonDraft) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                TextField("Título do sermão", text: Bindable(draft).title)
                    .font(.title3.weight(.semibold))
                    .textFieldStyle(.plain)
                    .onChange(of: draft.title) { _, _ in draft.modifiedAt = .now }
                Spacer(minLength: 12)
                Text("Salvo neste Mac")
                    .font(.caption).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 27)
            .padding(.top, 23)
            .padding(.bottom, 12)

            if let reference = draft.mainReadingReference {
                HStack(spacing: 7) {
                    Image(systemName: "book.closed")
                    Text("Texto principal: \(reference)")
                }
                .font(.callout).foregroundStyle(.secondary)
                .padding(.horizontal, 27)
                .padding(.bottom, 14)
            } else {
                Text("Escolha uma leitura à esquerda quando decidir o texto principal.")
                    .font(.callout).foregroundStyle(.tertiary)
                    .padding(.horizontal, 27)
                    .padding(.bottom, 14)
            }

            Divider()
            editorToolbar
            Divider()
            RichTextEditor(rtfData: Bindable(draft).rtfData, modifiedAt: Bindable(draft).modifiedAt, commands: editorCommands)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var editorToolbar: some View {
        HStack(spacing: 4) {
            editorButton("bold", title: "Negrito", action: editorCommands.bold)
            editorButton("italic", title: "Itálico", action: editorCommands.italic)
            Divider().frame(height: 20).padding(.horizontal, 5)
            editorButton("textformat.size", title: "Título", action: editorCommands.heading)
            editorButton("text.quote", title: "Recuar citação", action: editorCommands.quotation)
            editorButton("list.bullet", title: "Lista com marcadores", action: editorCommands.bulletedList)
            Spacer()
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 20)
        .padding(.vertical, 7)
    }

    private func editorButton(_ symbol: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 30, height: 28)
                .contentShape(Rectangle())
        }
        .help(title)
        .accessibilityLabel(title)
    }

    private func moveDate(by days: Int) {
        if let date = Calendar.current.date(byAdding: .day, value: days, to: selectedDate) {
            selectedDate = Calendar.current.startOfDay(for: date)
        }
    }

    private func ensureDraft(for date: Date) {
        guard !drafts.contains(where: { Calendar.current.isDate($0.liturgicalDate, inSameDayAs: date) }) else { return }
        modelContext.insert(SermonDraft(liturgicalDate: date))
        try? modelContext.save()
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
        do {
            let loadedDay = try await LiturgicalAPIClient(settings: settingsStore.settings, apiKey: key).fetchDay(selectedDate)
            try Task.checkCancellation()
            day = loadedDay
            expandedReadingIDs = Set((loadedDay.readings ?? []).map(\.id))
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
        case "branco", "white": return Color(red: 0.82, green: 0.69, blue: 0.31)
        default: return Color.accentColor
        }
    }
}
