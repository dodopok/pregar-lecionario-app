import AppKit
import SwiftUI

enum ContextPaneTab: String, CaseIterable, Identifiable {
    case materials = "Materiais"
    case ideas = "Ideias"
    case review = "Revisão"

    var id: String { rawValue }
}

struct CalendarSidebarView: View {
    @EnvironmentObject private var apiSettingsStore: APISettingsStore
    @Binding var selectedDate: Date
    @Binding var calendarMonth: Date
    let liturgicalDay: LiturgicalDay?
    let accent: Color
    let openArchive: () -> Void
    let openLibrary: () -> Void
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
                    .background(PrototypeStyle.green, in: RoundedRectangle(cornerRadius: 7))
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
                Button("Hoje") {
                    let today = calendar.startOfDay(for: .now)
                    selectedDate = today
                    calendarMonth = today
                }
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .contentShape(Rectangle())
                .foregroundStyle(PrototypeStyle.ink)
                weekButton("chevron.right", accessibility: "Próxima semana", days: 7)
            }
            .font(.system(size: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text("DOMINGOS")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(PrototypeStyle.muted)
                    .padding(.horizontal, 6)
                ForEach(sundays, id: \.self) { sunday in
                    sundayRow(sunday)
                }
            }
            .padding(.top, 2)

            Spacer(minLength: 0)

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
        .buttonStyle(.plain)
        .foregroundStyle(PrototypeStyle.muted)
        .help(accessibility)
        .accessibilityLabel(accessibility)
    }

    private func calendarDay(_ date: Date) -> some View {
        let selected = calendar.isDate(date, inSameDayAs: selectedDate)
        let isSunday = calendar.component(.weekday, from: date) == 1
        return Button {
            selectedDate = calendar.startOfDay(for: date)
        } label: {
            VStack(spacing: 1) {
                Text(date.formatted(.dateTime.day()))
                    .font(.system(size: 12, weight: selected ? .bold : .regular))
                    .foregroundStyle(selected ? .white : PrototypeStyle.ink.opacity(isSunday ? 1 : 0.82))
                Circle()
                    .fill(isSunday && !selected ? accent : .clear)
                    .frame(width: 3, height: 3)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 30)
            .background(selected ? accent : .clear, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(date.formatted(date: .long, time: .omitted))
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
        .buttonStyle(.plain)
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
                Circle().fill(selected ? accent : accent.opacity(0.75)).frame(width: 7, height: 7)
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
        .buttonStyle(.plain)
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
        .buttonStyle(.plain)
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
    let collapse: () -> Void

    private let translations = [("nvt", "NVT"), ("nvi", "NVI"), ("naa", "NAA"), ("ara", "ARA")]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("LEITURAS")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(PrototypeStyle.muted)
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
                    .padding(.horizontal, 8)
                    .frame(height: 22)
                    .background(.white, in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                Button(action: collapse) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 13, weight: .regular))
                        .frame(width: 32, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(PrototypeStyle.muted)
                .help("Ocultar painel de leituras")
                .accessibilityLabel("Ocultar painel de leituras")
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if let readings = day.readings, !readings.isEmpty {
                        ForEach(readings) { reading in
                            readingRow(reading)
                        }
                    } else {
                        ContentUnavailableView("Sem leituras", systemImage: "text.book.closed")
                    }

                    if let collects = day.collect, !collects.isEmpty {
                        Divider().padding(.vertical, 11)
                        sectionLabel(collects.count == 1 ? "COLETA DO DIA" : "COLETAS DO DIA")
                        ForEach(collects) { collect in
                            VStack(alignment: .leading, spacing: 4) {
                                if collects.count > 1, let title = collect.title ?? collect.subtitle,
                                   !title.localizedCaseInsensitiveContains("do dia") {
                                    Text(title)
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(PrototypeStyle.muted)
                                }
                                if let text = collect.text {
                                    Text(text)
                                        .font(PrototypeStyle.serif(14))
                                        .foregroundStyle(PrototypeStyle.ink.opacity(0.85))
                                        .lineSpacing(4)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .textSelection(.enabled)
                                }
                            }
                            .padding(.top, 8)
                        }
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
                                    .font(.system(size: 9, weight: .bold))
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
                        .frame(width: 25, height: 27)
                }
                .buttonStyle(.plain)
                .help(primary ? "Texto principal do sermão" : "Usar como texto principal")
                .accessibilityLabel(primary ? "Desmarcar texto principal" : "Usar \(reading.label) como texto principal")
            }

            if primary {
                Text("TEXTO PRINCIPAL DO SERMÃO")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(accent)
            }

            if expanded {
                if let verses = text?.verses, !verses.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(verses) { verse in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(verse.number)")
                                    .font(.system(size: 9, weight: .bold).monospacedDigit())
                                    .foregroundStyle(accent.opacity(0.8))
                                    .frame(width: 16, alignment: .trailing)
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
        Text(title)
            .font(.system(size: 10, weight: .bold))
            .tracking(1)
            .foregroundStyle(PrototypeStyle.muted)
    }
}

struct ResourceContextPanel: View {
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
    let reviewReports: [SermonReviewReport]
    let manuscript: String
    let accent: Color
    let openSettings: () -> Void
    let openDriveConnection: () -> Void
    let openLibrary: () -> Void
    let newReview: () -> Void
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
    @State private var isPreparingIdeas = false
    @State private var ideasError: String?
    @State private var openingPDFPath: String?

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
                            if tab == .review { badge("\(reviewReports.last?.findings.count ?? 0)", color: accent) }
                        }
                        .foregroundStyle(selectedTab == tab ? PrototypeStyle.ink : PrototypeStyle.ink.opacity(0.75))
                        .frame(maxWidth: .infinity, minHeight: 30, maxHeight: 30, alignment: .center)
                        .contentShape(Rectangle())
                        .background(selectedTab == tab ? .white : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .shadow(color: selectedTab == tab ? .black.opacity(0.10) : .clear, radius: 2, y: 1)
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    collapse()
                } label: {
                    Image(systemName: "sidebar.right")
                        .font(.system(size: 13, weight: .regular))
                        .frame(width: 32, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(PrototypeStyle.muted)
                .help("Ocultar painel de materiais")
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
            if tab == .ideas { Task { await refreshIdeasIfLinked() } }
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
        .task(id: "\(favoriteSiteSearchKey)|\(selectedTab == .materials)|\(filter != .library)") {
            guard selectedTab == .materials, filter != .library,
                  ScriptureReference.parse(reference) != nil else { return }
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
        let hasPDFMatches = !exactPDFs.isEmpty || !partialPDFs.isEmpty || !contextPDFs.isEmpty
        let hasSiteMatches = !favoriteSiteArticles.isEmpty

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Sobre \(reference.isEmpty ? "esta passagem" : reference)")
                    .font(PrototypeStyle.serif(15, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Spacer(minLength: 4)
                if filter != .library {
                    Button {
                        Task { await refreshFavoriteSites(reference: reference, cacheKey: favoriteSiteSearchKey) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .medium))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PrototypeStyle.muted)
                    .help("Atualizar resultados das fontes favoritas")
                    .disabled(reference.isEmpty || favoriteSiteSearchInProgressReference != nil)
                }
            }

            HStack(spacing: 5) {
                ForEach(MaterialFilter.allCases, id: \.self) { option in
                    Button(option.rawValue) { filter = option }
                        .font(.system(size: 11, weight: filter == option ? .medium : .regular))
                        .foregroundStyle(filter == option ? .white : PrototypeStyle.ink.opacity(0.72))
                        .padding(.horizontal, 10)
                        .frame(height: 22)
                        .background(filter == option ? PrototypeStyle.ink : PrototypeStyle.ink.opacity(0.06), in: Capsule())
                        .buttonStyle(.plain)
                }
            }

            if (!exactPDFs.isEmpty && filter != .sites) || (!exactSites.isEmpty && filter != .library) {
                sectionHeading("SOBRE ESTA PASSAGEM", color: accent)
                if filter != .sites {
                    ForEach(exactPDFs) { pdfMatchRow($0) }
                }
                if filter != .library {
                    ForEach(exactSites) { favoriteArticleRow($0) }
                }
            }
            if (!partialPDFs.isEmpty && filter != .sites) || (!partialSites.isEmpty && filter != .library) {
                sectionHeading("SOBREPOSIÇÃO PARCIAL", color: Color(red: 0.62, green: 0.43, blue: 0.04))
                if filter != .sites {
                    ForEach(partialPDFs) { pdfMatchRow($0) }
                }
                if filter != .library {
                    ForEach(partialSites) { favoriteArticleRow($0) }
                }
            }
            if (!contextPDFs.isEmpty && filter != .sites) || (!contextSites.isEmpty && filter != .library) {
                sectionHeading("A CONFIRMAR", color: PrototypeStyle.muted)
                if filter != .sites {
                    ForEach(contextPDFs) { pdfMatchRow($0) }
                }
                if filter != .library {
                    ForEach(contextSites) { favoriteArticleRow($0) }
                }
            }
            if filter != .sites && !hasPDFMatches && (filter == .library || !hasSiteMatches) {
                sectionHeading("BIBLIOTECA", color: accent)
                Text(isMatchingPDFs
                     ? "Comparando referências nos PDFs…"
                     : (pdfRecords.isEmpty ? "Importe PDFs para encontrar comentários desta passagem." : "Nenhum PDF indexado corresponde a esta passagem."))
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
            }
            if filter != .sites {
                Button("Abrir biblioteca de PDFs", systemImage: "book.closed", action: openLibrary)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(accent)
                    .buttonStyle(.plain)
            }

            if filter != .library {
                favoriteSourcesContent
                researchContent
            }
        }
    }

    private var favoriteSourcesContent: some View {
        VStack(alignment: .leading, spacing: 7) {
            if favoriteSiteSearchInProgressReference == favoriteSiteSearchKey {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.small)
                    Text("Consultando as fontes…")
                        .font(.system(size: 10))
                        .foregroundStyle(PrototypeStyle.muted)
                }
            }

            let groups = favoriteSiteReports[favoriteSiteSearchKey]?.groups ?? []
            let unmatchedGroups = groups.filter { $0.articles.isEmpty }
            if !unmatchedGroups.isEmpty {
                sectionHeading("FONTES PARA CONSULTAR", color: PrototypeStyle.muted)
                ForEach(unmatchedGroups) { group in
                    favoriteSourceRow(group.site, group: group)
                }
            }
            if favoriteSites.isEmpty && favoriteSiteSearchInProgressReference != favoriteSiteSearchKey {
                Text("Adicione fontes favoritas em Preferências · Biblioteca.")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
            } else if groups.isEmpty && favoriteSiteSearchInProgressReference != favoriteSiteSearchKey {
                Text(reference.isEmpty
                    ? "Escolha o texto principal para buscar nas fontes favoritas."
                    : "Nenhuma correspondência explícita nesta busca.")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
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
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
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
        .padding(9)
        .background(PrototypeStyle.manuscript.opacity(0.68), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PrototypeStyle.line, lineWidth: 1))
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
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .lineLimit(1)
                .padding(.horizontal, 9)
                .frame(height: 22)
                .background(isOpen ? accent.opacity(0.12) : .white, in: RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(isOpen ? .clear : PrototypeStyle.line, lineWidth: 1))
                .foregroundStyle(isOpen ? accent : PrototypeStyle.ink)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
        if let report = favoriteSiteReports[cacheKey], Date.now.timeIntervalSince(report.searchedAt) < 24 * 60 * 60 { return }
        await refreshFavoriteSites(reference: reference, cacheKey: cacheKey)
    }

    @MainActor
    private func refreshFavoriteSites(reference: String, cacheKey: String) async {
        guard favoriteSiteSearchInProgressReference != cacheKey,
              !reference.isEmpty,
              ScriptureReference.parse(reference) != nil else { return }
        favoriteSiteSearchInProgressReference = cacheKey
        defer {
            if favoriteSiteSearchInProgressReference == cacheKey { favoriteSiteSearchInProgressReference = nil }
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
            sectionHeading("OUTROS MATERIAIS", color: accent)
            if let report = researchReports[reference] {
                Text("\(report.provider.name) · \(report.sources.count) fontes · \(report.createdAt.formatted(date: .numeric, time: .shortened))")
                    .font(.system(size: 10))
                    .foregroundStyle(PrototypeStyle.muted)
                ForEach(report.sources) { source in
                    Button {
                        openResearchSource(source)
                    } label: {
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: "globe")
                                .font(.system(size: 12))
                                .foregroundStyle(PrototypeStyle.muted)
                                .frame(width: 15)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(source.title)
                                    .font(PrototypeStyle.serif(13, weight: .semibold))
                                    .foregroundStyle(PrototypeStyle.ink)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(source.editorialContext)
                                    .font(.system(size: 10))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .help("Metadados retornados pela busca; confirme na página original.")
                                Text([source.domain, source.publishedDate].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 10))
                                    .foregroundStyle(PrototypeStyle.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text("Abrir no leitor")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(accent)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
            }

            if researchInProgressReference == reference {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.small)
                    Text("Pesquisando fontes…")
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.muted)
                }
            }
            if researchErrorReference == reference, let researchError {
                Text(researchError)
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                if researchError.localizedCaseInsensitiveContains("chave") {
                    Button("Configurar IA", systemImage: "key", action: openSettings)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(accent)
                        .buttonStyle(.plain)
                }
            }

            Button {
                searchForMaterials()
            } label: {
                Label(
                    researchReports[reference] == nil ? "Buscar outros materiais" : "Atualizar pesquisa",
                    systemImage: "sparkle.magnifyingglass"
                )
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(accent)
            }
            .buttonStyle(.plain)
            .disabled(reference.isEmpty || researchInProgressReference != nil)
            .help("Usa o provedor de pesquisa escolhido. Envia somente passagem e ocasião; o manuscrito não é enviado. O provedor pode cobrar a busca.")
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
        .padding(9)
        .background(PrototypeStyle.manuscript.opacity(0.68), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PrototypeStyle.line, lineWidth: 1))
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
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(accent).buttonStyle(.plain)
            } else if googleDrive.ideasDocumentID == nil {
                Text("Crie um Google Doc independente para continuar anotando pelo iPhone.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await createIdeasDocument() }
                } label: {
                    if isPreparingIdeas { ProgressView().controlSize(.small) }
                    else { Label("Criar documento de ideias", systemImage: "doc.badge.plus") }
                }
                .font(.system(size: 12, weight: .medium)).foregroundStyle(accent).buttonStyle(.plain)
                .disabled(isPreparingIdeas)
            } else {
                HStack(spacing: 12) {
                    Button {
                        if let id = googleDrive.ideasDocumentID, let url = googleDrive.documentURL(for: id) {
                            NSWorkspace.shared.open(url)
                        }
                    } label: {
                        Label("Abrir no Google Docs", systemImage: "arrow.up.right.square")
                    }
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(accent).buttonStyle(.plain)
                    Button {
                        Task { await refreshIdeasIfLinked() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain).foregroundStyle(PrototypeStyle.muted)
                    .help("Atualizar ideias do Google Drive")
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
                                .buttonStyle(.plain).foregroundStyle(accent)
                                .help("Inserir esta ideia no manuscrito")
                            }
                        }
                        .padding(10)
                        .background(.white, in: RoundedRectangle(cornerRadius: 6))
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
        VStack(alignment: .leading, spacing: 12) {
            Text("Revisões do manuscrito").font(PrototypeStyle.serif(17, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            if let report = reviewReports.last {
                let stale = report.isStale(manuscript: manuscript, mainReference: reference)
                HStack(spacing: 6) {
                    Text("\(report.provider.name) · \(report.createdAt.formatted(date: .numeric, time: .shortened))")
                    if stale { Text("· texto alterado").foregroundStyle(.orange) }
                }
                .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                if let validationNotice = report.validationNotice {
                    Label(validationNotice, systemImage: "checkmark.shield")
                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(SermonReviewCriterion.allCases) { criterion in
                    HStack {
                        Text(criterion.title).font(.system(size: 12))
                        Spacer()
                        Text("\(report.findings.filter { $0.criterion == criterion }.count)")
                            .font(.system(size: 11, design: .rounded).monospacedDigit()).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.vertical, 5)
                    .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
                if report.isEmpty {
                    Text("Nenhuma observação fundamentada nos critérios escolhidos.")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                } else {
                    ForEach(report.findings) { finding in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(finding.criterion.title.uppercased())
                                .font(.system(size: 10, weight: .bold)).foregroundStyle(accent)
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
                                    .font(.system(size: 9)).foregroundStyle(PrototypeStyle.muted)
                            }
                            if !finding.manuscriptQuote.isEmpty {
                                Button("Ir ao trecho", systemImage: "text.viewfinder") { selectQuote(finding.manuscriptQuote) }
                                    .font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(accent)
                            }
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                    }
                }
            } else {
                Text("Ainda não há observações para esta versão.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                ForEach(SermonReviewCriterion.allCases) { criterion in
                    HStack {
                        Text(criterion.title).font(.system(size: 12))
                        Spacer()
                        Text("0").font(.system(size: 11, design: .rounded).monospacedDigit()).foregroundStyle(PrototypeStyle.muted)
                    }
                    .padding(.vertical, 5)
                    .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
            }
            Text("Perguntas de emergência são uma ação separada e nunca são solicitadas automaticamente.")
                .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            Button("Perguntas de emergência", systemImage: "questionmark.circle", action: emergencyQuestions)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(accent)
                .buttonStyle(.plain)
            Button("Nova revisão", systemImage: "checkmark", action: newReview)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(accent)
                .buttonStyle(.plain)
        }
    }

    private func badge(_ value: String, color: Color) -> some View {
        Text(value)
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(minWidth: 14, minHeight: 14)
            .background(color, in: Circle())
    }

    private func sectionHeading(_ title: String, color: Color) -> some View {
        HStack(spacing: 7) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
            Rectangle().fill(PrototypeStyle.line).frame(height: 1)
        }
        .padding(.top, 4)
    }
}
