import AppKit
import SwiftUI

struct WindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async { configure(view.window) }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async { configure(view.window) }
    }

    private func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.styleMask.insert(.fullSizeContentView)
        window.toolbar = nil

        for type in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(type)?.isHidden = false
        }
    }
}

/// Pedidos de navegação dirigidos à Mesa de preparação a partir de outras janelas,
/// como abrir a preparação de uma data escolhida no Arquivo de sermões.
@MainActor
final class WorkspaceNavigationStore: ObservableObject {
    struct DateRequest: Equatable {
        let id: UUID
        let date: Date
    }

    @Published private(set) var dateRequest: DateRequest?
    weak var workspaceWindow: NSWindow?

    var isWorkspaceVisible: Bool {
        workspaceWindow?.isVisible ?? false
    }

    /// Pede à Mesa que mostre a preparação da data e traz a janela para a frente quando ela existe.
    func open(date: Date) {
        dateRequest = DateRequest(id: UUID(), date: Calendar.current.startOfDay(for: date))
        if let workspaceWindow, workspaceWindow.isVisible {
            workspaceWindow.makeKeyAndOrderFront(nil)
        }
    }

    func consumeDateRequest() -> Date? {
        guard let dateRequest else { return nil }
        self.dateRequest = nil
        return dateRequest.date
    }
}

/// Registra a janela que hospeda a Mesa para que outras janelas possam trazê-la à frente.
struct WorkspaceWindowRegistrar: NSViewRepresentable {
    let navigation: WorkspaceNavigationStore

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async { register(view.window) }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async { register(view.window) }
    }

    private func register(_ window: NSWindow?) {
        guard let window else { return }
        navigation.workspaceWindow = window
    }
}
