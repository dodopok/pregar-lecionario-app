import AppKit
import SwiftUI

struct BibleComparisonView: View {
    private enum PassageScope: String {
        case pericope = "Perícope"
        case chapter = "Capítulo"
    }

    let settings: APISettings
    let apiKey: String
    let accent: Color
    @Environment(\.dismiss) private var dismiss
    @State private var reference: String
    @State private var scope: PassageScope = .pericope
    @State private var comparisonBible = "naa"
    @State private var passages: [String: BiblePassageText] = [:]
    @State private var errorMessage: String?
    @State private var isLoading = false

    init(reference: String, settings: APISettings, apiKey: String, accent: Color) {
        self.settings = settings
        self.apiKey = apiKey
        self.accent = accent
        _reference = State(initialValue: reference)
    }

    private var chapterReference: String {
        guard let range = reference.range(of: #"[.:]\d+[a-z]?([–-].*)?$"#, options: .regularExpression) else { return reference }
        return String(reference[..<range.lowerBound])
    }

    private var requestReference: String {
        scope == .chapter ? chapterReference : reference
    }

    private var requestKey: String {
        "\(requestReference)|\(settings.bible)|\(comparisonBible)"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                TextField("Referência bíblica", text: $reference)
                    .font(PrototypeStyle.serif(18, weight: .semibold))
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 13)
                    .frame(width: 300, height: 38)
                    .background(.white, in: RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(PrototypeStyle.line, lineWidth: 1))
                    .onSubmit { Task { await loadPassages() } }

                HStack(spacing: 2) {
                    scopeButton(.pericope)
                    scopeButton(.chapter)
                }
                .padding(3)
                .background(PrototypeStyle.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 9))

                Spacer(minLength: 10)

                translationBadge(settings.bible.uppercased(), active: true)
                Menu {
                    ForEach(["nvi", "naa", "ara"].filter { $0 != settings.bible }, id: \.self) { version in
                        Button(version.uppercased()) { comparisonBible = version }
                    }
                } label: {
                    Text(comparisonBible.uppercased())
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PrototypeStyle.ink)
                        .padding(.horizontal, 15)
                        .frame(height: 38)
                        .background(.white, in: Capsule())
                        .overlay(Capsule().stroke(PrototypeStyle.line, lineWidth: 1))
                }
                .menuStyle(.borderlessButton)

                Button {
                    Task { await loadPassages() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .help("Atualizar passagens")

                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PrototypeStyle.muted)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("Fechar Bíblia")
            }
            .padding(.horizontal, 22)
            .frame(height: 58)
            .background(PrototypeStyle.canvas)

            Divider()

            if let errorMessage {
                ContentUnavailableView {
                    Label("Não foi possível carregar as traduções", systemImage: "book.closed")
                } description: {
                    Text(errorMessage).frame(maxWidth: 430)
                } actions: {
                    Button("Tentar novamente") { Task { await loadPassages() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if isLoading || passages[settings.bible] == nil || passages[comparisonBible] == nil {
                VStack(spacing: 10) {
                    ProgressView().tint(accent)
                    Text(isLoading ? "Consultando a Estêvão API…" : "Aguardando passagens")
                        .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(PrototypeStyle.paper)
            } else {
                HSplitView {
                    passageColumn(passages[settings.bible], version: settings.bible)
                    passageColumn(passages[comparisonBible], version: comparisonBible)
                }
                .background(PrototypeStyle.paper)
            }

            HStack {
                Text("Textos bíblicos fornecidos pela Estêvão API v2.")
                    .font(.system(size: 11))
                    .foregroundStyle(PrototypeStyle.muted)
                Spacer()
                if isLoading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 16)
            .frame(height: 29)
            .background(PrototypeStyle.canvas)
        }
        .frame(width: 1260, height: 840)
        .background(PrototypeStyle.paper)
        .tint(accent)
        .task(id: requestKey) { await loadPassages() }
    }

    private func scopeButton(_ value: PassageScope) -> some View {
        Button {
            scope = value
        } label: {
            Text(value == .pericope ? value.rawValue : "Capítulo \(chapterReference.components(separatedBy: " ").last ?? "")")
                .font(.system(size: 12, weight: scope == value ? .semibold : .regular))
                .foregroundStyle(scope == value ? PrototypeStyle.ink : PrototypeStyle.muted)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .background(scope == value ? .white : .clear, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }

    private func translationBadge(_ title: String, active: Bool) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active ? .white : PrototypeStyle.ink)
            .padding(.horizontal, 17)
            .frame(height: 38)
            .background(active ? accent : .white, in: Capsule())
    }

    private func passageColumn(_ text: BiblePassageText?, version: String) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 17) {
                if let verses = text?.verses, !verses.isEmpty {
                    ForEach(verses) { verse in
                        HStack(alignment: .firstTextBaseline, spacing: 13) {
                            Text("\(verse.number)")
                                .font(.system(size: 12, weight: .semibold, design: .rounded).monospacedDigit())
                                .foregroundStyle(version == settings.bible ? accent : PrototypeStyle.muted)
                                .frame(width: 25, alignment: .trailing)
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
                } else {
                    ContentUnavailableView("Texto indisponível", systemImage: "text.book.closed")
                }
            }
            .padding(.horizontal, 46)
            .padding(.vertical, 34)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(version == settings.bible ? .white : PrototypeStyle.canvas.opacity(0.45))
    }

    @MainActor
    private func loadPassages() async {
        guard !apiKey.isEmpty else {
            errorMessage = "Configure sua chave da Estêvão API nas Preferências."
            return
        }
        guard !requestReference.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Informe uma passagem bíblica."
            return
        }
        isLoading = true
        errorMessage = nil
        do {
            let client = LiturgicalAPIClient(settings: settings, apiKey: apiKey)
            async let primary = client.fetchPassage(reference: requestReference, bible: settings.bible)
            async let comparison = client.fetchPassage(reference: requestReference, bible: comparisonBible)
            let (first, second) = try await (primary, comparison)
            try Task.checkCancellation()
            passages[settings.bible] = first
            passages[comparisonBible] = second
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct ReviewRequestSheet: View {
    let accent: Color
    let configureAI: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = ["Ortografia", "Fidelidade", "Estrutura", "Clareza", "Tom"]
    private let criteria = ["Ortografia", "Fidelidade", "Estrutura", "Clareza", "Tom"]

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Text("Nova revisão").font(PrototypeStyle.serif(22, weight: .semibold)).foregroundStyle(PrototypeStyle.ink)
            Text("Aponta e fundamenta. Não escreve, não completa, não sugere frases.")
                .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted)

            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 8) {
                ForEach(criteria, id: \.self) { criterion in
                    Toggle(criterion, isOn: Binding(
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

            VStack(alignment: .leading, spacing: 6) {
                Text("PARA A REVISÃO").font(.system(size: 10, weight: .bold)).foregroundStyle(PrototypeStyle.muted)
                Text("A passagem principal e os materiais marcados como ‘na revisão’ serão enviados ao provedor escolhido.")
                    .font(.system(size: 12)).foregroundStyle(PrototypeStyle.muted).fixedSize(horizontal: false, vertical: true)
            }
            .padding(13)
            .background(.white, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(PrototypeStyle.line, lineWidth: 1))

            HStack(spacing: 8) {
                Image(systemName: "key.fill").foregroundStyle(accent)
                Text("Nenhum provedor de IA configurado neste Mac.")
                    .font(.system(size: 11)).foregroundStyle(PrototypeStyle.muted)
                Spacer(minLength: 0)
                Button("Configurar") { configureAI() }
                    .font(.system(size: 11, weight: .medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(accent)
            }

            HStack {
                Spacer()
                Button("Cancelar") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Enviar revisão") {}
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    .disabled(true)
                    .help("Configure um provedor BYOK antes de enviar o manuscrito")
            }
        }
        .padding(22)
        .frame(width: 540)
        .background(PrototypeStyle.canvas)
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
