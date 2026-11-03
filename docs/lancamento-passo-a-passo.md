# Lançamento do Proper: passo a passo

O código está pronto na branch `feat/multiplataforma`. Estes passos dependem de contas, chaves e máquinas suas. Siga na ordem: cada etapa usa a anterior. Os detalhes de cada item estão nos guias citados.

Tempo estimado: um dia de trabalho, sem contar as aprovações de terceiros. A conta do Asaas, o domínio na Resend, o Apple Developer e o certificado do Windows levam de horas a alguns dias para aprovar. Peça essas aprovações logo no começo.

## 0. Peça já o que demora

- [ ] **Apple Developer Program** (US$ 99/ano) em developer.apple.com, se ainda não tiver.
- [ ] **Certificado de assinatura de código do Windows**: um certificado OV de uma autoridade (Sectigo, SSL.com, DigiCert) ou o Azure Trusted Signing. Exige validação da empresa ou da pessoa.
- [ ] **Conta no Asaas** em produção, com os documentos aprovados. Para o Pix Automático, a conta precisa ser PJ com CNPJ ativo há pelo menos 6 meses. Sem isso, use o Pix mensal (`pix_assinatura`), que funciona em qualquer conta.
- [ ] **Conta de sandbox do Asaas** em sandbox.asaas.com (cadastro separado), para testar sem dinheiro real.

## 1. Juntar o código na `main`

- [ ] Revise a branch `feat/multiplataforma` e faça o merge em `main` (posso abrir o PR se você pedir). Outra opção é apontar a Railway para a branch, no passo 2.

## 2. Subir a API na Railway

Guia: [api-railway.md](api-railway.md).

1. [ ] Crie um projeto na Railway a partir do repositório `dodopok/pregar-lecionario-app`. A Railway lê o `railway.json` e usa `apps/api/Dockerfile`.
2. [ ] Adicione um PostgreSQL ao projeto (New › Database › PostgreSQL) e ative os backups dele.
3. [ ] Gere um domínio público ou ligue o seu (o app usa `https://api.pregar.oficio.app` por padrão; se for outro, anote para o passo 9).
4. [ ] Cadastre as variáveis mínimas no serviço da API:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `AUTH_SECRET` | saída de `openssl rand -base64 48` |
   | `PUBLIC_BASE_URL` | o domínio do item 3, com `https://` |
   | `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_DOCUMENT`, `LEGAL_CONTACT_EMAIL` | nome, CPF/CNPJ e email de contato que aparecem nas páginas de privacidade e termos |

5. [ ] Faça o deploy e abra `https://<seu-domínio>/health`. Deve responder `{"ok":true}`.

## 3. Email do código de login (Resend)

1. [ ] Crie a conta em resend.com e adicione o domínio do remetente (por exemplo `pregar.app`).
2. [ ] Cadastre no DNS do domínio os registros que a Resend mostrar e espere aparecer "Verified".
3. [ ] Crie uma chave de API e cadastre na Railway: `RESEND_API_KEY` e `EMAIL_FROM` (por exemplo `Proper <nao-responda@pregar.app>`).

## 4. Leituras e IA dos assinantes

1. [ ] `ESTEVAO_APP_INTERNAL_ID`: identificador usado pelo Ordo, enviado no header `X-App-Internal-Id` só pelo servidor.
2. [ ] `ANTHROPIC_API_KEY`: chave do console da Anthropic (revisão e perguntas). Defina um limite de gastos mensal no console.
3. [ ] `PERPLEXITY_API_KEY`: chave da Perplexity (pesquisa de materiais). Defina também um limite de gastos.

## 5. Testar a assinatura no sandbox do Asaas

Guia: [assinatura-pix.md](assinatura-pix.md).

1. [ ] No sandbox, crie a chave de API e uma chave Pix (Pix › Minhas chaves).
2. [ ] Cadastre na Railway: `ASAAS_API_KEY` (a do sandbox), `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_WEBHOOK_TOKEN` (saída de `openssl rand -hex 32`) e `BILLING_PIX_MODE` (`pix_assinatura`, ou `pix_automatico` se a conta for elegível).
3. [ ] No sandbox, em Integrações › Webhooks, crie o webhook:
   - URL: `https://<seu-domínio>/v1/webhooks/asaas`
   - Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - Envio sequencial
   - Eventos: todos de cobrança (`PAYMENT_*`) e de assinatura (`SUBSCRIPTION_*`) e, no Pix Automático, os de autorização (`PIX_AUTOMATIC_RECURRING_AUTHORIZATION_*`)
4. [ ] No shell do serviço na Railway, rode:

   ```sh
   node apps/api/dist/admin.js doctor
   ```

   Corrija cada FALHA que aparecer e rode de novo. No sandbox, "Asaas" aparece como AVISO; isso é esperado.
5. [ ] No seu computador, abra o app apontando para a API:

   ```sh
   npm ci
   MAIN_VITE_PREGAR_API_URL=https://<seu-domínio> npm run dev:desktop
   ```

   No Windows, defina a variável com `set` (cmd) ou `$env:` (PowerShell) antes do `npm run dev:desktop`.
6. [ ] No app, entre com seu email (o código chega pela Resend) e assine com um CPF de teste válido.
7. [ ] Confirme o pagamento no painel do sandbox. Em alguns segundos o app mostra "Assinatura ativa".
8. [ ] Na Mesa, carregue as leituras de um domingo (sem chave da Estêvão no app) e faça uma revisão por IA de um sermão real.
9. [ ] Veja o custo dessa revisão:

   ```sh
   node apps/api/dist/admin.js user <seu-email>
   ```

   `aiCostThisPeriodUSD` mostra o custo do mês em dólar, e `recentAICalls` mostra cada chamada com modelo, tokens e custo. Com isso, confira se o preço e os limites fazem sentido.

## 6. Preço e limites

- [ ] Ajuste, se precisar: `PLAN_MONTHLY_PRICE_CENTS` (padrão 1990), `PLAN_YEARLY_PRICE_CENTS` (padrão 19900), `LIMIT_REVIEWS_PER_MONTH` (40), `LIMIT_QUESTIONS_PER_MONTH` (60), `LIMIT_RESEARCH_PER_MONTH` (60), `LIMIT_AI_CALLS_PER_DAY` (20) e `LIMIT_MONTHLY_COST_USD` (8, o teto de custo por assinante). Mudar essas variáveis não exige novo release do app.

## 7. Asaas em produção

1. [ ] Na conta de produção, crie a chave Pix e a chave de API.
2. [ ] Troque na Railway: `ASAAS_API_KEY` (a de produção) e `ASAAS_ENVIRONMENT=production`.
3. [ ] Crie o webhook de produção igual ao do sandbox (mesma URL, mesmo token e mesmos eventos).
4. [ ] Rode `node apps/api/dist/admin.js doctor` até aparecer **"Pronto para produção"**.
5. [ ] Faça uma assinatura real de R$ 19,90 com a sua conta para conferir o fluxo inteiro. Depois, se quiser, cancele pelo app.

## 8. Google Drive (opcional no lançamento)

Guia: [release-desktop.md](release-desktop.md#google-drive).

1. [ ] No Google Cloud, ative a Google Drive API e a Google Docs API.
2. [ ] Configure a tela de consentimento com o nome Proper e os links `https://<seu-domínio>/legal/privacidade` e `https://<seu-domínio>/legal/termos`.
3. [ ] Crie um cliente OAuth do tipo **App para computador** e anote o Client ID e o segredo.

Sem isso o app funciona normalmente; só o envio para o Google Docs fica desligado.

## 9. Gerar e publicar os instaladores

Os instaladores saem do seu computador (o GitHub Actions não será usado). Guia: [release-desktop.md](release-desktop.md#publicar-do-seu-computador).

Em cada máquina, uma vez:

1. [ ] Instale o Node 22.13 ou mais recente e clone o repositório.
2. [ ] Em `apps/desktop`, copie `.env.example` para `.env.production.local` e preencha `MAIN_VITE_PREGAR_API_URL` (o domínio do passo 2) e, se tiver feito o passo 8, `MAIN_VITE_GOOGLE_CLIENT_ID` e `MAIN_VITE_GOOGLE_CLIENT_SECRET`.
3. [ ] Rode `npm ci` e depois `npm run verify` na raiz. Tudo deve passar; sem PostgreSQL local, os testes da API são pulados.

**No Mac** (gera o `.dmg` universal e o `.zip`):

```sh
export APPLE_ID=<seu Apple ID>
export APPLE_APP_SPECIFIC_PASSWORD=<senha de app criada em appleid.apple.com>
export APPLE_TEAM_ID=<Team ID>
# Certificado Developer ID Application: instalado no Acesso às Chaves,
# ou CSC_LINK=<caminho do .p12> e CSC_KEY_PASSWORD=<senha>
export GH_TOKEN=<token do GitHub com escrita em releases>
npm run release -w @pregar/desktop -- --publish
```

**No Windows** (gera o instalador x64 e ARM64):

```powershell
$env:CSC_LINK="C:\caminho\certificado.pfx"
$env:CSC_KEY_PASSWORD="<senha>"
$env:GH_TOKEN="<token do GitHub>"
npm run release -w @pregar/desktop -- --publish
```

**No Linux** (AppImage e `.deb`): o mesmo comando, sem certificado. Posso gerar este daqui se você me passar o endereço da API.

4. [ ] Os três envios completam um mesmo rascunho de release (versão de `apps/desktop/package.json`). Quando os três terminarem, publique o rascunho no GitHub. A partir daí, a atualização automática de quem tem o app passa a ver essa versão.

Se a conta do GitHub também não deixar criar releases, rode sem `--publish`, distribua os arquivos de `apps/desktop/release/<versão>/` por outro meio e me avise: dá para mudar a atualização automática para outro servidor.

## 10. Conferir em máquinas reais

Em um Mac e um PC com Windows que nunca tiveram o Proper:

- [ ] O instalador abre sem aviso de app não identificado (macOS) ou de editor desconhecido (Windows).
- [ ] Plano gratuito: cole uma chave da Estêvão e uma de IA nas Preferências, carregue um domingo e faça uma revisão.
- [ ] Plano Pro: entre com o email e veja leituras e revisão funcionando sem chave.
- [ ] Biblioteca: importe um PDF de comentário e abra uma seção no Leitor.
- [ ] Feche o app logo depois de digitar e reabra: o texto deve estar lá.
- [ ] No Mac com o app antigo: crie o backup no app antigo (Preferências › Biblioteca) e importe no novo (Preferências › Biblioteca › Importar do Pregar para Mac). Confira os sermões, o histórico e a Biblioteca.

Se quiser que eu faça esses testes, ligue a máquina à sessão por Remote Control (no app Claude Desktop: Configurações › Claude Code › Remote Control).

## 11. Depois do lançamento

- [ ] Acompanhe os logs da API na Railway na primeira semana. Erros do Asaas e dos provedores aparecem com status e duração, sem dados pessoais.
- [ ] Rode `node apps/api/dist/admin.js doctor` depois de qualquer troca de chave.
- [ ] Para liberar dias de cortesia a alguém: `node apps/api/dist/admin.js grant <email> <dias>`.
- [ ] Para uma nova versão: aumente `version` em `apps/desktop/package.json` e repita o passo 9.

## O que me mandar quando voltar

- A saída do `doctor` (ela não mostra chaves).
- O custo da primeira revisão real (passo 5.9), para eu ajustar preços e limites com você.
- Qualquer erro dos passos 9 e 10, com a mensagem e o print.
- Se quiser que eu teste no Mac ou no Windows, a máquina ligada por Remote Control.
