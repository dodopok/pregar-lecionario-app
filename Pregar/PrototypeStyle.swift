import SwiftUI

enum PrototypeStyle {
    static let canvas = Color(red: 0.961, green: 0.953, blue: 0.933)
    static let sidebar = Color(red: 0.925, green: 0.914, blue: 0.886)
    static let paper = Color(red: 0.995, green: 0.992, blue: 0.980)
    static let ink = Color(red: 0.122, green: 0.114, blue: 0.098)
    static let green = Color(red: 0.180, green: 0.478, blue: 0.318)
    static let softGreen = Color(red: 0.906, green: 0.937, blue: 0.902)
    static let muted = Color(red: 0.510, green: 0.502, blue: 0.478)
    static let line = Color(red: 0.122, green: 0.114, blue: 0.098).opacity(0.10)

    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}
