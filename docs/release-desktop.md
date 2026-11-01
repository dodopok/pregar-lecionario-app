# Instaladores e atualização do app desktop

Os instaladores saem do workflow `.github/workflows/release-desktop.yml`, que roda em macOS, Windows e Linux quando uma tag `v*` é enviada. Ele publica um rascunho de release no GitHub; o app instalado se atualiza sozinho a partir dos releases publicados.

## Publicar uma versão

1. Atualize `version` em `apps/desktop/package.json` (por exemplo `0.2.0`).
2. Faça commit, crie a tag e envie: `git tag v0.2.0 && git push origin v0.2.0`.
3. Ao fim do workflow, revise o rascunho do release no GitHub e publique. A partir daí, quem tem o app recebe a atualização.

## Configuração do repositório

Em Settings › Secrets and variables › Actions:

| Nome | Tipo | Uso |
| --- | --- | --- |
| `PREGAR_API_URL` | variável | Endereço da API embutido no app (ex.: `https://api.pregar.app`) |
| `GOOGLE_CLIENT_ID` | variável | Cliente OAuth "App para computador" do Google Drive |
| `GOOGLE_CLIENT_SECRET` | segredo | Segredo desse cliente (em apps de computador o Google não o trata como confidencial) |
| `DRIVE_API_KEY` | segredo | Chave restrita à Drive API para importar pastas públicas (opcional) |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | segredos | Certificado Developer ID Application em base64 (.p12) e senha |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | segredos | Notarização na Apple |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | segredos | Certificado de assinatura de código do Windows (.pfx em base64) |

Sem os certificados, o workflow ainda gera os instaladores, mas sem assinatura. No macOS, um app sem assinatura e notarização é bloqueado pelo Gatekeeper; no Windows, o SmartScreen avisa que o editor é desconhecido. Para leigos, assine desde a primeira versão pública.

## Por sistema

- **macOS.** Um `.dmg` universal (Apple Silicon e Intel) e um `.zip` para a atualização automática. Precisa da conta Apple Developer (US$ 99/ano), de um certificado Developer ID Application e da notarização.
- **Windows.** Instalador NSIS para x64 e ARM64, por usuário, sem pedir administrador. Para evitar o aviso do SmartScreen, use um certificado de assinatura de código (OV) ou o Azure Trusted Signing; a reputação melhora com os downloads.
- **Linux.** AppImage (com atualização automática) e `.deb` (atualizado por nova instalação). O cofre de senhas usa o libsecret: em distribuições sem gnome-keyring ou KWallet, o app avisa e não grava chaves em texto puro.

## Google Drive

Crie no Google Cloud um cliente OAuth do tipo "App para computador", com o escopo `drive.file`, e preencha a tela de consentimento (nome Pregar, links de privacidade e termos da API: `/legal/privacidade` e `/legal/termos`). Como o escopo é restrito aos arquivos criados pelo app, a verificação do Google é a simples. O login usa PKCE com retorno em `127.0.0.1`, sem servidor do Pregar no meio.

## Quando o CI não roda

O CI roda em Linux, macOS e Windows a cada envio. Se todos os jobs falham em um ou dois segundos, sem log e sem runner, o GitHub não chegou a iniciá-los. Em repositório privado isso costuma ser cobrança: pagamento recusado ou limite de gastos do Actions atingido. Confira em Settings › Billing and plans da conta dona do repositório e rode o workflow de novo.

## Desenvolvimento

```sh
npm ci
npm run dev:desktop                    # app com recarga automática
npm run build -w @pregar/desktop       # build de produção em apps/desktop/out
npm run dist:linux -w @pregar/desktop  # instaladores locais (dist:mac e dist:win nos respectivos sistemas)
```

Para apontar o app de desenvolvimento para uma API local, use Preferências › Sobre › Endereço da API (`http://localhost:3000` é aceito só para localhost).
