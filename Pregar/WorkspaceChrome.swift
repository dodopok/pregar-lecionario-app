import AppKit
import SwiftUI

enum ContextPaneTab: String, CaseIterable, Identifiable {
    case materials = "Materiais"
    case ideas = "Ideias"
    case review = "Revisão"

    var id: String { rawValue }
}

/// Estado de uma preparação, para o calendário mostrar o ritmo da semana.
enum SermonPreparationState: String, Sendable {
    case empty
    case inProgress
    case exported

    var title: String {
        switch self {
        case .empty: "sem rascunho"
        case .inProgress: "em preparação"
        case .exported: "pronta para pregar"
        }
    }
}

struct CalendarSidebarView: View {
    @EnvironmentObject private var apiSettingsStore: APISettingsStore
    @Binding var selectedDate: Date
    @Binding var calendarMonth: Date
    let liturgicalDay: LiturgicalDay?
    let accent: Color
    let openArchive: () -> Void
    let openLibrary: () -> Void
    /// Estado de cada preparação por data (yyyy-MM-dd), calculado pela Mesa.
    var preparationStates: [String: SermonPreparationState] = [:]
    @State private var sundayNames: [String: String] = [:]
    @State private var dayLabelsByMonth: [String: [String: String]] = [:]

    private let calendar = Calendar(identifier: .gregorian)
    private let weekdays = ["D", "S", "T", "Q", "Q", "S", "S"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 1), count: 7)

    private var calendarCells: [Date?] {
        guard let interval = calendar.dateInterval(of: .month, for: calendarMonth),
              let dayRange = calendar.range(of: .day, in: .month, for: calendarMonth) else { return [] }
        let leading = (calendar.component(.weekday, from: interval.start) - calendar.firstWeekday + 7) % 7
        let dates = dayRange.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: interval.start) }
        return Array(repeating: nil, count: leading) + dates.map(Optional.some)
    }

    private var calendarMonthKey: String {
        let components = calendar.dateComponents([.year, .month], from: calendarMonth)
        return String(format: "%04d-%02d", components.year ?? 0, components.month ?? 0)
    }

    private var dayLabelsCacheKey: String {
        "\(calendarMonthKey)|\(apiSettingsStore.settings.prayerBook)|\(apiSettingsStore.settings.language)"
    }

    private var sundays: [Date] {
        guard let interval = calendar.dateInterval(of: .month, for: calendarMonth),
              let dayRange = calendar.range(of: .day, in: .month, for: calendarMonth) else { return [] }
        let dates = dayRange.compactMap { calendar.date(byAdding: .day, value: $0 - 1, to: interval.start) }
        var values = dates.filter { calendar.component(.weekday, from: $0) == 1 }
        if values.count < 5, let nextMonth = calendar.date(byAdding: .month, value: 1, to: interval.start),
           let nextInterval = calendar.dateInterval(of: .month, for: nextMonth),
           calendar.component(.weekday, from: nextInterval.start) == 1 {
            values.append(nextInterval.start)
        }
        return values
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Spacer().frame(height: 40)

            HStack(spacing: 9) {
                Image(systemName: "cross.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(accent, in: RoundedRectangle(cornerRadius: 7))
                    .animation(.easeInOut(duration: 0.3), value: accent)
                Text("Pregar")
                    .font(PrototypeStyle.serif(17, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
            }
            .padding(.horizontal, 4)

            VStack(spacing: 8) {
                HStack {
                    Text(monthTitle)
                        .font(PrototypeStyle.serif(15, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Spacer()
                    monthButton("chevron.left", accessibility: "Mês anterior", amount: -1)
                    monthButton("chevron.right", accessibility: "Próximo mês", amount: 1)
                }
                .padding(.horizontal, 5)

                LazyVGrid(columns: columns, spacing: 1) {
                    ForEach(Array(weekdays.enumerated()), id: \.offset) { index, label in
                        Text(label)
                            .font(.system(size: 9, weight: index == 0 ? .bold : .medium))
                            .foregroundStyle(index == 0 ? accent : PrototypeStyle.muted.opacity(0.75))
                            .frame(maxWidth: .infinity)
                            .frame(height: 13)
                    }
                    ForEach(Array(calendarCells.enumerated()), id: \.offset) { _, date in
                        if let date {
                            calendarDay(date)
                        } else {
                            Color.clear.frame(height: 30)
                        }
                    }
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 10)
            .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PrototypeStyle.line, lineWidth: 1))

            HStack(spacing: 6) {
                weekButton("chevron.left", accessibility: "Semana anterior", days: -7)
                Button {
                    let today = calendar.startOfDay(for: .now)
                    selectedDate = today
                    calendarMonth = today
                } label: {
                    Text("Hoje")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PrototypeStyle.ink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight)
                .help("Voltar para hoje")
                weekButton("chevron.right", accessibility: "Próxima semana", days: 7)
            }
            .font(.system(size: 12))

            VStack(alignment: .leading, spacing: 4) {
                SectionLabel("Domingos")
                    .padding(.horizontal, 6)
                ForEach(sundays, id: \.self) { sunday in
                    sundayRow(sunday)
                }
            }
            .padding(.top, 2)

            Spacer(minLength: 0)

            weekRhythmCard

            VStack(alignment: .leading, spacing: 3) {
                sidebarLink("Arquivo de sermões", symbol: "text.alignleft", action: openArchive)
                sidebarLink("Biblioteca de PDFs", symbol: "book.closed", action: openLibrary)
            }

            Text([
                "LOC 2027",
                liturgicalDay?.season?.name,
                LiturgicalDateContext.yearLetter(for: selectedDate).map { "Ano \($0)" }
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11))
                .foregroundStyle(PrototypeStyle.muted.opacity(0.8))
                .lineLimit(1)
                .padding(.horizontal, 6)
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(PrototypeStyle.sidebar)
        .task(id: "\(dayLabelsCacheKey)|\(apiSettingsStore.revision)") { await loadSundayNames() }
    }

    private var monthTitle: String {
        calendarMonth.formatted(.dateTime.month(.wide).locale(Locale(identifier: "pt_BR"))).lowercased()
    }

    private func monthButton(_ symbol: String, accessibility: String, amount: Int) -> some View {
        Button {
            if let date = calendar.date(byAdding: .month, value: amount, to: calendarMonth) {
                calendarMonth = date
            }
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .foregroundStyle(PrototypeStyle.muted)
        .help(accessibility)
        .accessibilityLabel(accessibility)
    }

    private func calendarDay(_ date: Date) -> some View {
        let selected = calendar.isDate(date, inSameDayAs: selectedDate)
        let isSunday = calendar.component(.weekday, from: date) == 1
        let isToday = calendar.isDateInToday(date)
        return Button {
            selectedDate = calendar.startOfDay(for: date)
        } label: {
            VStack(spacing: 1) {
                Text(date.formatted(.dateTime.day()))
                    .font(.system(size: 12, weight: selected || isToday ? .bold : .regular))
                    .foregroundStyle(selected ? .white : (isToday ? accent : PrototypeStyle.ink.opacity(isSunday ? 1 : 0.82)))
                Circle()
                    .fill(isSunday && !selected ? accent : .clear)
                    .frame(width: 3, height: 3)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 30)
            .background(selected ? accent : .clear, in: RoundedRectangle(cornerRadius: 7))
            .overlay {
                if isToday && !selected {
                    RoundedRectangle(cornerRadius: 7).strokeBorder(accent.opacity(0.55), lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .help(isToday ? "Hoje" : date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "pt_BR"))))
        .accessibilityLabel(isToday ? "Hoje, \(date.formatted(date: .long, time: .omitted))" : date.formatted(date: .long, time: .omitted))
    }

    private func weekButton(_ symbol: String, accessibility: String, days: Int) -> some View {
        Button {
            if let date = calendar.date(byAdding: .day, value: days, to: selectedDate) {
                selectedDate = calendar.startOfDay(for: date)
                calendarMonth = date
            }
        } label: {
            Image(systemName: symbol)
                .frame(width: 30, height: 30)
                .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .help(accessibility)
        .accessibilityLabel(accessibility)
    }

    private func sundayRow(_ date: Date) -> some View {
        let selected = calendar.isDate(date, inSameDayAs: selectedDate)
        let name = sundayNames[SermonDateKey.string(from: date)]
            ?? (selected ? liturgicalDay?.sundayName ?? liturgicalDay?.celebration?.name : nil)
        return Button {
            selectedDate = calendar.startOfDay(for: date)
        } label: {
            HStack(spacing: 8) {
                stateGlyph(for: date)
                Text(date.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "pt_BR"))))
                    .font(.system(size: 12, weight: selected ? .semibold : .regular))
                    .foregroundStyle(PrototypeStyle.ink)
                Text(name ?? "Domingo")
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .frame(height: 30)
            .background(selected ? accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .help("\(name ?? "Domingo") · \((preparationStates[SermonDateKey.string(from: date)] ?? .empty).title)")
    }

    private func stateGlyph(for date: Date) -> some View {
        let state = preparationStates[SermonDateKey.string(from: date)] ?? .empty
        let symbol: String
        switch state {
        case .empty: symbol = "circle"
        case .inProgress: symbol = "circle.lefthalf.filled"
        case .exported: symbol = "checkmark.circle.fill"
        }
        return Image(systemName: symbol)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(state == .empty ? accent.opacity(0.55) : accent)
            .frame(width: 12)
            .accessibilityLabel(state.title)
    }

    private var nextSunday: Date {
        let today = calendar.startOfDay(for: .now)
        let weekday = calendar.component(.weekday, from: today)
        let daysAhead = (8 - weekday) % 7
        return calendar.date(byAdding: .day, value: daysAhead, to: today) ?? today
    }

    /// Ritmo da semana, como o workshop recomenda: uma semana com o texto antes de pregar.
    private var weekRhythmCard: some View {
        let sunday = nextSunday
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: .now), to: sunday).day ?? 0
        let state = preparationStates[SermonDateKey.string(from: sunday)] ?? .empty
        let countdown = days == 0 ? "É hoje" : (days == 1 ? "Falta 1 dia" : "Faltam \(days) dias")
        let guidance: String
        switch (days, state) {
        case (_, .exported): guidance = "Cópia pronta. Releia com calma e descanse."
        case (0, _): guidance = "Dia de pregar: caminhe tranquilamente pelo texto."
        case (1, _): guidance = "Véspera: revise e prepare a cópia para o tablet."
        case (2...4, _): guidance = "Hora de escrever, com o texto já ruminado."
        default: guidance = "Semana de releitura: leia e releia os textos do domingo."
        }
        return Button {
            selectedDate = sunday
            calendarMonth = sunday
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    SectionLabel("Próximo domingo")
                    Spacer(minLength: 0)
                    Text(countdown)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(accent)
                }
                Text(sunday.formatted(.dateTime.day().month(.wide).locale(Locale(identifier: "pt_BR"))))
                    .font(PrototypeStyle.serif(13, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Text(state.title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(state == .empty ? PrototypeStyle.muted : accent)
                Text(guidance)
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panelCard(padding: 10, background: PrototypeStyle.paper)
            .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: PrototypeStyle.Radius.card))
        .help("Abrir a preparação do próximo domingo")
    }

    @MainActor
    private func loadSundayNames() async {
        if let cached = dayLabelsByMonth[dayLabelsCacheKey] {
            sundayNames = cached
            return
        }
        sundayNames = [:]
        guard let apiKey = apiSettingsStore.credential,
              let monthInterval = calendar.dateInterval(of: .month, for: calendarMonth),
              let lastDay = calendar.date(byAdding: .day, value: -1, to: monthInterval.end),
              let rangeEnd = calendar.date(byAdding: .day, value: 7, to: lastDay) else { return }

        do {
            let days = try await LiturgicalAPIClient(
                settings: apiSettingsStore.settings,
                apiKey: apiKey
            ).fetchCalendarDays(from: monthInterval.start, through: rangeEnd)
            try Task.checkCancellation()
            var names: [String: String] = [:]
            for day in days where day.isSunday == true {
                guard let name = day.sundayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { continue }
                names[day.date] = name
            }
            sundayNames = names
            dayLabelsByMonth[dayLabelsCacheKey] = names
        } catch is CancellationError {
            return
        } catch {
            sundayNames = [:]
        }
    }

    private func sidebarLink(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
                .frame(height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight)
        .help(title)
    }
}

struct ScripturePanelView: View {
    let day: LiturgicalDay
    let mainReference: String?
    let mainSlot: String?
    let primaryBible: String
    let selectedBible: String
    let displayedTexts: [String: BiblePassageText]
    let isLoadingTranslation: Bool
    let accent: Color
    @Binding var expandedReadingIDs: Set<String>
    let chooseReading: (LiturgicalReading) -> Void
    let chooseBible: (String) -> Void
    /// Insere o texto da coleta no manuscrito como epígrafe.
    let insertCollect: (String) -> Void
    let collapse: () -> Void

    private let translations = [("nvt", "NVT"), ("nvi", "NVI"), ("naa", "NAA"), ("ara", "ARA")]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                SectionLabel("Leituras")
                Spacer()
                Menu {
                    ForEach(translations, id: \.0) { code, label in
                        Button {
                            chooseBible(code)
                        } label: {
                            if selectedBible == code { Label(label, systemImage: "checkmark") }
                            else { Text(label) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(translations.first(where: { $0.0 == selectedBible })?.1 ?? selectedBible.uppercased())
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PrototypeStyle.ink)
                    .padding(.horizontal, 10)
                    .frame(height: PrototypeStyle.Layout.compactControlHeight)
                    .background(PrototypeStyle.surface, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous).stroke(PrototypeStyle.line, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .help("Tradução exibida nas leituras")
                Button(action: collapse) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 13, weight: .regular))
                        .frame(width: 32, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight)
                .foregroundStyle(PrototypeStyle.muted)
                .keyboardShortcut("2", modifiers: [.command, .option])
                .help("Ocultar painel de leituras (⌥⌘2)")
                .accessibilityLabel("Ocultar painel de leituras")
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if let collects = day.collect, !collects.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 6) {
                                Image(systemName: "hands.sparkles")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(accent)
                                    .accessibilityHidden(true)
                                SectionLabel(collects.count == 1 ? "Coleta do dia" : "Coletas do dia", color: accent)
                                Spacer(minLength: 0)
                            }
                            ForEach(collects) { collect in
                                VStack(alignment: .leading, spacing: 6) {
                                    if collects.count > 1, let title = collect.title ?? collect.subtitle,
                                       !title.localizedCaseInsensitiveContains("do dia") {
                                        Text(title)
                                            .font(.system(size: 10, weight: .semibold))
                                            .foregroundStyle(PrototypeStyle.muted)
                                    }
                                    if let text = collect.text {
                                        Text(text)
                                            .font(PrototypeStyle.serif(13))
                                            .foregroundStyle(PrototypeStyle.ink.opacity(0.9))
                                            .lineSpacing(3)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .textSelection(.enabled)
                                        Button("Inserir como epígrafe", systemImage: "text.quote") {
                                            insertCollect(text)
                                        }
                                        .buttonStyle(.linkAction(accent, compact: true))
                                        .help("Insere a coleta no início do manuscrito, como citação em bloco")
                                    }
                                }
                            }
                            Text("A coleta se liga às leituras e ao tempo litúrgico; lê-la antes ajuda a ver conexões.")
                                .font(.system(size: 10))
                                .foregroundStyle(PrototypeStyle.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .panelCard(padding: 12, background: PrototypeStyle.softAccent(accent))
                        .padding(.horizontal, 4)
                        .padding(.bottom, 8)
                    }

                    if let readings = day.readings, !readings.isEmpty {
                        ForEach(readings) { reading in
                            readingRow(reading)
                        }
                    } else {
                        ContentUnavailableView("Sem leituras", systemImage: "text.book.closed")
                    }

                    if let celebrations = day.celebrations, !celebrations.isEmpty {
                        Divider().padding(.vertical, 10)
                        sectionLabel("COMEMORAÇÕES")
                        ForEach(Array(celebrations.enumerated()), id: \.offset) { _, celebration in
                            Label(celebration.name, systemImage: "sparkle")
                                .font(.system(size: 12))
                                .padding(.vertical, 3)
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 18)
            }
        }
        .background(PrototypeStyle.paper)
    }

    private func readingRow(_ reading: LiturgicalReading) -> some View {
        let primary = mainSlot == reading.slot && mainReference == reading.reference
        let expanded = expandedReadingIDs.contains(reading.id)
        let text = selectedBible == primaryBible ? reading.text : displayedTexts[reading.id]

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 7) {
                Button {
                    if expanded { expandedReadingIDs.remove(reading.id) }
                    else { expandedReadingIDs.insert(reading.id) }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 5) {
                            Text(reading.label.uppercased())
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(primary ? accent : PrototypeStyle.muted)
                            if reading.slot == "gospel" {
                                Text("· EVANGELHO")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(accent)
                            }
                        }
                        Text(reading.reference)
                            .font(PrototypeStyle.serif(16, weight: .semibold))
                            .foregroundStyle(PrototypeStyle.ink)
                            .multilineTextAlignment(.leading)
                        if let alternatives = reading.alternatives, !alternatives.isEmpty {
                            Text("ou " + alternatives.joined(separator: " · "))
                                .font(.system(size: 12))
                                .foregroundStyle(PrototypeStyle.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Button {
                    chooseReading(reading)
                } label: {
                    Image(systemName: primary ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 17, weight: .regular))
                        .foregroundStyle(primary ? accent : PrototypeStyle.muted.opacity(0.45))
                        .frame(width: 27, height: 27)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight(cornerRadius: 13))
                .help(primary ? "Texto principal do sermão" : "Usar como texto principal")
                .accessibilityLabel(primary ? "Desmarcar texto principal" : "Usar \(reading.label) como texto principal")
            }

            if primary {
                SectionLabel("Texto principal do sermão", color: accent)
            }

            if expanded {
                if let verses = text?.verses, !verses.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(verses) { verse in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(verse.number)")
                                    .font(.system(size: 10, weight: .bold).monospacedDigit())
                                    .foregroundStyle(accent.opacity(0.85))
                                    .frame(width: 18, alignment: .trailing)
                                Text(verse.text)
                                    .font(PrototypeStyle.serif(14))
                                    .foregroundStyle(PrototypeStyle.ink.opacity(0.90))
                                    .lineSpacing(4)
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.top, 2)
                } else if let content = text?.content {
                    Text(content)
                        .font(PrototypeStyle.serif(14))
                        .foregroundStyle(PrototypeStyle.ink.opacity(0.9))
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else if selectedBible != primaryBible && isLoadingTranslation {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small).tint(accent)
                        Text("Buscando em \(selectedBible.uppercased())…")
                            .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.vertical, 8)
                } else {
                    Text("O texto desta leitura não está disponível nesta tradução.")
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.muted)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(primary ? accent.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 9))
        .overlay(alignment: .bottom) {
            if !primary { Rectangle().fill(PrototypeStyle.line).frame(height: 1).padding(.horizontal, 10) }
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        SectionLabel(title)
    }
}

struct ResourceContextPanel: View {
    @MainActor private static let automaticFavoriteSiteSearchGate = FavoriteSiteSearchAutoGate()

    @EnvironmentObject private var readerSession: ReaderSessionStore
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var googleDrive: GoogleDriveStore
    @Environment(\.openWindow) private var openWindow
    @AppStorage("pregar.library.records.v1") private var savedPDFRecords = Data()
    @AppStorage("pregar.material-research.reports.v1") private var savedResearchReports = Data()
    @AppStorage("pregar.favorite-site-search.reports.v3") private var savedFavoriteSiteReports = Data()
    @AppStorage(FavoriteReferenceLibrary.sitesKey) private var savedFavoriteSites = Data()
    @AppStorage(FavoriteReferenceLibrary.authorsKey) private var savedFavoriteAuthors = Data()
    @Binding var selectedTab: ContextPaneTab
    let reference: String
    let occasion: String?
    let liturgicalDate: Date
    let isSunday: Bool
    @Binding var reviewReports: [SermonReviewReport]
    let manuscript: String
    let accent: Color
    let openSettings: () -> Void
    let openDriveConnection: () -> Void
    let openLibrary: () -> Void
    let newReview: () -> Void
    let checkStructure: () -> Void
    let selectQuote: (String) -> Void
    let insertText: (String) -> Void
    let emergencyQuestions: () -> Void
    let collapse: () -> Void
    @State private var filter: MaterialFilter = .all
    @State private var pdfRecords: [PDFLibraryRecord] = []
    @State private var pdfRecordsRevision = 0
    @State private var matchedPDFs: [PDFSectionMatchKind: [MatchedPDF]] = [:]
    @State private var isMatchingPDFs = false
    @State private var researchReports: [String: AIResearchReport] = [:]
    @State private var researchInProgressReference: String?
    @State private var researchErrorReference: String?
    @State private var researchError: String?
    @State private var favoriteSiteReports: [String: FavoriteSiteSearchReport] = [:]
    @State private var favoriteSiteSearchInProgressReference: String?
    @State private var favoriteSiteSearchActiveReferences: Set<String> = []
    @State private var favoriteSiteLoadingClearTask: Task<Void, Never>?
    @State private var isPreparingIdeas = false
    @State private var ideasError: String?
    @State private var openingPDFPath: String?
    @State private var showingClosedFindings = false

    private enum MaterialFilter: String, CaseIterable {
        case all = "Tudo"
        case library = "Biblioteca"
        case sites = "Sites"
    }

    private struct MatchedPDF: Identifiable, Sendable {
        let record: PDFLibraryRecord
        let section: PDFSectionLocation
        let kind: PDFSectionMatchKind
        var id: String { "\(record.id)|\(section.id)" }
    }

    private var favoriteSiteSearchKey: String {
        FavoriteSiteSearchReport.cacheKey(
            reference: reference,
            occasion: occasion,
            date: liturgicalDate,
            isSunday: isSunday,
            sites: favoriteSites,
            authors: favoriteAuthors
        )
    }

    private var favoriteSites: [FavoriteSite] { FavoriteReferenceLibrary.sites(from: savedFavoriteSites) }
    private var favoriteAuthors: [FavoriteAuthor] { FavoriteReferenceLibrary.authors(from: savedFavoriteAuthors) }
    private var favoriteSiteArticles: [FavoriteSiteArticle] {
        favoriteSiteReports[favoriteSiteSearchKey]?.groups.flatMap(\.articles) ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                ForEach(ContextPaneTab.allCases) { tab in
                    Button {
                        selectedTab = tab
                    } label: {
                        HStack(alignment: .center, spacing: 5) {
                            Text(tab.rawValue)
                                .font(.system(size: 12, weight: selectedTab == tab ? .semibold : .medium))
                            if tab == .ideas { badge("\(ideaNotes.count)", color: Color(red: 0.78, green: 0.65, blue: 0.29)) }
                            if tab == .review { badge("\(reviewReports.last?.openFindings.count ?? 0)", color: accent) }
                        }
                        .foregroundStyle(selectedTab == tab ? PrototypeStyle.ink : PrototypeStyle.ink.opacity(0.75))
                        .frame(maxWidth: .infinity, minHeight: 30, maxHeight: 30, alignment: .center)
                        .contentShape(Rectangle())
                        .background(selectedTab == tab ? PrototypeStyle.surface : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .shadow(color: selectedTab == tab ? .black.opacity(0.10) : .clear, radius: 2, y: 1)
                    }
                    .buttonStyle(.hoverHighlight)
                    .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                }
                Button {
                    collapse()
                } label: {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 13, weight: .regular))
                        .frame(width: 32, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.hoverHighlight)
                .foregroundStyle(PrototypeStyle.muted)
                .keyboardShortcut("3", modifiers: [.command, .option])
                .help("Ocultar painel de materiais (⌥⌘3)")
                .accessibilityLabel("Ocultar painel de materiais")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
            .background(PrototypeStyle.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))

            Divider().overlay(PrototypeStyle.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 13) {
                    switch selectedTab {
                    case .materials: materialsContent
                    case .ideas: ideasContent
                    case .review: reviewContent
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            }
        }
        .background(PrototypeStyle.paper)
        .onAppear {
            restorePDFRecords()
            restoreResearchReports()
            restoreFavoriteSiteReports()
        }
        .onChange(of: savedPDFRecords) { _, _ in restorePDFRecords() }
        .onChange(of: savedResearchReports) { _, _ in restoreResearchReports() }
        .onChange(of: savedFavoriteSiteReports) { _, _ in restoreFavoriteSiteReports() }
        .onChange(of: selectedTab) { _, tab in
            if tab == .ideas {
                Task { await refreshIdeasIfLinked() }
            } else if tab == .materials, filter != .library {
                Task { await searchFavoriteSitesIfStale(reference: reference, cacheKey: favoriteSiteSearchKey) }
            }
        }
        .onChange(of: filter) { _, newFilter in
            guard selectedTab == .materials, newFilter != .library else { return }
            Task { await searchFavoriteSitesIfStale(reference: reference, cacheKey: favoriteSiteSearchKey) }
        }
        .onChange(of: googleDrive.isConnected) { _, connected in
            if connected && selectedTab == .ideas { Task { await refreshIdeasIfLinked() } }
        }
        .onChange(of: googleDrive.ideasDocumentID) { _, id in
            if id != nil && selectedTab == .ideas { Task { await refreshIdeasIfLinked() } }
        }
        .task(id: "\(reference)|\(pdfRecordsRevision)|\(selectedTab == .materials)|\(filter != .sites)") {
            matchedPDFs = [:]
            isMatchingPDFs = false
            guard selectedTab == .materials, filter != .sites,
                  let target = ScriptureReference.parse(reference) else { return }

            isMatchingPDFs = true
            let records = pdfRecords
            let worker = Task.detached(priority: .utility) { () -> [PDFSectionMatchKind: [MatchedPDF]] in
                var groups: [PDFSectionMatchKind: [MatchedPDF]] = [:]
                for record in records {
                    for section in record.sections ?? [] {
                        guard !Task.isCancelled else { return [:] }
                        guard let kind = PDFLibraryIndexer.match(section, target: target) else { continue }
                        groups[kind, default: []].append(MatchedPDF(record: record, section: section, kind: kind))
                    }
                }
                for kind in Array(groups.keys) {
                    groups[kind]?.sort {
                        $0.record.displayTitle.localizedStandardCompare($1.record.displayTitle) == .orderedAscending
                    }
                }
                return groups
            }
            let results = await withTaskCancellationHandler {
                await worker.value
            } onCancel: {
                worker.cancel()
            }
            guard !Task.isCancelled else { return }
            matchedPDFs = results
            isMatchingPDFs = false
        }
        .task(id: favoriteSiteSearchKey) {
            guard selectedTab == .materials, filter != .library,
                  ScriptureReference.parse(reference) != nil else { return }
            do {
                try await Task.sleep(nanoseconds: 650_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            await searchFavoriteSitesIfStale(reference: reference, cacheKey: favoriteSiteSearchKey)
        }
    }

    private var materialsContent: some View {
        let exactPDFs = matchedPDFs[.exact] ?? []
        let partialPDFs = matchedPDFs[.partial] ?? []
        let contextPDFs = matchedPDFs[.context] ?? []
        let exactSites = favoriteSiteArticles.filter { $0.match == .same || $0.match == .contains }
        let partialSites = favoriteSiteArticles.filter { $0.match == .partial }
        let contextSites = favoriteSiteArticles.filter { $0.match == .context }
        let showsPDFs = filter != .sites
        let showsSites = filter != .library
        let exactCount = (showsPDFs ? exactPDFs.count : 0) + (showsSites ? exactSites.count : 0)
        let partialCount = (showsPDFs ? partialPDFs.count : 0) + (showsSites ? partialSites.count : 0)
        let contextCount = (showsPDFs ? contextPDFs.count : 0) + (showsSites ? contextSites.count : 0)
        let isSearchingSites = showsSites && favoriteSiteSearchInProgressReference == favoriteSiteSearchKey
        let isBusy = (showsPDFs && isMatchingPDFs) || isSearchingSites
        let hasAnyMatch = exactCount + partialCount + contextCount > 0

        return VStack(alignment: .leading, spacing: PrototypeStyle.Spacing.md) {
            HStack(alignment: .firstTextBaseline) {
                Text(reference.isEmpty ? "Materiais" : "Materiais para \(reference)")
                    .font(PrototypeStyle.serif(15, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if showsSites {
                    Button {
                        Task { await refreshFavoriteSites(reference: reference, cacheKey: favoriteSiteSearchKey) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .medium))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.hoverHighlight)
                    .foregroundStyle(PrototypeStyle.muted)
                    .help("Consultar as fontes favoritas de novo")
                    .accessibilityLabel("Atualizar fontes favoritas")
                    .disabled(reference.isEmpty || !favoriteSiteSearchActiveReferences.isEmpty)
                }
            }

            HStack(spacing: 6) {
                ForEach(MaterialFilter.allCases, id: \.self) { option in
                    Button {
                        filter = option
                    } label: {
                        Text(option.rawValue)
                            .font(.system(size: 11, weight: filter == option ? .semibold : .medium))
                            .foregroundStyle(filter == option ? PrototypeStyle.canvas : PrototypeStyle.ink.opacity(0.78))
                            .padding(.horizontal, 11)
                            .frame(height: PrototypeStyle.Layout.compactControlHeight)
                            .background(filter == option ? PrototypeStyle.ink : PrototypeStyle.ink.opacity(0.06), in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.hoverHighlight(cornerRadius: 12))
                    .help(filterHelp(option))
                    .accessibilityAddTraits(filter == option ? .isSelected : [])
                }
            }

            if reference.isEmpty {
                Text("Escolha o texto principal nas leituras para reunir comentários e artigos desta passagem.")
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else if isBusy {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.small)
                    Text(isSearchingSites ? "Consultando as fontes favoritas…" : "Comparando referências nos PDFs…")
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.muted)
                }
            }

            if exactCount > 0 {
                groupHeading("Sobre esta passagem", color: accent, count: exactCount)
                if showsPDFs { ForEach(exactPDFs) { pdfMatchRow($0) } }
                if showsSites { ForEach(exactSites) { favoriteArticleRow($0) } }
            }
            if partialCount > 0 {
                groupHeading("Sobreposição parcial", color: PrototypeStyle.warning, count: partialCount)
                if showsPDFs { ForEach(partialPDFs) { pdfMatchRow($0) } }
                if showsSites { ForEach(partialSites) { favoriteArticleRow($0) } }
            }
            if contextCount > 0 {
                groupHeading("A confirmar", color: PrototypeStyle.muted, count: contextCount)
                if showsPDFs { ForEach(contextPDFs) { pdfMatchRow($0) } }
                if showsSites { ForEach(contextSites) { favoriteArticleRow($0) } }
            }
            if !reference.isEmpty && !hasAnyMatch && !isBusy {
                Text(materialsEmptyMessage(showsPDFs: showsPDFs, showsSites: showsSites))
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if showsSites {
                favoriteSourcesContent
                researchContent
            }

            HStack(spacing: PrototypeStyle.Spacing.sm) {
                if showsPDFs {
                    Button("Biblioteca de PDFs", systemImage: "book.closed", action: openLibrary)
                        .buttonStyle(.secondaryAction(compact: true))
                        .help("Importar e indexar comentários em PDF (⌘3)")
                }
                if showsSites {
                    Button {
                        searchForMaterials()
                    } label: {
                        Label(
                            researchReports[reference] == nil ? "Buscar outros materiais" : "Atualizar pesquisa",
                            systemImage: "sparkle.magnifyingglass"
                        )
                    }
                    .buttonStyle(.secondaryAction(compact: true))
                    .disabled(reference.isEmpty || researchInProgressReference != nil)
                    .help("Usa o provedor de pesquisa escolhido. Envia somente passagem e ocasião; o manuscrito não é enviado. O provedor pode cobrar a busca.")
                }
            }
            .padding(.top, PrototypeStyle.Spacing.xs)
        }
    }

    private func materialsEmptyMessage(showsPDFs: Bool, showsSites: Bool) -> String {
        var parts: [String] = []
        if showsPDFs {
            parts.append(pdfRecords.isEmpty
                ? "Nenhum PDF importado ainda."
                : "Nenhum PDF indexado trata desta passagem.")
        }
        if showsSites {
            parts.append(favoriteSites.isEmpty
                ? "Nenhuma fonte favorita cadastrada."
                : "Nenhum artigo das fontes favoritas corresponde a esta passagem.")
        }
        return parts.joined(separator: " ")
    }

    private func groupHeading(_ title: String, color: Color, count: Int) -> some View {
        HStack(spacing: 7) {
            SectionLabel(title, color: color)
            Text("\(count)")
                .font(.system(size: 10, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(PrototypeStyle.muted)
            Rectangle().fill(PrototypeStyle.line).frame(height: 1)
        }
        .padding(.top, PrototypeStyle.Spacing.xs)
    }

    private var favoriteSourcesContent: some View {
        let groups = favoriteSiteReports[favoriteSiteSearchKey]?.groups ?? []
        let unmatchedGroups = groups.filter { $0.articles.isEmpty }
        return VStack(alignment: .leading, spacing: 8) {
            if !unmatchedGroups.isEmpty {
                groupHeading("Fontes para consultar", color: PrototypeStyle.muted, count: unmatchedGroups.count)
                ForEach(unmatchedGroups) { group in
                    favoriteSourceRow(group.site, group: group)
                }
            }
            if favoriteSites.isEmpty && !reference.isEmpty && favoriteSiteSearchInProgressReference != favoriteSiteSearchKey {
                Button("Adicionar fontes favoritas", systemImage: "globe", action: openSettings)
                    .buttonStyle(.linkAction(accent, compact: true))
                    .help("Abre as Preferências na seção Fontes")
            }
        }
    }

    @ViewBuilder
    private func favoriteSourceRow(_ site: FavoriteSite, group: FavoriteSiteSearchGroup?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "globe")
                    .font(.system(size: 12))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: 15)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    let destinationContext = site.usesAnglicanCompassDestination
                        ? FavoriteSourceURLs.anglicanCompassDetail(occasion: occasion, date: liturgicalDate, isSunday: isSunday)
                        : nil
                    let contextDetails = [destinationContext, site.editorialContext]
                        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .filter { !$0.isEmpty }
                    Text(site.title)
                        .font(PrototypeStyle.serif(13, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(contextDetails.joined(separator: " · "))
                        .font(.system(size: 10))
                        .foregroundStyle(PrototypeStyle.muted)
                }
                Spacer(minLength: 2)
                Button {
                    openFavoriteSite(site, url: group?.searchURL ?? site.searchURL(
                        reference: reference,
                        occasion: occasion,
                        date: liturgicalDate,
                        isSunday: isSunday
                    ))
                } label: {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 11))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.plain)
                .foregroundStyle(accent)
                .help("Buscar no site")
            }

            if site.adapter == .workingPreacherArchive {
                Text("Arquivo da perícope. Confira o intervalo bíblico em cada resultado.")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else if site.adapter == .websiteSearch {
                Text("Abra o site para buscar esta passagem.")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
            } else if let group {
                if let error = group.errorMessage {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(PrototypeStyle.muted)
                } else if group.articles.isEmpty {
                    Text("Nenhuma correspondência explícita nesta busca.")
                        .font(.system(size: 10))
                        .foregroundStyle(PrototypeStyle.muted)
                } else {
                    ForEach(group.articles) { article in
                        favoriteArticleRow(article)
                    }
                }
            }
        }
        .materialCard()
    }

    private func favoriteArticleRow(_ article: FavoriteSiteArticle) -> some View {
        let existingTab = readerTab(kind: .web, location: article.url.absoluteString)
        let reviewTab = currentContextTab(existingTab)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "globe")
                    .font(.system(size: 12))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: 15)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(article.title)
                        .font(PrototypeStyle.serif(14, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    let source = [article.author, article.site.title]
                        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .filter { !$0.isEmpty }
                    if !source.isEmpty {
                        Text(source.joined(separator: " · "))
                            .font(.system(size: 11))
                            .foregroundStyle(PrototypeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    let details = [
                        article.site.editorialContext,
                        article.publishedAt?.formatted(date: .numeric, time: .omitted),
                        article.passageReference.map { passage in
                            guard article.match == .partial,
                                  let overlap = article.overlapReference else { return passage }
                            return "Trecho comum: \(overlap) · material: \(passage)"
                        }
                    ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .filter { !$0.isEmpty }
                    if !details.isEmpty {
                        Text(details.joined(separator: " · "))
                            .font(.system(size: 10))
                            .foregroundStyle(PrototypeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(article.match.label)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(article.match == .same || article.match == .contains ? accent : Color(red: 0.62, green: 0.43, blue: 0.04))
                }
            }
            HStack(spacing: 8) {
                materialActionButton(title: readerActionTitle(for: existingTab, unopened: "Abrir"), isOpen: existingTab != nil) {
                    openFavoriteSite(article.site, url: article.url, title: article.title)
                }
                if let reviewTab { reviewInclusionToggle(for: reviewTab) }
                Spacer(minLength: 0)
            }
            .padding(.leading, 23)
        }
        .materialCard()
    }

    private func readerTab(kind: ReaderTab.Kind, location: String) -> ReaderTab? {
        let normalizedLocation = kind == .pdf
            ? URL(fileURLWithPath: location).standardizedFileURL.path
            : location
        return readerSession.tabs.first { tab in
            guard tab.kind == kind else { return false }
            let candidate = kind == .pdf
                ? URL(fileURLWithPath: tab.location).standardizedFileURL.path
                : tab.location
            return candidate == normalizedLocation
        }
    }

    private func currentContextTab(_ tab: ReaderTab?) -> ReaderTab? {
        guard let tab,
              tab.reference == reference,
              tab.sermonDateKey == SermonDateKey.string(from: liturgicalDate) else { return nil }
        return tab
    }

    private func readerActionTitle(for tab: ReaderTab?, unopened: String) -> String {
        guard let tab else { return unopened }
        return readerSession.selectedTab?.id == tab.id ? "Aberto no leitor" : "Ir para a aba"
    }

    private func materialActionButton(title: String, isOpen: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: isOpen ? "checkmark" : "arrow.up.forward")
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: PrototypeStyle.Layout.compactControlHeight)
                .background(isOpen ? PrototypeStyle.softAccent(accent) : PrototypeStyle.surface, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous).stroke(isOpen ? .clear : PrototypeStyle.line, lineWidth: 1))
                .foregroundStyle(isOpen ? accent : PrototypeStyle.ink)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: PrototypeStyle.Radius.control))
        .help(isOpen ? "Este material já está aberto no Leitor" : "Abrir no Leitor, na página ou endereço indicado")
    }

    private func filterHelp(_ option: MaterialFilter) -> String {
        switch option {
        case .all: "PDFs da Biblioteca e artigos das fontes favoritas"
        case .library: "Somente seções dos PDFs indexados"
        case .sites: "Somente artigos das fontes favoritas e outras pesquisas"
        }
    }

    private func reviewInclusionToggle(for tab: ReaderTab) -> some View {
        Toggle(isOn: Binding(
            get: { readerSession.tabs.first(where: { $0.id == tab.id })?.isIncludedForReview ?? false },
            set: { readerSession.setReviewInclusion($0, for: tab.id) }
        )) {
            Text("na revisão")
                .font(.system(size: 10))
                .foregroundStyle(PrototypeStyle.muted)
        }
        .toggleStyle(.checkbox)
        .controlSize(.small)
        .fixedSize()
    }

    private func openFavoriteSite(_ site: FavoriteSite, url: URL, title: String? = nil) {
        _ = readerSession.openWeb(
            title: title ?? site.title,
            url: url,
            reference: reference,
            sermonDateKey: SermonDateKey.string(from: liturgicalDate)
        )
        openWindow(id: "reader")
    }

    @MainActor
    private func searchFavoriteSitesIfStale(reference: String, cacheKey: String) async {
        let cachedReport = favoriteSiteReports[cacheKey]
        if let cachedReport, Date.now.timeIntervalSince(cachedReport.searchedAt) < 24 * 60 * 60 { return }
        guard ScriptureReference.parse(reference) != nil,
              !favoriteSiteSearchActiveReferences.contains(cacheKey),
              Self.automaticFavoriteSiteSearchGate.begin(cacheKey: cacheKey) else { return }
        defer {
            Self.automaticFavoriteSiteSearchGate.finish(cacheKey: cacheKey, wasCancelled: Task.isCancelled)
        }
        await refreshFavoriteSites(reference: reference, cacheKey: cacheKey, showsLoading: cachedReport == nil)
    }

    @MainActor
    private func refreshFavoriteSites(reference: String, cacheKey: String, showsLoading: Bool = true) async {
        guard !favoriteSiteSearchActiveReferences.contains(cacheKey),
              !reference.isEmpty,
              ScriptureReference.parse(reference) != nil else { return }
        favoriteSiteSearchActiveReferences.insert(cacheKey)
        if showsLoading {
            favoriteSiteLoadingClearTask?.cancel()
            favoriteSiteSearchInProgressReference = cacheKey
        }
        defer {
            favoriteSiteSearchActiveReferences.remove(cacheKey)
            scheduleFavoriteSiteLoadingClear()
        }
        let report = await FavoriteSiteSearchClient().search(
            reference: reference,
            occasion: occasion,
            date: liturgicalDate,
            isSunday: isSunday,
            sites: favoriteSites,
            authors: favoriteAuthors
        )
        guard !Task.isCancelled, favoriteSiteSearchKey == cacheKey else { return }
        favoriteSiteReports[cacheKey] = report
        persistFavoriteSiteReports()
    }

    @MainActor
    private func scheduleFavoriteSiteLoadingClear() {
        guard favoriteSiteSearchActiveReferences.isEmpty,
              let visibleReference = favoriteSiteSearchInProgressReference else { return }
        favoriteSiteLoadingClearTask?.cancel()
        favoriteSiteLoadingClearTask = Task {
            do {
                try await Task.sleep(nanoseconds: 500_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled,
                  favoriteSiteSearchActiveReferences.isEmpty,
                  favoriteSiteSearchInProgressReference == visibleReference else { return }
            favoriteSiteSearchInProgressReference = nil
            favoriteSiteLoadingClearTask = nil
        }
    }

    private func restoreFavoriteSiteReports() {
        guard let decoded = try? JSONDecoder().decode([FavoriteSiteSearchReport].self, from: savedFavoriteSiteReports) else {
            favoriteSiteReports = [:]
            return
        }
        favoriteSiteReports = Dictionary(decoded.map { ($0.cacheKey, $0) }, uniquingKeysWith: { earlier, later in
            earlier.searchedAt > later.searchedAt ? earlier : later
        })
    }

    private func persistFavoriteSiteReports() {
        let reports = favoriteSiteReports.values.sorted { $0.searchedAt > $1.searchedAt }.prefix(100)
        savedFavoriteSiteReports = (try? JSONEncoder().encode(Array(reports))) ?? Data()
    }

    private var researchContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let report = researchReports[reference] {
                groupHeading("Outros materiais", color: accent, count: report.sources.count)
                Text("\(report.provider.name) · \(report.createdAt.formatted(date: .numeric, time: .shortened)) · metadados da busca; confirme na página")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(report.sources) { source in
                    let existingTab = readerTab(kind: .web, location: source.url.absoluteString)
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "globe")
                                .font(.system(size: 12))
                                .foregroundStyle(PrototypeStyle.muted)
                                .frame(width: 15)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(source.title)
                                    .font(PrototypeStyle.serif(14, weight: .semibold))
                                    .foregroundStyle(PrototypeStyle.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(source.editorialContext)
                                    .font(.system(size: 10))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text([source.domain, source.publishedDate].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 10))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        HStack(spacing: 8) {
                            materialActionButton(title: readerActionTitle(for: existingTab, unopened: "Abrir"), isOpen: existingTab != nil) {
                                openResearchSource(source)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.leading, 23)
                    }
                    .materialCard()
                }
            }

            if researchInProgressReference == reference {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.small)
                    Text("Pesquisando outras fontes…")
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.muted)
                }
            }
            if researchErrorReference == reference, let researchError {
                Text(researchError)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.warning)
                    .fixedSize(horizontal: false, vertical: true)
                if researchError.localizedCaseInsensitiveContains("chave") {
                    Button("Configurar IA", systemImage: "key", action: openSettings)
                        .buttonStyle(.linkAction(accent, compact: true))
                }
            }
        }
    }

    private func searchForMaterials() {
        let searchReference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !searchReference.isEmpty, researchInProgressReference == nil else { return }
        let provider = aiSettings.researchProvider
        let model = aiSettings.researchModel
        researchInProgressReference = searchReference
        researchErrorReference = nil
        researchError = nil

        Task {
            guard let key = await aiSettings.key(for: provider), !key.isEmpty else {
                researchErrorReference = searchReference
                researchError = AIResearchError.noKey.localizedDescription
                researchInProgressReference = nil
                return
            }
            do {
                let sources = try await AIResearchClient().search(
                    reference: searchReference,
                    occasion: occasion,
                    configuration: AIResearchConfiguration(
                        provider: provider,
                        model: model,
                        apiKey: key,
                        priorityAuthors: favoriteAuthors.map(\.name)
                    )
                )
                let report = AIResearchReport(
                    reference: searchReference,
                    provider: provider,
                    model: model,
                    createdAt: .now,
                    sources: sources
                )
                researchReports[searchReference] = report
                persistResearchReports()
            } catch {
                researchErrorReference = searchReference
                researchError = error.localizedDescription
            }
            researchInProgressReference = nil
        }
    }

    private func openResearchSource(_ source: AIResearchSource) {
        _ = readerSession.openWeb(
            title: source.title,
            url: source.url,
            reference: reference,
            sermonDateKey: SermonDateKey.string(from: liturgicalDate)
        )
        openWindow(id: "reader")
    }

    private func restoreResearchReports() {
        guard let decoded = try? JSONDecoder().decode([AIResearchReport].self, from: savedResearchReports) else {
            researchReports = [:]
            return
        }
        researchReports = Dictionary(decoded.map { ($0.reference, $0) }, uniquingKeysWith: { earlier, later in
            earlier.createdAt > later.createdAt ? earlier : later
        })
    }

    private func persistResearchReports() {
        let reports = researchReports.values.sorted { $0.createdAt > $1.createdAt }.prefix(100)
        savedResearchReports = (try? JSONEncoder().encode(Array(reports))) ?? Data()
    }

    private func pdfMatchRow(_ match: MatchedPDF) -> some View {
        let tab = readerTab(kind: .pdf, location: match.record.path)
        let reviewTab = currentContextTab(tab)
        let pageRange = match.section.startPage == match.section.endPage
            ? "física \(match.section.startPage)"
            : "físicas \(match.section.startPage)–\(match.section.endPage)"
        let metadata = ["PDF", pageRange, match.record.displayLanguage]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "doc.text")
                    .font(.system(size: 12))
                    .foregroundStyle(PrototypeStyle.muted)
                    .frame(width: 15)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(match.section.title)
                        .font(PrototypeStyle.serif(14, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text([match.record.displayAuthor, match.record.displayTitle].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(metadata.joined(separator: " · "))
                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                }
            }
            HStack(spacing: 8) {
                materialActionButton(
                    title: openingPDFPath == match.record.path
                        ? "Abrindo PDF…"
                        : readerActionTitle(for: tab, unopened: "Abrir"),
                    isOpen: tab != nil
                ) {
                    openPDFMatch(match)
                }
                .disabled(openingPDFPath != nil)
                if let reviewTab { reviewInclusionToggle(for: reviewTab) }
                Spacer(minLength: 0)
            }
            .padding(.leading, 23)
        }
        .materialCard()
    }

    private func openPDFMatch(_ match: MatchedPDF) {
        guard openingPDFPath == nil else { return }
        openingPDFPath = match.record.path
        Task { @MainActor in
            let opened = await readerSession.openPDF(
                title: match.record.displayTitle,
                path: match.record.path,
                page: match.section.startPage,
                reference: reference,
                sermonDateKey: SermonDateKey.string(from: liturgicalDate),
                indexedSections: match.record.sections
            )
            guard openingPDFPath == match.record.path else { return }
            openingPDFPath = nil
            if opened { openWindow(id: "reader") }
        }
    }

    private func restorePDFRecords() {
        guard let decoded = try? JSONDecoder().decode([PDFLibraryRecord].self, from: savedPDFRecords) else {
            pdfRecords = []
            pdfRecordsRevision += 1
            return
        }
        pdfRecords = decoded.filter { FileManager.default.fileExists(atPath: $0.path) }
        pdfRecordsRevision += 1
    }

    private var ideasContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ideias do iPhone").font(PrototypeStyle.serif(17, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            if googleDrive.isLoading {
                ProgressView("Verificando Google Drive…").font(.system(size: 12)).tint(accent)
            } else if !googleDrive.isConnected {
                Text("Conecte o Google Drive para usar seu documento separado de ideias.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
                Button("Conectar Google Drive", systemImage: "icloud", action: openDriveConnection)
                    .buttonStyle(.primaryAction(accent, compact: true))
            } else if googleDrive.ideasDocumentID == nil {
                Text("Crie um Google Doc independente para continuar anotando pelo iPhone.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: PrototypeStyle.Spacing.sm) {
                    Button("Criar documento de ideias", systemImage: "doc.badge.plus") {
                        Task { await createIdeasDocument() }
                    }
                    .buttonStyle(.primaryAction(accent, compact: true))
                    .disabled(isPreparingIdeas)
                    if isPreparingIdeas { ProgressView().controlSize(.small) }
                }
            } else {
                HStack(spacing: 12) {
                    Button {
                        if let id = googleDrive.ideasDocumentID, let url = googleDrive.documentURL(for: id) {
                            NSWorkspace.shared.open(url)
                        }
                    } label: {
                        Label("Abrir no Google Docs", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.linkAction(accent, compact: true))
                    Button {
                        Task { await refreshIdeasIfLinked() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .medium))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.hoverHighlight).foregroundStyle(PrototypeStyle.muted)
                    .help("Atualizar ideias do Google Drive")
                    .accessibilityLabel("Atualizar ideias")
                    if isPreparingIdeas { ProgressView().controlSize(.small) }
                }
                Text(googleDrive.ideasUpdatedAt.map { "Atualizado \($0.formatted(date: .omitted, time: .shortened))" } ?? "Documento de ideias")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                if ideaNotes.isEmpty {
                    Text("Nenhuma ideia anotada ainda.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                } else {
                    ForEach(Array(ideaNotes.enumerated()), id: \.offset) { item in
                        let note = item.element
                        VStack(alignment: .leading, spacing: 8) {
                            Text(note)
                                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                            HStack {
                                Spacer()
                                Button {
                                    insertText(note)
                                } label: {
                                    Image(systemName: "plus")
                                        .font(.system(size: 11, weight: .medium))
                                        .frame(width: 24, height: 24)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.hoverHighlight).foregroundStyle(accent)
                                .help("Inserir esta ideia no manuscrito")
                            }
                        }
                        .padding(10)
                        .background(PrototypeStyle.surface, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(PrototypeStyle.line.opacity(0.6), lineWidth: 1))
                    }
                }
            }
            if let ideasError {
                Text(ideasError).font(.system(size: 11)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var ideaNotes: [String] {
        googleDrive.ideasText
            .replacingOccurrences(of: "\r\n", with: "\n")
            .components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    @MainActor
    private func refreshIdeasIfLinked() async {
        guard selectedTab == .ideas, googleDrive.isConnected, googleDrive.ideasDocumentID != nil, !isPreparingIdeas else { return }
        isPreparingIdeas = true
        defer { isPreparingIdeas = false }
        do {
            try await googleDrive.refreshIdeas()
            ideasError = nil
        } catch {
            ideasError = error.localizedDescription
        }
    }

    @MainActor
    private func createIdeasDocument() async {
        guard googleDrive.isConnected, !isPreparingIdeas else { return }
        isPreparingIdeas = true
        defer { isPreparingIdeas = false }
        do {
            try await googleDrive.ensureIdeasDocument()
            ideasError = nil
        } catch {
            ideasError = error.localizedDescription
        }
    }

    private var reviewContent: some View {
        VStack(alignment: .leading, spacing: PrototypeStyle.Spacing.md) {
            Text("Revisões do manuscrito")
                .font(PrototypeStyle.serif(17, weight: .semibold))
                .foregroundStyle(PrototypeStyle.ink)
            if let report = reviewReports.last {
                let stale = report.isStale(manuscript: manuscript, mainReference: reference)
                HStack(spacing: 6) {
                    Text("\(report.provider.name) · \(report.createdAt.formatted(date: .numeric, time: .shortened))")
                    if stale { Text("· texto alterado desde então").foregroundStyle(PrototypeStyle.warning) }
                }
                .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                if let validationNotice = report.validationNotice {
                    Label(validationNotice, systemImage: "checkmark.shield")
                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let structure = report.structure {
                    SermonStructureMapView(
                        structure: structure,
                        accent: accent,
                        isStale: stale,
                        compact: true,
                        selectQuote: selectQuote
                    )
                } else {
                    structurePlaceholder
                }
                criteriaSummary(report)
                if report.isEmpty {
                    Text("Nenhuma observação fundamentada nos critérios escolhidos.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                } else {
                    if report.openFindings.isEmpty {
                        Label("Todos os apontamentos foram resolvidos ou descartados.", systemImage: "checkmark.circle")
                            .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                    }
                    ForEach(report.openFindings) { finding in
                        findingRow(finding, in: report)
                    }
                    if !report.closedFindings.isEmpty {
                        closedFindingsSection(report)
                    }
                }
            } else {
                Text("Ainda não há observações para esta versão.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                structurePlaceholder
                criteriaSummary(nil)
            }
            HStack(spacing: PrototypeStyle.Spacing.sm) {
                Button("Nova revisão", systemImage: "checkmark", action: newReview)
                    .buttonStyle(.primaryAction(accent, compact: true))
                    .help("Revisão completa com os critérios que você escolher (⇧⌘R)")
                Button("Checar estrutura", systemImage: "list.bullet.below.rectangle", action: checkStructure)
                    .buttonStyle(.secondaryAction(compact: true))
                    .help("Revisão rápida só de estrutura: partes, ideia dominante, movimentos e Boa Nova")
            }
            .padding(.top, PrototypeStyle.Spacing.xs)
            Button("Perguntas de emergência", systemImage: "questionmark.circle", action: emergencyQuestions)
                .buttonStyle(.linkAction(accent, compact: true))
                .help("Perguntas sobre o que já está escrito; nunca são pedidas automaticamente")
            Text("A revisão aponta e fundamenta. Não escreve, não completa, não sugere frases.")
                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var structurePlaceholder: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet.below.rectangle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(accent)
                Text("Mapa do sermão")
                    .font(PrototypeStyle.serif(14, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
            }
            Text("Toda revisão devolve onde começam introdução, desenvolvimento e conclusão, qual é a ideia dominante, os movimentos do texto e onde a Boa Nova aparece. “Checar estrutura” faz só essa leitura.")
                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .panelCard(padding: PrototypeStyle.Spacing.md)
    }

    private func criteriaSummary(_ report: SermonReviewReport?) -> some View {
        VStack(spacing: 0) {
            ForEach(SermonReviewCriterion.allCases) { criterion in
                let count = report?.openFindings.filter { $0.criterion == criterion }.count ?? 0
                HStack {
                    Text(criterion.title).font(.system(size: 12))
                    Spacer()
                    Text("\(count)")
                        .font(.system(size: 11, design: .rounded).monospacedDigit())
                        .foregroundStyle(count == 0 ? PrototypeStyle.muted : accent)
                }
                .padding(.vertical, 5)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                .help(criterion.guidance)
            }
        }
    }

    private func findingRow(_ finding: SermonReviewFinding, in report: SermonReviewReport) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(finding.criterion.title.uppercased())
                    .font(.system(size: 10, weight: .bold)).foregroundStyle(accent)
                if finding.severity == .attention {
                    Text("verificar").font(.system(size: 10)).foregroundStyle(PrototypeStyle.warning)
                }
                Spacer(minLength: 4)
                findingStatusButton("checkmark", help: "Marcar como resolvido") {
                    setStatus(.resolved, for: finding, in: report)
                }
                findingStatusButton("xmark", help: "Descartar este apontamento") {
                    setStatus(.dismissed, for: finding, in: report)
                }
            }
            if !finding.manuscriptQuote.isEmpty {
                Text("“\(finding.manuscriptQuote)”")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(PrototypeStyle.ink)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
            Text(finding.observation)
                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !finding.correction.isEmpty {
                Text("Grafia: \(finding.correction)")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(accent)
            }
            if !finding.evidenceQuote.isEmpty {
                Text("“\(finding.evidenceQuote)”")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(3).fixedSize(horizontal: false, vertical: true)
                Text([finding.evidenceSourceTitle, finding.evidenceCitation].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
            }
            if !finding.manuscriptQuote.isEmpty {
                Button("Ir ao trecho", systemImage: "text.viewfinder") { selectQuote(finding.manuscriptQuote) }
                    .buttonStyle(.linkAction(accent, compact: true))
                    .help("Selecionar este trecho no manuscrito")
            }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    private func findingStatusButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PrototypeStyle.muted)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: 5))
        .help(help)
        .accessibilityLabel(help)
    }

    private func closedFindingsSection(_ report: SermonReviewReport) -> some View {
        let resolved = report.closedFindings.filter { $0.status == .resolved }.count
        let dismissed = report.closedFindings.count - resolved
        let summary = [
            resolved > 0 ? "\(resolved) resolvido\(resolved == 1 ? "" : "s")" : nil,
            dismissed > 0 ? "\(dismissed) descartado\(dismissed == 1 ? "" : "s")" : nil
        ].compactMap { $0 }.joined(separator: " · ")
        return DisclosureGroup(isExpanded: $showingClosedFindings) {
            ForEach(report.closedFindings) { finding in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: finding.status == .resolved ? "checkmark.circle.fill" : "xmark.circle")
                        .font(.system(size: 11))
                        .foregroundStyle(finding.status == .resolved ? accent : PrototypeStyle.muted)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(finding.observation)
                            .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Reabrir") { setStatus(.open, for: finding, in: report) }
                            .buttonStyle(.linkAction(accent, compact: true))
                    }
                }
                .padding(.vertical, 6)
            }
        } label: {
            Text(summary)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(PrototypeStyle.muted)
        }
    }

    /// Marca um apontamento e regrava o relatório; uma nova revisão não altera estas marcações.
    private func setStatus(_ status: SermonReviewFindingStatus, for finding: SermonReviewFinding, in report: SermonReviewReport) {
        guard let reportIndex = reviewReports.firstIndex(where: { $0.id == report.id }),
              let findingIndex = reviewReports[reportIndex].findings.firstIndex(where: { $0.id == finding.id }) else { return }
        withAnimation(.easeInOut(duration: 0.16)) {
            reviewReports[reportIndex].findings[findingIndex].status = status
        }
        let updated = reviewReports[reportIndex]
        Task { try? await SermonReviewReportStore.shared.update(updated) }
    }

    private func badge(_ value: String, color: Color) -> some View {
        Text(value)
            .font(.system(size: 10, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(.white)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(color, in: Capsule())
    }

    private func sectionHeading(_ title: String, color: Color) -> some View {
        HStack(spacing: 7) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
            Rectangle().fill(PrototypeStyle.line).frame(height: 1)
        }
        .padding(.top, 4)
    }
}

/// Mapa estrutural devolvido pela revisão: as três partes com sua função, a ideia dominante,
/// os movimentos do desenvolvimento, o lugar da Boa Nova e as quatro páginas de Wilson.
/// Cada trecho é um botão que seleciona a passagem correspondente no manuscrito.
struct SermonStructureMapView: View {
    let structure: SermonStructureAssessment
    let accent: Color
    let isStale: Bool
    let compact: Bool
    let selectQuote: (String) -> Void

    private static let fragileColor = Color(red: 0.72, green: 0.22, blue: 0.20)

    private var verdictColor: Color {
        switch structure.verdict {
        case .solid: accent
        case .attention: PrototypeStyle.warning
        case .fragile: Self.fragileColor
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PrototypeStyle.Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Mapa do sermão")
                    .font(PrototypeStyle.serif(compact ? 14 : 16, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Spacer(minLength: 4)
                Text(structure.verdict.title)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(verdictColor, in: Capsule())
                    .accessibilityLabel("Veredito: \(structure.verdict.title)")
            }
            if isStale {
                Label("O texto mudou depois deste mapa.", systemImage: "clock.arrow.circlepath")
                    .font(.system(size: 10)).foregroundStyle(PrototypeStyle.warning)
            }
            if !structure.summary.isEmpty {
                Text(structure.summary)
                    .font(.system(size: compact ? 11 : 12))
                    .foregroundStyle(PrototypeStyle.ink.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 0) {
                ForEach(structure.sections) { section in
                    sectionRow(section)
                }
            }

            anchorBlock(
                title: "Ideia dominante",
                status: structure.centralIdea.status.title,
                isPositive: structure.centralIdea.status == .clear,
                statement: structure.centralIdea.statement,
                quote: structure.centralIdea.quote,
                note: structure.centralIdea.note
            )

            if !structure.movements.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel("Movimentos")
                    ForEach(Array(structure.movements.enumerated()), id: \.offset) { index, movement in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(index + 1).")
                                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                                .foregroundStyle(accent)
                                .frame(width: 18, alignment: .trailing)
                            Text(movement.label)
                                .font(.system(size: 11))
                                .foregroundStyle(PrototypeStyle.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 2)
                            if !movement.startQuote.isEmpty { goToButton(movement.startQuote) }
                        }
                    }
                }
            }

            anchorBlock(
                title: "Boa Nova de Cristo",
                status: structure.gospel.status.title,
                isPositive: structure.gospel.status == .explicit,
                statement: "",
                quote: structure.gospel.quote,
                note: structure.gospel.note
            )

            VStack(alignment: .leading, spacing: 4) {
                SectionLabel("Quatro páginas")
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)], spacing: 4) {
                    ForEach(structure.fourPages) { page in
                        pageChip(page)
                    }
                }
            }
        }
        .panelCard(padding: PrototypeStyle.Spacing.md)
    }

    private func sectionRow(_ section: SermonStructureAssessment.Section) -> some View {
        let symbol: String
        let color: Color
        switch section.assessment {
        case .fulfills:
            symbol = "checkmark.circle.fill"
            color = accent
        case .partial:
            symbol = "exclamationmark.circle.fill"
            color = PrototypeStyle.warning
        case .missing:
            symbol = "xmark.circle"
            color = Self.fragileColor
        }
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .foregroundStyle(color)
                .frame(width: 16)
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(section.kind.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.ink)
                    Text(section.assessment.title)
                        .font(.system(size: 10))
                        .foregroundStyle(color)
                    Spacer(minLength: 2)
                    if !section.startQuote.isEmpty { goToButton(section.startQuote) }
                }
                Text(section.kind.expectation)
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted.opacity(0.85))
                if !section.note.isEmpty {
                    Text(section.note)
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.ink.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 7)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
    }

    private func anchorBlock(
        title: String,
        status: String,
        isPositive: Bool,
        statement: String,
        quote: String,
        note: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                SectionLabel(title)
                Text(status)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(isPositive ? accent : PrototypeStyle.warning)
                Spacer(minLength: 2)
                if !quote.isEmpty { goToButton(quote) }
            }
            if !statement.isEmpty {
                Text(statement)
                    .font(PrototypeStyle.serif(13, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !quote.isEmpty {
                Text("“\(quote)”")
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !note.isEmpty {
                Text(note)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.ink.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 2)
    }

    private func pageChip(_ page: SermonStructureAssessment.Page) -> some View {
        let symbol: String
        let color: Color
        switch page.status {
        case .present:
            symbol = "checkmark.circle.fill"
            color = accent
        case .brief:
            symbol = "circle.lefthalf.filled"
            color = PrototypeStyle.warning
        case .notFound:
            symbol = "circle.dotted"
            color = PrototypeStyle.muted
        }
        return Button {
            if !page.quote.isEmpty { selectQuote(page.quote) }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 10))
                    .foregroundStyle(color)
                Text(page.page.shortTitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(PrototypeStyle.ink.opacity(0.85))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .frame(height: 22)
            .background(PrototypeStyle.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: PrototypeStyle.Radius.control))
        .disabled(page.quote.isEmpty)
        .help(page.quote.isEmpty ? "\(page.page.title): não localizada" : "\(page.page.title): ir ao trecho")
    }

    private func goToButton(_ quote: String) -> some View {
        Button {
            selectQuote(quote)
        } label: {
            Image(systemName: "text.viewfinder")
                .font(.system(size: 11, weight: .medium))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: 5))
        .foregroundStyle(accent)
        .help("Ir ao trecho no manuscrito")
        .accessibilityLabel("Ir ao trecho")
    }
}

private extension View {
    /// Cartão de material (PDF, artigo ou fonte): a mesma superfície para todos os itens do painel.
    func materialCard() -> some View {
        padding(9)
            .background(PrototypeStyle.manuscript.opacity(0.68), in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous).stroke(PrototypeStyle.line, lineWidth: 1))
    }
}

/// Barra flutuante que aparece sobre o texto selecionado no manuscrito, no espírito do Substack.
struct EditorSelectionToolbar: View {
    @ObservedObject var commands: EditorCommands
    let accent: Color

    var body: some View {
        HStack(spacing: 2) {
            toolbarButton("bold", help: "Negrito (⌘B)", isActive: commands.isBoldActive, action: commands.bold)
            toolbarButton("italic", help: "Itálico (⌘I)", isActive: commands.isItalicActive, action: commands.italic)
            Rectangle().fill(PrototypeStyle.line).frame(width: 1, height: 16).padding(.horizontal, 2)
            toolbarButton("textformat.size", help: "Título (⇧⌘1)", isActive: commands.isHeadingActive, action: commands.heading)
            toolbarButton("text.quote", help: "Citação em bloco (⇧⌘.)", isActive: commands.isQuoteActive, action: commands.quotation)
            toolbarButton("list.bullet", help: "Lista (⇧⌘8)", isActive: commands.isListActive, action: commands.bulletedList)
            toolbarButton("text.badge.plus", help: "Nota de rodapé (⌥⌘N)", isActive: false, action: commands.footnote)
        }
        .padding(4)
        .background(PrototypeStyle.surface, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous).stroke(PrototypeStyle.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.14), radius: 10, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Formatação da seleção")
    }

    private func toolbarButton(_ symbol: String, help: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isActive ? accent : PrototypeStyle.ink)
                .frame(width: 26, height: 26)
                .background(isActive ? PrototypeStyle.softAccent(accent) : .clear, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.hoverHighlight(cornerRadius: 5))
        .help(help)
        .accessibilityLabel(help)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
