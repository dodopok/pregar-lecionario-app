import SwiftData
import SwiftUI

@main
struct PregarApp: App {
    @StateObject private var settings = APISettingsStore()

    var body: some Scene {
        WindowGroup {
            PreparationWorkspace()
                .environmentObject(settings)
                .frame(minWidth: 1040, minHeight: 700)
        }
        .modelContainer(for: SermonDraft.self)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
