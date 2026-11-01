import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../../lib/context'

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Pregar</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1f2a24;background:#faf9f6}h1{font-size:26px}h2{font-size:18px;margin-top:28px}@media(prefers-color-scheme:dark){body{background:#151816;color:#e6e8e4}a{color:#9fd3b0}}</style>
</head><body>${body}</body></html>`
}

export function legalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { config } = deps
  const operator = escape(config.LEGAL_OPERATOR_NAME)
  const documentText = config.LEGAL_OPERATOR_DOCUMENT ? ` (${escape(config.LEGAL_OPERATOR_DOCUMENT)})` : ''
  const contact = escape(config.LEGAL_CONTACT_EMAIL)

  app.get('/legal/privacidade', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(
      page(
        'Política de privacidade',
        `<h1>Política de privacidade do Pregar</h1>
<p>Responsável pelo tratamento: ${operator}${documentText}. Contato: <a href="mailto:${contact}">${contact}</a>.</p>
<h2>O que fica no seu computador</h2>
<p>Manuscritos, histórico de versões, biblioteca de PDFs, anotações de leitura e preferências ficam no seu computador. Eles não são enviados ao servidor do Pregar.</p>
<h2>O que o servidor guarda</h2>
<p>Para quem cria conta: email, nome informado na assinatura, sessões por dispositivo (nome do dispositivo e datas de uso), estado da assinatura, histórico de pagamentos e contagem de uso da IA (tipo de operação, modelo, quantidade de tokens e custo estimado). O CPF ou CNPJ é repassado ao provedor de pagamento (Asaas) para emitir a cobrança e não é guardado pelo Pregar.</p>
<h2>Revisão por IA</h2>
<p>No plano gratuito, o app envia o manuscrito diretamente ao provedor escolhido por você, com a sua chave; nada passa pelo servidor do Pregar. No plano pago, o manuscrito e os trechos de comentários selecionados passam pelo servidor do Pregar até o provedor de IA contratado e não são armazenados: o servidor registra apenas metadados da chamada. O manuscrito só é enviado quando você pede uma revisão, perguntas ou pesquisa.</p>
<h2>Leituras bíblicas</h2>
<p>As consultas de calendário e leituras usam a Estêvão API. No plano pago, elas passam pelo servidor do Pregar e ficam em cache sem relação com a sua identidade.</p>
<h2>Seus direitos (LGPD)</h2>
<p>No app, em Preferências › Conta, você pode baixar uma cópia dos dados da conta, encerrar sessões e apagar a conta. A exclusão cancela a assinatura e remove email, nome, sessões e registros de uso; os registros de pagamento são mantidos sem dados pessoais pelo prazo exigido pela legislação fiscal.</p>
<h2>Google Drive</h2>
<p>Se você conectar o Google Drive, o app usa a permissão <code>drive.file</code>, que dá acesso somente aos arquivos criados pelo próprio Pregar. Os tokens ficam no cofre de senhas do seu sistema operacional.</p>`,
      ),
    ),
  )

  app.get('/legal/termos', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(
      page(
        'Termos de uso',
        `<h1>Termos de uso do Pregar</h1>
<p>Fornecedor: ${operator}${documentText}. Contato: <a href="mailto:${contact}">${contact}</a>.</p>
<h2>O serviço</h2>
<p>O Pregar é um aplicativo para preparar sermões. A IA aponta e fundamenta observações sobre o texto já escrito; ela não escreve, não completa e não sugere frases. A responsabilidade pelo conteúdo pregado é de quem prega.</p>
<h2>Plano gratuito</h2>
<p>Funciona sem conta. A revisão por IA usa chaves de API próprias, cobradas pelo respectivo provedor.</p>
<h2>Assinatura</h2>
<p>A assinatura é paga por Pix, mensal ou anual, sem fidelidade. Inclui revisão por IA e leituras sem configurar chaves, com limites de uso mensais exibidos no app. O cancelamento pode ser feito no app a qualquer momento e vale ao fim do período já pago. Valores pagos não são reembolsados proporcionalmente, salvo nos casos previstos no Código de Defesa do Consumidor, inclusive o direito de arrependimento em até 7 dias da primeira contratação.</p>
<h2>Uso aceitável</h2>
<p>A conta é pessoal. Não é permitido usar o serviço para contornar os limites, revender o acesso ou enviar conteúdo ilícito.</p>
<h2>Disponibilidade</h2>
<p>O serviço depende de provedores externos (IA, Estêvão API, pagamento). Interrupções desses provedores podem afetar as funções que dependem deles; a escrita e os arquivos locais continuam funcionando.</p>`,
      ),
    ),
  )
}
