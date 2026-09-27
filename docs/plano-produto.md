# App de preparação de sermões

Primeiro plano de produto, atualizado em 26 de setembro de 2026.

Este documento registra a conversa de descoberta. Requisitos confirmados aparecem como tais; propostas e decisões pendentes não representam escolhas já aprovadas. A implementação do protótipo começou; o registro incremental está em [progresso](progresso.md).

## 1. Propósito e uso confirmado

Reunir leitura bíblica, consulta de fontes, escrita e revisão em um ambiente que preserve a concentração e a autoria do pregador.

- Uso inicialmente pessoal; uma eventual distribuição para outras pessoas fica para depois.
- Preparação no Mac, com três monitores: leituras/sites, editor e comentários.
- O processo começa pela releitura das passagens, passa pelos comentários e avança com ideias e pequenos parágrafos no próprio manuscrito.
- Anotações e sermão ficam juntos. O usuário apaga as notas à medida que o texto se torna um manuscrito contínuo.
- Cada preparação começa do zero. O arquivo deve permitir reencontrar sermões pela data/celebração litúrgica ou pela passagem bíblica.
- O livro de oração usado é o LOC 2027 (`loc_2027`). Conforme informado pelo usuário, ele adota o Lecionário Comum Revisado Expandido, com as mesmas leituras do LCR aos domingos.
- Cada sermão se concentra em uma leitura, geralmente o Evangelho, podendo ter outra leitura como texto principal.
- NVT é a tradução principal; outras traduções são usadas para comparação.
- A escrita acontecerá no app. Uma cópia atualizada no Drive é suficiente para o arquivo do sermão.
- Ideias ocasionais são anotadas no Drive pelo iPhone. O usuário escolheu manter um documento separado de ideias, a ser lido pelo app.
- O sermão é lido no aplicativo do Drive em um tablet Android. O usuário também possui um iPad. O formato atual do arquivo ainda não foi especificado.
- O editor deve oferecer negrito, itálico, títulos, listas, notas de rodapé e citações.
- Citações podem ser de qualquer tipo, incluindo poemas, frases e trechos de livros. O usuário escolhe e insere o conteúdo manualmente.
- O manuscrito habitual tem cerca de três páginas no Google Docs, em Arial 10, e rende aproximadamente 20 a 24 minutos de pregação. Páginas e duração são referências do uso atual, não limites impostos à escrita.
- A maioria dos PDFs contém texto selecionável; alguns livros antigos podem precisar de OCR.
- A revisão deve aparecer num painel separado por critérios, com ligação ao trecho do manuscrito quando aplicável.
- A revisão de fidelidade pode consultar os comentários da preparação, identificando a fonte e distinguindo divergência interpretativa de contradição bíblica.
- A IA deve funcionar com BYOK: chaves próprias para OpenAI, Anthropic/Claude, Google/Gemini e Perplexity, priorizando modelos intermediários.
- O tom deve considerar moralismo, abstração, informalidade e caráter pastoral.
- O usuário normalmente solicita duas ou três revisões por preparação.

## 2. Experiência proposta

1. Escolher a celebração no LOC 2027 e consultar as leituras do dia.
2. Abrir uma preparação com manuscrito vazio e o contexto litúrgico fornecido pela Estêvão API.
3. Reler as passagens em NVT e comparar traduções, incluindo o contexto do capítulo quando desejado.
4. Escolher a leitura principal e consultar seus materiais: capítulos dos próprios PDFs, artigos das fontes favoritas e sugestões de outras fontes. A escolha pode acontecer depois da releitura inicial; as demais leituras continuam acessíveis.
5. Abrir PDFs nas páginas relevantes e artigos em seus endereços originais, navegando dentro do app.
6. Escrever e reorganizar livremente o mesmo documento, com salvamento local e histórico recuperável.
7. Solicitar revisões específicas quando desejar. Perguntas para destravar ficam numa ação separada.
8. Preparar uma versão para o tablet e manter a cópia do Drive atualizada.
9. Arquivar o sermão com sua ocasião, passagens e materiais associados.

O calendário escolhe o contexto da preparação. Ele não deve impor um roteiro de escrita ou etapas obrigatórias.

### Leitura principal do sermão

Proposta: abrir com o LOC 2027 como preferência e o Evangelho em destaque, mantendo todas as leituras disponíveis para consulta. O usuário pode deixar o texto principal indefinido enquanto lê, escolhê-lo depois ou trocá-lo durante a preparação.

- Priorizar a pesquisa de materiais para a passagem escolhida. Materiais das outras leituras ficam acessíveis como contexto.
- Mudar a leitura principal atualiza a prioridade dos resultados, preservando o manuscrito, as notas e os materiais já selecionados.
- Guardar a passagem principal separadamente das demais leituras da celebração e das referências citadas no manuscrito.
- Permitir recuperar o sermão pela passagem principal e identificar quando um resultado de busca corresponde apenas a uma leitura de contexto.
- Avaliar a fidelidade bíblica em relação à passagem escolhida e ao seu contexto. A revisão não deve exigir que o sermão integre todas as leituras do domingo.

### Janelas e concentração

Proposta: editor, leitor bíblico e leitores de materiais podem ocupar janelas independentes ou compartilhar a mesma janela. O usuário distribui o trabalho entre os monitores.

- Restaurar documentos, páginas e posições de leitura ao reabrir uma preparação.
- Manter navegação entre os sites e permitir adicionar links manualmente.
- Abrir a pesquisa nas fontes favoritas e nas páginas da preparação.
- Oferecer um modo de escrita que recolha os materiais quando desejado.
- Não contar apenas com a troca de navegador para resolver a dispersão; validar a experiência numa preparação real.

## 3. Descoberta de materiais

Encontrar o capítulo e o artigo corretos é um requisito central, e deve ser validado cedo.

### A passagem como referência principal

O contexto deve guardar data, livro de oração, celebração, ciclo, tipo de leitura, variantes, leituras da celebração e passagem principal escolhida para o sermão. O LOC 2027 é a referência litúrgica do usuário; a correspondência dominical informada com o LCR orienta a busca nas fontes que o seguem, sempre conferindo os intervalos efetivos. O nome do domingo, isoladamente, não é uma chave suficiente para encontrar recursos de tradições diferentes.

Representar referências por livro, capítulo e intervalos de versículos, preservando também a grafia original. Considerar nomes em português/inglês, intervalos descontínuos, versículos opcionais e diferenças de numeração quando aplicáveis.

Cada resultado deve identificar a relação encontrada:

- Trata da mesma passagem.
- Trata de uma seção maior que contém a passagem.
- Tem sobreposição parcial, exibindo o intervalo coberto.
- É material de contexto ou uma correspondência ainda não confirmada.

Um artigo de outro ano pode ser pertinente à passagem atual. Uma coincidência de data, título do domingo ou palavra-chave não basta para classificá-lo como correspondente.

### Biblioteca de PDFs

Proposta de importação e indexação:

1. Identificar obra, autor, volume, edição e idioma; permitir corrigir os metadados.
2. Extrair o texto e o sumário preservando a ligação com as páginas do arquivo.
3. Aplicar OCR apenas nas páginas que precisarem, mantendo o PDF original.
4. Relacionar capítulos/seções às passagens comentadas. Distinguir uma seção dedicada ao texto de uma citação ocasional dentro de outro capítulo.
5. Guardar página física do PDF, localizador editorial quando verificável e início/fim da seção, incluindo a posição dentro de páginas compartilhadas. Não presumir que números de índices de PDFs convertidos correspondam à edição comercial impressa.
6. Permitir corrigir a página inicial e memorizar o vínculo para consultas futuras.

Quando a localização for incerta, mostrar os candidatos e permitir a seleção manual. A ausência de um resultado confiável não deve produzir uma página inventada.

### Amostra real da biblioteca

Análise exploratória realizada em 26 de setembro de 2026, sem alterar os originais. Os relatórios registram caminhos, método e limites: [Wright / For Everyone](analises/wright.md), [Feasting on the Word](analises/feasting.md) e [sermão no Drive](analises/sermao-drive.md). A inspeção foi amostral, não uma indexação completa.

O documento fornecido pelo usuário, intitulado `Romanos 13:8-14`, permitiu testar a mesma referência nos dois comentários:

| Fonte | Resultado verificado | Implicação |
| --- | --- | --- |
| Wright, Romans Part 2 | Seção exata de Romanos 13:8-14 nas páginas físicas 102-107, impressas 88-93; localização por sumário e cabeçalhos, sem bookmarks. | Abrir na física 102. A página também contém o fim da seção anterior; o contexto enviado à IA precisa respeitar o início efetivo da seção. |
| Feasting, Year A, Volume 4 | Seção exata nas páginas físicas 96-108; quatro perspectivas, cada uma com seu autor identificado ao final. A primeira e a última página também contêm material de unidades vizinhas. | Manter uma unidade de leitura e quatro ensaios atribuídos separadamente, delimitando o trecho dentro das páginas compartilhadas e preservando vínculos de retorno à fonte. |
| Feasting, Year A, Volume 1 | Seção de Romanos 13:11-14. | Mostrar como sobreposição parcial, sem apresentá-la como comentário de todo o intervalo 13:8-14. |

Os PDFs amostrados do Feasting são conversões com texto extraível e disposição em uma coluna nas páginas renderizadas. Os números indicados em seus índices não foram confirmados como paginação da edição comercial. No Wright, alguns volumes têm bookmarks úteis, mas Romans Part 2 não; portanto, bookmarks são uma ajuda, não um requisito da importação.

Proposta decorrente da amostra: priorizar sumários, cabeçalhos e intervalos bíblicos para localizar seções. Uma busca textual complementar pode ajudar, mas encontrar uma menção no corpo não basta para classificar a seção como comentário dedicado. Extrair e atribuir trechos corretamente para revisão é uma validação distinta de conseguir abrir o PDF na página certa. Nenhum desses mecanismos foi implementado ou medido em escala.

### Sites favoritos e novas fontes

Fontes iniciais indicadas pelo usuário:

- Working Preacher.
- Anglican Compass.
- My Pastoral Ponderings.
- Ponderings on a Faith Journey.

Proposta: consultar índices, buscas e feeds disponíveis em cada fonte, guardar os endereços efetivamente encontrados e verificar a referência bíblica na página. O mecanismo de cada site precisa de uma integração própria e de uma alternativa manual quando falhar.

Os resultados devem mostrar título, autoria, fonte, tradição quando conhecida, idioma, passagem e data de publicação. Isso permite avaliar a fonte antes de lê-la. Não gerar resumos interpretativos ou aplicações para o sermão por padrão.

Para novas recomendações, começar por um catálogo de fontes com autoria e responsabilidade editorial identificáveis. O usuário poderá favorecer, ocultar ou desativar fontes. Além de N. T. Wright e das fontes iniciais, Michael Bird, Scot McKnight, Fleming Rutledge, Andrew McGowan e Richard Bauckham foram indicados como referências de qualidade. Não foram explicitadas linhas a excluir. A curadoria deve usar esses exemplos sem presumir adesão a todas as posições desses autores nem transformar a denominação em garantia automática de qualidade.

Guardar resultados confirmados por passagem e reaproveitar essa pesquisa. Uma falha em um site não deve impedir a leitura dos PDFs ou dos outros sites. Evitar varreduras completas e repetidas das fontes.

### Evidências pesquisadas

O [Working Preacher](https://www.workingpreacher.org/) distingue Revised Common Lectionary e Narrative Lectionary. A apresentação de [Notes on the Lectionary, do Anglican Compass](https://anglicancompass.com/what-is-notes-on-the-lectionary/), situa a série no contexto da ACNA. Isso reforça a necessidade de conferir as passagens efetivas.

O arquivo de [My Pastoral Ponderings](https://mypastoralponderings.com/author/jelaurence/) inclui referências bíblicas nos títulos de diversos sermões. Há resultados indexados de [Ponderings on a Faith Journey](https://www.bobcornwall.com/search/label/faith) com passagens e identificação litúrgica; a consulta direta à página inicial retornou HTTP 429 nesta pesquisa. A navegação completa e as integrações dos quatro sites ainda não foram testadas.

## 4. Escrita e autoria

### Editor

Requisitos confirmados: negrito, itálico, títulos, listas, notas de rodapé e citações.

Propostas complementares:

- Salvamento local imediato, desfazer/refazer e versões recuperáveis.
- Texto contínuo, sem obrigar a escrever em blocos de introdução, desenvolvimento e conclusão.
- Referências de origem opcionais para trechos copiados de PDFs ou sites, com título, página/endereço e ligação à fonte.
- Notas de rodapé e citações como elementos do documento, preservadas nas exportações.
- Manuscrito salvo em formato estruturado que mantenha a formatação e a história; o arquivo enviado ao Drive é uma representação desse documento.
- Preservar a preferência visual por Arial 10 como opção inicial do editor, sem impor uma quantidade de páginas. A apresentação de leitura no tablet pode ser ajustada independentemente da escrita.

Confirmado: citações são conteúdo de qualquer tipo, como poemas, frases e trechos de livros, escolhido e inserido manualmente pelo usuário. Não exigem um gerenciador bibliográfico automático. Proposta de edição: permitir citações no parágrafo ou em bloco destacado, com autoria e referência adicionadas livremente, inclusive em nota de rodapé, sem exigir cadastro de obra. Preservar quebras de verso, estrofes, ênfase e atribuição ao salvar e exportar. O app e a IA não devem escolher nem inserir citações por conta própria.

A amostra do Drive contém 2.115 palavras, 25 parágrafos com texto e 25 vazios intercalados, Arial 10, um trecho em negrito e 12 em itálico. Não contém títulos semânticos, listas ou notas de rodapé. Isso reforça a necessidade de preservar escrita contínua, espaçamento e ênfase sem impor divisões ao autor; não elimina os recursos adicionais solicitados. A contagem de páginas não foi medida. Títulos de outros arquivos da mesma pasta variam entre passagem e ocasião/data, reforçando que esses campos devem ser guardados separadamente do nome do documento.

### Contrato da revisão por IA

A IA não escreve o sermão, não completa parágrafos, não sugere frases, não oferece aplicações e não muda o manuscrito. A ortografia pode mostrar a grafia correta de uma palavra, conforme autorizado.

| Critério | Comportamento permitido |
| --- | --- |
| Ortografia | Localizar o erro e apresentar a grafia correta, sem reescrever a frase. |
| Fidelidade bíblica | Relacionar uma afirmação do manuscrito a uma possível tensão com a passagem e seu contexto, mostrando a evidência textual. |
| Estrutura | Examinar início, desenvolvimento, conclusão, ideia central e relações entre partes já escritas. |
| Clareza | Localizar ambiguidades, relações pouco claras e dificuldades de compreensão. |
| Tom | Examinar moralismo, abstração, informalidade e caráter pastoral; apontar os efeitos do texto existente sem propor redação. |
| Perguntas de emergência | Fazer perguntas sobre ideias já presentes, mediante solicitação específica, sem introduzir interpretação ou aplicação nova. |

Fidelidade deve distinguir contradição textual, afirmação sem apoio suficiente na passagem e questão interpretativa. O usuário autorizou consultar comentários. Proposta: usar os materiais incluídos na preparação, apresentando autor, obra, página/endereço e o trecho que sustenta a observação. A interpretação de um comentarista não deve ser apresentada como se fosse a própria passagem bíblica, e uma divergência confessional não deve virar erro objetivo. Traduções comparadas e referências utilizadas precisam ficar identificadas.

Formato aprovado: painel separado por critérios, com observações ligadas aos trechos do manuscrito quando houver um trecho específico. Clicar numa observação destaca o texto correspondente; questões sobre a estrutura geral podem aparecer sem uma ligação artificial a uma frase. Perguntas de emergência continuam em uma ação separada.

Proposta de critérios de tom: distinguir moralismo de exortação bíblica, abstração que dificulta a compreensão de profundidade teológica, informalidade excessiva de linguagem oral natural e cuidado pastoral de sentimentalismo. Não exigir uma intervenção em cada critério nem impor um estilo uniforme a todo sermão.

Proposta de funcionamento: cada revisão fica associada a uma versão do manuscrito e ao contexto bíblico analisado, e cada observação aponta um trecho real. Alterações posteriores no texto, na passagem principal ou nas traduções usadas tornam a observação potencialmente desatualizada. Revisões podem ser descartadas pelo usuário.

O uso habitual de duas ou três revisões favorece analisar o manuscrito inteiro em cada solicitação, preservando o contexto necessário para estrutura e ideia central. Proposta: relatórios concisos, histórico por versão e marcação manual de observações como resolvidas ou descartadas. Uma nova revisão não deve declarar automaticamente resolvida uma observação anterior apenas porque deixou de mencioná-la.

O modelo não recebe uma operação de edição do manuscrito. Respostas precisam ser verificadas quanto a formato, referências e comportamentos proibidos. Uma instrução de sistema sozinha não garante que a IA nunca ofereça redação; esse limite exige avaliação com exemplos reais antes do uso.

Critérios de aceitação: nenhuma alteração automática no manuscrito; nenhuma reescrita em revisões; nenhuma pergunta de emergência não solicitada; observações fundamentadas no texto analisado; ausência de preenchimento artificial quando não há problema a apontar.

### BYOK e modelos

Confirmado: integrar modelos existentes por API usando as chaves do usuário, com suporte a OpenAI, Anthropic/Claude, Google/Gemini e Perplexity. Não há necessidade prevista de treinar ou hospedar um modelo próprio.

Proposta: uma configuração de provedor/modelo para revisão e outra, opcional, para descoberta de materiais. Uma única chave deve permitir começar; não exigir assinatura ou conta em todos os serviços. Trocar de provedor mantém os critérios e a interface, mas a qualidade e a adesão aos limites precisam ser avaliadas em cada modelo.

O manuscrito e os trechos dos comentários usados na revisão serão enviados à API escolhida ao solicitar a revisão. A descoberta de materiais pode usar apenas a passagem e os critérios de fontes, sem enviar o sermão. Salvar, escrever e ler os PDFs locais continuam independentes da IA.

Modelos candidatos, limites de contexto, tratamento das chaves e validação estão detalhados em [IA com BYOK](ia-byok.md). A seleção é provisória e deve ser reavaliada na implementação; não foram realizadas chamadas pagas ou testes com manuscritos nesta etapa.

## 5. Drive, iPhone e tablet

### Cópia no Drive

Confirmado: encontrar uma cópia atualizada do sermão no Drive é suficiente. Proposta: um Google Doc por sermão, na pasta escolhida, mantendo o mesmo identificador nas atualizações.

- Salvar localmente antes de enviar ao Drive.
- Exibir a última atualização concluída e quando houver envio pendente.
- Retomar envios após interrupções sem criar um novo documento a cada tentativa.
- Conferir alterações externas antes de substituir conteúdo; não sobrescrever silenciosamente uma edição feita pelo usuário no Drive.
- Validar a preservação de listas, notas de rodapé e citações numa exportação real.

A [API do Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads) permite atualizar arquivos existentes, mas a conversão durante uma atualização pode substituir todo o conteúdo de um Google Doc. A cópia de leitura no Drive também não equivale, por si só, ao backup de todo o histórico, PDFs e estado do app. Uma exportação restaurável desses dados deve entrar no desenho de persistência.

### Ideias pelo iPhone: decisão confirmada

O usuário escolheu um documento separado de ideias no Drive. O app deve ler esse documento e disponibilizar as anotações para incorporação ao manuscrito por ação do usuário. O documento de ideias não é um destino da exportação automática do sermão.

Proposta: uma caixa de entrada de ideias no app, com registro do que já foi importado e indicação de novas alterações. Não apagar as ideias da origem automaticamente, não incorporá-las duas vezes e não tratar texto editado como uma anotação inteiramente nova sem verificar sua origem. A escolha da preparação de destino deve permanecer com o usuário.

### Uso no tablet

Confirmado: tablet Android, aplicativo do Drive; há também um iPad disponível. Manter esse caminho atende ao uso atual sem exigir um segundo aplicativo de pregação.

Proposta inicial: preparar uma versão de leitura pelo Drive, com tamanho de fonte confortável e notas preservadas. Validar Google Doc e PDF no aparelho real antes de escolher o formato principal. Preparar acesso offline antes da pregação e garantir que a versão aberta permaneça estável, mesmo que uma sincronização ou revisão termine naquele momento. Um app próprio para tablet não está previsto na primeira versão proposta.

## 6. Base técnica existente

Inspeção de código local realizada em 26 de setembro de 2026. Não foram consultados banco de produção, credenciais ou APIs autenticadas.

- `estevao-api` é uma aplicação Rails. O catálogo em `db/seeds/bible_versions.rb` inclui `nvt`.
- Existem seeds próprios do LOC 2027 em `db/seeds/prayer_books/loc_2027/`, com leituras dominicais e opções semicontínua/complementar. A preferência do usuário entre essas opções ainda não foi informada.
- `config/routes.rb` já declara endpoints v2 para dias, leituras, coletas, passagens e traduções.
- O deploy e o OpenAPI do backend apontam para `https://api.caminhoanglicano.com.br`; `estevao.caminhoanglicano.com.br` é o site, não o host da API. O endereço é fixo no app, não editável no painel.
- `app/controllers/api/v2/passages_controller.rb` aceita `ref` e `bible`, permitindo buscar uma passagem fora do calendário e comparar versões.
- A v2 exige chave de API, conforme `app/controllers/api/v2/base_controller.rb`.
- A presença de NVT no catálogo não comprova a completude dos seus versículos no ambiente de produção.
- `lecionario-anglicano` usa Nuxt/Vue. Seu `app/composables/useApi.ts` consome o calendário e o lecionário v1; os tipos e a interface já contemplam dados de leitura.
- O endpoint v1 específico de lecionário serializa referências. A obtenção de texto completo deve usar um contrato apropriado, como a passagem v2, e ser validada no ambiente utilizado.

Direção proposta: consumir a API existente para calendário e Bíblia. Manter manuscritos, biblioteca e histórico no app pessoal, sem ampliar a API para armazená-los por necessidade presumida.

## 7. Plataforma e limites da primeira versão

Decisão de implementação: começar com um app nativo para macOS, priorizando armazenamento local, janelas independentes, editor e leitores integrados. O protótipo de referência visual e de interação é [Pregar para macOS](https://marvelous-syrniki-65b530.netlify.app/pregar-macos.html), com as telas 3a–3f fornecidas pelo usuário. SwiftUI, PDFKit e WebKit são a base inicial do app. A Apple oferece suporte a [múltiplas janelas](https://developer.apple.com/documentation/swiftui/windows), [PDFs](https://developer.apple.com/documentation/pdfkit) e [páginas web](https://developer.apple.com/documentation/webkit/wkwebview).

Na reprodução visual, conservar a composição, hierarquia tipográfica, painéis recolhíveis, abas e folhas demonstradas no protótipo. A cor de acento segue a cor litúrgica do dia fornecida pela API, não uma cor fixa. O host da Estêvão API é sempre `https://api.caminhoanglicano.com.br` e não é editável, mesmo que uma captura do protótipo mostre um campo de endereço de exemplo.

A escolha do componente de edição permanece aberta. Notas de rodapé, citações, persistência e exportação precisam ser comprovadas num pequeno protótipo antes de fechar a tecnologia. A possibilidade de usar um componente web dentro do app pode ser avaliada nessa etapa, sem assumir que a interface atual do lecionário resolve a escrita.

Escopo proposto para a primeira versão utilizável:

- Preparações e arquivo por celebração/passagem.
- Leituras em NVT e comparação de traduções via API.
- Editor com os recursos pedidos e recuperação de versões.
- Biblioteca de PDFs, vínculos por passagem, abertura em página e correção manual de localização.
- Navegação interna e descoberta de artigos nas fontes favoritas, com acesso manual quando a integração falhar.
- Sugestões de novas fontes a partir de um catálogo inicial ajustável.
- Revisão nos limites definidos, painel por critérios e suporte BYOK aos quatro provedores pedidos.
- Cópia no Drive, importação do documento separado de ideias e saída para pregar pelo Drive no tablet Android.

Distribuição pública, colaboração, assinaturas e editores completos para celular/tablet não são requisitos da primeira versão.

## 8. Validação antes de construir o app completo

1. Escolher uma celebração real do LOC 2027 e obter suas leituras e textos na API, incluindo NVT e uma segunda versão. Confirmar as alternativas usadas e a disponibilidade da v2 no ambiente. Testar uma preparação centrada no Evangelho e outra centrada em uma leitura diferente.
2. Transformar a amostra documental de Romanos 13:8-14 em teste de localização: Wright física 102, Feasting A/4 física 96 e Feasting A/1 identificado como parcial. Testar também extração em páginas compartilhadas, atribuição das quatro perspectivas e uma referência apenas mencionada em outro capítulo. Ampliar para um PDF digitalizado e medir o mecanismo implementado; a inspeção manual já realizada não valida sua automação.
3. Localizar os artigos correspondentes nos quatro sites favoritos. Validar sobreposição de passagens, anos diferentes, ausência de resultados e abertura/navegação dentro do leitor.
4. Testar um manuscrito com listas, notas de rodapé e citações manuais no editor, ao reabrir o arquivo, no Drive e no tablet. Incluir um poema com versos e estrofes, uma citação dentro do parágrafo e um trecho em bloco com atribuição. Simular interrupção de conexão e uma edição feita no Drive.
5. Avaliar revisões com manuscritos reais e casos sem problema em cada provedor/modelo candidato, verificando especialmente sugestões de redação disfarçadas de crítica, perguntas que introduzam ideias novas, uso fiel dos comentários e tratamento das observações de tom. Medir consumo e latência com o mesmo conjunto de entradas.
6. Fazer uma preparação completa e avaliar concentração, retorno às fontes e confiabilidade do salvamento antes de ampliar o catálogo e as automações.

## 9. Próximas decisões de produto

- Tablet: formato de arquivo atual e preferências de apresentação na leitura pelo Drive.
- Curadoria: formar um catálogo concreto a partir dos exemplos fornecidos, permitindo ajustes posteriores.
- Contexto litúrgico: preferência entre as opções semicontínua/complementar quando disponíveis no LOC 2027.
- Revisão: validar os critérios aprovados com exemplos de manuscritos e comentários; registrar ajustes de avaliação por provedor/modelo.
- BYOK: validar os modelos intermediários disponíveis na implementação e medir custo de duas ou três revisões por preparação, incluindo os comentários associados. A simulação inicial está em `ia-byok.md`.
- Ampliar a validação da biblioteca além das amostras examinadas, incluindo PDF digitalizado, limites de seção e qualidade de extração por autor.
- Plataforma e componente de edição após as validações, ainda sem compromisso de implementação.
