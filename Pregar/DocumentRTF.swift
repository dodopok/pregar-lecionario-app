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
        let rtf = try encode(selected)
        let html = DocumentClipboardHTML.encode(selected)
        pasteboard.addTypes([.rtf, .html, .string], owner: nil)
        pasteboard.setData(rtf, forType: .rtf)
        pasteboard.setString(html, forType: .html)
        pasteboard.setString(selected.string, forType: .string)
    }
}

/// Editores web recebem HTML, não os metadados do RTF. Estilos inline e blocos
/// explícitos conservam a seleção quando o destino descarta o cabeçalho do HTML.
enum DocumentClipboardHTML {
    static func encode(_ text: NSAttributedString) -> String {
        let source = text.string as NSString
        var paragraphs: [String] = []
        var location = 0
        while location < source.length {
            var end = 0
            var contentsEnd = 0
            source.getParagraphStart(nil, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: location, length: 0))
            guard end > location else { break }
            let attributes = text.attributes(at: location, effectiveRange: nil)
            let range = NSRange(location: location, length: contentsEnd - location)
            var content = ""
            text.enumerateAttributes(in: range) { attributes, run, _ in
                let value = source.substring(with: run)
                var inline = escaped(value)
                    .replacingOccurrences(of: "\u{2028}", with: "<br>")
                    .replacingOccurrences(of: "\u{000B}", with: "<br>")
                if let link = safeLink(attributes[.link]) { inline = "<a href=\"\(escaped(link))\" style=\"color:inherit;text-decoration:inherit\">\(inline)</a>" }
                let baseline = (attributes[.baselineOffset] as? NSNumber)?.doubleValue ?? 0
                if baseline > 0 { inline = "<sup style=\"font-size:inherit\">\(inline)</sup>" }
                if baseline < 0 { inline = "<sub style=\"font-size:inherit\">\(inline)</sub>" }
                content += "<span style=\"\(escaped(characterCSS(attributes)))\">\(inline)</span>"
            }
            paragraphs.append(paragraph(content, attributes: attributes))
            location = end
        }
        if source.length == 0 || [10, 13, 0x2029].contains(Int(source.character(at: source.length - 1))) {
            let attributes = source.length > 0 ? text.attributes(at: source.length - 1, effectiveRange: nil) : [:]
            paragraphs.append(paragraph("", attributes: attributes))
        }
        return "<html><head><meta charset=\"utf-8\"></head><body><!--StartFragment--><div>\(paragraphs.joined())</div><!--EndFragment--></body></html>"
    }

    private static func paragraph(_ content: String, attributes: [NSAttributedString.Key: Any]) -> String {
        let style = attributes[.paragraphStyle] as? NSParagraphStyle ?? .default
        let semantic = (attributes[.pregarParagraphStyle] as? String).flatMap(DocumentParagraphStyle.init(rawValue:))
        let level = semantic?.level ?? style.headerLevel
        let tag = level > 0 ? "h\(min(6, level))" : "p"
        let font = attributes[.font] as? NSFont ?? NSFont(name: "Arial", size: 11)!
        var css = [
            fontCSS(font), "font-weight:normal", "font-style:normal", "white-space:pre-wrap",
            "margin-top:\(number(style.paragraphSpacingBefore))pt", "margin-bottom:\(number(style.paragraphSpacing))pt",
            "margin-left:\(number(style.headIndent))pt", "margin-right:\(number(max(0, -style.tailIndent)))pt",
            "text-indent:\(number(style.firstLineHeadIndent - style.headIndent))pt"
        ]
        switch style.alignment {
        case .left: css.append("text-align:left")
        case .center: css.append("text-align:center")
        case .right: css.append("text-align:right")
        case .justified: css.append("text-align:justify")
        default: css.append("text-align:start")
        }
        if style.baseWritingDirection == .rightToLeft { css.append("direction:rtl") }
        if style.lineHeightMultiple > 0 {
            css.append("line-height:\(number(style.lineHeightMultiple))")
        } else if style.minimumLineHeight > 0, style.minimumLineHeight == style.maximumLineHeight {
            css.append("line-height:\(number(style.minimumLineHeight))pt")
        }
        return "<\(tag) style=\"\(escaped(css.joined(separator: ";")))\">\(content.isEmpty ? "<br>" : content)</\(tag)>"
    }

    private static func characterCSS(_ attributes: [NSAttributedString.Key: Any]) -> String {
        let font = attributes[.font] as? NSFont ?? NSFont(name: "Arial", size: 11)!
        let traits = font.fontDescriptor.symbolicTraits
        var css = [fontCSS(font), "font-weight:\(traits.contains(.bold) ? "700" : "400")",
                   "font-style:\(traits.contains(.italic) ? "italic" : "normal")", "white-space:pre-wrap"]
        var decorations: [String] = []
        if ((attributes[.underlineStyle] as? NSNumber)?.intValue ?? 0) != 0 { decorations.append("underline") }
        if ((attributes[.strikethroughStyle] as? NSNumber)?.intValue ?? 0) != 0 { decorations.append("line-through") }
        css.append("text-decoration:\(decorations.isEmpty ? "none" : decorations.joined(separator: " "))")
        if let color = colorCSS(attributes[.foregroundColor] as? NSColor ?? .black) { css.append("color:\(color)") }
        if let color = colorCSS(attributes[.backgroundColor] as? NSColor) { css.append("background-color:\(color)") }
        if let kern = attributes[.kern] as? NSNumber { css.append("letter-spacing:\(number(kern.doubleValue))pt") }
        return css.joined(separator: ";")
    }

    private static func fontCSS(_ font: NSFont) -> String {
        let family = (font.familyName ?? "Arial").replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "font-family:\"\(family)\";font-size:\(number(font.pointSize))pt"
    }

    private static func colorCSS(_ color: NSColor?) -> String? {
        guard let color = color?.usingColorSpace(.sRGB) else { return nil }
        let rgb = [color.redComponent, color.greenComponent, color.blueComponent].map { Int((min(1, max(0, $0)) * 255).rounded()) }
        return "rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(number(color.alphaComponent)))"
    }

    private static func safeLink(_ value: Any?) -> String? {
        let string = (value as? URL)?.absoluteString ?? value as? String
        guard let string, let url = URL(string: string),
              ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url.absoluteString
    }

    private static func number(_ value: CGFloat) -> String {
        guard value.isFinite else { return "0" }
        let decimal = String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), Double(value))
        return decimal.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }

    private static func escaped(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}
