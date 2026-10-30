import AppKit

enum DocumentParagraphStyle: String, CaseIterable, Identifiable {
    case normal, title, subtitle, heading1, heading2, heading3, heading4, heading5, heading6
    var id: String { rawValue }
    var title: String {
        switch self {
        case .normal: "Texto normal"
        case .title: "Título"
        case .subtitle: "Subtítulo"
        case .heading1: "Título 1"
        case .heading2: "Título 2"
        case .heading3: "Título 3"
        case .heading4: "Título 4"
        case .heading5: "Título 5"
        case .heading6: "Título 6"
        }
    }
    var level: Int {
        switch self {
        case .heading1: 1
        case .heading2: 2
        case .heading3: 3
        case .heading4: 4
        case .heading5: 5
        case .heading6: 6
        default: 0
        }
    }
    var pointSize: CGFloat {
        switch self {
        case .normal, .heading5, .heading6: 11
        case .title: 26
        case .subtitle: 15
        case .heading1: 20
        case .heading2: 16
        case .heading3: 14
        case .heading4: 12
        }
    }
}

enum DocumentListStyle: String, CaseIterable, Identifiable {
    case none, bullet, numbered, checklist
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: "Sem lista"
        case .bullet: "Lista com marcadores"
        case .numbered: "Lista numerada"
        case .checklist: "Lista de verificação"
        }
    }
    func marker(number: Int = 1) -> String {
        switch self {
        case .none: ""
        case .bullet: "• "
        case .numbered: "\(number). "
        case .checklist: "☐ "
        }
    }
    static func prefix(in text: String) -> (kind: Self, length: Int, number: Int)? {
        if text.hasPrefix("• ") { return (.bullet, 2, 0) }
        if text.hasPrefix("☐ ") || text.hasPrefix("☑ ") { return (.checklist, 2, 0) }
        if let range = text.range(of: #"^\d+\. "#, options: .regularExpression) {
            let marker = String(text[range])
            return (.numbered, (marker as NSString).length, Int(marker.dropLast(2)) ?? 1)
        }
        return nil
    }
}

@MainActor
extension EditorCommands {
    var canUndo: Bool { textView?.undoManager?.canUndo == true }
    var canRedo: Bool { textView?.undoManager?.canRedo == true }

    func focusDocument() { if let textView { textView.window?.makeFirstResponder(textView) } }
    func undo() { focusDocument(); textView?.undoManager?.undo(); updateAfterCommand() }
    func redo() { focusDocument(); textView?.undoManager?.redo(); updateAfterCommand() }
    func cut() { focusDocument(); textView?.cut(nil) }
    func copy() { textView?.copy(nil) }
    func paste() { focusDocument(); textView?.paste(nil) }
    func pasteWithoutFormatting() {
        guard let text = NSPasteboard.general.string(forType: .string), let textView else { return }
        focusDocument()
        textView.insertText(text, replacementRange: textView.selectedRange())
    }
    func selectAll() { focusDocument(); textView?.selectAll(nil) }
    func printDocument() { flushPendingEdits(); textView?.printView(nil) }
    func find(replacing: Bool = false) {
        focusDocument()
        let item = NSMenuItem()
        item.tag = replacing ? NSTextFinder.Action.showReplaceInterface.rawValue : NSTextFinder.Action.showFindInterface.rawValue
        textView?.performFindPanelAction(item)
    }

    private func updateAfterCommand() {
        (textView as? QuotationTextView)?.refreshDisplayColors()
        if let textView { updateWordCount(from: textView.string) }
        objectWillChange.send()
    }

    /// As mudanças de atributos precisam do mesmo desfazer/refazer confiável da digitação nativa.
    func registerFormattingUndo(_ name: String) {
        guard let textView, let manager = textView.undoManager else { return }
        let before = NSAttributedString(attributedString: textView.attributedString())
        let selection = textView.selectedRange()
        let typing = textView.typingAttributes
        manager.registerUndo(withTarget: textView) { [weak self] target in
            guard let self else { return }
            self.registerFormattingUndo(name)
            target.textStorage?.setAttributedString(before)
            target.setSelectedRange(NSIntersectionRange(selection, NSRange(location: 0, length: before.length)))
            target.typingAttributes = typing
            target.didChangeText()
            self.updateAfterCommand()
        }
        manager.setActionName(name)
    }

    func changeCharacterAttributes(_ name: String, attributes: [NSAttributedString.Key: Any], removing: [NSAttributedString.Key] = []) {
        guard let textView, let storage = textView.textStorage else { return }
        focusDocument()
        registerFormattingUndo(name)
        let selection = NSIntersectionRange(textView.selectedRange(), NSRange(location: 0, length: storage.length))
        if selection.length > 0 {
            storage.beginEditing()
            removing.forEach { storage.removeAttribute($0, range: selection) }
            storage.addAttributes(attributes, range: selection)
            storage.endEditing()
            textView.didChangeText()
        } else {
            var typing = textView.typingAttributes
            removing.forEach { typing.removeValue(forKey: $0) }
            attributes.forEach { typing[$0.key] = $0.value }
            textView.typingAttributes = typing
        }
        updateSelectionFormatting()
    }

    func underline() {
        changeCharacterAttributes("Sublinhado", attributes: [.underlineStyle: isUnderlineActive ? 0 : NSUnderlineStyle.single.rawValue])
    }
    func strikethrough() {
        changeCharacterAttributes("Tachado", attributes: [.strikethroughStyle: isStrikethroughActive ? 0 : NSUnderlineStyle.single.rawValue])
    }
    func setTextColor(_ color: NSColor?) {
        changeCharacterAttributes("Cor do texto", attributes: color.map { [.foregroundColor: $0] } ?? [:], removing: [.foregroundColor])
    }
    func setHighlightColor(_ color: NSColor?) {
        changeCharacterAttributes("Realce", attributes: color.map { [.backgroundColor: $0] } ?? [:], removing: [.backgroundColor])
    }
    func setScript(superscript: Bool) {
        let active = superscript ? isSuperscriptActive : isSubscriptActive
        changeCharacterAttributes(superscript ? "Sobrescrito" : "Subscrito", attributes: [.baselineOffset: active ? 0 : (superscript ? 4 : -3)])
    }
    func setLink(_ url: URL?) {
        changeCharacterAttributes("Link", attributes: url.map { [.link: $0] } ?? [:], removing: [.link])
    }

    private var linkEditingRange: NSRange {
        guard let textView, let storage = textView.textStorage else { return NSRange(location: 0, length: 0) }
        let selection = textView.selectedRange()
        if selection.length > 0 { return selection }
        if storage.length > 0 {
            var range = NSRange(location: 0, length: 0)
            if storage.attribute(.link, at: min(selection.location, storage.length - 1), effectiveRange: &range) != nil { return range }
        }
        return selection
    }

    var linkEditingText: String {
        guard let textView else { return "" }
        return (textView.string as NSString).substring(with: linkEditingRange)
    }

    func applyLink(_ url: URL?, displayText: String? = nil) {
        guard let textView, let storage = textView.textStorage else { return }
        let range = linkEditingRange
        let existing = (storage.string as NSString).substring(with: range)
        let display = displayText.flatMap { $0.isEmpty ? nil : $0 } ?? (existing.isEmpty ? url?.absoluteString ?? "" : existing)
        focusDocument()
        if range.length > 0, display == existing {
            let previous = textView.selectedRange()
            textView.setSelectedRange(range)
            setLink(url)
            textView.setSelectedRange(previous)
        } else if let url, !display.isEmpty {
            var attributes = textView.typingAttributes
            attributes[.link] = url
            attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
            attributes[.foregroundColor] = NSColor(srgbRed: 0.102, green: 0.451, blue: 0.910, alpha: 1)
            textView.insertText(NSAttributedString(string: display, attributes: attributes), replacementRange: range)
            textView.didChangeText()
        }
    }
    func copyFormatting() {
        guard let textView else { return }
        let selected = textView.selectedRange()
        let storage = textView.textStorage
        copiedFormatting = selected.length > 0 && (storage?.length ?? 0) > 0
            ? storage?.attributes(at: selected.location, effectiveRange: nil)
            : textView.typingAttributes
        copiedFormatting?.removeValue(forKey: .attachment)
        copiedFormatting?.removeValue(forKey: .link)
        objectWillChange.send()
    }
    func pasteFormatting() {
        guard let copiedFormatting else { return }
        changeCharacterAttributes("Colar formatação", attributes: copiedFormatting)
    }
    func clearFormatting() {
        changeCharacterAttributes("Limpar formatação", attributes: [
            .font: Self.bodyFont(family: "Arial"), .paragraphStyle: Self.bodyParagraphStyle(), .pregarParagraphStyle: DocumentParagraphStyle.normal.rawValue
        ], removing: [.font, .foregroundColor, .backgroundColor, .underlineStyle, .strikethroughStyle, .baselineOffset, .link, .paragraphStyle])
    }

    private func documentParagraphRanges() -> [NSRange] {
        guard let textView else { return [] }
        let source = textView.string as NSString
        let selected = textView.selectedRange()
        let safe = NSIntersectionRange(selected, NSRange(location: 0, length: source.length))
        let expanded = source.paragraphRange(for: safe)
        if expanded.length == 0 { return [expanded] }
        var result: [NSRange] = []
        var cursor = expanded.location
        while cursor < NSMaxRange(expanded) {
            let range = source.paragraphRange(for: NSRange(location: cursor, length: 0))
            guard range.length > 0 else { break }
            result.append(range)
            cursor = NSMaxRange(range)
        }
        return result
    }

    func changeParagraphs(_ name: String, change: (NSMutableParagraphStyle) -> Void) {
        guard let textView, let storage = textView.textStorage else { return }
        focusDocument()
        registerFormattingUndo(name)
        let ranges = documentParagraphRanges()
        storage.beginEditing()
        for range in ranges {
            let existing = range.location < storage.length
                ? storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle
                : textView.typingAttributes[.paragraphStyle] as? NSParagraphStyle
            let style = (existing?.mutableCopy() as? NSMutableParagraphStyle) ?? Self.bodyParagraphStyle()
            change(style)
            if range.length > 0 { storage.addAttribute(.paragraphStyle, value: style, range: range) }
            if textView.selectedRange().length == 0 { textView.typingAttributes[.paragraphStyle] = style }
        }
        storage.endEditing()
        if storage.length > 0 { textView.didChangeText() }
        updateSelectionFormatting()
    }

    func setAlignment(_ alignment: NSTextAlignment) { changeParagraphs("Alinhamento") { $0.alignment = alignment } }
    func setLineSpacing(_ multiple: Double) {
        guard multiple.isFinite, (0.5...5).contains(multiple) else { return }
        changeParagraphs("Espaçamento entre linhas") { $0.lineHeightMultiple = multiple }
    }
    func setParagraphSpacing(before: Double? = nil, after: Double? = nil) {
        guard [before, after].compactMap({ $0 }).allSatisfy(\.isFinite) else { return }
        changeParagraphs("Espaçamento entre parágrafos") {
            if let before { $0.paragraphSpacingBefore = min(400, max(0, before)) }
            if let after { $0.paragraphSpacing = min(400, max(0, after)) }
        }
    }
    func changeIndent(by delta: CGFloat) {
        changeParagraphs("Recuo do parágrafo") {
            $0.headIndent = max(0, $0.headIndent + delta)
            $0.firstLineHeadIndent = max(0, $0.firstLineHeadIndent + delta)
        }
    }
    func setParagraphStyle(_ style: DocumentParagraphStyle) {
        guard let textView, let storage = textView.textStorage else { return }
        focusDocument()
        registerFormattingUndo(style.title)
        let font = NSFontManager.shared.font(withFamily: selectedFontFamily, traits: [], weight: 5, size: style.pointSize)
            ?? NSFont(name: selectedFontFamily, size: style.pointSize) ?? NSFont.systemFont(ofSize: style.pointSize)
        let paragraph = Self.bodyParagraphStyle()
        paragraph.headerLevel = style.level
        paragraph.paragraphSpacingBefore = style.level > 0 ? 16 : 0
        paragraph.paragraphSpacing = style.level > 0 || style == .title || style == .subtitle ? 6 : 0
        var attributes: [NSAttributedString.Key: Any] = [.font: font, .paragraphStyle: paragraph, .pregarParagraphStyle: style.rawValue]
        if style == .subtitle { attributes[.foregroundColor] = NSColor(calibratedWhite: 0.4, alpha: 1) }
        storage.beginEditing()
        for range in documentParagraphRanges() where range.length > 0 {
            storage.removeAttribute(.foregroundColor, range: range)
            storage.removeAttribute(.backgroundColor, range: range)
            storage.addAttributes(attributes, range: range)
        }
        storage.endEditing()
        textView.typingAttributes = attributes
        if storage.length > 0 { textView.didChangeText() }
        updateSelectionFormatting()
    }

    func setListStyle(_ requested: DocumentListStyle) {
        guard let textView, let storage = textView.textStorage else { return }
        focusDocument()
        registerFormattingUndo(requested.title)
        let ranges = documentParagraphRanges()
        let source = storage.string as NSString
        let allMatch = ranges.allSatisfy { DocumentListStyle.prefix(in: source.substring(with: $0))?.kind == requested }
        let target: DocumentListStyle = allMatch ? .none : requested
        let selection = textView.selectedRange()
        var lengthChange = 0
        storage.beginEditing()
        for (number, range) in ranges.enumerated().reversed() {
            let prefixLength = DocumentListStyle.prefix(in: source.substring(with: range))?.length ?? 0
            let marker = target.marker(number: number + 1)
            var attributes = range.location < storage.length
                ? storage.attributes(at: range.location, effectiveRange: nil) : textView.typingAttributes
            attributes[.font] = attributes[.font] ?? Self.bodyFont(family: selectedFontFamily)
            storage.replaceCharacters(in: NSRange(location: range.location, length: prefixLength), with: NSAttributedString(string: marker, attributes: attributes))
            lengthChange += (marker as NSString).length - prefixLength
        }
        storage.endEditing()
        let newLength = selection.length == 0 ? 0 : max(0, selection.length + lengthChange)
        let location = selection.length == 0 ? max(0, selection.location + lengthChange) : selection.location
        textView.setSelectedRange(NSIntersectionRange(NSRange(location: location, length: newLength), NSRange(location: 0, length: storage.length)))
        textView.didChangeText()
        updateSelectionFormatting()
    }

    func updateDocumentFormatting() {
        guard let textView else { return }
        let selection = textView.selectedRange()
        let storage = textView.textStorage
        let position = min(selection.location, max(0, (storage?.length ?? 0) - 1))
        let stored = (storage?.length ?? 0) > 0 ? storage?.attributes(at: position, effectiveRange: nil) ?? [:] : [:]
        let attributes = selection.length == 0 ? textView.typingAttributes : stored
        let paragraph = (attributes[.paragraphStyle] ?? stored[.paragraphStyle]) as? NSParagraphStyle ?? Self.bodyParagraphStyle()
        let underline = ((attributes[.underlineStyle] as? NSNumber)?.intValue ?? 0) != 0
        let strike = ((attributes[.strikethroughStyle] as? NSNumber)?.intValue ?? 0) != 0
        let baseline = (attributes[.baselineOffset] as? NSNumber)?.doubleValue ?? 0
        if isUnderlineActive != underline { isUnderlineActive = underline }
        if isStrikethroughActive != strike { isStrikethroughActive = strike }
        if isSuperscriptActive != (baseline > 0) { isSuperscriptActive = baseline > 0 }
        if isSubscriptActive != (baseline < 0) { isSubscriptActive = baseline < 0 }
        if selectedAlignment != paragraph.alignment { selectedAlignment = paragraph.alignment }
        let spacing = paragraph.lineHeightMultiple > 0 ? Double(paragraph.lineHeightMultiple) : 1.15
        if selectedLineSpacing != spacing { selectedLineSpacing = spacing }
        if selectedSpaceBefore != Double(paragraph.paragraphSpacingBefore) { selectedSpaceBefore = Double(paragraph.paragraphSpacingBefore) }
        if selectedSpaceAfter != Double(paragraph.paragraphSpacing) { selectedSpaceAfter = Double(paragraph.paragraphSpacing) }
        let level = paragraph.headerLevel
        let semantic = ((attributes[.pregarParagraphStyle] ?? stored[.pregarParagraphStyle]) as? String).flatMap(DocumentParagraphStyle.init(rawValue:))
        let style = semantic ?? DocumentParagraphStyle.allCases.first { $0.level == level && level > 0 } ?? .normal
        if selectedParagraphStyle != style { selectedParagraphStyle = style }
        let heading = semantic.map { $0.level > 0 } ?? (level > 0 || ((stored[.font] as? NSFont).map(Self.isHeadingFont) ?? false))
        if isHeadingActive != heading { isHeadingActive = heading }
        let source = textView.string as NSString
        let range = source.paragraphRange(for: NSRange(location: min(selection.location, source.length), length: 0))
        let list = DocumentListStyle.prefix(in: source.substring(with: range))?.kind ?? .none
        if selectedList != list { selectedList = list }
    }

    /// Os atalhos de texto têm prioridade sobre os atalhos da Mesa enquanto o manuscrito tem foco.
    func handleDocumentShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        if flags == [.option], key == "/" { toolFinderHandler?(); return true }
        guard flags.contains(.command), !flags.contains(.control) else { return false }
        if flags == [.command, .option] {
            if key == "0" { setParagraphStyle(.normal); return true }
            if let level = Int(key), (1...6).contains(level), let style = DocumentParagraphStyle.allCases.first(where: { $0.level == level }) {
                setParagraphStyle(style); return true
            }
            switch key {
            case "c": copyFormatting()
            case "v": pasteFormatting()
            case "f": footnote()
            default: return false
            }
            return true
        }
        if flags == [.command, .shift] {
            switch key {
            case "z": redo()
            case "v": pasteWithoutFormatting()
            case "h": find(replacing: true)
            case "x": strikethrough()
            case "l": setAlignment(.left)
            case "e": setAlignment(.center)
            case "r": setAlignment(.right)
            case "j": setAlignment(.justified)
            case "7", "&": setListStyle(.numbered)
            case "8", "*": setListStyle(.bullet)
            case "9", "(": setListStyle(.checklist)
            case ".", ">": setFontSize(min(400, selectedFontSize + 1))
            case ",", "<": setFontSize(max(1, selectedFontSize - 1))
            case "+", "=": zoomPercent = min(200, zoomPercent + 10)
            default: return false
            }
            return true
        }
        guard flags == [.command] else { return false }
        switch key {
        case "b": bold()
        case "i": italic()
        case "u": underline()
        case "z": undo()
        case "y": redo()
        case "k": linkHandler?()
        case "f": find()
        case "s": flushPendingEdits()
        case "p": printDocument()
        case "\\": clearFormatting()
        case ".": setScript(superscript: true)
        case ",": setScript(superscript: false)
        case "]": changeIndent(by: 36)
        case "[": changeIndent(by: -36)
        case "/": shortcutsHandler?()
        case "0": zoomPercent = 100
        case "+", "=": zoomPercent = min(200, zoomPercent + 10)
        case "-": zoomPercent = max(50, zoomPercent - 10)
        default: return false
        }
        return true
    }
}
