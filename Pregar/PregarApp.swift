import SwiftData
import SwiftUI

@main
struct PregarApp: App {
    private let sermonModelContainer: ModelContainer = {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: PregarRuntime.isIsolatedTestHost)
        return try! ModelContainer(for: SermonDraft.self, configurations: configuration)
    }()
    @StateObject private var settings = APISettingsStore()
    @StateObject private var aiSettings = AISettingsStore()
    @StateObject private var appearance = AppAppearanceStore()
    @StateObject private var readerSession = ReaderSessionStore(userDefaults: PregarRuntime.makeAppUserDefaults())
    @StateObject private var bibleSession = BibleWindowSession()
    @StateObject private var googleDrive = GoogleDriveStore()
    @StateObject private var navigation = WorkspaceNavigationStore()
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        WindowGroup(id: "workspace") {
            PreparationWorkspace()
                .environmentObject(settings)
                .environmentObject(aiSettings)
                .environmentObject(appearance)
                .environmentObject(readerSession)
                .environmentObject(bibleSession)
                .environmentObject(googleDrive)
                .environmentObject(navigation)
                .frame(minWidth: 1220, minHeight: 740)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
                .overlay(WorkspaceWindowRegistrar(navigation: navigation).frame(width: 0, height: 0))
        }
        .defaultSize(width: 1440, height: 900)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
        .modelContainer(sermonModelContainer)
        .commands {
            CommandGroup(replacing: .newItem) {}
            TextEditingCommands()
            CommandGroup(replacing: .appSettings) {
                Button("Preferências…") { openWindow(id: "preferences") }
                    .keyboardShortcut(",", modifiers: .command)
            }
            CommandMenu("Preparação") {
                Button("Bíblia", systemImage: "book.closed") { openWindow(id: "bible") }
                    .keyboardShortcut("1", modifiers: .command)
                Button("Leitor", systemImage: "doc.text") { openWindow(id: "reader") }
                    .keyboardShortcut("2", modifiers: .command)
                Button("Biblioteca de PDFs", systemImage: "books.vertical") { openWindow(id: "library") }
                    .keyboardShortcut("3", modifiers: .command)
                Button("Arquivo de sermões", systemImage: "archivebox") { openWindow(id: "archive") }
                    .keyboardShortcut("4", modifiers: .command)
                Divider()
                Button("Mesa de preparação", systemImage: "square.text.square") {
                    if navigation.isWorkspaceVisible, let window = navigation.workspaceWindow {
                        window.makeKeyAndOrderFront(nil)
                    } else {
                        openWindow(id: "workspace")
                    }
                }
                .keyboardShortcut("0", modifiers: .command)
            }
        }

        Window("Leitor", id: "reader") {
            ReaderWindowView()
                .environmentObject(readerSession)
                .environmentObject(appearance)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
        }
        .defaultSize(width: 1380, height: 860)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)

        Window("Bíblia", id: "bible") {
            BibleComparisonSceneView()
                .environmentObject(settings)
                .environmentObject(appearance)
                .environmentObject(bibleSession)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
        }
        .defaultSize(width: 1220, height: 820)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)

        Window("Biblioteca de PDFs", id: "library") {
            PDFLibraryView()
                .environmentObject(readerSession)
                .environmentObject(appearance)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
        }
        .defaultSize(width: 1320, height: 820)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)

        Window("Arquivo de sermões", id: "archive") {
            SermonArchiveView()
                .environmentObject(readerSession)
                .environmentObject(appearance)
                .environmentObject(navigation)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
        }
        .defaultSize(width: 1220, height: 760)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
        .modelContainer(sermonModelContainer)

        Window("Preferências", id: "preferences") {
            PreferencesSceneView()
                .environmentObject(settings)
                .environmentObject(aiSettings)
                .environmentObject(appearance)
                .environmentObject(readerSession)
                .overlay(WindowChromeConfigurator().frame(width: 0, height: 0))
        }
        .defaultSize(width: 1120, height: 820)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
        .modelContainer(sermonModelContainer)
    }
}
