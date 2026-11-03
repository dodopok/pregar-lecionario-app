# API do Pregar na Railway

A API (`apps/api`) é um serviço Node com PostgreSQL. Ela cuida das contas, da assinatura por Pix no Asaas, do proxy de IA com cotas, do proxy da Estêvão API para assinantes e da degustação (leituras das próximas semanas sem conta, se ligada). Quem usa o plano gratuito com a própria chave não passa por ela.

## Subir pela primeira vez

1. Na Railway, crie um projeto a partir do repositório `dodopok/pregar-lecionario-app`. A Railway lê o `railway.json` da raiz e usa `apps/api/Dockerfile`; o contexto do build é a raiz do repositório. A imagem final leva só o bundle da API (`apps/api/dist`, gerado pelo tsup com as dependências embutidas), sem `node_modules`; as migrações rodam ao iniciar o servidor.
2. Adicione um PostgreSQL ao projeto (New › Database › PostgreSQL).
3. No serviço da API, em Variables, cadastre as variáveis da tabela abaixo. `DATABASE_URL` pode referenciar o banco: `${{Postgres.DATABASE_URL}}`.
4. Em Settings › Networking, gere um domínio público ou ligue o seu (por exemplo `api.pregar.app`). Use esse endereço em `PUBLIC_BASE_URL` e no app (variável `PREGAR_API_URL` do release).
5. Faça o deploy. As migrações rodam sozinhas ao iniciar; o healthcheck é `/health`.

O serviço sobe mesmo sem as chaves de pagamento, de email ou de IA: as rotas que dependem delas respondem 503 com a explicação, e o log avisa o que falta em produção.

## Verificar antes de abrir para assinantes

Com as variáveis cadastradas, abra o shell do serviço na Railway e rode:

```sh
node apps/api/dist/admin.js doctor
```

A verificação faz chamadas reais e gratuitas e mostra OK, AVISO ou FALHA para cada item, sem exibir chaves:

| Item | O que confere |
| --- | --- |
| Configuração | `NODE_ENV=production`, endereço público em https, `TRUST_PROXY` |
| Banco de dados | Conexão e migrações aplicadas |
| Email (Resend) | Chave aceita e domínio do `EMAIL_FROM` verificado |
| Asaas | Chave aceita e do mesmo ambiente de `ASAAS_ENVIRONMENT` |
| Asaas · chave Pix | Ao menos uma chave Pix ativa (sem ela o Asaas não gera QR Code) |
| Asaas · webhook | Webhook ativo para `<PUBLIC_BASE_URL>/v1/webhooks/asaas`, fila não interrompida e os eventos usados pelo modo escolhido |
| Asaas · Pix Automático | Conta habilitada (só no modo `pix_automatico`) |
| Estêvão API | Chave do servidor aceita |
| IA | Chave e modelo de revisão e de pesquisa existem (a Perplexity só tem a chave conferida na primeira pesquisa real) |

O comando termina com código 1 se houver falha. Rode de novo depois de cada ajuste até aparecer "Pronto para produção".

## Variáveis

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | sim | Banco PostgreSQL |
| `AUTH_SECRET` | sim | Segredo de 32+ caracteres para os códigos de login (`openssl rand -base64 48`) |
| `PUBLIC_BASE_URL` | sim | Endereço público da API, usado nas páginas legais |
| `RESEND_API_KEY`, `EMAIL_FROM` | sim | Envio do código de login por email ([Resend](https://resend.com)); o remetente precisa de domínio verificado |
| `ESTEVAO_APP_INTERNAL_ID` | sim | Identificador do app enviado como `X-App-Internal-Id` para as leituras dos assinantes |
| `ANTHROPIC_API_KEY` | sim | Revisão e perguntas dos assinantes (padrão `claude-sonnet-5-5`) |
| `PERPLEXITY_API_KEY` | sim | Pesquisa de materiais dos assinantes (padrão `perplexity/sonar`) |
| `AI_REVIEW_PROVIDER`, `AI_REVIEW_MODEL`, `AI_RESEARCH_PROVIDER`, `AI_RESEARCH_MODEL` | não | Troca de provedor ou modelo sem novo release; os outros provedores usam `OPENAI_API_KEY` e `GOOGLE_AI_API_KEY` |
| `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT`, `ASAAS_WEBHOOK_TOKEN` | sim | Cobrança; ver [Assinatura por Pix](assinatura-pix.md) |
| `BILLING_PIX_MODE` | não | `pix_assinatura` (padrão, qualquer conta) ou `pix_automatico` (conta PJ elegível) |
| `PLAN_MONTHLY_PRICE_CENTS`, `PLAN_YEARLY_PRICE_CENTS` | não | Preços em centavos; padrão R$ 19,90 e R$ 199,00, valores de exemplo |
| `BILLING_GRACE_DAYS` | não | Tolerância após o vencimento (padrão 5 dias) |
| `LIMIT_*` | não | Limites do plano pago; ver a seção 10 do [plano](plano-multiplataforma.md) |
| `ESTEVAO_PROXY_FOR_FREE` | não | `true` libera as leituras pelo servidor também para contas sem assinatura |
| `ESTEVAO_PUBLIC_PREVIEW` | não | `true` liga a degustação: `GET /v1/public/estevao/days/<data>` e `GET /v1/public/estevao/days?from&to` sem conta, só de 7 dias atrás até `ESTEVAO_PREVIEW_DAYS` dias à frente (padrão 35, máximo 120). Um dia fora da janela responde 400 `preview_window`; um intervalo é recortado para a janela (400 se nada sobrar). Desligada, as rotas respondem 404 `preview_disabled`; `GET /v1/public/preview` informa ao app se está ligada e a janela |
| `LIMIT_ESTEVAO_PREVIEW_PER_MINUTE` | não | Consultas da degustação por endereço IP e por minuto (padrão 20) |
| `ADMIN_TOKEN` | não | Liga as rotas `/v1/admin` de suporte; sem ele, elas não existem |
| `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_DOCUMENT`, `LEGAL_CONTACT_EMAIL` | sim | Identificação nas páginas `/legal/privacidade` e `/legal/termos` |
| `CORS_ORIGINS` | não | Só se houver uma versão web; o app desktop não precisa |

O modelo completo, com comentários, está em `apps/api/.env.example`.

## Operação

- **Logs.** O log nunca grava corpos de requisição nem cabeçalhos de autenticação. Erros do Asaas e dos provedores aparecem com status e duração.
- **Reconciliação.** A cada `RECONCILE_INTERVAL_MINUTES` (padrão 15), a API reprocessa webhooks que falharam, confere checkouts pendentes no Asaas e encerra assinaturas vencidas depois da tolerância. Ela usa uma trava do Postgres, então é seguro rodar mais de uma réplica.
- **Suporte.** Com `ADMIN_TOKEN`, `POST /v1/admin/grant` concede dias de plano pago (cortesia ou correção) e `GET /v1/admin/users/:email` mostra plano, uso e assinaturas. Pela linha de comando, no shell da Railway: `node apps/api/dist/admin.js grant email@exemplo.com 30`, `user email@exemplo.com` (plano, uso, custo real da IA no período e as últimas chamadas) ou `reconcile`.
- **Backup do banco.** Ative os backups do PostgreSQL na Railway. A API não guarda manuscritos: só contas, sessões, assinaturas, pagamentos e contagem de uso.
- **LGPD.** O usuário exporta e apaga a conta pelo app. A exclusão cancela a cobrança, remove email, nome, sessões e uso, e mantém os pagamentos sem dados pessoais.

## Desenvolvimento local

```sh
cp apps/api/.env.example apps/api/.env   # ajuste DATABASE_URL e AUTH_SECRET
npm run migrate:dev -w @pregar/api
npm run dev:api
```

Sem `RESEND_API_KEY`, o código de login aparece no log. Os testes usam um PostgreSQL real: `TEST_DATABASE_URL=postgres://… npx vitest run --project api`.
