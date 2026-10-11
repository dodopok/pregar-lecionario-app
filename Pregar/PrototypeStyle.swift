import AppKit
import SwiftUI

/// Sistema visual do Pregar: paleta de papel que vira tinta no modo escuro, tipografia serifada
/// para títulos e escalas fixas de espaçamento, raio e altura de controle. Todas as telas usam
/// estes valores para que botões, cartões e cabeçalhos se alinhem entre janelas e aparências.
enum PrototypeStyle {
    typealias RGB = (red: Double, green: Double, blue: Double)

    /// Cor que resolve conforme a aparência efetiva da janela (clara ou escura).
    static func adaptive(light: RGB, dark: RGB) -> Color {
        Color(nsColor: NSColor(name: nil, dynamicProvider: { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let value = isDark ? dark : light
            return NSColor(srgbRed: value.red, green: value.green, blue: value.blue, alpha: 1)
        }))
    }

    static let canvas = adaptive(light: (0.961, 0.953, 0.933), dark: (0.118, 0.114, 0.106))
    static let sidebar = adaptive(light: (0.925, 0.914, 0.886), dark: (0.098, 0.094, 0.088))
    static let paper = adaptive(light: (0.984, 0.980, 0.969), dark: (0.145, 0.141, 0.131))
    static let manuscript = adaptive(light: (1.000, 0.996, 0.984), dark: (0.165, 0.161, 0.150))
    static let editorSurface = adaptive(light: (0.922, 0.910, 0.882), dark: (0.102, 0.098, 0.090))
    /// Superfície de cartões e controles: branco sobre papel, tinta elevada no escuro.
    static let surface = adaptive(light: (1.0, 1.0, 1.0), dark: (0.196, 0.190, 0.178))
    static let ink = adaptive(light: (0.122, 0.114, 0.098), dark: (0.925, 0.914, 0.886))
    static let green = adaptive(light: (0.180, 0.478, 0.318), dark: (0.360, 0.660, 0.480))
    static let softGreen = adaptive(light: (0.890, 0.925, 0.890), dark: (0.170, 0.260, 0.200))
    /// Texto secundário com contraste ≥ 4,5:1 sobre papel e sobre tinta (WCAG AA para texto pequeno).
    static let muted = adaptive(light: (0.440, 0.430, 0.405), dark: (0.660, 0.650, 0.620))
    static let line = ink.opacity(0.10)
    static let warning = adaptive(light: (0.72, 0.44, 0.08), dark: (0.93, 0.66, 0.30))

    /// Fundo suave derivado do acento litúrgico, usado em estados selecionados/ativos.
    static func softAccent(_ accent: Color) -> Color {
        accent.opacity(0.14)
    }

    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    /// Escala de espaçamento em múltiplos de 4 pt.
    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
    }

    /// Raios de canto: controles pequenos, cartões e folhas.
    enum Radius {
        static let control: CGFloat = 6
        static let button: CGFloat = 8
        static let card: CGFloat = 10
        static let sheet: CGFloat = 12
    }

    /// Medidas de layout partilhadas pelas janelas.
    enum Layout {
        /// Recuo à esquerda que deixa livre a área dos controles da janela
        /// (fechar, minimizar, zoom) em janelas sem barra de título.
        static let windowControlsInset: CGFloat = 88
        static let headerHeight: CGFloat = 52
        static let iconButtonSize: CGFloat = 34
        static let controlHeight: CGFloat = 28
        static let compactControlHeight: CGFloat = 24
    }
}

/// Aparência escolhida pelo usuário. "Automático" segue o sistema.
enum AppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "Automático"
        case .light: "Claro"
        case .dark: "Escuro"
        }
    }

    var symbol: String {
        switch self {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max"
        case .dark: "moon"
        }
    }

    var nsAppearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

@MainActor
final class AppAppearanceStore: ObservableObject {
    static let modeKey = "pregar.appearance.mode"

    @Published var accent = PrototypeStyle.green
    /// Aplicada ao app inteiro (janelas, folhas e painéis do sistema) via `NSApplication.appearance`.
    @Published var mode: AppearanceMode {
        didSet {
            defaults.set(mode.rawValue, forKey: Self.modeKey)
            apply()
        }
    }
    private let defaults: UserDefaults

    init(defaults: UserDefaults = PregarRuntime.makeAppUserDefaults()) {
        self.defaults = defaults
        self.mode = AppearanceMode(rawValue: defaults.string(forKey: Self.modeKey) ?? "") ?? .system
        apply()
    }

    private func apply() {
        NSApplication.shared.appearance = mode.nsAppearance
    }
}

/// Alça vertical entre painéis. Arrastar altera `width` dentro de `range`; `growsTowardTrailing`
/// indica que o painel controlado está à esquerda da alça (cresce quando se arrasta para a direita).
struct PanelResizeHandle: View {
    @Binding var width: CGFloat
    let range: ClosedRange<CGFloat>
    var growsTowardTrailing = true
    var label = "Divisor de painéis"
    @State private var dragStart: CGFloat?

    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 9)
            .overlay { Rectangle().fill(PrototypeStyle.line).frame(width: 1) }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .onChanged { value in
                        let start = dragStart ?? width
                        if dragStart == nil { dragStart = start }
                        let delta = growsTowardTrailing ? value.translation.width : -value.translation.width
                        width = min(range.upperBound, max(range.lowerBound, start + delta))
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .onHover { hovering in
                if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityValue("\(Int(width)) pontos")
            .accessibilityAdjustableAction { direction in
                let delta: CGFloat = direction == .increment ? 20 : -20
                width = min(range.upperBound, max(range.lowerBound, width + delta))
            }
    }
}

// MARK: - Componentes de texto e superfície

/// Rótulo de seção em versalete: 10 pt, negrito, espaçado. Marca uma região
/// para quem usa leitor de tela e para quem apenas percorre a tela com os olhos.
struct SectionLabel: View {
    let title: String
    var color: Color = PrototypeStyle.muted

    init(_ title: String, color: Color = PrototypeStyle.muted) {
        self.title = title
        self.color = color
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .bold))
            .tracking(1)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Cabeçalho padrão das folhas: título serifado, subtítulo em uma frase e, opcionalmente,
/// um símbolo sobre fundo suave do acento.
struct SheetHeader: View {
    let title: String
    var subtitle: String? = nil
    var symbol: String? = nil
    var accent: Color = PrototypeStyle.green

    var body: some View {
        HStack(alignment: .top, spacing: PrototypeStyle.Spacing.md) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(accent)
                    .frame(width: 38, height: 38)
                    .background(PrototypeStyle.softAccent(accent), in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous))
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(PrototypeStyle.serif(22, weight: .semibold))
                    .foregroundStyle(PrototypeStyle.ink)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(PrototypeStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct PanelCardModifier: ViewModifier {
    let padding: CGFloat
    let background: Color

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(background, in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PrototypeStyle.Radius.card, style: .continuous)
                    .stroke(PrototypeStyle.line, lineWidth: 1)
            )
    }
}

extension View {
    /// Cartão branco com contorno fino, a superfície padrão para grupos de conteúdo em folhas e painéis.
    func panelCard(padding: CGFloat = 14, background: Color = PrototypeStyle.surface) -> some View {
        modifier(PanelCardModifier(padding: padding, background: background))
    }
}

// MARK: - Estilos de botão

/// Ação principal de uma tela ou folha: preenchida com o acento litúrgico, uma por contexto.
struct PrimaryActionButtonStyle: ButtonStyle {
    let accent: Color
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        PrimaryActionBody(configuration: configuration, accent: accent, compact: compact)
    }

    private struct PrimaryActionBody: View {
        let configuration: ButtonStyleConfiguration
        let accent: Color
        let compact: Bool
        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovering = false

        private var fillOpacity: Double {
            if configuration.isPressed { return 0.80 }
            return isHovering ? 0.90 : 1
        }

        var body: some View {
            configuration.label
                .font(.system(size: compact ? 11 : 12, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, compact ? 10 : 14)
                .frame(height: compact ? PrototypeStyle.Layout.compactControlHeight : 30)
                .background(
                    accent.opacity(fillOpacity),
                    in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous)
                )
                .contentShape(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous))
                .opacity(isEnabled ? 1 : 0.45)
                .onHover { hovering in isHovering = hovering }
                .animation(.easeOut(duration: 0.12), value: isHovering)
        }
    }
}

/// Ação secundária: superfície branca com contorno fino; convive ao lado da ação principal.
struct SecondaryActionButtonStyle: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        SecondaryActionBody(configuration: configuration, compact: compact)
    }

    private struct SecondaryActionBody: View {
        let configuration: ButtonStyleConfiguration
        let compact: Bool
        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovering = false

        private var overlayOpacity: Double {
            if configuration.isPressed { return 0.08 }
            return isHovering ? 0.04 : 0
        }

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: PrototypeStyle.Radius.button, style: .continuous)
            configuration.label
                .font(.system(size: compact ? 11 : 12, weight: .medium))
                .foregroundStyle(PrototypeStyle.ink)
                .lineLimit(1)
                .padding(.horizontal, compact ? 10 : 12)
                .frame(height: compact ? PrototypeStyle.Layout.compactControlHeight : PrototypeStyle.Layout.controlHeight)
                .background(PrototypeStyle.surface, in: shape)
                .overlay(shape.fill(PrototypeStyle.ink.opacity(overlayOpacity)))
                .overlay(shape.stroke(PrototypeStyle.line, lineWidth: 1))
                .contentShape(shape)
                .opacity(isEnabled ? 1 : 0.45)
                .onHover { hovering in isHovering = hovering }
                .animation(.easeOut(duration: 0.12), value: isHovering)
        }
    }
}

/// Ação em texto na cor do acento, para ações terciárias dentro de painéis e listas.
/// O realce se estende 6 pt além do texto, sem deslocar o alinhamento em repouso.
struct LinkButtonStyle: ButtonStyle {
    let accent: Color
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        LinkBody(configuration: configuration, accent: accent, compact: compact)
    }

    private struct LinkBody: View {
        let configuration: ButtonStyleConfiguration
        let accent: Color
        let compact: Bool
        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovering = false

        private var overlayOpacity: Double {
            if configuration.isPressed { return 0.18 }
            return isHovering ? 0.10 : 0
        }

        var body: some View {
            configuration.label
                .font(.system(size: compact ? 11 : 12, weight: .medium))
                .foregroundStyle(accent)
                .padding(.horizontal, 6)
                .frame(height: compact ? PrototypeStyle.Layout.compactControlHeight : 26)
                .background(
                    accent.opacity(overlayOpacity),
                    in: RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous)
                )
                .contentShape(RoundedRectangle(cornerRadius: PrototypeStyle.Radius.control, style: .continuous))
                .padding(.horizontal, -6)
                .opacity(isEnabled ? 1 : 0.45)
                .onHover { hovering in isHovering = hovering }
                .animation(.easeOut(duration: 0.12), value: isHovering)
        }
    }
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

extension ButtonStyle where Self == PrimaryActionButtonStyle {
    static func primaryAction(_ accent: Color, compact: Bool = false) -> PrimaryActionButtonStyle {
        PrimaryActionButtonStyle(accent: accent, compact: compact)
    }
}

extension ButtonStyle where Self == SecondaryActionButtonStyle {
    static var secondaryAction: SecondaryActionButtonStyle { SecondaryActionButtonStyle() }

    static func secondaryAction(compact: Bool) -> SecondaryActionButtonStyle {
        SecondaryActionButtonStyle(compact: compact)
    }
}

extension ButtonStyle where Self == LinkButtonStyle {
    static func linkAction(_ accent: Color, compact: Bool = false) -> LinkButtonStyle {
        LinkButtonStyle(accent: accent, compact: compact)
    }
}

extension ButtonStyle where Self == HoverHighlightButtonStyle {
    /// Realce suave ao passar o cursor; substitui `.plain` em botões de ícone e linhas de lista.
    static var hoverHighlight: HoverHighlightButtonStyle { HoverHighlightButtonStyle() }

    static func hoverHighlight(cornerRadius: CGFloat) -> HoverHighlightButtonStyle {
        HoverHighlightButtonStyle(cornerRadius: cornerRadius)
    }
}
