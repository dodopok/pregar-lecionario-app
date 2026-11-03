# Instaladores e atualização do app desktop

Os instaladores saem do computador de cada sistema com `npm run release -w @pregar/desktop`, que publica um rascunho de release no GitHub. O app instalado se atualiza sozinho a partir dos releases publicados. O GitHub Actions não é usado: o workflow `.github/workflows/release-desktop.yml` fica guardado só com disparo manual.

## Publicar uma versão

1. Atualize `version` em `apps/desktop/package.json` (por exemplo `0.2.0`) e faça commit.
2. Rode `npm run verify` na raiz e confira que tudo passa.
3. Gere e envie os instaladores em cada sistema, como em "Publicar do seu computador" abaixo. Os três envios completam o mesmo rascunho.
4. Revise o rascunho do release no GitHub e publique. A partir daí, quem tem o app recebe a atualização.

## Variáveis e segredos

Ficam no seu computador, nunca no repositório:

| Nome | Onde | Uso |
| --- | --- | --- |
| `MAIN_VITE_PREGAR_API_URL` | `apps/desktop/.env.production.local` | Endereço da API embutido no app (ex.: `https://api.pregar.oficio.app`) |
| `MAIN_VITE_GOOGLE_CLIENT_ID`, `MAIN_VITE_GOOGLE_CLIENT_SECRET` | `apps/desktop/.env.production.local` | Cliente OAuth "App para computador" do Google Drive (em apps de computador o Google não trata o segredo como confidencial) |
| `MAIN_VITE_DRIVE_API_KEY` | `apps/desktop/.env.production.local` | Chave restrita à Drive API para importar pastas públicas (opcional) |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | terminal | Certificado (caminho ou base64 do .p12 no Mac, do .pfx no Windows) e senha. No Mac, o certificado instalado no Acesso às Chaves também serve |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | terminal (Mac) | Notarização na Apple |
| `GH_TOKEN` | terminal | Token do GitHub com escrita em releases, só para `--publish` |

Sem os certificados, o script ainda gera os instaladores, mas sem assinatura. No macOS, um app sem assinatura e notarização é bloqueado pelo Gatekeeper; no Windows, o SmartScreen avisa que o editor é desconhecido. Para leigos, assine desde a primeira versão pública.

## Por sistema

- **macOS.** Um `.dmg` universal (Apple Silicon e Intel) e um `.zip` para a atualização automática. Precisa da conta Apple Developer (US$ 99/ano), de um certificado Developer ID Application e da notarização.
- **Windows.** Instalador NSIS para x64 e ARM64, por usuário, sem pedir administrador. Para evitar o aviso do SmartScreen, use um certificado de assinatura de código (OV) ou o Azure Trusted Signing; a reputação melhora com os downloads.
- **Linux.** AppImage (com atualização automática) e `.deb` (atualizado por nova instalação). O cofre de senhas usa o libsecret: em distribuições sem gnome-keyring ou KWallet, o app avisa e não grava chaves em texto puro.

## Google Drive

Crie no Google Cloud um cliente OAuth do tipo "App para computador", com o escopo `drive.file`, e preencha a tela de consentimento (nome Proper, links de privacidade e termos da API: `/legal/privacidade` e `/legal/termos`). Como o escopo é restrito aos arquivos criados pelo app, a verificação do Google é a simples. O login usa PKCE com retorno em `127.0.0.1`, sem servidor do Proper no meio.

## Verificação

`npm run verify` na raiz roda a verificação completa no seu computador: lint, tipos, testes (os da API precisam de um PostgreSQL em `TEST_DATABASE_URL`), build e os cinco roteiros ponta a ponta. `npm run verify -- --quick` pula o build e os roteiros. O workflow `.github/workflows/ci.yml` faz o mesmo no GitHub, mas fica só com disparo manual enquanto o Actions não estiver disponível na conta.

## Publicar do seu computador

Cada sistema gera os próprios instaladores: rode no Mac para o macOS, num PC com Windows para o Windows e em Linux (ou num contêiner Linux) para o Linux.

1. Em `apps/desktop`, copie `.env.example` para `.env.production.local` (fica fora do git) e preencha `MAIN_VITE_PREGAR_API_URL` com o endereço da API na Railway e, se houver, o cliente do Google Drive.
2. Exporte no terminal os segredos de assinatura da tabela acima. Sem eles o instalador sai sem assinatura, e o script avisa.
3. Para só gerar os arquivos: `npm run release -w @pregar/desktop`. Ele roda `npm run verify` antes (use `-- --skip-verify` para pular) e deixa tudo em `apps/desktop/release/<versão>/`.
4. Para publicar: `GH_TOKEN=<token> npm run release -w @pregar/desktop -- --publish`. O token precisa de permissão de escrita em releases do repositório. O envio cria ou completa um rascunho com a versão de `apps/desktop/package.json`; rode nos três sistemas e publique o rascunho no GitHub quando os três tiverem enviado. Por segurança, `--publish` recusa endereço de API que não seja https ou que aponte para localhost ou domínio de teste.

A atualização automática lê os releases publicados no GitHub, inclusive os arquivos `latest*.yml` que o envio inclui. Se o GitHub também ficar indisponível para releases, gere sem `--publish` e distribua os instaladores por outro meio; a atualização automática volta a funcionar no primeiro release publicado.

## Desenvolvimento

```sh
npm ci
npm run dev:desktop                    # app com recarga automática
npm run build -w @pregar/desktop       # build de produção em apps/desktop/out
npm run dist:linux -w @pregar/desktop  # instaladores locais (dist:mac e dist:win nos respectivos sistemas)
```

Para apontar o app de desenvolvimento para uma API local, use Preferências › Sobre › Endereço da API (`http://localhost:3000` é aceito só para localhost).
