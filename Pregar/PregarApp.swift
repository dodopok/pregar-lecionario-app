import SwiftData
import SwiftUI

@main
struct PregarApp: App {
    @StateObject private var settings = APISettingsStore()
    @StateObject private var aiSettings = AISettingsStore()

    var body: some Scene {
        WindowGroup {
            PreparationWorkspace()
                .environmentObject(settings)
                .environmentObject(aiSettings)
                .frame(minWidth: 1040, minHeight: 700)
        }
        .modelContainer(for: SermonDraft.self)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
