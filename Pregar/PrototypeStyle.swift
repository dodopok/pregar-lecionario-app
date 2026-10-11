import SwiftUI

/// Sistema visual do Pregar: paleta de papel, tipografia serifada para títulos e
/// escalas fixas de espaçamento, raio e altura de controle. Todas as telas usam
/// estes valores para que botões, cartões e cabeçalhos se alinhem entre janelas.
enum PrototypeStyle {
    static let canvas = Color(red: 0.961, green: 0.953, blue: 0.933)
    static let sidebar = Color(red: 0.925, green: 0.914, blue: 0.886)
    static let paper = Color(red: 0.984, green: 0.980, blue: 0.969)
    static let manuscript = Color(red: 1.000, green: 0.996, blue: 0.984)
    static let editorSurface = Color(red: 0.922, green: 0.910, blue: 0.882)
    static let ink = Color(red: 0.122, green: 0.114, blue: 0.098)
    static let green = Color(red: 0.180, green: 0.478, blue: 0.318)
    static let softGreen = Color(red: 0.890, green: 0.925, blue: 0.890)
    /// Texto secundário. Escurecido para manter contraste ≥ 4,5:1 sobre papel e tela,
    /// o mínimo WCAG AA para texto pequeno.
    static let muted = Color(red: 0.440, green: 0.430, blue: 0.405)
    static let line = Color(red: 0.122, green: 0.114, blue: 0.098).opacity(0.10)
    static let warning = Color(red: 0.72, green: 0.44, blue: 0.08)

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

@MainActor
final class AppAppearanceStore: ObservableObject {
    @Published var accent = PrototypeStyle.green
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
    func panelCard(padding: CGFloat = 14, background: Color = .white) -> some View {
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
                .background(.white, in: shape)
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
