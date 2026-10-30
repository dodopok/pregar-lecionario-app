import AppKit
import SwiftData
import SwiftUI

/// Editor local de documentos: comandos fixos, página de leitura e salvamento fora da digitação.
struct ManuscriptEditorView: View {
    @Bindable var draft: SermonDraft
    @ObservedObject var commands: EditorCommands
    let onCommit: () throws -> Void
    let exportPDF: () -> Void
    let showHistory: () -> Void
    let toggleFocus: () -> Void
    @State private var showingLink = false
    @State private var showingShortcuts = false
    @State private var showingToolFinder = false
    @State private var showingSpacing = false
    @State private var linkAddress = ""
    @State private var linkText = ""
    @State private var toolQuery = ""
    @State private var customLineSpacing = 1.15
    @State private var customSpaceBefore: Double = 0
    @State private var customSpaceAfter: Double = 0

    var body: some View {
        VStack(spacing: 0) {
            documentHeader
            menuBar
            DocumentFormattingToolbar(commands: commands, state: DocumentToolbarState(commands))
                .equatable()
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
            if commands.showsRuler {
                DocumentRuler(zoom: commands.zoomPercent)
                    .frame(height: 23)
                    .frame(maxWidth: 816)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 16)
                    .accessibilityLabel("Régua horizontal do documento")
            }
            GeometryReader { geometry in
                RichTextEditor(
                    rtfData: $draft.rtfData,
                    modifiedAt: $draft.modifiedAt,
                    commands: commands,
                    onCommit: onCommit
                )
                .id(draft.persistentModelID)
                .background(PrototypeStyle.documentPaper)
                .overlay(alignment: .topLeading) {
                    if commands.isEmpty {
                        Text("Comece a escrever…")
                            .font(.custom("Arial", size: 14.67))
                            .foregroundStyle(PrototypeStyle.documentMuted.opacity(0.65))
                            .padding(.leading, max(32, min(96, geometry.size.width * 0.12)))
                            .padding(.top, 48)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .overlay(Rectangle().stroke(PrototypeStyle.documentBorder, lineWidth: 1))
                .shadow(color: .black.opacity(0.035), radius: 2, y: 1)
                .frame(maxWidth: 816, maxHeight: .infinity)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .foregroundStyle(PrototypeStyle.documentInk)
        .background(PrototypeStyle.documentCanvas)
        .onAppear {
            commands.linkHandler = { [binding = $showingLink] in binding.wrappedValue = true }
            commands.shortcutsHandler = { [binding = $showingShortcuts] in binding.wrappedValue = true }
            commands.toolFinderHandler = { [binding = $showingToolFinder] in binding.wrappedValue = true }
            commands.spacingHandler = { [binding = $showingSpacing] in binding.wrappedValue = true }
        }
        .onChange(of: showingLink) { _, showing in
            if showing { linkAddress = currentLinkAddress; linkText = commands.linkEditingText }
        }
        .onChange(of: showingSpacing) { _, showing in
            if showing {
                customLineSpacing = commands.selectedLineSpacing
                customSpaceBefore = commands.selectedSpaceBefore
                customSpaceAfter = commands.selectedSpaceAfter
            }
        }
        .sheet(isPresented: $showingLink) { linkSheet }
        .sheet(isPresented: $showingShortcuts) { shortcutsSheet }
        .sheet(isPresented: $showingToolFinder) { toolFinderSheet }
        .sheet(isPresented: $showingSpacing) { spacingSheet }
    }

    private var documentHeader: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text.fill")
                .font(.system(size: 25))
                .foregroundStyle(PrototypeStyle.documentBlue)
                .accessibilityHidden(true)
            TextField("Documento sem título", text: Binding(
                get: { draft.title },
                set: { draft.title = $0; draft.modifiedAt = .now }
            ))
            .textFieldStyle(.plain)
            .font(.system(size: 18))
            .accessibilityLabel("Título do sermão")
            Spacer(minLength: 4)
            saveState
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private var saveState: some View {
        if let error = commands.saveError {
            Button { commands.flushPendingEdits() } label: {
                Label("Tentar salvar", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 11))
            }
            .buttonStyle(.plain)
            .foregroundStyle(PrototypeStyle.warning)
            .help("Não foi possível salvar: \(error)")
        } else {
            Label(commands.hasPendingChanges ? "Salvando…" : "Salvo neste Mac", systemImage: commands.hasPendingChanges ? "arrow.triangle.2.circlepath" : "checkmark.icloud")
                .font(.system(size: 11))
                .foregroundStyle(PrototypeStyle.documentMuted)
                .lineLimit(1)
                .help(commands.hasPendingChanges ? "As alterações estão sendo salvas neste Mac." : "Salvo neste Mac às \(draft.modifiedAt.formatted(date: .omitted, time: .shortened)).")
        }
    }

    private var menuBar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 1) { fileMenu; editMenu; viewMenu; insertMenu; formatMenu; toolsMenu; helpMenu }.fixedSize()
            HStack(spacing: 1) {
                fileMenu; editMenu; insertMenu; formatMenu
                documentMenu("Mais") { viewMenu; toolsMenu; helpMenu }
            }.fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13)
        .padding(.bottom, 8)
    }

    private var fileMenu: some View {
        documentMenu("Arquivo") {
            Button("Salvar agora", action: commands.flushPendingEdits)
            Button("Imprimir…", action: commands.printDocument)
            Divider()
            Button("Exportar para PDF…") { commands.flushPendingEdits(); exportPDF() }
            Button("Histórico de versões") { commands.flushPendingEdits(); showHistory() }
        }
    }

    private var editMenu: some View {
        documentMenu("Editar") {
            Button("Desfazer", action: commands.undo).disabled(!commands.canUndo)
            Button("Refazer", action: commands.redo).disabled(!commands.canRedo)
            Divider()
            Button("Recortar", action: commands.cut)
            Button("Copiar", action: commands.copy)
            Button("Colar", action: commands.paste)
            Button("Colar sem formatação", action: commands.pasteWithoutFormatting)
            Button("Selecionar tudo", action: commands.selectAll)
            Divider()
            Button("Localizar", action: { commands.find() })
            Button("Localizar e substituir", action: { commands.find(replacing: true) })
        }
    }

    private var viewMenu: some View {
        documentMenu("Ver") {
            Menu("Zoom") {
                ForEach([50, 75, 90, 100, 125, 150, 200], id: \.self) { value in
                    Button("\(value)%") { commands.zoomPercent = value }
                }
            }
            Toggle("Mostrar régua", isOn: $commands.showsRuler)
            Button("Modo de escrita", action: toggleFocus)
        }
    }

    private var insertMenu: some View {
        documentMenu("Inserir") {
            Button("Link…") { showingLink = true }
            Button("Nota de rodapé", action: commands.footnote)
            Button("Citação em bloco", action: commands.quotation)
        }
    }

    private var formatMenu: some View {
        documentMenu("Formatar") {
            Menu("Estilos de parágrafo") {
                ForEach(DocumentParagraphStyle.allCases) { style in
                    Button(style.title) { commands.setParagraphStyle(style) }
                }
            }
            Menu("Texto") {
                Button("Negrito", action: commands.bold)
                Button("Itálico", action: commands.italic)
                Button("Sublinhado", action: commands.underline)
                Button("Tachado", action: commands.strikethrough)
                Divider()
                Button("Sobrescrito") { commands.setScript(superscript: true) }
                Button("Subscrito") { commands.setScript(superscript: false) }
            }
            Menu("Alinhar e recuar") {
                alignmentItems
                Divider()
                Button("Aumentar recuo") { commands.changeIndent(by: 36) }
                Button("Diminuir recuo") { commands.changeIndent(by: -36) }
            }
            Menu("Espaçamento entre linhas e parágrafos") { lineSpacingItems }
            Menu("Listas") {
                ForEach(DocumentListStyle.allCases) { style in
                    Button(style.title) { commands.setListStyle(style) }
                }
            }
            Divider()
            Button("Copiar formatação", action: commands.copyFormatting)
            Button("Colar formatação", action: commands.pasteFormatting).disabled(commands.copiedFormatting == nil)
            Button("Limpar formatação", action: commands.clearFormatting)
        }
    }

    private var toolsMenu: some View {
        documentMenu("Ferramentas") {
            Button("Pesquisar comandos…") { showingToolFinder = true }
            Button("Ortografia e gramática…") { commands.textView?.showGuessPanel(nil) }
            Button("Verificar ortografia agora") { commands.textView?.checkSpelling(nil) }
            Toggle("Verificar ortografia ao digitar", isOn: Binding(
                get: { commands.textView?.isContinuousSpellCheckingEnabled ?? true },
                set: { commands.textView?.isContinuousSpellCheckingEnabled = $0 }
            ))
        }
    }

    private var helpMenu: some View {
        documentMenu("Ajuda") {
            Button("Atalhos do teclado") { showingShortcuts = true }
            Link("Atalhos de referência do Google Docs", destination: URL(string: "https://support.google.com/docs/answer/179738?hl=pt-BR")!)
        }
    }

    private func documentMenu<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        Menu(content: content) { Text(title).font(.system(size: 12)) }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .padding(.horizontal, 3)
            .accessibilityLabel(title)
    }

    private var alignmentItems: some View {
        Group {
            Button("Esquerda") { commands.setAlignment(.left) }
            Button("Centralizado") { commands.setAlignment(.center) }
            Button("Direita") { commands.setAlignment(.right) }
            Button("Justificado") { commands.setAlignment(.justified) }
        }
    }
    private var lineSpacingItems: some View {
        Group {
            Button("Simples") { commands.setLineSpacing(1) }
            Button("1,15") { commands.setLineSpacing(1.15) }
            Button("1,5") { commands.setLineSpacing(1.5) }
            Button("Duplo") { commands.setLineSpacing(2) }
            Divider()
            Button("Adicionar espaço antes do parágrafo") { commands.setParagraphSpacing(before: 8) }
            Button("Adicionar espaço depois do parágrafo") { commands.setParagraphSpacing(after: 8) }
            Button("Remover espaço entre parágrafos") { commands.setParagraphSpacing(before: 0, after: 0) }
            Button("Espaçamento personalizado…") { showingSpacing = true }
        }
    }

    private var currentLinkAddress: String {
        guard let textView = commands.textView, let storage = textView.textStorage, storage.length > 0 else { return "" }
        let position = min(textView.selectedRange().location, storage.length - 1)
        let value = storage.attribute(.link, at: position, effectiveRange: nil)
        return (value as? URL)?.absoluteString ?? value as? String ?? ""
    }
    private var validLink: URL? {
        let value = linkAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let url = URL(string: value.contains(":") ? value : "https://" + value)
        guard let url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        if url.scheme != "mailto", url.host?.isEmpty != false { return nil }
        return url
    }
    private var linkSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Inserir ou editar link").font(.system(size: 19, weight: .medium))
            TextField("Texto a exibir", text: $linkText).textFieldStyle(.roundedBorder)
            TextField("Cole ou digite o endereço", text: $linkAddress).textFieldStyle(.roundedBorder)
                .onSubmit { if let url = validLink { commands.applyLink(url, displayText: linkText); showingLink = false } }
            HStack {
                Button("Remover link") { commands.applyLink(nil); showingLink = false }.buttonStyle(.linkAction(PrototypeStyle.documentBlue))
                Spacer()
                Button("Cancelar") { showingLink = false }.buttonStyle(.secondaryAction)
                Button("Aplicar") { commands.applyLink(validLink, displayText: linkText); showingLink = false }
                    .buttonStyle(.primaryAction(PrototypeStyle.documentBlue)).disabled(validLink == nil)
            }
        }
        .padding(24).frame(width: 440)
        .background(PrototypeStyle.documentPaper)
    }

    private var spacingSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Espaçamento personalizado").font(.system(size: 19, weight: .medium))
            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 12) {
                GridRow { Text("Entre linhas"); TextField("1,15", value: $customLineSpacing, format: .number) }
                GridRow { Text("Antes do parágrafo (pt)"); TextField("0", value: $customSpaceBefore, format: .number) }
                GridRow { Text("Depois do parágrafo (pt)"); TextField("0", value: $customSpaceAfter, format: .number) }
            }.font(.system(size: 13)).textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancelar") { showingSpacing = false }.buttonStyle(.secondaryAction)
                Button("Aplicar") {
                    commands.setLineSpacing(customLineSpacing)
                    commands.setParagraphSpacing(before: customSpaceBefore, after: customSpaceAfter)
                    showingSpacing = false
                }.buttonStyle(.primaryAction(PrototypeStyle.documentBlue))
                    .disabled(!(0.5...5).contains(customLineSpacing) || customSpaceBefore < 0 || customSpaceAfter < 0)
            }
        }.padding(24).frame(width: 400).background(PrototypeStyle.documentPaper)
    }

    private let shortcutRows: [(String, String)] = [
        ("Desfazer / Refazer", "⌘Z / ⇧⌘Z"), ("Negrito / Itálico / Sublinhado", "⌘B / ⌘I / ⌘U"),
        ("Tachado", "⇧⌘X"), ("Texto normal", "⌥⌘0"), ("Título 1 a 6", "⌥⌘1 … ⌥⌘6"),
        ("Esquerda / Centro / Direita / Justificado", "⇧⌘L / E / R / J"),
        ("Lista numerada / Marcadores / Verificação", "⇧⌘7 / 8 / 9"),
        ("Aumentar / Diminuir recuo", "⌘] / ⌘["), ("Inserir link", "⌘K"), ("Nota de rodapé", "⌥⌘F"),
        ("Limpar formatação", "⌘\\"), ("Colar sem formatação", "⇧⌘V"),
        ("Localizar / Localizar e substituir", "⌘F / ⇧⌘H"), ("Salvar / Imprimir", "⌘S / ⌘P"),
        ("Pesquisar comandos", "⌥/"), ("Ver atalhos", "⌘/")
    ]
    private var shortcutsSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Atalhos do editor").font(.system(size: 20, weight: .medium))
            Text("Ativos enquanto o manuscrito tem foco.").font(.system(size: 12)).foregroundStyle(PrototypeStyle.documentMuted)
            ForEach(shortcutRows, id: \.0) { label, shortcut in
                HStack { Text(label); Spacer(); Text(shortcut).monospaced().foregroundStyle(PrototypeStyle.documentMuted) }
                    .font(.system(size: 12))
            }
            HStack { Spacer(); Button("Concluído") { showingShortcuts = false }.buttonStyle(.primaryAction(PrototypeStyle.documentBlue)) }
        }
        .padding(24).frame(width: 580).background(PrototypeStyle.documentPaper)
    }
    private var toolFinderSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pesquisar comandos").font(.system(size: 20, weight: .medium))
            TextField("Ex.: centralizar, título, espaçamento…", text: $toolQuery).textFieldStyle(.roundedBorder)
            ForEach(DocumentParagraphStyle.allCases.filter { toolQuery.isEmpty || $0.title.localizedCaseInsensitiveContains(toolQuery) }) { style in
                Button(style.title) { commands.setParagraphStyle(style); showingToolFinder = false }.buttonStyle(.linkAction(PrototypeStyle.documentBlue))
            }
            ForEach(["Negrito", "Itálico", "Sublinhado", "Centralizar", "Justificar", "Espaçamento duplo", "Lista numerada", "Limpar formatação"].filter { toolQuery.isEmpty || $0.localizedCaseInsensitiveContains(toolQuery) }, id: \.self) { title in
                Button(title) {
                    switch title {
                    case "Negrito": commands.bold()
                    case "Itálico": commands.italic()
                    case "Sublinhado": commands.underline()
                    case "Centralizar": commands.setAlignment(.center)
                    case "Justificar": commands.setAlignment(.justified)
                    case "Espaçamento duplo": commands.setLineSpacing(2)
                    case "Lista numerada": commands.setListStyle(.numbered)
                    default: commands.clearFormatting()
                    }
                    showingToolFinder = false
                }.buttonStyle(.linkAction(PrototypeStyle.documentBlue))
            }
            HStack { Spacer(); Button("Fechar") { showingToolFinder = false }.buttonStyle(.secondaryAction) }
        }
        .padding(24).frame(width: 440).background(PrototypeStyle.documentPaper)
    }
}

private struct DocumentToolbarState: Equatable {
    let font: String
    let size: Double
    let style: DocumentParagraphStyle
    let bold: Bool
    let italic: Bool
    let underline: Bool
    let alignment: NSTextAlignment
    let list: DocumentListStyle
    let zoom: Int
    let canUndo: Bool
    let canRedo: Bool
    let hasCopiedFormatting: Bool
    @MainActor init(_ commands: EditorCommands) {
        font = commands.selectedFontFamily; size = commands.selectedFontPointSize; style = commands.selectedParagraphStyle
        bold = commands.isBoldActive; italic = commands.isItalicActive; underline = commands.isUnderlineActive
        alignment = commands.selectedAlignment; list = commands.selectedList; zoom = commands.zoomPercent
        canUndo = commands.canUndo; canRedo = commands.canRedo
        hasCopiedFormatting = commands.copiedFormatting != nil
    }
}

private struct DocumentFormattingToolbar: View, Equatable {
    let commands: EditorCommands
    let state: DocumentToolbarState
    @State private var sizeText = "11"
    @State private var showingTextColors = false
    @State private var showingHighlightColors = false
    @FocusState private var editingSize: Bool
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.state == rhs.state }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 3) { primaryTools; separator; secondaryTools(compact: false) }.fixedSize()
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 2) { primaryTools }
                HStack(spacing: 2) { secondaryTools(compact: true); Spacer(minLength: 0) }
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PrototypeStyle.documentToolbar, in: RoundedRectangle(cornerRadius: 22))
        .onAppear { sizeText = state.size.formatted(.number.precision(.fractionLength(0...1))) }
        .onChange(of: state.size) { _, value in if !editingSize { sizeText = value.formatted(.number.precision(.fractionLength(0...1))) } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Formatação do documento")
    }

    private var primaryTools: some View {
        Group {
            DocumentToolButton(symbol: "arrow.uturn.backward", title: "Desfazer (⌘Z)", width: 24, action: commands.undo).disabled(!state.canUndo)
            DocumentToolButton(symbol: "arrow.uturn.forward", title: "Refazer (⇧⌘Z)", width: 24, action: commands.redo).disabled(!state.canRedo)
            Menu {
                ForEach([50, 75, 90, 100, 125, 150, 200], id: \.self) { zoom in Button("\(zoom)%") { commands.zoomPercent = zoom } }
            } label: { Text("\(state.zoom)%").font(.system(size: 12)).frame(width: 47) }
                .menuStyle(.borderlessButton).fixedSize().help("Zoom do documento")
            separator
            Menu {
                ForEach(DocumentParagraphStyle.allCases) { style in Button(style.title) { commands.setParagraphStyle(style) } }
            } label: { Text(state.style.title).font(.system(size: 12)).lineLimit(1).frame(width: 68, alignment: .leading) }
                .menuStyle(.borderlessButton).fixedSize().help("Estilos de parágrafo (⌥⌘0 a 6)")
            separator
            Menu {
                ForEach(EditorCommands.fontFamilies, id: \.self) { family in Button(family) { commands.setFontFamily(family) } }
            } label: { Text(state.font).font(.system(size: 12)).lineLimit(1).frame(width: 56, alignment: .leading) }
                .menuStyle(.borderlessButton).fixedSize().help("Fonte: \(state.font)")
            HStack(spacing: 0) {
                DocumentToolButton(symbol: "minus", title: "Diminuir tamanho da fonte (⇧⌘,)", width: 18) { commands.setFontSize(commands.selectedFontPointSize - 1) }
                TextField("11", text: $sizeText).font(.system(size: 12)).textFieldStyle(.plain).multilineTextAlignment(.center)
                    .frame(width: 28, height: 24)
                    .background(PrototypeStyle.documentPaper, in: RoundedRectangle(cornerRadius: 3))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(PrototypeStyle.documentBorder))
                    .focused($editingSize)
                    .onSubmit { commitSize() }
                    .onChange(of: editingSize) { _, focused in if !focused { commitSize() } }
                    .accessibilityLabel("Tamanho da fonte")
                DocumentToolButton(symbol: "plus", title: "Aumentar tamanho da fonte (⇧⌘.)", width: 18) { commands.setFontSize(commands.selectedFontPointSize + 1) }
            }.fixedSize()
        }
    }

    private func secondaryTools(compact: Bool) -> some View {
        Group {
            DocumentToolButton(symbol: "bold", title: "Negrito (⌘B)", active: state.bold, action: commands.bold)
            DocumentToolButton(symbol: "italic", title: "Itálico (⌘I)", active: state.italic, action: commands.italic)
            DocumentToolButton(symbol: "underline", title: "Sublinhado (⌘U)", active: state.underline, action: commands.underline)
            DocumentToolButton(symbol: "a", title: "Cor do texto") { showingTextColors = true }
                .popover(isPresented: $showingTextColors) { DocumentColorPalette(title: "Cor do texto", selected: { commands.setTextColor($0); showingTextColors = false }) }
            DocumentToolButton(symbol: "highlighter", title: "Cor do realce") { showingHighlightColors = true }
                .popover(isPresented: $showingHighlightColors) { DocumentColorPalette(title: "Cor do realce", selected: { commands.setHighlightColor($0); showingHighlightColors = false }) }
            separator
            DocumentToolButton(symbol: "link", title: "Inserir link (⌘K)") { commands.linkHandler?() }
            Menu {
                Button("Esquerda (⇧⌘L)") { commands.setAlignment(.left) }
                Button("Centralizado (⇧⌘E)") { commands.setAlignment(.center) }
                Button("Direita (⇧⌘R)") { commands.setAlignment(.right) }
                Button("Justificado (⇧⌘J)") { commands.setAlignment(.justified) }
            } label: { Image(systemName: alignmentSymbol).font(.system(size: 14)).frame(width: 24, height: 28) }
                .menuStyle(.borderlessButton).fixedSize().help("Alinhamento")
            Menu {
                Button("Simples") { commands.setLineSpacing(1) }
                Button("1,15") { commands.setLineSpacing(1.15) }
                Button("1,5") { commands.setLineSpacing(1.5) }
                Button("Duplo") { commands.setLineSpacing(2) }
                Divider()
                Button("Adicionar espaço depois") { commands.setParagraphSpacing(after: 8) }
                Button("Remover espaço entre parágrafos") { commands.setParagraphSpacing(before: 0, after: 0) }
                Button("Espaçamento personalizado…") { commands.spacingHandler?() }
            } label: { Image(systemName: "arrow.up.and.down.text.horizontal").font(.system(size: 14)).frame(width: 24, height: 28) }
                .menuStyle(.borderlessButton).fixedSize().help("Espaçamento entre linhas e parágrafos")
            if !compact {
                DocumentToolButton(symbol: "checklist", title: "Lista de verificação (⇧⌘9)", active: state.list == .checklist) { commands.setListStyle(.checklist) }
            }
            DocumentToolButton(symbol: "list.number", title: "Lista numerada (⇧⌘7)", active: state.list == .numbered) { commands.setListStyle(.numbered) }
            DocumentToolButton(symbol: "list.bullet", title: "Lista com marcadores (⇧⌘8)", active: state.list == .bullet, action: commands.bulletedList)
            Menu {
                Button("Lista de verificação (⇧⌘9)") { commands.setListStyle(.checklist) }
                Button("Tachado (⇧⌘X)", action: commands.strikethrough)
                Button("Sobrescrito (⌘.)") { commands.setScript(superscript: true) }
                Button("Subscrito (⌘,)") { commands.setScript(superscript: false) }
                Divider()
                Button("Diminuir recuo (⌘[)") { commands.changeIndent(by: -36) }
                Button("Aumentar recuo (⌘])") { commands.changeIndent(by: 36) }
                Divider()
                Button("Copiar formatação (⌥⌘C)", action: commands.copyFormatting)
                Button("Colar formatação (⌥⌘V)", action: commands.pasteFormatting).disabled(commands.copiedFormatting == nil)
                Button("Limpar formatação (⌘\\)", action: commands.clearFormatting)
                Divider()
                Button("Imprimir… (⌘P)", action: commands.printDocument)
                Button("Nota de rodapé (⌥⌘F)", action: commands.footnote)
                Button("Citação em bloco", action: commands.quotation)
            } label: { Image(systemName: "ellipsis").font(.system(size: 15)).frame(width: 22, height: 28) }
                .menuStyle(.borderlessButton).fixedSize().help("Mais opções de formatação")
        }
    }

    private var separator: some View { Rectangle().fill(PrototypeStyle.documentBorder).frame(width: 1, height: 20).padding(.horizontal, 3) }
    private var alignmentSymbol: String {
        switch state.alignment {
        case .center: "text.aligncenter"
        case .right: "text.alignright"
        case .justified: "text.justify"
        default: "text.alignleft"
        }
    }
    private func commitSize() {
        if let value = Double(sizeText.replacingOccurrences(of: ",", with: ".")), value != commands.selectedFontPointSize { commands.setFontSize(value) }
        sizeText = commands.selectedFontPointSize.formatted(.number.precision(.fractionLength(0...1)))
    }
}

private struct DocumentToolButton: View {
    let symbol: String
    let title: String
    var active = false
    var width: CGFloat = 27
    let action: () -> Void
    @State private var hovered = false
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13, weight: .medium))
                .frame(width: width, height: 28)
                .foregroundStyle(active ? PrototypeStyle.documentBlue : PrototypeStyle.documentInk)
                .background(active ? PrototypeStyle.documentSelection : (hovered ? PrototypeStyle.documentInk.opacity(0.07) : .clear), in: RoundedRectangle(cornerRadius: 4))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).onHover { hovered = $0 }.help(title).accessibilityLabel(title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

private struct DocumentColorPalette: View {
    let title: String
    let selected: (NSColor?) -> Void
    private let colors: [UInt32] = [
        0x000000, 0x434343, 0x666666, 0x999999, 0xb7b7b7, 0xcccccc, 0xeeeeee, 0xffffff,
        0x980000, 0xff0000, 0xff9900, 0xffff00, 0x00ff00, 0x00ffff, 0x4a86e8, 0x0000ff,
        0x9900ff, 0xff00ff, 0xf4cccc, 0xfce5cd, 0xfff2cc, 0xd9ead3, 0xd0e0e3, 0xcfe2f3,
        0xd9d2e9, 0xead1dc, 0xe06666, 0xf6b26b, 0xffd966, 0x93c47d, 0x76a5af, 0x6fa8dc,
        0x8e7cc3, 0xc27ba0, 0xa61c00, 0xb45f06, 0xbf9000, 0x38761d, 0x134f5c, 0x0b5394
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 13, weight: .medium))
            Button("Automático / sem cor") { selected(nil) }.buttonStyle(.linkAction(PrototypeStyle.documentBlue))
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(23), spacing: 4), count: 8), spacing: 4) {
                ForEach(colors, id: \.self) { hex in
                    let color = NSColor(srgbRed: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, alpha: 1)
                    Button { selected(color) } label: {
                        RoundedRectangle(cornerRadius: 3).fill(Color(nsColor: color)).frame(width: 22, height: 22)
                            .overlay(RoundedRectangle(cornerRadius: 3).stroke(PrototypeStyle.documentBorder))
                    }.buttonStyle(.plain).help(String(format: "#%06X", hex)).accessibilityLabel(String(format: "Cor #%06X", hex))
                }
            }
        }.padding(16).background(PrototypeStyle.documentPaper)
    }
}

private struct DocumentRuler: View {
    let zoom: Int
    var body: some View {
        Canvas { context, size in
            let scale = CGFloat(zoom) / 75
            let margin = max(24, min(72, size.width / scale * 0.12)) * scale
            let usable = size.width - 2 * margin
            var baseline = Path()
            baseline.move(to: CGPoint(x: 0, y: size.height - 1))
            baseline.addLine(to: CGPoint(x: size.width, y: size.height - 1))
            context.stroke(baseline, with: .color(PrototypeStyle.documentBorder), lineWidth: 1)
            let cm = 72 / 2.54 * scale
            guard cm > 0, usable > 0 else { return }
            for tick in 0...Int(usable / (cm / 4)) {
                let x = margin + CGFloat(tick) * cm / 4
                var mark = Path()
                mark.move(to: CGPoint(x: x, y: size.height - (tick % 4 == 0 ? 8 : 4)))
                mark.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(mark, with: .color(PrototypeStyle.documentMuted.opacity(0.55)), lineWidth: 0.7)
                if tick % 4 == 0 {
                    context.draw(Text("\(tick / 4)").font(.system(size: 9)).foregroundStyle(PrototypeStyle.documentMuted), at: CGPoint(x: x, y: 6))
                }
            }
        }
    }
}
