# Pregar

App para preparar sermões no Windows, macOS e Linux: calendário do LOC 2027 com as leituras do dia, Bíblia comparativa, editor de manuscrito em texto rico, biblioteca de comentários em PDF, leitor de PDFs e sites, revisão por IA, modo ensaio e cópia para o tablet via PDF ou Google Docs.

Há dois jeitos de usar:

| | Gratuito | Pro (assinatura Pix) |
| --- | --- | --- |
| Conta | Não precisa | Login por código no email |
| Leituras e Bíblia | Com a sua chave da Estêvão API | Pela API do Pregar, sem chave |
| Revisão, perguntas e pesquisa por IA | Com as suas chaves (OpenAI, Anthropic, Google, Perplexity) | Pela API do Pregar, sem chave, com limites mensais |
| Manuscritos | Só no computador | Só no computador (a API não guarda manuscritos) |

O assinante pode continuar usando as próprias chaves se preferir (Preferências › Inteligência artificial). Limites, preço e cobrança estão em [docs/assinatura-pix.md](docs/assinatura-pix.md).

O propósito e o referencial homilético estão em [docs/plano-produto.md](docs/plano-produto.md). O plano da versão multiplataforma, com as decisões de arquitetura, está em [docs/plano-multiplataforma.md](docs/plano-multiplataforma.md). O que já existe e o que falta verificar está em [docs/progresso.md](docs/progresso.md).

## Estrutura do repositório

```
packages/core/      domínio em TypeScript, sem dependência de plataforma: referências bíblicas,
                    calendário e cliente da Estêvão API, revisão por IA (prompt, esquema, validação),
                    perguntas, pesquisa, fontes favoritas, biblioteca, histórico, backup, contrato da API
packages/editor/    modelo do documento (TipTap), conversões RTF ⇄ documento, exportações
apps/desktop/       app Electron + Vue 3
  src/main/           processo principal: janelas, menus, IPC, SQLite, segredos, módulos (IA, conteúdo,
                      biblioteca, leitor), atualização automática
  src/preload/        ponte mínima e tipada entre a interface e o processo principal
  src/renderer/       interface: Mesa, Bíblia, Leitor, Biblioteca, Arquivo, Preferências, boas-vindas
  test/e2e/           testes ponta a ponta com Playwright sobre o app compilado
apps/api/           API do Pregar (Fastify + PostgreSQL), publicada na Railway
  src/modules/        auth (código por email), conta (LGPD), cobrança (Asaas Pix), IA, Estêvão, admin
docs/               produto, plano, operação da API, cobrança, release, análises
Pregar/, PregarTests/   app legado para macOS em Swift (veja o fim deste arquivo)
```

## Requisitos

| Item | Versão |
| --- | --- |
| Node.js | 22.13 ou mais recente (o app usa o Node 24 embutido no Electron) |
| npm | 10 ou mais recente |
| PostgreSQL | 16, só para rodar a API e os testes dela |
| Docker | opcional, para testar a imagem da API |

## Rodar em desenvolvimento

```sh
npm ci
npm run dev:desktop
```

Sem conta, o app funciona no modo gratuito: cole a chave da Estêvão API na tela de boas-vindas ou em Preferências.

Para testar a assinatura localmente, suba a API e aponte o app para ela:

```sh
docker run -d --name pregar-db -e POSTGRES_USER=pregar -e POSTGRES_PASSWORD=pregar \
  -e POSTGRES_DB=pregar -p 5432:5432 postgres:16
cp apps/api/.env.example apps/api/.env
# no .env: NODE_ENV=development, DATABASE_URL=postgres://pregar:pregar@127.0.0.1:5432/pregar
# e AUTH_SECRET=$(openssl rand -base64 48)
npm run migrate:dev -w @pregar/api
npm run dev:api
MAIN_VITE_PREGAR_API_URL=http://127.0.0.1:3000 npm run dev:desktop
```

Sem `RESEND_API_KEY`, o código de login aparece no log da API (só fora de produção). Sem `ASAAS_API_KEY`, o checkout responde que a cobrança não está configurada; use `npm run admin -w @pregar/api -- grant email@exemplo.com 30` para liberar o plano a uma conta de teste.

Variáveis do app (em `apps/desktop/.env` ou no ambiente do build):

| Variável | Uso |
| --- | --- |
| `MAIN_VITE_PREGAR_API_URL` | Endereço da API (padrão: o de produção) |
| `MAIN_VITE_GOOGLE_CLIENT_ID`, `MAIN_VITE_GOOGLE_CLIENT_SECRET` | Cliente OAuth "App para computador" do Google Drive ([docs/google-drive-setup.md](docs/google-drive-setup.md)) |
| `MAIN_VITE_DRIVE_API_KEY` | Chave da Drive API para importar pastas públicas (opcional) |

## Testar

```sh
npm run verify   # tudo de uma vez, como o CI: lint, tipos, testes, build e roteiros

# ou por partes:
npm run lint
npm run typecheck
TEST_DATABASE_URL=postgres://pregar:pregar@127.0.0.1:5432/pregar_test npx vitest run
```

O Vitest roda os projetos `core`, `editor`, `desktop` e `api`. Os testes da API usam um PostgreSQL real (o banco de teste é limpo a cada arquivo) e um Asaas falso; nenhum teste chama serviços externos.

Os testes ponta a ponta abrem o app compilado com Playwright. No Linux sem tela, use `xvfb-run -a`:

```sh
npm run build -w @pregar/desktop
cd apps/desktop
node test/e2e/smoke.mjs out smoke.png          # abre o app e confere a Mesa
node test/e2e/mesa.mjs out capturas             # login na API falsa, leituras, escrita e revisão por IA
```

Os demais roteiros em `test/e2e/` cobrem Leitor, Biblioteca e Preferências da mesma forma. O CI (`.github/workflows/ci.yml`) roda lint, tipos, Vitest com PostgreSQL, os roteiros ponta a ponta no Linux, no macOS e no Windows, e o build da imagem da API.

## Instaladores e atualização

```sh
npm run dist:mac -w @pregar/desktop     # .dmg universal e .zip
npm run dist:win -w @pregar/desktop     # instalador NSIS x64 e ARM64
npm run dist:linux -w @pregar/desktop   # AppImage e .deb
```

As versões públicas saem do workflow de release ao enviar uma tag `v*`, ou do seu computador com `npm run release -w @pregar/desktop` (sem depender do GitHub Actions). O app instalado se atualiza sozinho a partir dos releases do GitHub. Certificados, notarização e variáveis do repositório estão em [docs/release-desktop.md](docs/release-desktop.md).

## API, Railway e cobrança

- Publicação, variáveis, domínio, webhooks e rotina de suporte: [docs/api-railway.md](docs/api-railway.md). Antes de abrir para assinantes, `node apps/api/dist/admin.js doctor` no shell da Railway confere banco, email, Asaas, Estêvão e IA com chamadas reais.
- Pix Automático e Pix mensal pelo Asaas, ciclo da assinatura, limites de uso e o que acontece em atraso: [docs/assinatura-pix.md](docs/assinatura-pix.md).
- IA com chaves próprias no modo gratuito: [docs/ia-byok.md](docs/ia-byok.md).

## Onde os dados ficam

Tudo fica na pasta de dados do app:

| Sistema | Pasta |
| --- | --- |
| macOS | `~/Library/Application Support/Pregar` |
| Windows | `%APPDATA%\Pregar` |
| Linux | `~/.config/Pregar` |

- **Manuscritos, histórico de versões, relatórios de revisão, preferências e índice da Biblioteca** em `pregar.sqlite` (SQLite com busca de texto completo).
- **Chaves e sessão** (Estêvão API, provedores de IA, sessão da conta, token do Google) em `secrets.bin`, cifrado pelo cofre do sistema: Keychain no macOS, DPAPI no Windows, libsecret no Linux. As chaves nunca chegam à interface; ela só sabe se cada uma está cadastrada.
- **PDFs** continuam nos caminhos originais; capas e PDFs baixados do Drive ficam em `Library/`.
- **Registro de integrações** em `Logs/`, sem corpos de requisição nem chaves (Preferências › Registros mostra e copia as últimas linhas).

Preferências › Biblioteca cria e restaura um backup local de tudo isso, exceto as chaves.

## Migrar do Pregar para Mac (Swift)

1. No app antigo, em Preferências › Biblioteca, crie um backup.
2. No app novo, em Preferências › Biblioteca, use **Importar do Pregar para Mac** e escolha a pasta do backup.

Manuscritos (RTF convertidos para o novo editor, com títulos, listas, citações e notas), histórico de versões, relatórios de revisão, Biblioteca, abas do Leitor, vínculos de seções e preferências entram no app novo. As chaves não fazem parte do backup: cadastre-as de novo ou entre com a conta Pro. O pacote é validado antes de qualquer gravação; um arquivo alterado ou fora do manifesto cancela a importação sem mexer nos dados atuais.

## Atalhos

No Windows e no Linux, leia ⌘ como Ctrl e ⌥ como Alt.

| Atalho | Ação |
| --- | --- |
| ⌘0 · ⌘1 · ⌘2 · ⌘3 · ⌘4 | Mesa · Bíblia · Leitor · Biblioteca · Arquivo |
| ⌘, | Preferências |
| ⌘B · ⌘I · ⌘U · ⇧⌘X | Negrito · Itálico · Sublinhado · Tachado |
| ⌥⌘0 · ⌥⌘1…6 | Texto normal · Título 1 a 6 |
| ⇧⌘7 · ⇧⌘8 | Lista numerada · Marcadores |
| ⌘K · ⌥⌘F | Link · Nota de rodapé |
| ⌘F · ⇧⌘H | Localizar · Localizar e substituir |
| ⌘S · ⌘P | Salvar agora · Imprimir |
| ⌘+ · ⌘− | Aumentar · Diminuir zoom |
| ⇧⌥⌘R · ⇧⌥⌘E · ⇧⌘T · ⇧⌥⌘H | Revisar · Ensaio · Tablet · Histórico de versões |
| ⌘T · ⌘W · ⇧⌘T | No Leitor: nova aba · fechar aba · reabrir a última |

## Segurança, em resumo

- Interface isolada (`contextIsolation`, `sandbox`, sem Node na página), CSP restrita e IPC tipado que confere a origem de cada chamada. Sites abertos no Leitor rodam em visões separadas, sem acesso à ponte do app.
- Segredos cifrados pelo sistema e nunca expostos à interface nem aos registros.
- Na API: sessões opacas guardadas só como hash, código de login com tentativas limitadas, limites por IP e por conta, webhooks do Asaas com token e idempotência, cabeçalhos de segurança, nenhum manuscrito gravado, exportação e exclusão da conta (LGPD).

## Convenções

- Interface e documentação em português do Brasil.
- Cores, espaçamentos e raios vêm dos tokens de `apps/desktop/src/renderer/src/styles`; o acento segue a cor litúrgica do dia.
- A IA aponta e fundamenta, nunca escreve ou sugere frases. Toda resposta é validada contra trechos literais do manuscrito antes de aparecer.
- Regras de domínio ficam em `packages/core`, com testes; o app e a API só as usam.
- Mudanças de comportamento entram em `docs/progresso.md`, com o que ficou pendente de verificação.

## App legado para macOS (Swift)

O app nativo original continua em `Pregar/` e `PregarTests/` até a migração dos usuários. Ele não recebe novos recursos.

- Abra `Pregar.xcodeproj` no Xcode 15 ou mais recente, scheme **Pregar**, destino **My Mac**, e pressione ⌘R. A assinatura padrão é manual no time `R573HPN65Q`; com outro time, use *Automatically manage signing*.
- Testes: `xcodebuild test -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' -derivedDataPath build`. Ao hospedar testes, o app usa armazenamento temporário e não lê chaves nem acessa a rede.
- Se alterar `project.yml`, regenere com `xcodegen generate`.
- Dados em `~/Library/Application Support/br.caminhoanglicano.pregar`, chaves no Acesso às Chaves.
