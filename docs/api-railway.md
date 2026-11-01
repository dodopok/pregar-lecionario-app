# API do Pregar na Railway

A API (`apps/api`) é um serviço Node com PostgreSQL. Ela cuida das contas, da assinatura por Pix no Asaas, do proxy de IA com cotas e do proxy da Estêvão API para assinantes. Quem usa o plano gratuito não passa por ela.

## Subir pela primeira vez

1. Na Railway, crie um projeto a partir do repositório `dodopok/pregar-lecionario-app`. A Railway lê o `railway.json` da raiz e usa `apps/api/Dockerfile`; o contexto do build é a raiz do repositório. A imagem final leva só o bundle da API (`apps/api/dist`, gerado pelo tsup com as dependências embutidas), sem `node_modules`; as migrações rodam ao iniciar o servidor.
2. Adicione um PostgreSQL ao projeto (New › Database › PostgreSQL).
3. No serviço da API, em Variables, cadastre as variáveis da tabela abaixo. `DATABASE_URL` pode referenciar o banco: `${{Postgres.DATABASE_URL}}`.
4. Em Settings › Networking, gere um domínio público ou ligue o seu (por exemplo `api.pregar.app`). Use esse endereço em `PUBLIC_BASE_URL` e no app (variável `PREGAR_API_URL` do release).
5. Faça o deploy. As migrações rodam sozinhas ao iniciar; o healthcheck é `/health`.

O serviço sobe mesmo sem as chaves de pagamento, de email ou de IA: as rotas que dependem delas respondem 503 com a explicação, e o log avisa o que falta em produção.

## Variáveis

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | sim | Banco PostgreSQL |
| `AUTH_SECRET` | sim | Segredo de 32+ caracteres para os códigos de login (`openssl rand -base64 48`) |
| `PUBLIC_BASE_URL` | sim | Endereço público da API, usado nas páginas legais |
| `RESEND_API_KEY`, `EMAIL_FROM` | sim | Envio do código de login por email ([Resend](https://resend.com)); o remetente precisa de domínio verificado |
| `ESTEVAO_API_KEY` | sim | Chave do servidor para as leituras dos assinantes |
| `ANTHROPIC_API_KEY` | sim | Revisão e perguntas dos assinantes (padrão `claude-sonnet-5-5`) |
| `PERPLEXITY_API_KEY` | sim | Pesquisa de materiais dos assinantes (padrão `perplexity/sonar`) |
| `AI_REVIEW_PROVIDER`, `AI_REVIEW_MODEL`, `AI_RESEARCH_PROVIDER`, `AI_RESEARCH_MODEL` | não | Troca de provedor ou modelo sem novo release; os outros provedores usam `OPENAI_API_KEY` e `GOOGLE_AI_API_KEY` |
| `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT`, `ASAAS_WEBHOOK_TOKEN` | sim | Cobrança; ver [Assinatura por Pix](assinatura-pix.md) |
| `BILLING_PIX_MODE` | não | `pix_assinatura` (padrão, qualquer conta) ou `pix_automatico` (conta PJ elegível) |
| `PLAN_MONTHLY_PRICE_CENTS`, `PLAN_YEARLY_PRICE_CENTS` | não | Preços em centavos; padrão R$ 19,90 e R$ 199,00, valores de exemplo |
| `BILLING_GRACE_DAYS` | não | Tolerância após o vencimento (padrão 5 dias) |
| `LIMIT_*` | não | Limites do plano pago; ver a seção 10 do [plano](plano-multiplataforma.md) |
| `ESTEVAO_PROXY_FOR_FREE` | não | `true` libera as leituras pelo servidor também para contas sem assinatura |
| `ADMIN_TOKEN` | não | Liga as rotas `/v1/admin` de suporte; sem ele, elas não existem |
| `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_DOCUMENT`, `LEGAL_CONTACT_EMAIL` | sim | Identificação nas páginas `/legal/privacidade` e `/legal/termos` |
| `CORS_ORIGINS` | não | Só se houver uma versão web; o app desktop não precisa |

O modelo completo, com comentários, está em `apps/api/.env.example`.

## Operação

- **Logs.** O log nunca grava corpos de requisição nem cabeçalhos de autenticação. Erros do Asaas e dos provedores aparecem com status e duração.
- **Reconciliação.** A cada `RECONCILE_INTERVAL_MINUTES` (padrão 15), a API reprocessa webhooks que falharam, confere checkouts pendentes no Asaas e encerra assinaturas vencidas depois da tolerância. Ela usa uma trava do Postgres, então é seguro rodar mais de uma réplica.
- **Suporte.** Com `ADMIN_TOKEN`, `POST /v1/admin/grant` concede dias de plano pago (cortesia ou correção) e `GET /v1/admin/users/:email` mostra plano, uso e assinaturas. Pela linha de comando, no shell da Railway: `node apps/api/dist/admin.js grant email@exemplo.com 30`, `user email@exemplo.com` ou `reconcile`.
- **Backup do banco.** Ative os backups do PostgreSQL na Railway. A API não guarda manuscritos: só contas, sessões, assinaturas, pagamentos e contagem de uso.
- **LGPD.** O usuário exporta e apaga a conta pelo app. A exclusão cancela a cobrança, remove email, nome, sessões e uso, e mantém os pagamentos sem dados pessoais.

## Desenvolvimento local

```sh
cp apps/api/.env.example apps/api/.env   # ajuste DATABASE_URL e AUTH_SECRET
npm run migrate:dev -w @pregar/api
npm run dev:api
```

Sem `RESEND_API_KEY`, o código de login aparece no log. Os testes usam um PostgreSQL real: `TEST_DATABASE_URL=postgres://… npx vitest run --project api`.
