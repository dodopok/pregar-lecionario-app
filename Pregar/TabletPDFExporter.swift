import AppKit
import CoreText
import Foundation

enum TabletPDFExporter {
    enum ExportError: LocalizedError {
        case emptyManuscript
        case cannotCreatePDF
        case cannotLayOutText

        var errorDescription: String? {
            switch self {
            case .emptyManuscript: "O manuscrito está vazio."
            case .cannotCreatePDF: "Não foi possível criar o arquivo PDF."
            case .cannotLayOutText: "Não foi possível paginar o manuscrito."
            }
        }
    }

    static func makePDF(
        rtfData: Data,
        title: String,
        subtitle: String?,
        fontName: String,
        fontSize: CGFloat,
        includeFootnotes: Bool
    ) throws -> Data {
        let source = try NSAttributedString(
            data: rtfData,
            options: [.documentType: NSAttributedString.DocumentType.rtf],
            documentAttributes: nil
        )
        guard !source.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ExportError.emptyManuscript
        }

        let body = NSMutableAttributedString(attributedString: source)
        if !includeFootnotes { removeFootnoteParagraphs(from: body) }
        scaleFonts(in: body, family: fontName, baseSize: fontSize)

        let heading = NSMutableParagraphStyle()
        heading.paragraphSpacing = 3
        let titleSize = min(fontSize + 4, 28)
        let titleBase = NSFont(name: fontName, size: titleSize) ?? NSFont.systemFont(ofSize: titleSize)
        let titleFont = NSFontManager.shared.convert(titleBase, toHaveTrait: .boldFontMask)
        let headingString = NSMutableAttributedString(
            string: title.trimmingCharacters(in: .whitespacesAndNewlines) + "\n",
            attributes: [
                .font: titleFont,
                .paragraphStyle: heading
            ]
        )
        if let subtitle, !subtitle.isEmpty {
            headingString.append(NSAttributedString(string: subtitle + "\n\n", attributes: [
                .font: NSFont.systemFont(ofSize: max(9, fontSize - 3)),
                .foregroundColor: NSColor.secondaryLabelColor
            ]))
        } else {
            headingString.append(NSAttributedString(string: "\n"))
        }
        headingString.append(body)

        let temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("Pregar-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: temporaryURL) }

        var pageRect = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
        guard let context = CGContext(temporaryURL as CFURL, mediaBox: &pageRect, nil) else {
            throw ExportError.cannotCreatePDF
        }

        let attributedText = headingString as CFAttributedString
        let framesetter = CTFramesetterCreateWithAttributedString(attributedText)
        let inset: CGFloat = 48
        let textRect = CGRect(x: inset, y: inset, width: pageRect.width - inset * 2, height: pageRect.height - inset * 2)
        var currentRange = CFRange(location: 0, length: 0)
        var pageCount = 0

        while currentRange.location < headingString.length {
            context.beginPDFPage(nil)
            context.saveGState()
            context.translateBy(x: 0, y: pageRect.height)
            context.scaleBy(x: 1, y: -1)
            let path = CGPath(rect: textRect, transform: nil)
            let frame = CTFramesetterCreateFrame(framesetter, currentRange, path, nil)
            CTFrameDraw(frame, context)
            let visibleRange = CTFrameGetVisibleStringRange(frame)
            context.restoreGState()
            context.endPDFPage()

            guard visibleRange.length > 0 else { throw ExportError.cannotLayOutText }
            currentRange.location += visibleRange.length
            pageCount += 1
            guard pageCount <= 200 else { throw ExportError.cannotLayOutText }
        }

        context.closePDF()
        return try Data(contentsOf: temporaryURL)
    }

    private static func scaleFonts(in text: NSMutableAttributedString, family: String, baseSize: CGFloat) {
        let fullRange = NSRange(location: 0, length: text.length)
        var replacements: [(NSRange, NSFont)] = []
        text.enumerateAttribute(.font, in: fullRange) { value, range, _ in
            let original = value as? NSFont ?? NSFont.systemFont(ofSize: 10)
            let size = min(42, max(8, baseSize * original.pointSize / 10))
            let base = NSFont(name: family, size: size) ?? NSFont.systemFont(ofSize: size)
            replacements.append((range, NSFontManager.shared.convert(base, toHaveTrait: NSFontManager.shared.traits(of: original))))
        }
        for (range, font) in replacements { text.addAttribute(.font, value: font, range: range) }
    }

    private static func removeFootnoteParagraphs(from text: NSMutableAttributedString) {
        let source = text.string as NSString
        let superscriptDigits = CharacterSet(charactersIn: "⁰¹²³⁴⁵⁶⁷⁸⁹")
        var ranges: [NSRange] = []
        var location = 0
        while location < source.length {
            let paragraph = source.paragraphRange(for: NSRange(location: location, length: 0))
            let line = source.substring(with: paragraph).trimmingCharacters(in: .newlines)
            let prefix = String(line.prefix { character in
                character.unicodeScalars.allSatisfy(superscriptDigits.contains)
                    || character.isNumber && character.isASCII
            })
            let remainder = line.dropFirst(prefix.count)
            if !prefix.isEmpty,
               remainder.first == " ",
               source.substring(to: paragraph.location).contains(prefix) {
                ranges.append(paragraph)
                let earlierText = NSRange(location: 0, length: paragraph.location)
                let markerRange = source.range(of: prefix, options: [], range: earlierText)
                if markerRange.location != NSNotFound { ranges.append(markerRange) }
            }
            location = NSMaxRange(paragraph)
        }
        for range in ranges.sorted(by: { $0.location > $1.location }) {
            text.deleteCharacters(in: range)
        }
    }
}
