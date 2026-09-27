import SwiftData
import SwiftUI

@main
struct PregarApp: App {
    @StateObject private var settings = APISettingsStore()
    @StateObject private var aiSettings = AISettingsStore()
    @StateObject private var appearance = AppAppearanceStore()

    var body: some Scene {
        WindowGroup {
            PreparationWorkspace()
                .environmentObject(settings)
                .environmentObject(aiSettings)
                .environmentObject(appearance)
                .frame(minWidth: 1220, minHeight: 740)
        }
        .defaultSize(width: 1600, height: 980)
        .windowResizability(.contentMinSize)
        .modelContainer(for: SermonDraft.self)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }

        Window("Preferências", id: "preferences") {
            PreferencesSceneView()
                .environmentObject(settings)
                .environmentObject(aiSettings)
                .environmentObject(appearance)
        }
        .defaultSize(width: 1120, height: 900)
        .windowResizability(.contentMinSize)
    }
}
