import SwiftUI

enum PrototypeStyle {
    static let canvas = Color(red: 0.961, green: 0.953, blue: 0.933)
    static let sidebar = Color(red: 0.925, green: 0.914, blue: 0.886)
    static let paper = Color(red: 0.984, green: 0.980, blue: 0.969)
    static let manuscript = Color(red: 1.000, green: 0.996, blue: 0.984)
    static let editorSurface = Color(red: 0.922, green: 0.910, blue: 0.882)
    static let ink = Color(red: 0.122, green: 0.114, blue: 0.098)
    static let green = Color(red: 0.180, green: 0.478, blue: 0.318)
    static let softGreen = Color(red: 0.890, green: 0.925, blue: 0.890)
    static let muted = Color(red: 0.510, green: 0.502, blue: 0.478)
    static let line = Color(red: 0.122, green: 0.114, blue: 0.098).opacity(0.10)

    /// Fundo suave derivado do acento litúrgico, usado em estados selecionados/ativos.
    static func softAccent(_ accent: Color) -> Color {
        accent.opacity(0.14)
    }

    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

@MainActor
final class AppAppearanceStore: ObservableObject {
    @Published var accent = PrototypeStyle.green
}

/// Estilo de botão discreto com resposta ao cursor e ao clique, para ações de ícone e linhas clicáveis.
/// Mantém o rótulo como está e desenha apenas um realce arredondado por trás dele.
struct HoverHighlightButtonStyle: ButtonStyle {
    var cornerRadius: CGFloat = 7
    var hoverOpacity: Double = 0.06
    var pressedOpacity: Double = 0.11

    func makeBody(configuration: Configuration) -> some View {
        HoverHighlightBody(
            configuration: configuration,
            cornerRadius: cornerRadius,
            hoverOpacity: hoverOpacity,
            pressedOpacity: pressedOpacity
        )
    }

    private struct HoverHighlightBody: View {
        let configuration: ButtonStyleConfiguration
        let cornerRadius: CGFloat
        let hoverOpacity: Double
        let pressedOpacity: Double
        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovering = false

        private var highlightOpacity: Double {
            guard isEnabled else { return 0 }
            if configuration.isPressed { return pressedOpacity }
            return isHovering ? hoverOpacity : 0
        }

        var body: some View {
            configuration.label
                .background(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(PrototypeStyle.ink.opacity(highlightOpacity))
                )
                .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .opacity(isEnabled ? 1 : 0.45)
                .onHover { hovering in
                    isHovering = hovering
                }
                .animation(.easeOut(duration: 0.12), value: isHovering)
        }
    }
}

extension ButtonStyle where Self == HoverHighlightButtonStyle {
    /// Realce suave ao passar o cursor; substitui `.plain` em botões de ícone e linhas de lista.
    static var hoverHighlight: HoverHighlightButtonStyle { HoverHighlightButtonStyle() }

    static func hoverHighlight(cornerRadius: CGFloat) -> HoverHighlightButtonStyle {
        HoverHighlightButtonStyle(cornerRadius: cornerRadius)
    }
}
