import AppKit

extension NSAttributedString.Key {
    static let pregarParagraphStyle = NSAttributedString.Key("br.caminhoanglicano.pregar.paragraph-style")
}

/// O RTF conserva a aparência, mas o AppKit descarta `headerLevel`. Os estilos semânticos
/// viajam nos metadados padrão de palavras-chave do próprio RTF, sem arquivo auxiliar.
enum DocumentRTF {
    private static let metadataPrefix = "PregarDocumentStyles.v1:"
    private struct StyleRun: Codable {
        let location: Int
        let length: Int
        let style: String
    }

    static func encode(_ text: NSAttributedString) throws -> Data {
        let range = NSRange(location: 0, length: text.length)
        var styles: [StyleRun] = []
        text.enumerateAttributes(in: range) { attributes, range, _ in
            let explicit = (attributes[.pregarParagraphStyle] as? String).flatMap(DocumentParagraphStyle.init(rawValue:))
            let level = (attributes[.paragraphStyle] as? NSParagraphStyle)?.headerLevel ?? 0
            guard let style = explicit ?? DocumentParagraphStyle.allCases.first(where: { level > 0 && $0.level == level }) else { return }
            if let previous = styles.last, previous.style == style.rawValue,
               previous.location + previous.length == range.location {
                styles[styles.count - 1] = StyleRun(location: previous.location, length: previous.length + range.length, style: previous.style)
            } else {
                styles.append(StyleRun(location: range.location, length: range.length, style: style.rawValue))
            }
        }
        var attributes: [NSAttributedString.DocumentAttributeKey: Any] = [.documentType: NSAttributedString.DocumentType.rtf]
        if !styles.isEmpty {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let payload = try encoder.encode(styles).base64EncodedString()
            attributes[.keywords] = [metadataPrefix + payload]
        }
        return try text.data(from: range, documentAttributes: attributes)
    }

    static func decode(_ data: Data) throws -> NSAttributedString {
        var documentAttributes: NSDictionary?
        let text = try NSMutableAttributedString(
            data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: &documentAttributes
        )
        let keywords = documentAttributes?[NSAttributedString.DocumentAttributeKey.keywords] as? [String] ?? []
        guard let metadata = keywords.first(where: { $0.hasPrefix(metadataPrefix) }),
              metadata.utf8.count <= 1_000_000,
              let payload = Data(base64Encoded: String(metadata.dropFirst(metadataPrefix.count))),
              let styles = try? JSONDecoder().decode([StyleRun].self, from: payload), styles.count <= 20_000 else { return text }
        for style in styles {
            guard style.location >= 0, style.length > 0, style.location <= text.length,
                  style.length <= text.length - style.location,
                  DocumentParagraphStyle(rawValue: style.style) != nil else { continue }
            text.addAttribute(.pregarParagraphStyle, value: style.style, range: NSRange(location: style.location, length: style.length))
        }
        return text
    }

    static func copySelection(from textView: NSTextView, to pasteboard: NSPasteboard) throws {
        let selection = textView.selectedRange()
        guard selection.length > 0 else { return }
        let selected = textView.attributedString().attributedSubstring(from: selection)
        pasteboard.addTypes([.rtf, .string], owner: nil)
        pasteboard.setData(try encode(selected), forType: .rtf)
        pasteboard.setString(selected.string, forType: .string)
    }
}
