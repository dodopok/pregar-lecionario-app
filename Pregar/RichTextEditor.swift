import AppKit
import SwiftUI

@MainActor
final class EditorCommands: ObservableObject {
    weak var textView: NSTextView?

    func bold() { toggleFontTrait(.boldFontMask) }
    func italic() { toggleFontTrait(.italicFontMask) }

    func heading() {
        styleSelection { _ in
            NSFont(name: "Arial-BoldMT", size: 14) ?? NSFont.boldSystemFont(ofSize: 14)
        }
    }

    func quotation() {
        guard let textView, let storage = textView.textStorage else { return }
        let range = paragraphRange(in: textView)
        let style = (storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        style.headIndent = 22
        style.firstLineHeadIndent = 22
        style.tailIndent = -12
        storage.addAttribute(.paragraphStyle, value: style, range: range)
    }

    func bulletedList() {
        guard let textView, let storage = textView.textStorage else { return }
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

    private func styleSelection(_ font: (NSFont) -> NSFont) {
        guard let textView, let storage = textView.textStorage else { return }
        let range = paragraphRange(in: textView)
        let current = storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont ?? NSFont.systemFont(ofSize: 10)
        storage.addAttribute(.font, value: font(current), range: range)
        textView.didChangeText()
    }

    private func toggleFontTrait(_ trait: NSFontTraitMask) {
        guard let textView, let storage = textView.textStorage else { return }
        let manager = NSFontManager.shared
        let selection = textView.selectedRange()
        let current = textView.typingAttributes[.font] as? NSFont ?? textView.font ?? NSFont.systemFont(ofSize: 10)
        let shouldEnable = !manager.traits(of: current).contains(trait)
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
    }

    private func paragraphRange(in textView: NSTextView) -> NSRange {
        let source = textView.string as NSString
        let selection = textView.selectedRange()
        let location = min(selection.location, max(source.length - 1, 0))
        return source.length == 0 ? NSRange(location: 0, length: 0) : source.paragraphRange(for: NSRange(location: location, length: selection.length))
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

        let textView = NSTextView()
        textView.isRichText = true
        textView.allowsUndo = true
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

        init(_ parent: RichTextEditor) {
            self.parent = parent
        }

        func apply(_ data: Data?, to textView: NSTextView) {
            guard data != lastAppliedData else { return }
            if let data, let content = try? NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.rtf],
                documentAttributes: nil
            ) {
                textView.textStorage?.setAttributedString(content)
            } else if data == nil {
                textView.string = ""
            }
            lastAppliedData = data
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
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
