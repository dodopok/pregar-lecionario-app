# Plano multiplataforma e assinatura

Proposta registrada em 1 de novembro de 2026. Complementa o [plano de produto](plano-produto.md), que previa plataforma e componente de edição como decisões posteriores, e a [IA com BYOK](ia-byok.md). Nada aqui está aprovado; as decisões que dependem do dono do produto estão na seção 9.

## 1. Recomendação

São duas decisões separadas. A assinatura exige um backend próprio em qualquer plataforma. A multiplataforma exige reescrever o cliente, porque as partes difíceis do app atual são todas AppKit.

- Backend primeiro: contas, direitos de uso e um proxy de revisão no Rails que já serve a Estêvão API. Isso também remove a chave colada à mão e o OAuth Client ID que cada usuário cria hoje no Google Cloud.
- Cliente novo em Electron, Vue 3 e TypeScript: TipTap para o manuscrito, PDF.js para a biblioteca, WebContentsView para as abas de sites. O Leitor é um mini navegador e precisa de um Chromium igual nos três sistemas.
- BYOK continua como caminho sem servidor. A assinatura entra como quinto provedor ao lado de OpenAI, Anthropic, Google e Perplexity, atrás da mesma interface.
- Aposentar o app Swift quando o cliente novo chegar à paridade. Manter dois clientes com uma pessoa não fecha.

## 2. Ponto de partida

Cerca de um terço das 20 mil linhas de Swift é lógica portável e coberta por testes; o resto depende de frameworks que só existem no Mac. Swift compila em Windows e Linux, mas SwiftUI, AppKit, PDFKit, WebKit, SwiftData e Vision não. A suíte em `PregarTests` vira a especificação do porte.

| Área | Arquivos atuais | Depende de | Destino |
| --- | --- | --- | --- |
| Revisão por IA | SermonReview, AIResearch, AIReviewMaterials, AISettings | Foundation, CryptoKit | Portar para TypeScript com os testes; vira o pacote compartilhado com o proxy |
| Referências e fontes | FavoriteReferences, FavoriteSiteSearch, FavoriteSourceURLs | Foundation | Portar com os testes |
| Lecionário e Bíblia | LiturgicalAPI, APISettings, APISettingsView | Foundation, Keychain | Portar; a chave passa a vir da conta |
| Google Drive e Docs | GoogleDrive | Foundation, OAuth por loopback | Portar; cliente OAuth único registrado pelo produto |
| Histórico e backup | SermonHistory, PregarBackup | SwiftData, RTF, CryptoKit | Portar o formato; importador no app novo |
| Editor | RichTextEditor, ManuscriptEditor, DocumentEditing, DocumentRTF | NSTextView, RTF | Reescrever em TipTap, documento em JSON |
| Leitor | ReaderSession | PDFKit, WKWebView | Reescrever: PDF.js e WebContentsView |
| Biblioteca | PDFLibraryIndex | PDFKit, Vision | Reescrever: PDF.js e tesseract.js, ou OCR no servidor |
| Mesa e janelas | PreparationWorkspace, WorkspaceChrome, WorkspaceSheets, LibraryArchiveViews, WindowChrome, PregarApp | SwiftUI, AppKit | Reescrever em Vue; janelas independentes via BrowserWindow |
| Tablet | TabletPDFExporter | CoreText, AppKit | Reescrever: impressão em PDF do Chromium |
| Design | PrototypeStyle | SwiftUI, AppKit | Converter os tokens para CSS custom properties |

O que não muda: a Estêvão API em Rails, o contrato da revisão, os critérios do workshop e os documentos em `docs/`.

## 3. Plataforma

Electron com Vue 3 e TypeScript, porque o Leitor exige um Chromium embutido e igual nos três sistemas, e porque Vue e Rails já são a stack do lecionário e da API. O custo é um binário de 150 a 250 MB e disciplina de segurança; o primeiro não importa para leigos, o segundo está resolvido na seção 4.

| Opção | O que resolve | Onde falha para o Pregar | Veredito |
| --- | --- | --- | --- |
| Electron + Vue 3 | Chromium igual nos três sistemas; WebContentsView para abas de sites; PDF.js; assinatura de código e auto-update maduros; tudo em TypeScript | Binário grande; exige contextIsolation, sandbox e sessão separada para páginas de terceiros | Recomendado |
| Tauri 2 + Vue 3 | Binário pequeno; seguro por padrão | Webview do sistema: WebKitGTK antigo no Linux e renderização diferente por sistema; múltiplos webviews ainda instáveis; parte nativa em Rust | Só se tamanho for prioridade |
| Flutter desktop | Renderização consistente | Editor rico e webview fracos no desktop; webview sem suporte oficial em Windows e Linux | Descartado |
| .NET MAUI ou Avalonia | Boa base no Windows | Webview e editor rico fracos; C# fora da stack | Descartado |
| Qt | QtWebEngine, QPdf e editor rico | Toolchain pesado em C++ ou Python; fora da stack | Descartado |
| Web pura (PWA) | Zero instalação, ideal para leigos | Não embute sites de terceiros em aba; PDFs locais só em Chrome e Edge; OCR local desconfortável | Versão leve do mesmo frontend, não o produto principal |
| Swift multiplataforma | Reaproveita a lógica atual | Nenhum framework de interface, PDF, web ou OCR fora do Mac | Descartado |

A versão leve no navegador vale como porta de entrada: a pessoa experimenta calendário, leituras, editor e revisão por assinatura sem instalar nada, e baixa o app quando quiser a biblioteca de PDFs e o Leitor.

## 4. Arquitetura alvo

Um monorepo com o cliente desktop, um pacote de domínio compartilhado e o backend. A revisão BYOK e a revisão por assinatura passam pelo mesmo contrato: muda só quem segura a chave e quem monta o prompt.

```
apps/desktop        Electron: processo principal, preload, renderer Vue 3
apps/web            o mesmo renderer no navegador, versão leve (opcional)
packages/core       contrato de revisão e validação, referências, lecionário,
                    busca em sites, Drive, formato de backup (porte do Swift testado)
packages/editor     esquema TipTap, ids de bloco, exportação HTML/DOCX/Google Docs
services/ai-proxy   Node, importa packages/core, fala com os quatro provedores
```

Fluxos:

- Renderer para o Rails: login, direitos de uso, lecionário e Bíblia v2.
- Renderer para o proxy: revisão, perguntas e pesquisa por assinatura.
- Renderer para os provedores: BYOK, direto, sem tocar o servidor do produto.
- Proxy para os provedores: com as chaves do produto, prompt e esquema montados no servidor, cotas aplicadas.
- Rails e meio de pagamento: webhooks.
- Processo principal: SQLite local, chaves em safeStorage, janelas independentes para Leitor, Biblioteca e Arquivo, impressão em PDF para o tablet, auto-update.
- Leitor: uma WebContentsView por aba de site, em sessão própria, sem acesso ao manuscrito nem às chaves.

Regras de segurança do Electron, não negociáveis: contextIsolation e sandbox ligados; nodeIntegration desligado; IPC tipado só com as operações que o renderer precisa; Leitor em WebContentsView com partition própria, sem preload e sem IPC; CSP estrita no renderer; chaves só no processo principal.

Onde fica o proxy: em Node, importando o mesmo pacote de revisão do cliente, não há duplicação de prompt e validação. Em Rails, a suíte de testes atual vira o contrato entre os dois. A recomendação é Node pequeno ao lado do Rails.

## 5. Assinatura

A assinatura é um quinto provedor atrás da mesma interface, servido por um proxy de revisão. Não é um proxy genérico de prompts: o endpoint só sabe revisar, perguntar e pesquisar materiais, com o contrato que o app já valida hoje.

- Conta. Login por email com link mágico ou pelo Google. A chave da Estêvão API passa a ser emitida por conta no login. O cliente OAuth do Google passa a ser um só, com o escopo `drive.file` já usado; a verificação do Google acontece uma vez.
- Proxy de revisão. Três operações: revisão, perguntas de emergência e pesquisa de materiais. Cada uma recebe o mesmo pacote que hoje vai direto ao provedor, monta prompt e esquema no servidor, valida e devolve o JSON do contrato atual. Sem prompt livre, sem ferramentas de edição, mesmo limite de entrada do app.
- Cotas. Por revisão, não por token. A base de uso é de duas a três revisões por sermão. Um plano mensal com um número de revisões e de perguntas; acima disso, bloqueio claro ou BYOK.
- Custo de modelo. A simulação de [ia-byok.md](ia-byok.md) dá US$ 0,27 por três revisões com Sonnet 5 ou GPT-6 Sol e US$ 0,10 com Gemini Flash, no cenário de 20 mil tokens de entrada e 5 mil de saída. Um pregador semanal custa de US$ 0,45 a US$ 1,20 por mês em modelo, antes de câmbio, impostos e tentativas repetidas. Medir o pacote real antes de fixar preço.
- Privacidade e LGPD. O manuscrito passa a transitar pelo servidor do produto. Não persistir por padrão; registrar só metadados, como o log de integrações já faz. Termos de uso, política de privacidade e contratos de API dos provedores sem retenção para treino. BYOK continua sem tocar o servidor, e isso é argumento de venda.
- Pagamento. Para público brasileiro, Pix pesa. Stripe, Asaas ou Pagar.me cobrem Pix e cartão; conferir emissão de nota fiscal e a necessidade de CNPJ. Lojas de app levam de 15% a 30% e complicam o BYOK; venda direta com o direito de uso verificado no backend.
- Antiabuso. Limite de requisições por conta, tamanho máximo de entrada, cota dura, alerta de gasto diário e nenhuma repetição automática paga.

## 6. Fases

Estimativas grosseiras, assumindo uma pessoa em dedicação integral. Em meio período, dobre. Cada fase tem uma porta de saída verificável.

| Fase | Duração | Entregas | Porta de saída |
| --- | --- | --- | --- |
| 0 · Provas de conceito | 1 a 2 semanas | TipTap com nota de rodapé, citação em bloco e ids de bloco estáveis, exportando HTML; PDF.js abrindo Wright na física 102 e Feasting A/4 na 96, com texto e sumário; WebContentsView com abas, voltar/avançar e posição restaurada | As três provas passam os critérios já descritos em `docs/analises` |
| 1 · Backend | 3 a 5 semanas | Rails: contas, planos, direitos de uso, chave da Estêvão API por conta, webhook de pagamento. Proxy: revisão, perguntas e pesquisa com o contrato atual, cotas, log só de metadados. Cliente OAuth único submetido à verificação do Google | Revisão pelo proxy desconta a cota; BYOK intocado |
| 2 · Mac atual ligado ao backend | 1 a 2 semanas | No app Swift: login, provedor Pregar ao lado dos quatro, Drive pelo cliente único, exportador HTML de manuscritos e histórico. Depois disso, só correções no Swift | Um mês pagando e usando a própria assinatura |
| 3 · Cliente novo em Electron | 3 a 4 meses | 3a core em TypeScript com os testes portados; 3b Mesa, calendário, leituras, editor, histórico e painel de revisão; 3c biblioteca, indexação e Leitor; 3d Drive, tablet, backup e importador; 3e assinatura de código, instaladores e auto-update nos três sistemas. Beta com dois ou três pastores no Windows a partir de 3b | Uma preparação real completa no Windows, sem voltar ao Mac |
| 4 · Lançamento | 2 a 4 semanas | Migração guiada pelo backup, lançamento, app Swift só em manutenção. Versão leve no navegador apenas se decidido | App Swift aposentado |

A fase 2 serve para o dono do produto usar a própria assinatura, não para medir demanda: o público leigo está no Windows. A fase 3 só começa com o backend no ar e o app Swift congelado.

## 7. Migração de dados

O backup local que o app já gera é o veículo da migração; só manuscritos e histórico precisam de conversão, porque hoje são RTF. O app novo lê o pacote inteiro de uma vez.

| Dado | Onde está hoje | Como migra |
| --- | --- | --- |
| Manuscritos | SwiftData, em RTF; `Drafts.json` no backup | Última função do app Swift: exportar cada manuscrito em HTML com os ids de bloco; importador TipTap no app novo |
| Histórico de versões | Pasta `SermonHistory`, um JSON por sermão com RTF dentro | Converter cada versão para HTML no mesmo exportador; se pesar, migrar só a versão atual e guardar as antigas como anexo |
| Relatórios de revisão | Um JSON por data em Application Support | Copiar sem converter, mantendo o esquema do contrato; conferir se já entram no backup |
| Biblioteca e índices | `Library.json` e `SectionLinks.json`; PDFs nos caminhos originais | Reindexar com PDF.js; reaproveitar obra, autor, página inicial e vínculos corrigidos à mão |
| Sessão do Leitor | `Reader.json` e páginas lembradas | Reimportar abas, URLs e páginas; posições dentro da página são opcionais |
| Preferências | `Preferences.plist` | Mapear para a tabela de preferências do SQLite |
| Chaves | Acesso às Chaves do macOS | Não migram; a pessoa redigita ou entra na conta |
| Log de integrações | `Logs/integracoes.log` | Não migra |

O exportador em HTML é a única mudança de código no app Swift exigida pela migração. Vale fazer na fase 2, para testar o importador do TipTap com manuscritos reais desde o início.

## 8. Riscos e mitigações

| Risco | Efeito | Mitigação |
| --- | --- | --- |
| Reescrita longa demais para uma pessoa | Dois clientes vivos, nenhum pronto | Congelar o Swift depois da fase 2; portar primeiro o que tem testes; beta cedo no Windows |
| Editor regride no que custou caro | Digitação instável, quebras erradas, atalhos perdidos | TipTap é maduro; usar as verificações de [progresso.md](progresso.md) como roteiro de aceite; prova de conceito na fase 0 |
| Custo da assinatura foge do previsto | Prejuízo por usuário | Cota dura por revisão, teto de tokens de saída, alerta diário de gasto, medir o pacote real antes do preço |
| Injeção de prompt via manuscrito ou comentário chega ao servidor | Saída fora do contrato | Mesmas regras de hoje: sem ferramentas, esquema estrito, validação contra trechos literais, endpoint sem prompt livre |
| Verificação do Google atrasa | Drive indisponível para leigos | Submeter na fase 1; `drive.file` é o escopo menos exigente |
| Windows marca o instalador como desconhecido | Leigos desistem na instalação | Assinar desde a primeira beta; certificado OV ou Azure Trusted Signing |
| Linux tem público pequeno e empacotamento variado | Esforço sem retorno | AppImage primeiro; Flatpak só se houver pedido |
| Direitos autorais dos PDFs dos usuários | Exposição legal | PDFs nunca sobem; só trechos delimitados vão para a revisão, como hoje; OCR no servidor só por página e sem retenção |
| Electron mal configurado expõe o sistema | Site de terceiro acessa arquivos ou chaves | contextIsolation e sandbox ligados, nodeIntegration desligado, Leitor em sessão separada sem preload, CSP estrita |
| Dependência de um único provedor de IA na assinatura | Indisponibilidade ou alta de preço | O proxy já fala com quatro provedores; trocar o padrão é configuração no servidor, sem release |

## 9. Decisões em aberto

Nenhuma bloqueia a fase 0.

- [ ] Proxy em Rails ou em Node? Recomendação: Node pequeno ao lado do Rails, compartilhando o pacote de revisão.
- [ ] Login só pelo Google ou também por email?
- [ ] OCR local com tesseract.js ou no servidor?
- [ ] Meio de pagamento e pessoa jurídica: Stripe, Asaas ou Pagar.me; CNPJ e nota fiscal.
- [ ] Preço e cota do plano, depois de medir o custo real por revisão.
- [ ] Versão leve no navegador: sim ou não.
- [ ] Manter o app Swift depois da paridade? Recomendação: não.
- [ ] Nome e marca: Pregar como produto próprio ou dentro do Caminho Anglicano.
- [ ] Linux no lançamento ou depois?
