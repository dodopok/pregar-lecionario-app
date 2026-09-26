import SwiftUI

struct APISettingsView: View {
    @ObservedObject var store: APISettingsStore
    @Environment(\.dismiss) private var dismiss
    @State private var settings: APISettings
    @State private var enteredKey = ""
    @State private var isTesting = false
    @State private var resultMessage: String?
    @State private var testSucceeded = false

    init(store: APISettingsStore) {
        self.store = store
        _settings = State(initialValue: store.settings)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Estêvão API").font(.title2.weight(.semibold))
                    Text("A chave fica salva no Acesso às Chaves deste Mac.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Concluído") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(24)

            Form {
                Section("Conexão") {
                    LabeledContent("Servidor", value: "api.caminhoanglicano.com.br")
                    SecureField("Chave X-API-Key", text: $enteredKey, prompt: Text(store.hasAPIKey ? "Chave salva; deixe vazio para mantê-la" : "estevao_…"))
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Label(store.hasAPIKey ? "Chave salva neste Mac" : "Nenhuma chave salva", systemImage: store.hasAPIKey ? "key.fill" : "key")
                            .foregroundStyle(store.hasAPIKey ? .green : .secondary)
                        Spacer()
                        if store.hasAPIKey {
                            Button("Remover chave", role: .destructive, action: removeKey)
                                .buttonStyle(.link)
                        }
                    }
                }

                Section("Contexto litúrgico") {
                    TextField("Livro de oração", text: $settings.prayerBook)
                        .textFieldStyle(.roundedBorder)
                    Picker("Leituras dominicais", selection: $settings.readingType) {
                        Text("Padrão do LOC").tag("")
                        Text("Complementar").tag("complementary")
                        Text("Semicontínua").tag("semicontinuous")
                    }
                    Picker("Tradução principal", selection: $settings.bible) {
                        Text("NVT").tag("nvt")
                        Text("NVI").tag("nvi")
                        Text("NAA").tag("naa")
                        Text("ARA").tag("ara")
                    }
                    TextField("Idioma", text: $settings.language)
                        .textFieldStyle(.roundedBorder)
                }

                if let resultMessage {
                    Section {
                        Label(resultMessage, systemImage: testSucceeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(testSucceeded ? .green : .orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .formStyle(.grouped)
            .padding(.horizontal, 16)

            HStack {
                Text("A v2 exige uma chave pessoal da Estêvão API.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task { await saveAndTest() }
                } label: {
                    if isTesting { ProgressView().controlSize(.small) }
                    else { Label("Salvar e testar", systemImage: "arrow.trianglehead.2.clockwise") }
                }
                .disabled(isTesting)
            }
            .padding(24)
        }
        .frame(width: 610, height: 630)
    }

    @MainActor
    private func saveAndTest() async {
        isTesting = true
        resultMessage = nil
        do {
            try store.save(settings: settings, enteredKey: enteredKey)
            enteredKey = ""
            guard let key = store.credential else {
                throw LiturgicalAPIError(message: "Informe sua chave pessoal da Estêvão API para consultar a v2.")
            }
            let day = try await LiturgicalAPIClient(settings: settings, apiKey: key).fetchDay(.now)
            resultMessage = "Conectado. A API respondeu para \(day.date)."
            testSucceeded = true
        } catch {
            resultMessage = error.localizedDescription
            testSucceeded = false
        }
        isTesting = false
    }

    private func removeKey() {
        do {
            try store.removeKey()
            resultMessage = "Chave removida deste Mac."
            testSucceeded = true
        } catch {
            resultMessage = error.localizedDescription
            testSucceeded = false
        }
    }
}
