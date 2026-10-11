# Pregar

App nativo para macOS, de uso pessoal, para preparar sermões: calendário do LOC 2027 com as leituras do dia, Bíblia comparativa, editor de manuscrito em texto rico, biblioteca de comentários em PDF, leitor de PDFs e sites, revisão por IA com chaves próprias (BYOK), modo ensaio e cópia para o tablet via PDF ou Google Docs.

O propósito, as decisões de produto e o referencial homilético estão em [docs/plano-produto.md](docs/plano-produto.md). O que já existe, com limites e pendências de verificação, está em [docs/progresso.md](docs/progresso.md).

## Requisitos

| Item | Versão |
| --- | --- |
| macOS | 14 (Sonoma) ou mais recente |
| Xcode | 15 ou mais recente (Swift 5.9) |
| XcodeGen | opcional, só para regenerar o projeto a partir de `project.yml` |

Não há dependências externas: o projeto usa apenas SwiftUI, AppKit, SwiftData, PDFKit, WebKit e Vision.

## Subir o app

1. Clone o repositório e abra `Pregar.xcodeproj` no Xcode.
2. Escolha o scheme **Pregar** e o destino **My Mac**.
3. Ajuste a assinatura, se necessário. O projeto vem com assinatura manual no time `R573HPN65Q`. Se você não pertence a esse time, em *Signing & Capabilities* troque para *Automatically manage signing* e selecione o seu. Mantenha a mesma identidade entre builds: o app guarda chaves no Acesso às Chaves, e uma identidade diferente faz o macOS pedir autorização de novo.
4. Pressione ⌘R.

Pela linha de comando, na raiz do repositório:

```sh
xcodebuild -project Pregar.xcodeproj -scheme Pregar -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build build
open build/Build/Products/Debug/Pregar.app
```

Para compilar com outro time sem editar o projeto, acrescente `CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=SEU_TEAM` ao fim do comando.

Se alterar `project.yml` (novos arquivos, targets ou configurações), regenere o projeto antes de abrir:

```sh
brew install xcodegen   # uma vez
xcodegen generate
```

O `project.pbxproj` lista os arquivos-fonte explicitamente. Um arquivo Swift novo só entra na build depois de regenerar o projeto ou de adicioná-lo pelo Xcode.

## Configurar na primeira abertura

Tudo fica em **Preferências** (⌘,), numa barra lateral com seis seções.

- **Estêvão API.** O app consome `https://api.caminhoanglicano.com.br` (host fixo) para calendário, leituras, coletas e textos bíblicos. Cole a chave da API; ela fica no Acesso às Chaves. Livro de oração (LOC 2027 por padrão), idioma e tradução principal (NVT) são preferências locais.
- **Inteligência artificial.** Chaves próprias de OpenAI, Anthropic, Google e Perplexity, também no Acesso às Chaves, e a escolha de provedor e modelo para revisão e para pesquisa de materiais. Nada é enviado sem um comando explícito. Detalhes em [docs/ia-byok.md](docs/ia-byok.md).
- **Aparência.** Automático, claro ou escuro, para todas as janelas. A cor de acento segue a cor litúrgica do dia.
- **Tablet.** Tipografia e formato da cópia de leitura.
- **Biblioteca.** Pasta dos PDFs e backup/restauração local de tudo o que o app guarda.
- **Fontes.** Sites e autores favoritos consultados por passagem.

Google Drive é opcional e fica dentro da própria preparação (folha Tablet e aba Ideias). Exige um OAuth Client ID de app para desktop criado no Google Cloud; o passo a passo está em [docs/google-drive-setup.md](docs/google-drive-setup.md). A importação de uma pasta pública do Drive para a Biblioteca usa uma chave de API da Drive API, separada do OAuth.

## Testar

A suíte fica no target **PregarTests** e roda dentro do app (test host). No Xcode, com o scheme **Pregar** selecionado, pressione ⌘U. Pela linha de comando:

```sh
xcodebuild test -project Pregar.xcodeproj -scheme Pregar \
  -destination 'platform=macOS' -derivedDataPath build
```

Para rodar uma classe ou um teste só:

```sh
xcodebuild test -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' \
  -only-testing:PregarTests/SermonReviewTests
xcodebuild test -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' \
  -only-testing:PregarTests/SermonReviewTests/testStructureMapIsValidatedAgainstTheManuscriptAndSuggestionLanguage
```

Quando o processo detecta que está hospedando testes, ele se isola do seu uso real: UserDefaults em um suite temporário, SwiftData em memória, nenhuma chave lida do Acesso às Chaves e nenhuma consulta de rede automática. Os testes padrão são determinísticos e passam sem chaves nem internet.

Três provas de integração são opcionais e ficam desligadas por padrão. Cada uma precisa de uma variável de ambiente e, nos casos de IA, da chave salva nas Preferências. Elas usam apenas passagens públicas ou texto sintético, nunca um manuscrito real.

| Variável | O que ativa |
| --- | --- |
| `PREGAR_LIVE_SITE_TESTS=1` | Consulta real aos sites favoritos com uma referência pública |
| `PREGAR_LIVE_ANTHROPIC_TEST=1` | Uma revisão real com a chave Anthropic salva e texto sintético |
| `PREGAR_LIVE_PERPLEXITY_TEST=1` | Uma pesquisa real com a chave Perplexity salva |

No Xcode, defina a variável em *Edit Scheme › Test › Arguments › Environment Variables*. Na linha de comando, o `xcodebuild` só repassa ao processo de teste variáveis com o prefixo `TEST_RUNNER_`:

```sh
TEST_RUNNER_PREGAR_LIVE_SITE_TESTS=1 xcodebuild test -project Pregar.xcodeproj \
  -scheme Pregar -destination 'platform=macOS' -only-testing:PregarTests/FavoriteSiteSearchTests
```

## Atalhos

| Atalho | Ação |
| --- | --- |
| ⌘0 · ⌘1 · ⌘2 · ⌘3 · ⌘4 | Mesa · Bíblia · Leitor · Biblioteca · Arquivo |
| ⌘, | Preferências |
| ⌥⌘1 · ⌥⌘2 · ⌥⌘3 | Mostrar ou ocultar calendário, leituras e materiais |
| ⇧⌘F | Modo de escrita (só o manuscrito) |
| ⇧⌘R · ⇧⌘E · ⇧⌘T · ⇧⌘H | Revisar · Ensaio · Tablet · Histórico de versões |
| ⌘B · ⌘I | Negrito · Itálico |
| ⇧⌘1 · ⇧⌘. · ⇧⌘8 · ⌥⌘N | Título · Citação em bloco · Lista · Nota de rodapé |
| `# `, `> `, `- ` no início da linha | Título, citação e lista enquanto digita |
| ⌘F | Localizar no manuscrito |

Os painéis da Mesa são redimensionáveis pelas alças entre eles; as larguras ficam guardadas entre sessões.

## Onde os dados ficam

- **Manuscritos** em SwiftData, no armazenamento padrão do app, em RTF. Esse RTF é a fonte das exportações: título em negrito ≥ 13 pt, citação com recuo de 34 pt, lista com marcador "• " e nota em sobrescrito.
- **Biblioteca, índices de PDF, histórico de versões, relatórios de revisão e sessão do Leitor** em `~/Library/Application Support/Pregar`. Os PDFs importados continuam nos caminhos originais; os baixados de pasta pública do Drive ficam numa subpasta própria.
- **Chaves** (Estêvão API, provedores de IA, refresh token do Google, chave da Drive API) no Acesso às Chaves do macOS.
- **Preferências** em UserDefaults.

Preferências › Biblioteca cria e restaura um backup local de tudo isso, exceto as chaves.

## Estrutura do repositório

```
Pregar/                 fontes do app (um target, sem subpastas)
  PregarApp.swift         cenas, janelas, menus e atalhos globais
  PreparationWorkspace    Mesa: calendário, leituras, editor, materiais
  WorkspaceChrome         painéis da Mesa, mapa do sermão, barra flutuante
  WorkspaceSheets         folhas: Bíblia, revisão, perguntas, Drive, tablet, ensaio
  RichTextEditor          NSTextView com os comandos e atalhos de escrita
  SermonReview            critérios, prompt, esquema estruturado e validação local
  LiturgicalAPI           cliente da Estêvão API v2
  PDFLibraryIndex         importação, bookmarks, cabeçalhos e OCR
  ReaderSession           janela do Leitor (PDFs e sites)
  LibraryArchiveViews     janelas Biblioteca e Arquivo
  GoogleDrive             OAuth, Docs e pasta pública
  PrototypeStyle          sistema de design: cores adaptativas, escalas e estilos
PregarTests/            XCTest, hospedado no app
docs/                   plano de produto, progresso, IA BYOK, Google Drive, análises
project.yml             fonte do projeto para o XcodeGen
```

## Convenções

- Interface e documentação em português do Brasil.
- Cores, espaçamentos, raios e estilos de botão vêm de `PrototypeStyle`; não use `.bordered`, cores literais nem `preferredColorScheme`.
- A IA aponta e fundamenta, nunca escreve ou sugere frases. Toda resposta é validada contra trechos literais do manuscrito antes de aparecer.
- Mudanças de comportamento entram em `docs/progresso.md`, com o que ficou pendente de verificação.
