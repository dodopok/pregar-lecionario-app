import AppKit
import SwiftUI

@MainActor
final class EditorCommands: ObservableObject {
    @Published private(set) var wordCount = 0
    @Published private(set) var isEmpty = true
    @Published private(set) var selectedFontFamily = "Arial"
    @Published private(set) var selectedFontSize = 10
    @Published private(set) var isBoldActive = false
    @Published private(set) var isItalicActive = false
    @Published private(set) var isHeadingActive = false
    @Published private(set) var isQuoteActive = false
    @Published private(set) var isListActive = false
    static let fontFamilies = ["Arial", "Georgia", "Times New Roman", "Helvetica", "Avenir"]
    static let fontSizes = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36]
    weak var textView: NSTextView?

    func updateWordCount(from text: String) {
        let updatedWordCount = text.split(whereSeparator: \.isWhitespace).count
        if wordCount != updatedWordCount { wordCount = updatedWordCount }
        if isEmpty != text.isEmpty { isEmpty = text.isEmpty }
        updateSelectionFormatting()
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

    func bold() { toggleFontTrait(.boldFontMask) }
    func italic() { toggleFontTrait(.italicFontMask) }

    func heading() {
        focusTextView()
        styleSelection { _ in
            NSFont(name: "Arial-BoldMT", size: 14) ?? NSFont.boldSystemFont(ofSize: 14)
        }
    }

    func quotation() {
        guard let textView, let storage = textView.textStorage else { return }
        let ranges = paragraphRanges(in: textView)
        guard !ranges.isEmpty, storage.length > 0 else { return }
        textView.window?.makeFirstResponder(textView)
        let shouldRemove = ranges.allSatisfy { isQuoted($0, in: storage) }
        storage.beginEditing()
        for range in ranges {
            let style = (storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
            if shouldRemove {
                style.headIndent = 0
                style.firstLineHeadIndent = 0
                style.tailIndent = 0
                style.paragraphSpacingBefore = 0
                style.paragraphSpacing = 0
                storage.removeAttribute(.foregroundColor, range: range)
                storage.removeAttribute(.backgroundColor, range: range)
            } else {
                style.headIndent = 34
                style.firstLineHeadIndent = 34
                style.tailIndent = -12
                style.paragraphSpacingBefore = 11
                style.paragraphSpacing = 12
                storage.addAttribute(.foregroundColor, value: NSColor(calibratedRed: 0.17, green: 0.32, blue: 0.24, alpha: 1), range: range)
                storage.addAttribute(.backgroundColor, value: NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.91, alpha: 1), range: range)
            }
            storage.addAttribute(.paragraphStyle, value: style, range: range)
        }
        storage.endEditing()
        textView.didChangeText()
        updateSelectionFormatting()
    }

    func setFontFamily(_ family: String) {
        applyFontChange { font in
            let manager = NSFontManager.shared
            var updated = NSFont(name: family, size: font.pointSize) ?? font
            for trait in [NSFontTraitMask.boldFontMask, .italicFontMask] where manager.traits(of: font).contains(trait) {
                updated = manager.convert(updated, toHaveTrait: trait)
            }
            return updated
        }
    }

    func setFontSize(_ size: Int) {
        applyFontChange { $0.withSize(CGFloat(size)) }
    }

    func bulletedList() {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        let range = paragraphRange(in: textView)
        let source = textView.string as NSString
        var lineStart = range.location
        let end = NSMaxRange(range)
        storage.beginEditing()
        while lineStart < end {
            let lineRange = source.paragraphRange(for: NSRange(location: lineStart, length: 0))
            let hasMarker = source.substring(with: NSRange(location: lineRange.location, length: min(2, lineRange.length))) == "• "
            if hasMarker {
                storage.deleteCharacters(in: NSRange(location: lineRange.location, length: 2))
            } else {
                storage.insert(NSAttributedString(string: "• "), at: lineRange.location)
            }
            lineStart = NSMaxRange(lineRange)
        }
        storage.endEditing()
        textView.didChangeText()
    }

    func footnote() {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
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

    private func styleSelection(_ font: (NSFont) -> NSFont) {
        guard let textView, let storage = textView.textStorage else { return }
        focusTextView()
        let range = paragraphRange(in: textView)
        let current = storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont ?? NSFont.systemFont(ofSize: 10)
        storage.addAttribute(.font, value: font(current), range: range)
        textView.didChangeText()
        updateSelectionFormatting()
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
            return
        }

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
            isBoldActive = hasTrait(.boldFontMask, in: safeSelection, textView: textView, storage: storage, fallback: font)
            isItalicActive = hasTrait(.italicFontMask, in: safeSelection, textView: textView, storage: storage, fallback: font)
            isHeadingActive = font.pointSize >= 13 && NSFontManager.shared.traits(of: font).contains(.boldFontMask)
        } else {
            isBoldActive = false
            isItalicActive = false
            isHeadingActive = false
        }
        let paragraphRanges = paragraphRanges(in: textView)
        isQuoteActive = !paragraphRanges.isEmpty && paragraphRanges.allSatisfy { range in
            guard let storage, storage.length > 0 else { return false }
            return isQuoted(range, in: storage)
        }
        isListActive = !paragraphRanges.isEmpty && paragraphRanges.allSatisfy { range in
            guard let storage, range.location < storage.length else { return false }
            let prefixLength = min(2, range.length)
            return (storage.string as NSString).substring(with: NSRange(location: range.location, length: prefixLength)) == "• "
        }
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
        return style.headIndent >= 20
    }

    private func focusTextView() {
        guard let textView else { return }
        textView.window?.makeFirstResponder(textView)
    }

    private func paragraphRange(in textView: NSTextView) -> NSRange {
        let source = textView.string as NSString
        let selection = textView.selectedRange()
        let location = min(selection.location, max(source.length - 1, 0))
        return source.length == 0 ? NSRange(location: 0, length: 0) : source.paragraphRange(for: NSRange(location: location, length: selection.length))
    }

    private func paragraphRanges(in textView: NSTextView) -> [NSRange] {
        let source = textView.string as NSString
        guard source.length > 0 else { return [] }
        let selection = textView.selectedRange()
        let start = min(selection.location, source.length - 1)
        let expanded = source.paragraphRange(for: NSRange(location: start, length: selection.length))
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

@MainActor
final class QuotationTextView: NSTextView {
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
        storage.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            guard let style = value as? NSParagraphStyle, style.headIndent >= 20 else { return }
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
            NSColor(calibratedRed: 0.94, green: 0.96, blue: 0.94, alpha: 1).setFill()
            NSBezierPath(roundedRect: block, xRadius: 6, yRadius: 6).fill()
            NSColor(calibratedRed: 0.20, green: 0.48, blue: 0.34, alpha: 1).setFill()
            NSBezierPath(roundedRect: NSRect(x: block.minX + 8, y: block.minY + 8, width: 3, height: max(0, block.height - 16)), xRadius: 1.5, yRadius: 1.5).fill()
        }
    }
}

struct RichTextEditor: NSViewRepresentable {
    @Binding var rtfData: Data?
    @Binding var modifiedAt: Date
    @ObservedObject var commands: EditorCommands

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false

        let textView = QuotationTextView()
        textView.isRichText = true
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.font = NSFont(name: "Arial", size: 10)
        textView.textContainerInset = NSSize(width: 24, height: 22)
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.delegate = context.coordinator
        scrollView.documentView = textView
        commands.textView = textView
        context.coordinator.apply(rtfData, to: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        commands.textView = textView
        context.coordinator.parent = self
        context.coordinator.apply(rtfData, to: textView)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: RichTextEditor
        private var lastAppliedData: Data?
        private var isApplyingProgrammaticChange = false

        init(_ parent: RichTextEditor) {
            self.parent = parent
        }

        func apply(_ data: Data?, to textView: NSTextView) {
            guard data != lastAppliedData else { return }
            lastAppliedData = data
            isApplyingProgrammaticChange = true
            defer { isApplyingProgrammaticChange = false }

            if let data, let content = try? NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.rtf],
                documentAttributes: nil
            ) {
                textView.textStorage?.setAttributedString(content)
            } else if data == nil {
                textView.string = ""
            }

            let commands = parent.commands
            Task { @MainActor [weak commands, weak textView] in
                guard let commands, let textView else { return }
                commands.updateWordCount(from: textView.string)
            }
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard !isApplyingProgrammaticChange else { return }
            parent.commands.updateSelectionFormatting()
        }

        func textDidChange(_ notification: Notification) {
            guard !isApplyingProgrammaticChange else { return }
            guard let textView = notification.object as? NSTextView else { return }
            parent.commands.updateWordCount(from: textView.string)
            let range = NSRange(location: 0, length: textView.textStorage?.length ?? 0)
            guard let data = try? textView.attributedString().data(
                from: range,
                documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
            ) else { return }
            lastAppliedData = data
            parent.rtfData = data
            parent.modifiedAt = .now
        }
    }
}
