# Assinatura por Pix (Asaas)

O Pregar cobra a assinatura pelo [Asaas](https://www.asaas.com). A API suporta duas modalidades, escolhidas por `BILLING_PIX_MODE`.

| Modalidade | Como a pessoa paga | Requisito da conta Asaas |
| --- | --- | --- |
| `pix_automatico` | Paga o primeiro Pix e autoriza o débito automático no app do banco; as próximas cobranças são debitadas sozinhas | Pessoa jurídica aprovada, CNPJ ativo há pelo menos 6 meses, sem restrição de Pix |
| `pix_assinatura` (padrão) | A cada vencimento recebe um novo Pix por email e no próprio app | Qualquer conta |

No Pix Automático, a autorização é criada com `paymentCreationMode: SUBSCRIPTION`, então o Asaas gera sozinho as cobranças dos próximos ciclos. Referências: [Pix Automático](https://docs.asaas.com/docs/pix-automatico), [criar autorização](https://docs.asaas.com/reference/criar-uma-autorizacao-pix-automatico), [eventos](https://docs.asaas.com/docs/eventos-para-pix-autom%C3%A1tico), [assinaturas](https://docs.asaas.com/docs/criando-uma-assinatura).

## Configurar

1. Crie a chave de API no Asaas (Integrações › Chaves de API) e cadastre em `ASAAS_API_KEY`. Use `ASAAS_ENVIRONMENT=sandbox` com a chave do sandbox até homologar.
2. Cadastre o webhook (Integrações › Webhooks):
   - URL: `https://<sua-api>/v1/webhooks/asaas`
   - Token de autenticação: um valor longo e aleatório; o mesmo vai em `ASAAS_WEBHOOK_TOKEN`. O Asaas o envia no cabeçalho `asaas-access-token`.
   - Envio sequencial.
   - Eventos: todos os de cobrança (`PAYMENT_*`), de assinatura (`SUBSCRIPTION_*`) e, no Pix Automático, os de autorização (`PIX_AUTOMATIC_RECURRING_AUTHORIZATION_*`).
3. Escolha `BILLING_PIX_MODE` e os preços (`PLAN_MONTHLY_PRICE_CENTS`, `PLAN_YEARLY_PRICE_CENTS`).

## Como a API trata a cobrança

- **Checkout.** O app envia nome e CPF/CNPJ (validados pelos dígitos). A API cria o cliente no Asaas e devolve o QR Code Pix. O CPF não fica no banco do Pregar.
- **Ativação.** O primeiro `PAYMENT_RECEIVED` libera o plano por um ciclo. Cada pagamento estende o período uma única vez, mesmo que o webhook chegue repetido.
- **Idempotência.** Cada evento é gravado pelo `id` antes de ser processado. Repetições são ignoradas; falhas ficam registradas e a reconciliação tenta de novo, sem travar a fila sequencial do Asaas.
- **Atraso.** `PAYMENT_OVERDUE` marca a assinatura como pendente; o acesso continua por `BILLING_GRACE_DAYS`.
- **Cancelamento.** Pelo app, cancela a autorização ou a assinatura no Asaas e mantém o acesso até o fim do período pago. O cancelamento feito pelo próprio banco (`..._AUTHORIZATION_CANCELLED`) tem o mesmo efeito.
- **Recusa.** Se o banco não confirmar a autorização do Pix Automático, o primeiro pagamento continua valendo pelo mês pago e a pessoa pode gerar um novo código.
- **Reembolso ou chargeback.** Encerra o acesso imediatamente.

## Testar no sandbox

1. Configure a API com a chave do sandbox e o webhook do sandbox apontando para a API (use um túnel, como `cloudflared`, se estiver local).
2. No app, entre com um email e assine com um CPF de teste válido.
3. Confirme o pagamento pelo endpoint do sandbox ([confirmar pagamento](https://docs.asaas.com/reference/confirmar-pagamento)) ou pelo painel. O app mostra "Ativa" em alguns segundos.

Os fluxos completos, incluindo Pix Automático, webhook repetido, cancelamento, recusa e reconciliação sem webhook, estão cobertos por testes em `apps/api/test/billing.test.ts` com um Asaas simulado.

## Preço e limites

Os limites padrão do plano pago e o custo estimado por revisão estão na seção 10 do [plano](plano-multiplataforma.md). O teto de custo mensal por conta (`LIMIT_MONTHLY_COST_USD`) usa os tokens informados pelo provedor e protege contra entradas muito grandes. Os preços padrão são exemplos; defina-os depois de medir o custo real.
