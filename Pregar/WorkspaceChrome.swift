import AppKit
import SwiftUI

enum ContextPaneTab: String, CaseIterable, Identifiable {
    case materials = "Materiais"
    case ideas = "Ideias"
    case review = "Revisão"

    var id: String { rawValue }
}

struct CalendarSidebarView: View {
    @Binding var selectedDate: Date
    @Binding var calendarMonth: Date
    let liturgicalDay: LiturgicalDay?
    let accent: Color
    let openArchive: () -> Void
    let openLibrary: () -> Void

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
                            Color.clear.frame(height: 26)
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
                .frame(height: 26)
                .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
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

            Text(["LOC 2027", liturgicalDay?.season?.name, "Ano litúrgico"].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 11))
                .foregroundStyle(PrototypeStyle.muted.opacity(0.8))
                .lineLimit(1)
                .padding(.horizontal, 6)
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(PrototypeStyle.sidebar)
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
            Image(systemName: symbol).font(.system(size: 11, weight: .medium)).frame(width: 22, height: 22)
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
            .frame(height: 26)
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
                .frame(width: 28, height: 26)
                .background(PrototypeStyle.paper, in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PrototypeStyle.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help(accessibility)
        .accessibilityLabel(accessibility)
    }

    private func sundayRow(_ date: Date) -> some View {
        let selected = calendar.isDate(date, inSameDayAs: selectedDate)
        let name = selected ? liturgicalDay?.celebration?.name ?? liturgicalDay?.sundayName : nil
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
            .frame(height: 26)
            .background(selected ? accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sidebarLink(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12))
                .foregroundStyle(PrototypeStyle.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
                .frame(height: 32)
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
                    Image(systemName: "chevron.left").font(.system(size: 11, weight: .medium))
                        .frame(width: 24, height: 22)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PrototypeStyle.muted)
                .help("Recolher leituras")
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
                        sectionLabel("COLETAS")
                        ForEach(collects) { collect in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(collect.title ?? collect.subtitle ?? "Do dia")
                                    .font(.system(size: 14, weight: .semibold, design: .serif))
                                if let text = collect.text {
                                    Text(text).font(.system(size: 12)).textSelection(.enabled)
                                }
                            }
                            .padding(.vertical, 5)
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
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(verses) { verse in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(verse.number)")
                                    .font(.system(size: 10, weight: .medium, design: .rounded).monospacedDigit())
                                    .foregroundStyle(accent.opacity(0.88))
                                    .frame(width: 17, alignment: .trailing)
                                Text(verse.text)
                                    .font(PrototypeStyle.serif(15.5))
                                    .foregroundStyle(PrototypeStyle.ink.opacity(0.90))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.top, 2)
                } else if let content = text?.content {
                    Text(content)
                        .font(PrototypeStyle.serif(15.5))
                        .foregroundStyle(PrototypeStyle.ink.opacity(0.9))
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
        Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
    }
}

struct ResourceContextPanel: View {
    @EnvironmentObject private var readerSession: ReaderSessionStore
    @Environment(\.openWindow) private var openWindow
    @AppStorage("pregar.library.records.v1") private var savedPDFRecords = Data()
    @Binding var selectedTab: ContextPaneTab
    let reference: String
    let occasion: String?
    let liturgicalDate: Date
    let isSunday: Bool
    let accent: Color
    let openSettings: () -> Void
    let openLibrary: () -> Void
    let newReview: () -> Void
    let emergencyQuestions: () -> Void
    let collapse: () -> Void
    @State private var filter: MaterialFilter = .all
    @State private var pdfRecords: [PDFLibraryRecord] = []
    @State private var pdfRecordsRevision = 0
    @State private var matchedPDFs: [PDFSectionMatchKind: [MatchedPDF]] = [:]
    @State private var isMatchingPDFs = false

    private enum MaterialFilter: String, CaseIterable {
        case all = "Tudo"
        case library = "Biblioteca"
        case sites = "Sites"
    }

    private struct SourceLink: Identifiable {
        let title: String
        let detail: String
        let url: URL
        var id: String { url.absoluteString }
    }

    private struct MatchedPDF: Identifiable, Sendable {
        let record: PDFLibraryRecord
        let section: PDFSectionLocation
        let kind: PDFSectionMatchKind
        var id: String { "\(record.id)|\(section.id)" }
    }

    private var sources: [SourceLink] {
        [
            SourceLink(title: "Working Preacher", detail: "Comentários · Lecionário Comum Revisado", url: FavoriteSourceURLs.workingPreacher(reference: reference)),
            SourceLink(
                title: "Anglican Compass",
                detail: FavoriteSourceURLs.anglicanCompassDetail(occasion: occasion, date: liturgicalDate, isSunday: isSunday),
                url: FavoriteSourceURLs.anglicanCompass(reference: reference, occasion: occasion, date: liturgicalDate, isSunday: isSunday)
            ),
            SourceLink(title: "My Pastoral Ponderings", detail: "Busca por passagem", url: FavoriteSourceURLs.myPastoralPonderings(reference: reference)),
            SourceLink(title: "Ponderings on a Faith Journey", detail: "Bob Cornwall · busca por passagem", url: FavoriteSourceURLs.bobCornwall(reference: reference))
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                ForEach(ContextPaneTab.allCases) { tab in
                    Button {
                        selectedTab = tab
                    } label: {
                        HStack(spacing: 5) {
                            Text(tab.rawValue)
                                .font(.system(size: 12, weight: selectedTab == tab ? .semibold : .medium))
                            if tab == .ideas { badge("0", color: Color(red: 0.78, green: 0.65, blue: 0.29)) }
                            if tab == .review { badge("0", color: accent) }
                        }
                        .foregroundStyle(selectedTab == tab ? PrototypeStyle.ink : PrototypeStyle.ink.opacity(0.75))
                        .frame(maxWidth: .infinity)
                        .frame(height: 31)
                        .background(selectedTab == tab ? .white : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .shadow(color: selectedTab == tab ? .black.opacity(0.10) : .clear, radius: 2, y: 1)
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    collapse()
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .medium))
                        .frame(width: 23, height: 29)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PrototypeStyle.muted)
                .help("Recolher painel")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 3)
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
        .onAppear(perform: restorePDFRecords)
        .onChange(of: savedPDFRecords) { _, _ in restorePDFRecords() }
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
    }

    private var materialsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Sobre \(reference.isEmpty ? "esta passagem" : reference)")
                    .font(PrototypeStyle.serif(15, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                Spacer(minLength: 4)
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

            if filter != .library {
                sectionHeading("FONTES FAVORITAS", color: accent)

                ForEach(sources) { source in
                    Button {
                        _ = readerSession.openWeb(title: source.title, url: source.url, reference: reference)
                        openWindow(id: "reader")
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "globe")
                                .font(.system(size: 13))
                                .foregroundStyle(PrototypeStyle.muted)
                                .frame(width: 16)
                                .padding(.top, 3)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(source.title)
                                    .font(PrototypeStyle.serif(14, weight: .semibold))
                                    .foregroundStyle(PrototypeStyle.ink)
                                    .multilineTextAlignment(.leading)
                                Text(source.detail)
                                    .font(.system(size: 11))
                                    .foregroundStyle(PrototypeStyle.muted)
                                Text("Buscar esta passagem")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(accent)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
                }
            }

            if filter != .sites {
                let exact = matchedPDFs[.exact] ?? []
                let partial = matchedPDFs[.partial] ?? []
                let context = matchedPDFs[.context] ?? []
                if !exact.isEmpty {
                    sectionHeading("SOBRE ESTA PASSAGEM", color: accent)
                    ForEach(exact) { pdfMatchRow($0) }
                }
                if !partial.isEmpty {
                    sectionHeading("SOBREPOSIÇÃO PARCIAL", color: Color(red: 0.62, green: 0.43, blue: 0.04))
                    ForEach(partial) { pdfMatchRow($0) }
                }
                if !context.isEmpty {
                    sectionHeading("A CONFIRMAR", color: PrototypeStyle.muted)
                    ForEach(context) { pdfMatchRow($0) }
                }
                if matchedPDFs.values.allSatisfy(\.isEmpty) {
                    sectionHeading("BIBLIOTECA", color: accent)
                    Text(isMatchingPDFs
                         ? "Comparando referências nos PDFs…"
                         : (pdfRecords.isEmpty ? "Importe PDFs para encontrar comentários desta passagem." : "Nenhum PDF indexado corresponde a esta passagem."))
                        .font(.system(size: 11))
                        .foregroundStyle(PrototypeStyle.muted)
                }
                Button("Abrir biblioteca de PDFs", systemImage: "book.closed", action: openLibrary)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(accent)
                    .buttonStyle(.plain)
            }
        }
    }

    private func pdfMatchRow(_ match: MatchedPDF) -> some View {
        VStack(alignment: .leading, spacing: 5) {
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
                    Text([match.record.displayTitle, match.record.displayAuthor].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("PDF · físicas \(match.section.startPage)–\(match.section.endPage) · \(match.section.context ?? "sumário")")
                        .font(.system(size: 10)).foregroundStyle(PrototypeStyle.muted)
                }
            }
            HStack(spacing: 8) {
                Button("Ir para a aba") {
                    guard readerSession.openPDF(
                        title: match.record.displayTitle,
                        path: match.record.path,
                        page: match.section.startPage,
                        reference: reference,
                        indexedSections: match.record.sections
                    ) else { return }
                    openWindow(id: "reader")
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(accent)
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                Text(match.kind == .exact ? "alta" : match.kind == .partial ? "média" : "confirmar")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(match.kind == .exact ? accent : PrototypeStyle.muted)
            }
            .padding(.leading, 23)
        }
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
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
            Text("O documento separado de ideias do Drive ainda não está conectado.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            Button("Configurar Drive", systemImage: "arrow.up.doc", action: openSettings)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(accent)
                .buttonStyle(.plain)
        }
    }

    private var reviewContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Revisões do manuscrito").font(PrototypeStyle.serif(17, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text("Ainda não há observações para esta versão.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
            ForEach(["Ortografia", "Fidelidade", "Estrutura", "Clareza", "Tom"], id: \.self) { criterion in
                HStack {
                    Text(criterion).font(.system(size: 12))
                    Spacer()
                    Text("0").font(.system(size: 11, design: .rounded).monospacedDigit()).foregroundStyle(PrototypeStyle.muted)
                }
                .padding(.vertical, 5)
                .overlay(alignment: .bottom) { Rectangle().fill(PrototypeStyle.line).frame(height: 1) }
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
