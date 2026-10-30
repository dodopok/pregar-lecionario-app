import AppKit
import SwiftUI

/// Comandos do manuscrito. O NSTextView continua sendo a fonte da verdade do texto; esta classe
/// aplica formatação, publica o estado da seleção e trata as conveniências de escrita
/// (listas que continuam no Return, atalhos "# ", "> ", "- " no início do parágrafo).
@MainActor
final class EditorCommands: ObservableObject {
    @Published private(set) var wordCount = 0
    @Published private(set) var isEmpty = true
    @Published private(set) var plainText = ""
    @Published private(set) var hasPendingChanges = false
    @Published private(set) var saveError: String?
    @Published var zoomPercent = 100
    @Published var showsRuler = true
    @Published private(set) var selectedFontFamily = "Arial"
    @Published private(set) var selectedFontSize = 11
    @Published private(set) var selectedFontPointSize: Double = 11
    @Published private(set) var isBoldActive = false
    @Published private(set) var isItalicActive = false
    @Published var isHeadingActive = false
    @Published private(set) var isQuoteActive = false
    @Published private(set) var isListActive = false
    @Published var isUnderlineActive = false
    @Published var isStrikethroughActive = false
    @Published var selectedParagraphStyle = DocumentParagraphStyle.normal
    @Published var selectedAlignment = NSTextAlignment.left
    @Published var selectedLineSpacing: Double = 1.15
    @Published var selectedSpaceBefore: Double = 0
    @Published var selectedSpaceAfter: Double = 0
    @Published var selectedList = DocumentListStyle.none
    @Published var isSuperscriptActive = false
    @Published var isSubscriptActive = false
    var flushHandler: (() -> Void)?
    var linkHandler: (() -> Void)?
    var shortcutsHandler: (() -> Void)?
    var toolFinderHandler: (() -> Void)?
    var spacingHandler: (() -> Void)?
    var copiedFormatting: [NSAttributedString.Key: Any]?
    static let fontFamilies: [String] = {
        let preferred = ["Arial", "Calibri", "Cambria", "Courier New", "Georgia", "Helvetica", "Times New Roman", "Trebuchet MS", "Verdana"]
        let installed = NSFontManager.shared.availableFontFamilies
        return preferred.filter { installed.contains($0) } + installed.filter { !preferred.contains($0) }.sorted()
    }()
    static let fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72, 96]
    /// Texto normal: Arial 11, com a entrelinha padrão de 1,15 do editor de documentos.
    static let bodyPointSize: CGFloat = 11
    /// Título legado: 14 pt em negrito. Os novos estilos conservam o nível em metadados RTF.
    static let headingPointSize: CGFloat = 14
    /// Marcador literal das listas; exportações e testes dependem desta representação.
    static let listMarker = "• "
    weak var textView: NSTextView?

    // MARK: - Estilos

    /// Ritmo de leitura do manuscrito: entrelinha um pouco mais aberta que o padrão do AppKit.
    static func bodyParagraphStyle() -> NSMutableParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.15
        return style
    }

    static func quoteParagraphStyle(basedOn base: NSParagraphStyle?) -> NSMutableParagraphStyle {
        let style = (base?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
        style.headIndent = 34
        style.firstLineHeadIndent = 34
        style.tailIndent = -12
        style.paragraphSpacingBefore = 11
        style.paragraphSpacing = 12
        return style
    }

    static let quoteForegroundColor = NSColor(calibratedRed: 0.17, green: 0.32, blue: 0.24, alpha: 1)
    static let quoteBackgroundColor = NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.91, alpha: 1)

    static func isHeadingFont(_ font: NSFont) -> Bool {
        font.pointSize >= 13 && NSFontManager.shared.traits(of: font).contains(.boldFontMask)
    }

    static func bodyFont(family: String) -> NSFont {
        let base = NSFont(name: family, size: bodyPointSize) ?? NSFont.systemFont(ofSize: bodyPointSize)
        return NSFontManager.shared.convert(base, toNotHaveTrait: .boldFontMask)
    }

    static func headingFont(family: String) -> NSFont {
        let base = NSFont(name: family, size: headingPointSize) ?? NSFont.boldSystemFont(ofSize: headingPointSize)
        return NSFontManager.shared.convert(base, toHaveTrait: .boldFontMask)
    }

    // MARK: - Estado

    func updateWordCount(from text: String) {
        let updatedWordCount = text.split(whereSeparator: \.isWhitespace).count
        if wordCount != updatedWordCount { wordCount = updatedWordCount }
        if isEmpty != text.isEmpty { isEmpty = text.isEmpty }
        if plainText != text { plainText = text }
        updateSelectionFormatting()
    }

    func setPendingChanges(_ pending: Bool, error: String? = nil) {
        if hasPendingChanges != pending { hasPendingChanges = pending }
        if saveError != error { saveError = error }
    }

    func flushPendingEdits() { flushHandler?() }

    func updateEmptyState(_ empty: Bool) {
        if isEmpty != empty { isEmpty = empty }
    }

    @discardableResult
    func selectQuote(_ quote: String) -> Bool {
        guard let textView, !quote.isEmpty else { return false }
        let range = (textView.string as NSString).range(of: quote)
        guard range.location != NSNotFound else { return false }
        textView.window?.makeFirstResponder(textView)
        textView.setSelectedRange(range)
        textView.scrollRangeToVisible(range)
        return true
    }

    func insertText(_ text: String) {
        guard let textView, !text.isEmpty else { return }
        textView.window?.makeFirstResponder(textView)
        textView.insertText(text, replacementRange: textView.selectedRange())
        textView.didChangeText()
    }

    // MARK: - Caracteres

    func bold() { toggleFontTrait(.boldFontMask) }
    func italic() { toggleFontTrait(.italicFontMask) }

    func setFontFamily(_ family: String) {
        applyFontChange { font in
            let manager = NSFontManager.shared
            var updated = NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: font.pointSize)
                ?? NSFont(name: family, size: font.pointSize) ?? font
            for trait in [NSFontTraitMask.boldFontMask, .italicFontMask] where manager.traits(of: font).contains(trait) {
                updated = manager.convert(updated, toHaveTrait: trait)
            }
            return updated
        }
    }

    func setFontSize(_ size: Int) {
        setFontSize(Double(size))
    }

    func setFontSize(_ size: Double) {
        guard size.isFinite else { return }
        applyFontChange { $0.withSize(CGFloat(min(max(size, 1), 400))) }
    }

    // MARK: - Blocos

    /// Alterna o parágrafo atual entre título (negrito 14 pt, com respiro acima) e corpo.
    /// Num parágrafo vazio prepara a formatação do que for digitado em seguida.
    func heading() {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        registerFormattingUndo("Título")
        let range = currentParagraphRange(in: textView)
        let hasText = range.length > 0 && range.location < storage.length
        let referenceFont = (hasText ? storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont : nil)
            ?? textView.typingAttributes[.font] as? NSFont
            ?? textView.font
            ?? NSFont(name: "Arial", size: Self.bodyPointSize)
            ?? NSFont.systemFont(ofSize: Self.bodyPointSize)
        let makeHeading = !Self.isHeadingFont(referenceFont)
        let family = referenceFont.familyName ?? "Arial"
        let targetFont = makeHeading ? Self.headingFont(family: family) : Self.bodyFont(family: family)

        let existingStyle = hasText
            ? storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
            : textView.typingAttributes[.paragraphStyle] as? NSParagraphStyle
        let style = (existingStyle?.mutableCopy() as? NSMutableParagraphStyle)
            ?? (textView.defaultParagraphStyle?.mutableCopy() as? NSMutableParagraphStyle)
            ?? NSMutableParagraphStyle()
        style.paragraphSpacingBefore = makeHeading ? 14 : 0
        style.paragraphSpacing = makeHeading ? 4 : 0

        if hasText {
            storage.beginEditing()
            storage.addAttribute(.font, value: targetFont, range: range)
            storage.addAttribute(.paragraphStyle, value: style, range: range)
            storage.endEditing()
        }
        var typing = textView.typingAttributes
        typing[.font] = targetFont
        typing[.paragraphStyle] = style
        textView.typingAttributes = typing
        if hasText { textView.didChangeText() }
        updateSelectionFormatting()
    }

    /// Alterna a citação em bloco em todos os parágrafos da seleção, sem mexer no texto.
    /// Com o cursor num parágrafo vazio, prepara a formatação do que for digitado.
    func quotation() {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        registerFormattingUndo("Citação")
        let ranges = paragraphRanges(in: textView)
        let selection = textView.selectedRange()
        guard !ranges.isEmpty, storage.length > 0 else {
            setQuoteTypingAttributes(enabled: !typingAttributesAreQuoted(in: textView), in: textView)
            updateSelectionFormatting()
            return
        }
        let shouldRemove = ranges.allSatisfy { isQuoted($0, in: storage) }
        storage.beginEditing()
        for range in ranges {
            let existing = storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
            if shouldRemove {
                let style = (existing?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                Self.clearQuoteIndentation(in: style)
                storage.removeAttribute(.foregroundColor, range: range)
                storage.removeAttribute(.backgroundColor, range: range)
                storage.addAttribute(.paragraphStyle, value: style, range: range)
            } else {
                let style = Self.quoteParagraphStyle(basedOn: existing ?? textView.defaultParagraphStyle)
                storage.addAttribute(.foregroundColor, value: Self.quoteForegroundColor, range: range)
                storage.addAttribute(.backgroundColor, value: Self.quoteBackgroundColor, range: range)
                storage.addAttribute(.paragraphStyle, value: style, range: range)
            }
        }
        storage.endEditing()
        if selection.length == 0 {
            setQuoteTypingAttributes(enabled: !shouldRemove, in: textView)
        }
        textView.didChangeText()
        updateSelectionFormatting()
    }

    /// Alterna o marcador "• " nos parágrafos da seleção. Num parágrafo vazio, insere o marcador.
    func bulletedList() {
        setListStyle(.bullet)
    }

    func footnote() {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        registerFormattingUndo("Nota de rodapé")
        let occupied = footnoteNumbers(in: textView.string)
        let maximumCandidate = occupied.count + 1
        let number = (1...maximumCandidate).first { !occupied.contains($0) } ?? maximumCandidate
        let marker = String(number).compactMap { Self.decimalToSuperscript[$0] }.map(String.init).joined()
        let selection = textView.selectedRange()
        let markerText = NSAttributedString(string: marker, attributes: [
            .font: NSFont.systemFont(ofSize: 8),
            .baselineOffset: 4
        ])
        storage.replaceCharacters(in: selection, with: markerText)
        storage.append(NSAttributedString(string: "\n\n\(marker) ", attributes: [
            .font: NSFont.systemFont(ofSize: 10)
        ]))
        textView.setSelectedRange(NSRange(location: storage.length, length: 0))
        textView.scrollRangeToVisible(textView.selectedRange())
        textView.didChangeText()
    }

    /// Insere um texto no início do manuscrito como epígrafe: citação em bloco com atribuição.
    func insertEpigraph(_ text: String, attribution: String = "Coleta do dia") {
        guard let textView else { return }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        focusTextView()
        let block = "“\(body)”\n— \(attribution)\n\n"
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        textView.insertText(block, replacementRange: NSRange(location: 0, length: 0))
        let quoteLength = (block as NSString).length - 1
        textView.setSelectedRange(NSRange(location: 0, length: quoteLength))
        quotation()
        textView.setSelectedRange(NSRange(location: quoteLength, length: 0))
        textView.scrollRangeToVisible(NSRange(location: 0, length: 0))
    }

    // MARK: - Conveniências de digitação (chamadas pelo QuotationTextView)

    /// Return dentro de uma lista continua a lista; num item vazio, encerra a lista.
    /// Return no fim de um título começa um parágrafo de corpo. Return numa linha vazia
    /// de citação sai da citação. Devolve true quando consumiu a tecla.
    func handleNewline() -> Bool {
        guard let textView, let storage = textView.textStorage else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0 else { return false }
        let source = textView.string as NSString
        let paragraph = currentParagraphRange(in: textView)
        let paragraphText = source.substring(with: paragraph).trimmingCharacters(in: .newlines)
        if let prefix = DocumentListStyle.prefix(in: paragraphText) {
            let content = paragraphText.dropFirst(prefix.length).trimmingCharacters(in: .whitespaces)
            if content.isEmpty {
                textView.insertText("", replacementRange: NSRange(location: paragraph.location, length: prefix.length))
            } else {
                textView.insertText("\n" + prefix.kind.marker(number: prefix.number + 1), replacementRange: selection)
            }
            return true
        }

        let endsWithNewline = paragraph.length > 0
            && source.substring(with: NSRange(location: NSMaxRange(paragraph) - 1, length: 1)) == "\n"
        let textEnd = NSMaxRange(paragraph) - (endsWithNewline ? 1 : 0)
        if let font = textView.typingAttributes[.font] as? NSFont,
           (Self.isHeadingFont(font)
            || ((textView.typingAttributes[.paragraphStyle] as? NSParagraphStyle)?.headerLevel ?? 0) > 0
            || (textView.typingAttributes[.pregarParagraphStyle] as? String).flatMap(DocumentParagraphStyle.init(rawValue:)).map { $0 != .normal } == true),
           !paragraphText.isEmpty,
           selection.location >= textEnd {
            textView.insertText("\n", replacementRange: selection)
            var typing = textView.typingAttributes
            typing[.font] = Self.bodyFont(family: font.familyName ?? "Arial")
            typing[.paragraphStyle] = textView.defaultParagraphStyle ?? NSParagraphStyle.default
            typing[.pregarParagraphStyle] = DocumentParagraphStyle.normal.rawValue
            typing[.foregroundColor] = NSColor.black
            textView.typingAttributes = typing
            return true
        }

        if paragraphText.isEmpty, typingAttributesAreQuoted(in: textView) {
            if paragraph.length > 0, paragraph.location < storage.length {
                let existing = storage.attribute(.paragraphStyle, at: paragraph.location, effectiveRange: nil) as? NSParagraphStyle
                let style = (existing?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                Self.clearQuoteIndentation(in: style)
                storage.beginEditing()
                storage.removeAttribute(.foregroundColor, range: paragraph)
                storage.removeAttribute(.backgroundColor, range: paragraph)
                storage.addAttribute(.paragraphStyle, value: style, range: paragraph)
                storage.endEditing()
                textView.didChangeText()
            }
            setQuoteTypingAttributes(enabled: false, in: textView)
            updateSelectionFormatting()
            return true
        }
        return false
    }

    /// Backspace logo após o marcador de lista remove o marcador em vez de um caractere.
    func handleDeleteBackward() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0 else { return false }
        let source = textView.string as NSString
        let paragraph = currentParagraphRange(in: textView)
        guard let prefix = DocumentListStyle.prefix(in: source.substring(with: paragraph)),
              selection.location == paragraph.location + prefix.length else {
            return false
        }
        textView.insertText("", replacementRange: NSRange(location: paragraph.location, length: prefix.length))
        return true
    }

    /// Atalhos no início do parágrafo, ao digitar espaço: "#" ou "##" viram título,
    /// ">" vira citação, "-" ou "*" viram lista. Devolve true quando consumiu o espaço.
    func handleTypedSpace() -> Bool {
        guard let textView else { return false }
        let selection = textView.selectedRange()
        guard selection.length == 0 else { return false }
        let source = textView.string as NSString
        let location = min(selection.location, source.length)
        let paragraph = source.paragraphRange(for: NSRange(location: location, length: 0))
        let prefixRange = NSRange(location: paragraph.location, length: location - paragraph.location)
        guard (1...2).contains(prefixRange.length) else { return false }
        let remainder = source.substring(with: NSRange(location: location, length: NSMaxRange(paragraph) - location))
            .trimmingCharacters(in: .newlines)
        guard remainder.isEmpty else { return false }
        switch source.substring(with: prefixRange) {
        case "#":
            textView.insertText("", replacementRange: prefixRange)
            setParagraphStyle(.heading1)
        case "##":
            textView.insertText("", replacementRange: prefixRange)
            setParagraphStyle(.heading2)
        case ">":
            textView.insertText("", replacementRange: prefixRange)
            quotation()
        case "-", "*":
            textView.insertText(Self.listMarker, replacementRange: prefixRange)
        default:
            return false
        }
        return true
    }

    // MARK: - Internos

    private func footnoteNumbers(in text: String) -> Set<Int> {
        guard let expression = try? NSRegularExpression(pattern: "[⁰¹²³⁴⁵⁶⁷⁸⁹]+") else { return [] }
        let source = text as NSString
        return Set(expression.matches(in: text, range: NSRange(location: 0, length: source.length)).compactMap { match in
            let marker = source.substring(with: match.range)
            let decimal = marker.compactMap { Self.superscriptToDecimal[$0] }.map(String.init).joined()
            return Int(decimal)
        })
    }

    private static let superscriptToDecimal: [Character: Character] = [
        "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
        "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"
    ]
    private static let decimalToSuperscript = Dictionary(
        uniqueKeysWithValues: superscriptToDecimal.map { ($0.value, $0.key) }
    )

    private static func clearQuoteIndentation(in style: NSMutableParagraphStyle) {
        style.headIndent = 0
        style.firstLineHeadIndent = 0
        style.tailIndent = 0
        style.paragraphSpacingBefore = 0
        style.paragraphSpacing = 0
    }

    private func typingAttributesAreQuoted(in textView: NSTextView) -> Bool {
        abs(((textView.typingAttributes[.paragraphStyle] as? NSParagraphStyle)?.headIndent ?? 0) - 34) < 0.5
    }

    private func setQuoteTypingAttributes(enabled: Bool, in textView: NSTextView) {
        var typing = textView.typingAttributes
        let current = typing[.paragraphStyle] as? NSParagraphStyle
        if enabled {
            typing[.paragraphStyle] = Self.quoteParagraphStyle(basedOn: current ?? textView.defaultParagraphStyle)
            typing[.foregroundColor] = Self.quoteForegroundColor
            typing[.backgroundColor] = Self.quoteBackgroundColor
        } else {
            let style = (current?.mutableCopy() as? NSMutableParagraphStyle)
                ?? (textView.defaultParagraphStyle?.mutableCopy() as? NSMutableParagraphStyle)
                ?? NSMutableParagraphStyle()
            Self.clearQuoteIndentation(in: style)
            typing[.paragraphStyle] = style
            typing.removeValue(forKey: .foregroundColor)
            typing.removeValue(forKey: .backgroundColor)
        }
        textView.typingAttributes = typing
    }

    private func toggleFontTrait(_ trait: NSFontTraitMask) {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        let manager = NSFontManager.shared
        let selection = textView.selectedRange()
        let current = selection.length > 0 && storage.length > 0
            ? storage.attribute(.font, at: min(selection.location, storage.length - 1), effectiveRange: nil) as? NSFont
                ?? textView.font
                ?? NSFont.systemFont(ofSize: 10)
            : textView.typingAttributes[.font] as? NSFont
                ?? textView.font
                ?? NSFont.systemFont(ofSize: 10)
        let shouldEnable = !hasTrait(trait, in: selection, textView: textView, storage: storage, fallback: current)
        let convert: (NSFont) -> NSFont = shouldEnable
            ? { manager.convert($0, toHaveTrait: trait) }
            : { manager.convert($0, toNotHaveTrait: trait) }

        guard selection.length > 0 else {
            textView.typingAttributes[.font] = convert(current)
            updateSelectionFormatting()
            return
        }

        registerFormattingUndo(trait == .boldFontMask ? "Negrito" : "Itálico")

        let selectedText = storage.attributedSubstring(from: selection)
        var replacements: [(NSRange, NSFont)] = []
        selectedText.enumerateAttribute(.font, in: NSRange(location: 0, length: selectedText.length)) { value, range, _ in
            let font = value as? NSFont ?? current
            replacements.append((NSRange(location: selection.location + range.location, length: range.length), convert(font)))
        }
        storage.beginEditing()
        replacements.forEach { storage.addAttribute(.font, value: $0.1, range: $0.0) }
        storage.endEditing()
        textView.didChangeText()
        updateSelectionFormatting()
    }

    private func applyFontChange(_ transform: (NSFont) -> NSFont) {
        guard let textView, let storage = textView.textStorage else { return }
        textView.window?.makeFirstResponder(textView)
        let selection = textView.selectedRange()
        let current = textView.typingAttributes[.font] as? NSFont
            ?? (storage.length > 0 ? storage.attribute(.font, at: min(selection.location, storage.length - 1), effectiveRange: nil) as? NSFont : nil)
            ?? textView.font
            ?? NSFont(name: "Arial", size: 10)!

        guard selection.length > 0, storage.length > 0 else {
            textView.typingAttributes[.font] = transform(current)
            updateSelectionFormatting()
            return
        }

        let safeRange = NSIntersectionRange(selection, NSRange(location: 0, length: storage.length))
        registerFormattingUndo("Fonte")
        var replacements: [(NSRange, NSFont)] = []
        storage.enumerateAttribute(.font, in: safeRange) { value, range, _ in
            replacements.append((range, transform(value as? NSFont ?? current)))
        }
        storage.beginEditing()
        replacements.forEach { storage.addAttribute(.font, value: $0.1, range: $0.0) }
        storage.endEditing()
        textView.didChangeText()
        updateSelectionFormatting()
    }

    func updateSelectionFormatting() {
        guard let textView else { return }
        let storage = textView.textStorage
        let selection = textView.selectedRange()
        let safeSelection = NSIntersectionRange(selection, NSRange(location: 0, length: storage?.length ?? 0))
        let selectedFont = storage?.length ?? 0 > 0
            ? storage?.attribute(.font, at: min(selection.location, (storage?.length ?? 1) - 1), effectiveRange: nil) as? NSFont
            : nil
        let font = (selection.length > 0 ? selectedFont : nil)
            ?? textView.typingAttributes[.font] as? NSFont
            ?? selectedFont
            ?? textView.font
        if let font {
            let family = font.familyName ?? "Arial"
            let size = Int(font.pointSize.rounded())
            if selectedFontFamily != family { selectedFontFamily = family }
            if selectedFontSize != size { selectedFontSize = size }
            if selectedFontPointSize != Double(font.pointSize) { selectedFontPointSize = Double(font.pointSize) }
            let bold = hasTrait(.boldFontMask, in: safeSelection, textView: textView, storage: storage, fallback: font)
            let italic = hasTrait(.italicFontMask, in: safeSelection, textView: textView, storage: storage, fallback: font)
            if isBoldActive != bold { isBoldActive = bold }
            if isItalicActive != italic { isItalicActive = italic }
        } else {
            if isBoldActive { isBoldActive = false }
            if isItalicActive { isItalicActive = false }
        }
        let paragraphRanges = paragraphRanges(in: textView)
        if paragraphRanges.isEmpty {
            let quoted = typingAttributesAreQuoted(in: textView)
            if isQuoteActive != quoted { isQuoteActive = quoted }
            if isListActive { isListActive = false }
        } else {
            let quoted = paragraphRanges.allSatisfy { range in
                guard let storage, storage.length > 0 else { return false }
                return isQuoted(range, in: storage)
            }
            let listed = paragraphRanges.allSatisfy { range in
                guard let storage, range.location < storage.length else { return false }
                let prefixLength = min(2, range.length)
                return (storage.string as NSString).substring(with: NSRange(location: range.location, length: prefixLength)) == Self.listMarker
            }
            if isQuoteActive != quoted { isQuoteActive = quoted }
            if isListActive != listed { isListActive = listed }
        }
        updateDocumentFormatting()
    }

    private func hasTrait(
        _ trait: NSFontTraitMask,
        in selection: NSRange,
        textView: NSTextView,
        storage: NSTextStorage?,
        fallback: NSFont
    ) -> Bool {
        let manager = NSFontManager.shared
        guard selection.length > 0, let storage else {
            let font = textView.typingAttributes[.font] as? NSFont ?? fallback
            return manager.traits(of: font).contains(trait)
        }
        var allHaveTrait = true
        storage.enumerateAttribute(.font, in: selection) { value, _, _ in
            let font = value as? NSFont ?? fallback
            if !manager.traits(of: font).contains(trait) { allHaveTrait = false }
        }
        return allHaveTrait
    }

    private func isQuoted(_ range: NSRange, in storage: NSTextStorage) -> Bool {
        guard range.location < storage.length,
              let style = storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle else { return false }
        return abs(style.headIndent - 34) < 0.5
    }

    private func focusTextView() {
        guard let textView else { return }
        textView.window?.makeFirstResponder(textView)
    }

    /// Parágrafo que contém a seleção. Com o cursor depois da última quebra de linha,
    /// devolve o parágrafo vazio final (comprimento zero), não o parágrafo anterior.
    private func currentParagraphRange(in textView: NSTextView) -> NSRange {
        let source = textView.string as NSString
        let selection = textView.selectedRange()
        let location = min(selection.location, source.length)
        let length = min(selection.length, source.length - location)
        return source.paragraphRange(for: NSRange(location: location, length: length))
    }

    private func paragraphRanges(in textView: NSTextView) -> [NSRange] {
        let source = textView.string as NSString
        guard source.length > 0 else { return [] }
        let expanded = currentParagraphRange(in: textView)
        var ranges: [NSRange] = []
        var location = expanded.location
        while location < NSMaxRange(expanded) {
            let range = source.paragraphRange(for: NSRange(location: location, length: 0))
            guard range.length > 0 else { break }
            ranges.append(range)
            location = NSMaxRange(range)
        }
        return ranges
    }
}

/// NSTextView do manuscrito: desenha o fundo das citações em bloco e encaminha Return,
/// Backspace e o espaço após "#", ">" e "-" para as conveniências de EditorCommands.
@MainActor
final class QuotationTextView: NSTextView {
    weak var commands: EditorCommands?

    private static let darkQuoteInk = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(srgbRed: 0.74, green: 0.86, blue: 0.77, alpha: 1)
            : EditorCommands.quoteForegroundColor
    }
    private static let quotePaper = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(srgbRed: 0.16, green: 0.23, blue: 0.19, alpha: 1)
            : EditorCommands.quoteBackgroundColor
    }

    /// Cores temporárias pertencem só ao desenho: o RTF conserva preto e as cores escolhidas
    /// pelo autor, mesmo quando o papel é escuro. Durante a digitação, atualiza só o trecho editado.
    func refreshDisplayColors(in requestedRange: NSRange? = nil) {
        guard let storage = textStorage, let layoutManager, storage.length > 0 else { return }
        let range = NSIntersectionRange(requestedRange ?? NSRange(location: 0, length: storage.length), NSRange(location: 0, length: storage.length))
        guard range.length > 0 else { return }
        layoutManager.removeTemporaryAttribute(.foregroundColor, forCharacterRange: range)
        layoutManager.removeTemporaryAttribute(.backgroundColor, forCharacterRange: range)
        storage.enumerateAttributes(in: range) { attributes, range, _ in
            let color = (attributes[.foregroundColor] as? NSColor)?.usingColorSpace(.deviceRGB)
            let isQuote = abs(((attributes[.paragraphStyle] as? NSParagraphStyle)?.headIndent ?? 0) - 34) < 0.5
            if isQuote, Self.matches(color, EditorCommands.quoteForegroundColor) {
                layoutManager.addTemporaryAttribute(.foregroundColor, value: Self.darkQuoteInk, forCharacterRange: range)
            } else if attributes[.link] == nil, color == nil || Self.matches(color, .black) {
                layoutManager.addTemporaryAttribute(.foregroundColor, value: NSColor.textColor, forCharacterRange: range)
            } else if attributes[.pregarParagraphStyle] as? String == DocumentParagraphStyle.subtitle.rawValue {
                layoutManager.addTemporaryAttribute(.foregroundColor, value: NSColor.secondaryLabelColor, forCharacterRange: range)
            }
            if isQuote, Self.matches(attributes[.backgroundColor] as? NSColor, EditorCommands.quoteBackgroundColor) {
                layoutManager.addTemporaryAttribute(.backgroundColor, value: Self.quotePaper, forCharacterRange: range)
            }
        }
    }

    private static func matches(_ color: NSColor?, _ reference: NSColor) -> Bool {
        guard let color = color?.usingColorSpace(.deviceRGB),
              let reference = reference.usingColorSpace(.deviceRGB) else { return false }
        return abs(color.redComponent - reference.redComponent) < 0.02
            && abs(color.greenComponent - reference.greenComponent) < 0.02
            && abs(color.blueComponent - reference.blueComponent) < 0.02
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    override func copy(_ sender: Any?) {
        super.copy(sender)
        try? DocumentRTF.copySelection(from: self, to: .general)
    }

    override func cut(_ sender: Any?) {
        guard isEditable, selectedRange().length > 0 else { return }
        copy(sender)
        insertText("", replacementRange: selectedRange())
    }

    override func paste(_ sender: Any?) {
        if let data = NSPasteboard.general.data(forType: .rtf), let text = try? DocumentRTF.decode(data) {
            insertText(text, replacementRange: selectedRange())
        } else {
            super.paste(sender)
        }
    }

    override func insertNewline(_ sender: Any?) {
        if let commands, commands.handleNewline() { return }
        super.insertNewline(sender)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if window?.firstResponder === self, commands?.handleDocumentShortcut(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func deleteBackward(_ sender: Any?) {
        if let commands, commands.handleDeleteBackward() { return }
        super.deleteBackward(sender)
    }

    override func insertText(_ string: Any, replacementRange: NSRange) {
        if let typed = string as? String,
           typed == " ",
           replacementRange.location == NSNotFound || replacementRange.length == 0,
           let commands,
           commands.handleTypedSpace() {
            return
        }
        super.insertText(string, replacementRange: replacementRange)
    }

    override func draw(_ dirtyRect: NSRect) {
        drawQuotationBlocks(in: dirtyRect)
        super.draw(dirtyRect)
    }

    private func drawQuotationBlocks(in dirtyRect: NSRect) {
        guard let storage = textStorage,
              storage.length > 0,
              let layoutManager,
              let textContainer else { return }

        let origin = textContainerOrigin
        let containerWidth = textContainer.size.width
        let visibleGlyphs = layoutManager.glyphRange(forBoundingRect: dirtyRect.offsetBy(dx: -origin.x, dy: -origin.y), in: textContainer)
        let visibleCharacters = layoutManager.characterRange(forGlyphRange: visibleGlyphs, actualGlyphRange: nil)
        guard visibleCharacters.length > 0 else { return }
        storage.enumerateAttribute(.paragraphStyle, in: visibleCharacters) { value, range, _ in
            guard let style = value as? NSParagraphStyle, abs(style.headIndent - 34) < 0.5 else { return }
            let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphRange.length > 0 else { return }
            var top = CGFloat.greatestFiniteMagnitude
            var bottom = -CGFloat.greatestFiniteMagnitude
            layoutManager.enumerateLineFragments(forGlyphRange: glyphRange) { lineRect, _, _, _, _ in
                let viewRect = lineRect.offsetBy(dx: origin.x, dy: origin.y)
                top = min(top, viewRect.minY)
                bottom = max(bottom, viewRect.maxY)
            }
            guard top.isFinite, bottom.isFinite else { return }
            let block = NSRect(
                x: origin.x + 4,
                y: top - 5,
                width: max(0, containerWidth - 8),
                height: bottom - top + 10
            )
            guard block.intersects(dirtyRect) else { return }
            let isDark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            (isDark
                ? NSColor(calibratedRed: 0.16, green: 0.23, blue: 0.19, alpha: 1)
                : NSColor(calibratedRed: 0.94, green: 0.96, blue: 0.94, alpha: 1)).setFill()
            NSBezierPath(roundedRect: block, xRadius: 6, yRadius: 6).fill()
            (isDark
                ? NSColor(calibratedRed: 0.36, green: 0.66, blue: 0.48, alpha: 1)
                : NSColor(calibratedRed: 0.20, green: 0.48, blue: 0.34, alpha: 1)).setFill()
            NSBezierPath(roundedRect: NSRect(x: block.minX + 8, y: block.minY + 8, width: 3, height: max(0, block.height - 16)), xRadius: 1.5, yRadius: 1.5).fill()
        }
    }
}

struct RichTextEditor: NSViewRepresentable {
    @Binding var rtfData: Data?
    @Binding var modifiedAt: Date
    @ObservedObject var commands: EditorCommands
    var onCommit: (() throws -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = DocumentScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.allowsMagnification = true
        scrollView.minMagnification = 0.5
        scrollView.maxMagnification = 3

        let textView = QuotationTextView()
        textView.isRichText = true
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.textColor = .black
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = false
        textView.isAutomaticLinkDetectionEnabled = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        let bodyFont = NSFont(name: "Arial", size: EditorCommands.bodyPointSize)
        textView.font = bodyFont
        textView.defaultParagraphStyle = EditorCommands.bodyParagraphStyle()
        var typing = textView.typingAttributes
        if let bodyFont { typing[.font] = bodyFont }
        typing[.paragraphStyle] = EditorCommands.bodyParagraphStyle()
        typing[.pregarParagraphStyle] = DocumentParagraphStyle.normal.rawValue
        typing[.foregroundColor] = NSColor.black
        textView.typingAttributes = typing
        textView.textContainerInset = NSSize(width: 36, height: 36)
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        // O clip view muda de escala com o zoom. Autoresizing usa a largura física
        // anterior e deixa linhas fora da página; o scroll view controla a largura lógica.
        textView.autoresizingMask = []
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.lineFragmentPadding = 0
        textView.layoutManager?.allowsNonContiguousLayout = true
        textView.delegate = context.coordinator
        textView.commands = commands
        scrollView.documentView = textView
        commands.textView = textView
        commands.flushHandler = { [weak coordinator = context.coordinator, weak textView] in
            guard let textView else { return }
            textView.unmarkText()
            coordinator?.flush(to: textView)
        }
        context.coordinator.installLifecycleObservers(for: textView)
        context.coordinator.apply(rtfData, to: textView)
        scrollView.magnification = CGFloat(commands.zoomPercent) / 75
        return scrollView
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        if let textView = scrollView.documentView as? NSTextView {
            textView.unmarkText()
            coordinator.flush(to: textView)
            if coordinator.parent.commands.textView === textView {
                coordinator.parent.commands.flushHandler = nil
                coordinator.parent.commands.textView = nil
            }
        }
        coordinator.observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        commands.textView = textView
        (textView as? QuotationTextView)?.commands = commands
        context.coordinator.parent = self
        context.coordinator.apply(rtfData, to: textView)
        let magnification = CGFloat(commands.zoomPercent) / 75
        if abs(scrollView.magnification - magnification) > 0.001 {
            let visible = scrollView.documentVisibleRect
            scrollView.setMagnification(magnification, centeredAt: NSPoint(x: visible.midX, y: visible.midY))
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: RichTextEditor
        var observers: [NSObjectProtocol] = []
        private var lastAppliedData: Data?
        private var isApplyingProgrammaticChange = false
        private var hasAppliedDocument = false
        private var pendingSave: Task<Void, Never>?
        private var maximumSaveDelay: Task<Void, Never>?
        private var hasPendingEdits = false
        private var displayEditRange: NSRange?

        init(_ parent: RichTextEditor) {
            self.parent = parent
        }

        func apply(_ data: Data?, to textView: NSTextView) {
            guard !hasAppliedDocument || data != lastAppliedData else { return }
            // Uma restauração explícita substitui a edição atual; o eco do próprio salvamento
            // nunca reatribui o texto, preservando cursor, composição e histórico de desfazer.
            pendingSave?.cancel()
            maximumSaveDelay?.cancel()
            hasPendingEdits = false
            hasAppliedDocument = true
            lastAppliedData = data
            isApplyingProgrammaticChange = true
            defer { isApplyingProgrammaticChange = false }

            if let data, let content = try? DocumentRTF.decode(data) {
                textView.textStorage?.setAttributedString(content)
                Self.applyBodyRhythm(in: textView)
            } else if data == nil {
                textView.string = ""
            }
            (textView as? QuotationTextView)?.refreshDisplayColors()

            let commands = parent.commands
            Task { @MainActor [weak commands, weak textView] in
                guard let commands, let textView else { return }
                guard commands.textView == nil || commands.textView === textView else { return }
                commands.updateWordCount(from: textView.string)
                commands.setPendingChanges(false)
            }
        }

        /// Parágrafos gravados sem estilo explícito recebem o ritmo do corpo, para que texto
        /// antigo e texto novo leiam igual. Recuo, título e espaçamento existentes são preservados.
        private static func applyBodyRhythm(in textView: NSTextView) {
            guard let storage = textView.textStorage, storage.length > 0 else { return }
            let body = EditorCommands.bodyParagraphStyle()
            var ranges: [NSRange] = []
            storage.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
                if value == nil { ranges.append(range) }
            }
            guard !ranges.isEmpty else { return }
            storage.beginEditing()
            for range in ranges {
                storage.addAttribute(.paragraphStyle, value: body, range: range)
            }
            storage.endEditing()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard !isApplyingProgrammaticChange else { return }
            parent.commands.updateSelectionFormatting()
        }

        func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
            displayEditRange = NSRange(location: affectedCharRange.location, length: (replacementString as NSString?)?.length ?? affectedCharRange.length)
            return true
        }

        func textDidChange(_ notification: Notification) {
            guard !isApplyingProgrammaticChange else { return }
            guard let textView = notification.object as? NSTextView else { return }
            let selection = textView.selectedRange()
            let source = textView.string as NSString
            let safeSelection = NSIntersectionRange(selection, NSRange(location: 0, length: source.length))
            let fallback = source.paragraphRange(for: safeSelection)
            (textView as? QuotationTextView)?.refreshDisplayColors(in: displayEditRange ?? fallback)
            displayEditRange = nil
            hasPendingEdits = true
            parent.commands.updateEmptyState((textView.textStorage?.length ?? 0) == 0)
            parent.commands.setPendingChanges(true)
            pendingSave?.cancel()
            pendingSave = Task { @MainActor [weak self, weak textView] in
                do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                guard let self, let textView else { return }
                self.flush(to: textView)
            }
            if maximumSaveDelay == nil {
                maximumSaveDelay = Task { @MainActor [weak self, weak textView] in
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                    guard let self, let textView else { return }
                    self.flush(to: textView)
                }
            }
        }

        func textDidEndEditing(_ notification: Notification) {
            if let textView = notification.object as? NSTextView { flush(to: textView) }
        }

        func installLifecycleObservers(for textView: NSTextView) {
            for name in [NSApplication.willTerminateNotification, NSApplication.didResignActiveNotification, NSWindow.willCloseNotification, NSWindow.didResignKeyNotification] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self, weak textView] notification in
                    MainActor.assumeIsolated {
                        guard let self, let textView else { return }
                        if (name == NSWindow.willCloseNotification || name == NSWindow.didResignKeyNotification),
                           (notification.object as? NSWindow) !== textView.window { return }
                        textView.unmarkText()
                        self.flush(to: textView)
                    }
                })
            }
        }

        func flush(to textView: NSTextView) {
            pendingSave?.cancel()
            pendingSave = nil
            maximumSaveDelay?.cancel()
            maximumSaveDelay = nil
            guard hasPendingEdits, !isApplyingProgrammaticChange else { return }
            if textView.hasMarkedText() {
                pendingSave = Task { @MainActor [weak self, weak textView] in
                    do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
                    guard let self, let textView else { return }
                    self.flush(to: textView)
                }
                return
            }
            do {
                let data = try DocumentRTF.encode(textView.attributedString())
                lastAppliedData = data
                parent.rtfData = data
                parent.modifiedAt = .now
                try parent.onCommit?()
                hasPendingEdits = false
                if parent.commands.textView == nil || parent.commands.textView === textView {
                    parent.commands.updateWordCount(from: textView.string)
                    parent.commands.setPendingChanges(false)
                }
            } catch {
                parent.commands.setPendingChanges(true, error: error.localizedDescription)
            }
        }
    }
}

private final class DocumentScrollView: NSScrollView {
    private var isSizingDocument = false

    override var magnification: CGFloat {
        didSet { sizeDocumentToViewport() }
    }

    override func setMagnification(_ magnification: CGFloat, centeredAt point: NSPoint) {
        super.setMagnification(magnification, centeredAt: point)
        sizeDocumentToViewport()
    }

    override func tile() {
        super.tile()
        sizeDocumentToViewport()
    }

    private func sizeDocumentToViewport() {
        guard !isSizingDocument, let textView = documentView as? NSTextView else { return }
        let viewport = contentView.bounds.size
        guard viewport.width > 0, viewport.height > 0 else { return }
        isSizingDocument = true
        defer { isSizingDocument = false }
        let inset = max(24, min(72, viewport.width * 0.12))
        if abs(textView.textContainerInset.width - inset) > 0.5 {
            textView.textContainerInset = NSSize(width: inset, height: 36)
        }
        textView.minSize = NSSize(width: 0, height: viewport.height)
        if abs(textView.frame.width - viewport.width) > 0.5 || textView.frame.height < viewport.height {
            textView.setFrameSize(NSSize(width: viewport.width, height: max(viewport.height, textView.frame.height)))
        }
    }
}
