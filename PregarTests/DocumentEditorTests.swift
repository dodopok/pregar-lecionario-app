import AppKit
import Combine
import SwiftData
import SwiftUI
import XCTest
@testable import Pregar

@MainActor
final class DocumentEditorTests: XCTestCase {
    func testTypingThroughTheWorkspaceStaysResponsiveWithAnImportedManuscript() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let container = try ModelContainer(for: SermonDraft.self, configurations: ModelConfiguration(url: directory.appendingPathComponent("test.store")))
        let draft = SermonDraft(liturgicalDate: .now)
        draft.title = "Manuscrito de teste"
        if let path = ProcessInfo.processInfo.environment["PREGAR_EDITOR_REPRODUCTION_RTF"] {
            draft.rtfData = try Data(contentsOf: URL(fileURLWithPath: path))
        } else {
            draft.rtfData = try rtf(String(repeating: "A escrita acompanha a leitura, com frases de tamanho variado e atenção aos detalhes. Este parágrafo ocupa mais de uma linha na página e mantém o texto dentro das margens.\n\n", count: 50))
        }
        container.mainContext.insert(draft)
        try container.mainContext.save()
        let defaults = PregarRuntime.makeAppUserDefaults()
        let root = PreparationWorkspace(revisionStore: SermonRevisionStore(directory: directory.appendingPathComponent("history")), reviewReportStore: SermonReviewReportStore(directory: directory.appendingPathComponent("review")))
            .modelContainer(container)
            .environmentObject(APISettingsStore())
            .environmentObject(AISettingsStore())
            .environmentObject(AppAppearanceStore())
            .environmentObject(BibleWindowSession())
            .environmentObject(GoogleDriveStore())
            .environmentObject(WorkspaceNavigationStore())
            .environmentObject(ReaderSessionStore(userDefaults: defaults))
            .defaultAppStorage(defaults)
        let hosting = NSHostingView(rootView: AnyView(root))
        let window = NSWindow(contentRect: NSRect(x: -10_000, y: -10_000, width: 1786, height: 960), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = hosting
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        hosting.layoutSubtreeIfNeeded()
        hosting.displayIfNeeded()
        try await Task.sleep(for: .milliseconds(800))
        hosting.layoutSubtreeIfNeeded()
        hosting.displayIfNeeded()
        func findEditor(in view: NSView) -> QuotationTextView? {
            if let editor = view as? QuotationTextView { return editor }
            for child in view.subviews { if let editor = findEditor(in: child) { return editor } }
            return nil
        }
        let editor = try XCTUnwrap(findEditor(in: hosting))
        let commands = try XCTUnwrap(editor.commands)
        window.makeFirstResponder(editor)
        editor.setSelectedRange(NSRange(location: (editor.string as NSString).length / 2, length: 0))
        hosting.layoutSubtreeIfNeeded()
        hosting.displayIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        var inputTimes: [Double] = []
        var frameTimes: [Double] = []
        var resumeTimes: [Double] = []
        for character in " Uma frase nova para testar a resposta do editor enquanto escrevo no meio de um documento existente." {
            let value = String(character)
            let event = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: value, charactersIgnoringModifiers: value, isARepeat: false, keyCode: 0))
            let start = Date.timeIntervalSinceReferenceDate
            window.sendEvent(event)
            inputTimes.append(Date.timeIntervalSinceReferenceDate - start)
            hosting.layoutSubtreeIfNeeded()
            hosting.displayIfNeeded()
            frameTimes.append(Date.timeIntervalSinceReferenceDate - start)
            let suspended = Date.timeIntervalSinceReferenceDate
            try await Task.sleep(for: .milliseconds(100))
            resumeTimes.append(max(0, Date.timeIntervalSinceReferenceDate - suspended - 0.1))
        }
        let saveStart = Date.timeIntervalSinceReferenceDate
        commands.flushPendingEdits()
        let saveDuration = Date.timeIntervalSinceReferenceDate - saveStart
        let inputs = inputTimes.sorted()
        let frames = frameTimes.sorted()
        let p95 = Int(Double(inputs.count - 1) * 0.95)
        let metrics = ["inputMedian": inputs[inputs.count / 2], "inputP95": inputs[p95], "inputMax": inputs.last!, "frameP95": frames[p95], "frameMax": frames.last!, "frameMaxIndex": Double(frameTimes.firstIndex(of: frames.last!)!), "mainActorDelayMax": resumeTimes.max()!, "saveDuration": saveDuration]
        print("Workspace typing timings: \(metrics)")
        if let output = ProcessInfo.processInfo.environment["PREGAR_EDITOR_CAPTURE_PATH"] {
            try JSONSerialization.data(withJSONObject: metrics, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: output).appendingPathComponent("workspace-typing.json"))
        }
        XCTAssertLessThan(inputs[p95], 0.05, "Native key events must not stall while the complete workspace is mounted.")
        XCTAssertLessThan(frames[p95], 0.05, "Typing and drawing the frame must fit within 50 ms.")
        XCTAssertLessThan(frames.last!, 0.1, "The first keystroke and autosave must not introduce a visible hitch.")
        XCTAssertLessThan(resumeTimes.max()!, 0.1, "Autosave and sidebar updates must not block the next key event.")
        XCTAssertTrue(editor.string.contains("Uma frase nova para testar"))
        // Desmonta o @Query enquanto seu ModelContainer ainda existe, inclusive
        // as tarefas de janela, antes de a próxima suíte salvar em outro contexto.
        hosting.rootView = AnyView(EmptyView())
        hosting.layoutSubtreeIfNeeded()
        window.contentView = nil
        window.close()
        try await Task.sleep(for: .milliseconds(100))
    }

    func testLongImportedDocumentWrapsInsideThePageAndRespondsWhileTyping() async throws {
        let container = try ModelContainer(for: SermonDraft.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let draft = SermonDraft(liturgicalDate: .now)
        draft.title = "Teste de manuscrito longo"
        if let path = ProcessInfo.processInfo.environment["PREGAR_EDITOR_REPRODUCTION_RTF"] {
            draft.rtfData = try Data(contentsOf: URL(fileURLWithPath: path))
        } else {
            let text = String(repeating: "Um parágrafo longo, com palavras suficientes para ocupar várias linhas e conferir a quebra dentro do papel. A edição precisa acompanhar a digitação, inclusive quando há trechos em itálico no meio do texto.\n\n", count: 40)
            let content = NSMutableAttributedString(string: text, attributes: [.font: NSFont(name: "Times New Roman", size: 12)!, .paragraphStyle: EditorCommands.bodyParagraphStyle()])
            let italic = NSFontManager.shared.convert(NSFont(name: "Times New Roman", size: 12)!, toHaveTrait: .italicFontMask)
            content.addAttribute(.font, value: italic, range: NSRange(location: 100, length: 60))
            draft.rtfData = try DocumentRTF.encode(content)
        }
        container.mainContext.insert(draft)
        let commands = EditorCommands()
        let root = ManuscriptEditorView(draft: draft, commands: commands, onCommit: { try container.mainContext.save() }, exportPDF: {}, showHistory: {}, toggleFocus: {}).tint(.orange)
        let hosting = NSHostingView(rootView: root)
        let window = NSWindow(contentRect: NSRect(x: -10_000, y: -10_000, width: 900, height: 780), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = hosting
        window.orderFront(nil)
        defer { window.close() }
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(200))
        let textView = try XCTUnwrap(commands.textView)
        let scroll = try XCTUnwrap(textView.enclosingScrollView)
        let original = textView.string
        for width in [900, 560, 1000] {
            window.setContentSize(NSSize(width: width, height: 780))
            for zoom in [100, 125, 75] {
                commands.zoomPercent = zoom
                hosting.layoutSubtreeIfNeeded()
                try await Task.sleep(for: .milliseconds(60))
                XCTAssertLessThanOrEqual(textView.frame.width, scroll.documentVisibleRect.width + 1, "Text must wrap inside the visible page at \(width) points and \(zoom)% zoom.")
            }
        }
        commands.zoomPercent = 100
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        window.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: (original as NSString).length / 2, length: 0))
        let insertion = textView.selectedRange().location
        var durations: [Double] = []
        let suffix = " Uma nova frase, com ação e atenção ao escrever."
        for character in suffix {
            let started = Date.timeIntervalSinceReferenceDate
            textView.insertText(String(character), replacementRange: textView.selectedRange())
            textView.displayIfNeeded()
            durations.append(Date.timeIntervalSinceReferenceDate - started)
            try await Task.sleep(for: .milliseconds(15))
        }
        let sorted = durations.sorted()
        print("Hosted editor input: median=\(sorted[sorted.count / 2])s, p95=\(sorted[Int(Double(sorted.count - 1) * 0.95)])s, max=\(sorted.last!)s")
        XCTAssertLessThan(sorted[Int(Double(sorted.count - 1) * 0.95)], 0.05)
        commands.flushPendingEdits()
        let expected = NSMutableString(string: original)
        expected.insert(suffix, at: insertion)
        XCTAssertEqual(try plainText(draft.rtfData), expected as String)
        if let directory = ProcessInfo.processInfo.environment["PREGAR_EDITOR_CAPTURE_PATH"], let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("editor-long-document.png"))
        }
    }

    func testTypingIsImmediateAndDoesNotSerializeRTFForEveryKeystroke() async throws {
        let harness = try EditorHarness(text: String(repeating: "Um texto para testar a edição.\n", count: 350))
        defer { harness.close() }
        await Task.yield()
        let suffix = " Agora escrevo sem interromper a digitação."
        let original = harness.textView.string
        let clock = ContinuousClock()
        let started = clock.now
        for letter in suffix {
            harness.type(String(letter))
        }
        print("Editor input burst (\(suffix.count) characters, long document): \(started.duration(to: clock.now))")
        XCTAssertEqual(harness.textView.string, original + suffix)
        XCTAssertEqual(harness.storage.writeCount, 0, "A key event must never serialize the entire manuscript.")
        XCTAssertTrue(harness.commands.hasPendingChanges)
        let selection = harness.textView.selectedRange()
        harness.commands.flushPendingEdits()
        XCTAssertEqual(harness.storage.writeCount, 1)
        XCTAssertEqual(try plainText(harness.storage.data), original + suffix)
        XCTAssertFalse(harness.commands.hasPendingChanges)
        harness.coordinator.apply(harness.storage.data, to: harness.textView)
        XCTAssertEqual(harness.textView.selectedRange(), selection, "The persistence echo must not reset the caret.")
    }

    func testAutomaticSaveCoalescesTypingAndKeepsUnicodeIntact() async throws {
        let harness = try EditorHarness(text: "")
        defer { harness.close() }
        await Task.yield()
        let saved = expectation(description: "Changes are saved after typing settles")
        saved.assertForOverFulfill = false
        harness.storage.onWrite = { saved.fulfill() }
        let text = "Bênção, ação e café. 👩🏽‍💻"
        for letter in text { harness.type(String(letter)) }
        XCTAssertFalse(harness.commands.isEmpty, "The placeholder disappears on the first letter, without waiting for autosave.")
        XCTAssertEqual(harness.storage.writeCount, 0)
        await fulfillment(of: [saved], timeout: 3)
        XCTAssertEqual(harness.storage.writeCount, 1)
        XCTAssertEqual(try plainText(harness.storage.data), text)
    }

    func testClosingTheEditorFlushesItsOwnDraftWithoutClearingTheNextEditor() throws {
        let commands = EditorCommands()
        let first = try EditorHarness(text: "Primeiro documento.", commands: commands)
        first.type(" Última palavra.")
        let second = try EditorHarness(text: "Segundo documento.", commands: commands)
        defer { second.close() }
        first.close()
        XCTAssertEqual(try plainText(first.storage.data), "Primeiro documento. Última palavra.")
        XCTAssertEqual(try plainText(second.storage.data), "Segundo documento.")
        XCTAssertTrue(commands.textView === second.textView)
        second.type(" Nova edição.")
        commands.flushPendingEdits()
        XCTAssertEqual(try plainText(second.storage.data), "Segundo documento. Nova edição.")
    }

    func testExplicitRestoreCancelsAnOlderPendingSave() async throws {
        let harness = try EditorHarness(text: "Original.")
        defer { harness.close() }
        harness.type(" Edição pendente.")
        let restored = try rtf("Versão restaurada.")
        harness.storage.data = restored
        harness.coordinator.apply(restored, to: harness.textView)
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(harness.textView.string, "Versão restaurada.")
        XCTAssertEqual(try plainText(harness.storage.data), "Versão restaurada.")
        XCTAssertEqual(harness.storage.writeCount, 0)
    }

    func testSustainedTypingStillSavesWithoutWaitingForAnIdlePause() async throws {
        let harness = try EditorHarness(text: "")
        defer { harness.close() }
        for _ in 0..<24 {
            harness.type("x")
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertGreaterThan(harness.storage.writeCount, 0, "Continuous typing must not postpone autosave indefinitely.")
        harness.commands.flushPendingEdits()
        XCTAssertEqual(try plainText(harness.storage.data), String(repeating: "x", count: 24))
    }

    func testComposedCharactersSurviveViewUpdatesAndExplicitSave() throws {
        let harness = try EditorHarness(text: "A")
        defer { harness.close() }
        harness.textView.setMarkedText("ã", selectedRange: NSRange(location: 1, length: 0), replacementRange: harness.textView.selectedRange())
        harness.textView.didChangeText()
        XCTAssertTrue(harness.textView.hasMarkedText())
        harness.coordinator.apply(harness.storage.data, to: harness.textView)
        XCTAssertTrue(harness.textView.hasMarkedText(), "A SwiftUI update must not reset accented input in progress.")
        harness.textView.unmarkText()
        harness.commands.flushPendingEdits()
        XCTAssertEqual(try plainText(harness.storage.data), "Aã")
    }

    func testMovingTheCaretDoesNotRepublishUnchangedFormatting() throws {
        let harness = try EditorHarness(text: "Um parágrafo de texto normal.")
        defer { harness.close() }
        harness.commands.updateWordCount(from: harness.textView.string)
        var publications = 0
        let observer = harness.commands.objectWillChange.sink { publications += 1 }
        for position in 0..<20 {
            harness.textView.setSelectedRange(NSRange(location: position, length: 0))
            harness.commands.updateSelectionFormatting()
        }
        XCTAssertEqual(publications, 0, "Typing and caret movement must not rebuild the workspace for identical formatting.")
        withExtendedLifetime(observer) {}
    }

    func testFormattingUndoAndRedoPreserveTextAndRTFStyles() throws {
        let harness = try EditorHarness(text: "Texto confiável.")
        defer { harness.close() }
        harness.textView.setSelectedRange(NSRange(location: 0, length: (harness.textView.string as NSString).length))
        harness.commands.underline()
        XCTAssertTrue(harness.commands.isUnderlineActive)
        harness.commands.undo()
        XCTAssertFalse(harness.commands.isUnderlineActive)
        XCTAssertEqual(harness.textView.string, "Texto confiável.")
        harness.commands.redo()
        XCTAssertTrue(harness.commands.isUnderlineActive)
        harness.commands.strikethrough()
        harness.commands.setLink(URL(string: "https://example.org/reference"))
        harness.commands.flushPendingEdits()
        let content = try GoogleDocsContent.fromRTF(XCTUnwrap(harness.storage.data))
        XCTAssertTrue(content.styles.contains { $0.underline && $0.strikethrough && $0.linkURL == "https://example.org/reference" })
    }

    func testParagraphFormattingSurvivesRTFAndGoogleDocsExport() throws {
        let harness = try EditorHarness(text: "Um título\nTexto do documento.\n")
        defer { harness.close() }
        let heading = (harness.textView.string as NSString).range(of: "Um título")
        harness.textView.setSelectedRange(heading)
        harness.commands.setParagraphStyle(.heading2)
        harness.commands.setAlignment(.center)
        harness.commands.setLineSpacing(1.5)
        harness.commands.setParagraphSpacing(before: 6, after: 8)
        harness.commands.flushPendingEdits()
        let data = try XCTUnwrap(harness.storage.data)
        let content = try GoogleDocsContent.fromRTF(data)
        let paragraph = try XCTUnwrap(content.paragraphs.first)
        XCTAssertEqual(paragraph.headingType, "HEADING_2")
        XCTAssertEqual(paragraph.alignment, "CENTER")
        XCTAssertEqual(try XCTUnwrap(paragraph.lineSpacing), 150, accuracy: 1)
        XCTAssertEqual(paragraph.spacingBefore, 6)
        XCTAssertEqual(paragraph.spacingAfter, 8)
        let batch = GoogleDriveAPI.batchUpdateBody(content: content, currentEndIndex: 2, requiredRevisionID: "test")
        let requests = try XCTUnwrap(batch["requests"] as? [[String: Any]])
        let styles = requests.compactMap { $0["updateParagraphStyle"] as? [String: Any] }.compactMap { $0["paragraphStyle"] as? [String: Any] }
        XCTAssertTrue(styles.contains { $0["alignment"] as? String == "CENTER" && ($0["lineSpacing"] as? Double ?? 0) > 149 })
    }

    func testListsHandleMultipleParagraphsAndContinueOnReturn() throws {
        let harness = try EditorHarness(text: "Primeiro\nSegundo\nTerceiro")
        defer { harness.close() }
        harness.textView.selectAll(nil)
        harness.commands.bulletedList()
        XCTAssertEqual(harness.textView.string, "• Primeiro\n• Segundo\n• Terceiro")
        harness.commands.setListStyle(.numbered)
        XCTAssertEqual(harness.textView.string, "1. Primeiro\n2. Segundo\n3. Terceiro")
        harness.textView.setSelectedRange(NSRange(location: (harness.textView.string as NSString).length, length: 0))
        harness.textView.insertNewline(nil)
        XCTAssertTrue(harness.textView.string.hasSuffix("\n4. "))
        harness.textView.insertNewline(nil)
        XCTAssertTrue(harness.textView.string.hasSuffix("\n"))
        XCTAssertFalse(harness.textView.string.hasSuffix("4. "))
    }

    func testAHeadingChosenBeforeTypingKeepsItsStyleAfterSaving() throws {
        let harness = try EditorHarness(text: "")
        defer { harness.close() }
        harness.commands.setParagraphStyle(.heading1)
        harness.type("Um título novo")
        harness.commands.flushPendingEdits()
        let content = try GoogleDocsContent.fromRTF(XCTUnwrap(harness.storage.data))
        XCTAssertEqual(content.paragraphs.first?.headingType, "HEADING_1")
        XCTAssertEqual(content.text, "Um título novo")
    }

    func testSemanticStylesPreserveIndependentParagraphFormattingAndUnicode() throws {
        let source = NSMutableAttributedString(string: "😀 Primeiro\nSegundo\nCorpo em negrito.")
        let text = source.string as NSString
        let first = text.paragraphRange(for: text.range(of: "Primeiro"))
        let second = text.paragraphRange(for: text.range(of: "Segundo"))
        let body = text.paragraphRange(for: text.range(of: "Corpo"))
        let centered = EditorCommands.bodyParagraphStyle()
        centered.alignment = .center
        let left = EditorCommands.bodyParagraphStyle()
        left.alignment = .left
        source.addAttributes([.font: NSFont(name: "Arial", size: 20)!, .pregarParagraphStyle: DocumentParagraphStyle.heading1.rawValue], range: NSUnionRange(first, second))
        source.addAttribute(.paragraphStyle, value: centered, range: first)
        source.addAttribute(.paragraphStyle, value: left, range: second)
        source.addAttributes([.font: NSFont.boldSystemFont(ofSize: 16), .pregarParagraphStyle: DocumentParagraphStyle.normal.rawValue], range: body)
        let restored = try DocumentRTF.decode(DocumentRTF.encode(source))
        XCTAssertEqual(restored.string, source.string)
        XCTAssertEqual((restored.attribute(.paragraphStyle, at: second.location, effectiveRange: nil) as? NSParagraphStyle)?.alignment, .left)
        XCTAssertEqual(restored.attribute(.pregarParagraphStyle, at: first.location, effectiveRange: nil) as? String, DocumentParagraphStyle.heading1.rawValue)
        let content = try GoogleDocsContent.fromRTF(DocumentRTF.encode(source))
        XCTAssertEqual(content.paragraphs.filter { $0.headingType == "HEADING_1" }.count, 2)
        XCTAssertFalse(content.paragraphs.contains { $0.range.location == body.location && $0.headingType != nil }, "Bold body text is not a heading.")
    }

    func testCopyingASelectionPreservesItsStylesWithoutUsingTheUserClipboard() throws {
        let harness = try EditorHarness(text: "Primeiro\nTítulo copiado")
        defer { harness.close() }
        let selected = (harness.textView.string as NSString).range(of: "Título copiado")
        harness.textView.setSelectedRange(selected)
        harness.commands.setParagraphStyle(.heading3)
        let clipboard = NSPasteboard.withUniqueName()
        defer { clipboard.releaseGlobally() }
        try DocumentRTF.copySelection(from: harness.textView, to: clipboard)
        let data = try XCTUnwrap(clipboard.data(forType: .rtf))
        let content = try GoogleDocsContent.fromRTF(data)
        XCTAssertEqual(content.text, "Título copiado")
        XCTAssertEqual(content.paragraphs.first?.headingType, "HEADING_3")
    }

    func testLinksCanBeInsertedEditedAndRemovedWithOnlyTheCaretInside() throws {
        let harness = try EditorHarness(text: "Referência: ")
        defer { harness.close() }
        harness.commands.applyLink(URL(string: "https://example.org/one"), displayText: "Fonte")
        XCTAssertEqual(harness.textView.string, "Referência: Fonte")
        let range = (harness.textView.string as NSString).range(of: "Fonte")
        harness.textView.setSelectedRange(NSRange(location: range.location + 2, length: 0))
        XCTAssertEqual(harness.commands.linkEditingText, "Fonte")
        harness.commands.applyLink(URL(string: "https://example.org/two"), displayText: "Fonte")
        harness.commands.flushPendingEdits()
        let linked = try GoogleDocsContent.fromRTF(XCTUnwrap(harness.storage.data))
        XCTAssertTrue(linked.styles.contains { $0.linkURL == "https://example.org/two" })
        harness.commands.applyLink(nil)
        harness.commands.flushPendingEdits()
        let unlinked = try GoogleDocsContent.fromRTF(XCTUnwrap(harness.storage.data))
        XCTAssertFalse(unlinked.styles.contains { $0.linkURL != nil })
        XCTAssertEqual(unlinked.text, "Referência: Fonte")
    }

    func testCustomSpacingAndFractionalFontSizeKeepTheirValues() throws {
        let harness = try EditorHarness(text: "Um parágrafo.")
        defer { harness.close() }
        harness.textView.selectAll(nil)
        harness.commands.setFontSize(12.5)
        harness.commands.setParagraphSpacing(before: 6, after: 8)
        harness.commands.setParagraphSpacing(after: 12)
        harness.commands.setLineSpacing(1.3)
        harness.commands.flushPendingEdits()
        let content = try GoogleDocsContent.fromRTF(XCTUnwrap(harness.storage.data))
        XCTAssertEqual(content.styles.first?.fontSize, 12.5)
        XCTAssertEqual(content.paragraphs.first?.spacingBefore, 6)
        XCTAssertEqual(content.paragraphs.first?.spacingAfter, 12)
        XCTAssertEqual(try XCTUnwrap(content.paragraphs.first?.lineSpacing), 130, accuracy: 1)
    }

    func testDarkQuoteDisplayDoesNotChangeTheStoredInk() throws {
        let harness = try EditorHarness(text: "Uma citação com várias palavras.")
        defer { harness.close() }
        harness.commands.quotation()
        let layout = try XCTUnwrap(harness.textView.layoutManager)
        let displayed = try XCTUnwrap(layout.temporaryAttribute(.foregroundColor, atCharacterIndex: 0, effectiveRange: nil) as? NSColor)
        var greenDifference: CGFloat = 0
        try XCTUnwrap(NSAppearance(named: .darkAqua)).performAsCurrentDrawingAppearance {
            if let rgb = displayed.usingColorSpace(.deviceRGB) { greenDifference = rgb.greenComponent - rgb.redComponent }
        }
        XCTAssertGreaterThan(greenDifference, 0.05, "The entire quote, including its first character, uses the readable display color.")
        let stored = try XCTUnwrap(harness.textView.textStorage?.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor)
        let original = try XCTUnwrap(EditorCommands.quoteForegroundColor.usingColorSpace(.deviceRGB))
        XCTAssertEqual(try XCTUnwrap(stored.usingColorSpace(.deviceRGB)).redComponent, original.redComponent, accuracy: 0.001)
    }

    func testDocsShortcutsFormatTheDocumentWhileTheEditorHasFocus() throws {
        let harness = try EditorHarness(text: "Um parágrafo.")
        defer { harness.close() }
        harness.window.makeFirstResponder(harness.textView)
        let centered = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.command, .shift], timestamp: 0, windowNumber: harness.window.windowNumber, context: nil, characters: "e", charactersIgnoringModifiers: "e", isARepeat: false, keyCode: 14))
        XCTAssertTrue(harness.textView.performKeyEquivalent(with: centered))
        XCTAssertEqual(harness.commands.selectedAlignment, .center)
        let heading = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.command, .option], timestamp: 0, windowNumber: harness.window.windowNumber, context: nil, characters: "1", charactersIgnoringModifiers: "1", isARepeat: false, keyCode: 18))
        XCTAssertTrue(harness.textView.performKeyEquivalent(with: heading))
        XCTAssertEqual(harness.commands.selectedParagraphStyle, .heading1)
    }

    func testDocumentViewRendersAtNarrowAndWideWidths() async throws {
        let container = try ModelContainer(for: SermonDraft.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let draft = SermonDraft(liturgicalDate: .now)
        draft.title = "Anotações para domingo"
        draft.mainReadingReference = "Salmo 34:1–10, 22"
        draft.rtfData = try rtf("Um texto, um foco\n\nEste é um documento de teste para conferir a tipografia, os espaços e a resposta do editor.\n\nA escrita permanece neste Mac, com os controles de formatação sempre à mão.\n\n• Primeira anotação\n• Segunda anotação\n")
        container.mainContext.insert(draft)
        let commands = EditorCommands()
        let root = ManuscriptEditorView(draft: draft, commands: commands, onCommit: { try container.mainContext.save() }, exportPDF: {}, showHistory: {}, toggleFocus: {})
        let hosting = NSHostingView(rootView: root)
        let window = NSWindow(contentRect: NSRect(x: -10_000, y: -10_000, width: 1000, height: 780), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = hosting
        window.orderFront(nil)
        defer { window.close() }
        for width in [1000, 560, 420] {
            window.setContentSize(NSSize(width: width, height: 780))
            hosting.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(150))
            XCTAssertLessThanOrEqual(hosting.bounds.width, CGFloat(width) + 1, "The toolbar must fit the workspace column instead of widening it.")
            XCTAssertNotNil(commands.textView)
            XCTAssertGreaterThan(commands.textView?.bounds.width ?? 0, 200)
            if let directory = ProcessInfo.processInfo.environment["PREGAR_EDITOR_CAPTURE_PATH"] {
                let destination = URL(fileURLWithPath: directory, isDirectory: true)
                try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
                    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                    if let png = bitmap.representation(using: .png, properties: [:]) { try png.write(to: destination.appendingPathComponent("editor-\(width).png")) }
                }
            }
        }
        if let directory = ProcessInfo.processInfo.environment["PREGAR_EDITOR_CAPTURE_PATH"] {
            window.appearance = NSAppearance(named: .darkAqua)
            window.setContentSize(NSSize(width: 1000, height: 780))
            hosting.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(200))
            if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) {
                hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                if let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent("editor-dark.png"))
                }
            }
        }
    }

    private func rtf(_ text: String) throws -> Data {
        let attributed = NSAttributedString(string: text, attributes: [.font: NSFont(name: "Arial", size: 11)!, .paragraphStyle: EditorCommands.bodyParagraphStyle()])
        return try attributed.data(from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
    }
    private func plainText(_ data: Data?) throws -> String {
        try NSAttributedString(data: XCTUnwrap(data), options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil).string
    }
}

@MainActor
private final class EditorHarness {
    final class Storage {
        var data: Data?
        var date = Date()
        var writeCount = 0
        var onWrite: (() -> Void)?
    }
    let storage: Storage
    let commands: EditorCommands
    let coordinator: RichTextEditor.Coordinator
    let textView: QuotationTextView
    let scrollView: NSScrollView
    let window: NSWindow
    init(text: String, commands suppliedCommands: EditorCommands? = nil) throws {
        let commands = suppliedCommands ?? EditorCommands()
        self.commands = commands
        let storage = Storage()
        self.storage = storage
        let attributed = NSAttributedString(string: text, attributes: [.font: NSFont(name: "Arial", size: 11)!, .paragraphStyle: EditorCommands.bodyParagraphStyle()])
        storage.data = try attributed.data(from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])
        let editor = RichTextEditor(rtfData: Binding(get: { storage.data }, set: { storage.data = $0; storage.writeCount += 1; storage.onWrite?() }), modifiedAt: Binding(get: { storage.date }, set: { storage.date = $0 }), commands: commands)
        let coordinator = editor.makeCoordinator()
        self.coordinator = coordinator
        let textView = QuotationTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 800))
        self.textView = textView
        textView.isRichText = true
        textView.allowsUndo = true
        textView.font = NSFont(name: "Arial", size: 11)
        textView.defaultParagraphStyle = EditorCommands.bodyParagraphStyle()
        textView.typingAttributes = [.font: NSFont(name: "Arial", size: 11)!, .paragraphStyle: EditorCommands.bodyParagraphStyle()]
        textView.commands = commands
        textView.delegate = coordinator
        commands.textView = textView
        commands.flushHandler = { [weak coordinator, weak textView] in if let textView { coordinator?.flush(to: textView) } }
        coordinator.apply(storage.data, to: textView)
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
        let scrollView = NSScrollView(frame: textView.frame)
        self.scrollView = scrollView
        scrollView.documentView = textView
        let window = NSWindow(contentRect: NSRect(x: -10_000, y: -10_000, width: 600, height: 800), styleMask: [.borderless], backing: .buffered, defer: false)
        self.window = window
        window.isReleasedWhenClosed = false
        window.contentView = scrollView
        window.orderFront(nil)
    }
    func type(_ text: String) {
        textView.insertText(text, replacementRange: textView.selectedRange())
        textView.didChangeText()
    }
    func close() {
        RichTextEditor.dismantleNSView(scrollView, coordinator: coordinator)
        window.close()
    }
}
