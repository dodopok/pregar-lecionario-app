# IA com BYOK

Planejamento e registro da implementação complementar ao [plano de produto](plano-produto.md). A revisão BYOK foi conectada em 27 de setembro de 2026; nenhuma chave ou conteúdo de sermão foi enviado a um provedor durante o desenvolvimento.

## 1. Requisito confirmado

Usar APIs de modelos existentes com chaves do próprio usuário. Suportar OpenAI, Anthropic/Claude, Google/Gemini e Perplexity, priorizando modelos intermediários. O app controla os critérios de revisão, o contexto enviado e a apresentação dos resultados. Treinamento ou hospedagem de um modelo próprio não faz parte do plano.

## 2. Configuração proposta

- Provedor e modelo de revisão, com uma opção intermediária recomendada após avaliação.
- Provedor de descoberta de materiais opcional, que pode ser diferente do revisor.
- Uma chave basta para começar. A busca manual nos sites e os vínculos já indexados não dependem de uma segunda chave.
- Cadastro, teste de conexão, substituição e remoção de chaves nas preferências.
- Guardar as chaves no Keychain do macOS, fora dos documentos, exportações e logs.
- Fazer chamadas no componente nativo do app; páginas de terceiros abertas no leitor não recebem chaves nem acesso ao manuscrito por uma ponte de integração.
- Mostrar o provedor que receberá o conteúdo e as fontes incluídas na revisão, com preferências reutilizáveis.
- Não trocar automaticamente de provedor quando houver falha. Permitir nova tentativa ou uma troca escolhida pelo usuário.
- Consumo da API cobrado pela conta correspondente. O fluxo BYOK deve usar credenciais de API, sem presumir que uma assinatura do aplicativo de chat concede acesso equivalente.

## 3. Candidatos para avaliação

Esta tabela é uma proposta baseada nos catálogos oficiais consultados, e não um resultado de comparação com sermões. "Intermediário" descreve o compromisso procurado entre qualidade, custo e latência, sem pressupor capacidades idênticas entre fornecedores.

| Provedor | Candidato inicial | Observação |
| --- | --- | --- |
| OpenAI | `gpt-6-sol` | A documentação o posiciona como equilíbrio entre capacidade e custo; suporta respostas estruturadas. |
| Anthropic | `claude-sonnet-5` | Candidato da família Sonnet para avaliar revisão e obediência aos limites. |
| Google | `gemini-3.8-flash` | Candidato estável da família Flash; suporta respostas estruturadas. |
| Perplexity | `perplexity/sonar` | Usa o Agent API (`/v1/agent`) com JSON Schema; sem ferramentas de busca na revisão. A descoberta de materiais é um fluxo separado. |

Fontes: [OpenAI: modelos](https://developers.openai.com/api/docs/models), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [Claude: modelos](https://platform.claude.com/docs/en/models/overview), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) e [Perplexity: modelos da Agent API](https://docs.perplexity.ai/docs/agent-api/models).

Para descoberta, a [Search API da Perplexity](https://docs.perplexity.ai/docs/search/quickstart) é uma candidata a retornar páginas e metadados. A [Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart) permite controlar modelos e ferramentas. A proposta de revisão usa um modelo explícito com ferramentas de busca desabilitadas; a pesquisa de fontes ocorre em outra operação, sem enviar o manuscrito.

O nome do modelo `perplexity/sonar` continua disponível no catálogo da Agent API; isso não significa usar o endpoint legado Sonar. Revisão e descoberta Perplexity usam o endpoint Agent (`/v1/agent`) e extraem fontes verificáveis dos resultados/anotações da resposta, sem pedir URLs inventadas dentro do JSON. A revisão desativa as ferramentas de pesquisa e define `store: false`.

Na revisão e nas perguntas, `response_format` envia JSON Schema, e a resposta só é decodificada dos blocos `message`/`output_text`. O `name` do schema segue a restrição documentada pela Agent API: 1–64 caracteres alfanuméricos. O schema assegura a forma do objeto; a validação local ainda confere âncoras e escopo, que não podem ser garantidos apenas pelo tipo JSON.

Os identificadores e as capacidades devem ficar num catálogo atualizável. Preferir versões estáveis e registrar qual modelo efetivamente executou cada revisão. Não selecionar silenciosamente modelos mais caros ou versões novas ainda não avaliadas.

## 4. Contexto da revisão

O pacote enviado deve conter:

1. Identificador da versão do manuscrito, texto e identificadores estáveis dos seus blocos.
2. Passagem principal, traduções efetivamente utilizadas e contexto bíblico selecionado.
3. Critérios solicitados e regras de autoria.
4. Seções pertinentes dos comentários incluídos na preparação, com identificador, autor, obra, página ou URL.

O app deve permitir inspecionar os materiais incluídos. Proposta: trabalhar com os materiais explicitamente associados à preparação, sem enviar toda a biblioteca. Quando o contexto exceder o limite do modelo, informar quais materiais ficaram de fora ou pedir uma seleção menor, sem alegar que revisou fontes que não recebeu.

O manuscrito e as fontes são dados a analisar, não instruções que alteram o contrato de revisão. Uma citação não autoriza operações de edição, novas buscas ou envio a outro destino.

O uso dos comentários está autorizado. Toda observação que depender de um comentário deve identificar sua origem. Distinguir evidência da passagem, interpretação do comentarista e dúvida da revisão. Atribuições a autores exigem suporte no material fornecido, sem completar citações ou páginas pela memória do modelo.

A [amostra do Feasting](analises/feasting.md) confirma quatro ensaios de autores distintos na seção de Romanos 13:8-14. Cada ensaio precisa chegar ao modelo com sua autoria e perspectiva, não apenas com o nome dos organizadores do volume. A [amostra do Wright](analises/wright.md) mostra o início de uma seção na mesma página em que termina a anterior: selecionar páginas inteiras sem delimitar o conteúdo pode misturar contextos. Abertura do PDF e extração para IA exigem verificações separadas.

## 5. Resposta e interface

Formato aprovado: painel separado em Ortografia, Fidelidade ao texto, Estrutura, Clareza e Tom, com ligações ao manuscrito quando aplicáveis. Perguntas para aprofundar ficam disponíveis em uma ação separada, de emergência.

Uso confirmado: manuscrito de aproximadamente três páginas no Google Docs em Arial 10, pregação de 20 a 24 minutos e duas ou três revisões por preparação. Não se deduz uma contagem exata de palavras ou tokens apenas dessas medidas.

Proposta: analisar o manuscrito inteiro em cada revisão, manter observações concisas e preservar os relatórios anteriores ligados às versões que analisaram. Permitir marcar manualmente observações como resolvidas ou descartadas. Uma nova chamada não precisa reproduzir todo o histórico de respostas do modelo, que poderia ampliar o contexto e induzir repetição das críticas.

Proposta de contrato comum entre provedores:

- Critério e observação objetiva.
- Trecho do manuscrito e referência ao bloco, opcionais quando a observação for global.
- Fundamentação e fontes utilizadas, quando aplicáveis.
- Distinção entre erro identificável e questão interpretativa.
- Grafia correta apenas para uma correção ortográfica localizada.
- Identificador do manuscrito/contexto analisado e registro do provedor/modelo.

Não incluir campos para reescrita, frase sugerida, aplicação alternativa ou continuação do sermão. Clicar numa observação só seleciona o trecho correspondente. A IA não recebe ferramentas de edição.

As APIs oferecem mecanismos de saída estruturada: [OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs), [Claude](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini](https://ai.google.dev/gemini-api/docs/structured-output) e [Perplexity](https://docs.perplexity.ai/docs/agent-api/building-agents/shape-output). Cada integração deve converter o mesmo contrato para o formato suportado, sem presumir que todos usam os mesmos parâmetros.

Validar cada resultado antes de apresentá-lo: critério conhecido, ligação existente no manuscrito, fonte incluída, citação realmente presente e resposta concluída. Um esquema válido não garante correção teológica nem ausência de sugestões disfarçadas; essas propriedades exigem avaliação de conteúdo. Apontamentos inválidos são ocultados individualmente; os válidos podem ser apresentados junto de um aviso que informa somente contagem e categorias fixas, nunca o texto rejeitado. JSON incompleto ou ilegível não vira uma revisão concluída.

## 6. Critérios de tom

Critérios aprovados pelo usuário, com esta interpretação proposta para validação:

- Moralismo: examinar quando o texto se reduz a cobrança de desempenho ou culpa; não classificar toda exortação como moralismo.
- Abstração: localizar formulações difíceis de acompanhar ou desconectadas do raciocínio apresentado; não exigir que a IA invente exemplos ou aplicações.
- Informalidade: avaliar expressões que prejudiquem a ocasião e o público, preservando a naturalidade da linguagem oral.
- Caráter pastoral: observar cuidado com o ouvinte, generalizações e formulações potencialmente acusatórias, sem forçar um tom sentimental.

As observações devem explicar o efeito percebido e localizar sua base no manuscrito, mantendo a decisão com o autor. Não há exigência de apontar problemas em todos os critérios.

## 7. Custo e falhas

Propostas para manter o uso previsível:

- Revisão sob comando, sem chamadas a cada tecla.
- Uma solicitação pode avaliar vários critérios em conjunto, evitando repetir o mesmo contexto por padrão.
- Registrar tokens, ferramentas utilizadas e custo informado pelo provedor; estimativas ficam identificadas como estimativas.
- Limitar tamanho de resposta, esforço de raciocínio e buscas conforme as capacidades do modelo.
- Reaproveitar resultados de uma revisão apenas quando manuscrito, fontes, contexto, regras e modelo forem os mesmos.
- Tratar chave inválida, saldo insuficiente, limite de uso, indisponibilidade e resposta incompleta sem bloquear a escrita ou perder o manuscrito.
- Limitar tentativas automáticas, evitando custos repetidos. Cancelamento da interface não deve ser apresentado como garantia de cancelamento da cobrança.

### Simulação de custo por preparação

O usuário informou duas ou três revisões por sermão. Para uma ordem de grandeza, usar um cenário ilustrativo de 20.000 tokens de entrada por revisão (manuscrito, passagens, comentários e instruções) e 5.000 tokens de saída faturáveis, incluindo raciocínio quando cobrado. Esses números são hipóteses para cálculo, não uma medição do manuscrito nem um limite máximo garantido.

O [sermão amostrado no Drive](analises/sermao-drive.md) tem 2.115 palavras e 11.474 caracteres, incluindo espaços e quebras de linha. Essas medidas não foram convertidas em tokens faturáveis e não validam, por si só, o cenário de 20.000/5.000. A medição futura deve separar manuscrito, passagens, comentários, instruções e saída efetivamente cobrada. Nenhuma chamada paga de revisão foi realizada com essa amostra.

Tarifas padrão consultadas em 26 de setembro de 2026, sem cache, lote, ferramentas de busca ou chamadas adicionais:

| Provedor/modelo | Entrada por milhão | Saída por milhão | Duas revisões | Três revisões |
| --- | --- | --- | --- | --- |
| OpenAI / GPT-6 Sol | US$ 2,00 | US$ 10,00 | US$ 0,18 | US$ 0,27 |
| Anthropic / Claude Sonnet 5 | US$ 2,00 | US$ 10,00 | US$ 0,18 | US$ 0,27 |
| Google / Gemini 3.8 Flash | US$ 0,75 | US$ 3,75 | US$ 0,0675 | US$ 0,10125 |
| Perplexity / google/gemini-3.8-flash | US$ 0,75 | US$ 3,75 | US$ 0,0675 | US$ 0,10125 |

Cálculo: revisões × ((tokens de entrada × tarifa de entrada + tokens de saída × tarifa de saída) / 1.000.000).

Fontes das tarifas: [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-sol), [Anthropic](https://platform.claude.com/docs/en/models/overview), [Google](https://ai.google.dev/gemini-api/docs/pricing) e [Perplexity](https://docs.perplexity.ai/docs/agent-api/models). A tabela do Google informa que suas tarifas padrão do Gemini 3.8 Flash passam a US$ 1,50 de entrada e US$ 7,50 de saída por milhão em 1 de janeiro de 2027. Nesse mesmo cenário, duas ou três revisões custariam US$ 0,135 ou US$ 0,2025 diretamente no Google. Essa mudança não foi presumida para a tarifa da Perplexity.

A simulação cobre apenas a revisão e não inclui pesquisa de materiais, OCR pago, tentativas adicionais, impostos ou câmbio. O volume de comentários e o raciocínio faturado podem mudar significativamente o resultado. A avaliação deve medir o pacote real e registrar o custo por preparação; não assumir frequência semanal ou um custo mensal sem informação sobre quantos sermões são preparados.

## 8. Avaliação antes do uso

Comparar modelos com o mesmo conjunto de manuscritos e comentários e julgamento do usuário sobre a utilidade das observações.

- Ortografia com correções localizadas, sem reescritas.
- Afirmação realmente contrária à passagem e interpretação legítima que diverge de um comentário.
- Referência inventada, fonte ausente e citação incorreta.
- Sermão com linguagem oral, exortação e profundidade teológica que não devem ser automaticamente tratadas como defeitos.
- Texto sem problemas relevantes, para verificar ausência de críticas artificiais.
- Tentativas de sugerir redação, ideias ou aplicações em cada critério e nas perguntas de emergência.
- Comentário com instruções alheias à tarefa, para verificar que permanece apenas como fonte.
- Mudança de texto ou de passagem durante a revisão, com observações marcadas como pertencentes à versão anterior.
- Resposta interrompida, inválida ou com trechos que não existem no manuscrito.

Só recomendar um modelo após ele atender aos limites de autoria e fundamentação, além de apresentar custo e latência aceitáveis. O cumprimento perfeito dessas restrições não deve ser prometido apenas com base nas instruções enviadas ao modelo.

## 9. Implementação atual

- As chaves existentes no Acesso às Chaves são lidas fora da thread principal e usadas diretamente pelo app; as chamadas seguem ao endpoint oficial do provedor, sem passar por um servidor Pregar. A tela informa o provedor e o modelo antes do envio.
- A ação Revisar permite selecionar Ortografia, Fidelidade, Estrutura, Clareza e Tom. O sermão só é enviado após o clique explícito em “Enviar revisão”. O app não fornece ao modelo ferramentas de edição.
- Perguntas de emergência são uma ação separada, acionada manualmente, e retornam no máximo três perguntas curtas ancoradas em trechos literais do manuscrito. Resposta, ideia, interpretação, aplicação ou proposta de redação não fazem parte do formato; os resultados são temporários e não alteram nem são salvos no sermão.
- Fidelidade exige que o texto bíblico principal esteja carregado. Apenas nessa categoria são incluídas as traduções disponíveis e as abas do Leitor que foram marcadas explicitamente. Abas antigas não são consideradas consentimento; páginas Web e PDFs novos começam desmarcados. PDFs enviam a seção localizada da referência ou da página, sem o caminho local do arquivo; para o Feasting, os ensaios e autores são preservados.
- Sem Fidelidade, somente o manuscrito e os critérios selecionados são enviados. Fontes não marcadas e a biblioteca inteira não entram na chamada.
- Cada fonte tem limite de 24 KB e o conjunto de manuscrito e fontes, de 120 KB antes da requisição. A extração de PDFs sem componentes delimitados também para em seções acima de 36 páginas. Se algum limite exceder, o envio é bloqueado e o app informa para desmarcar a fonte; nunca trunca ou descarta material silenciosamente.
- Data litúrgica e título do rascunho ficam no armazenamento local e são omitidos do pacote externo; cada ação envia apenas os campos de texto/referência e fontes necessários, além dos critérios na revisão.
- Os quatro provedores usam saída JSON estruturada. Antes da exibição, o app valida critério, campos permitidos e trechos literais do manuscrito/fonte; a correção de Ortografia aceita somente uma palavra. Resposta que falha na validação não é exibida como revisão.
- O texto é enviado diretamente ao provedor com sua chave, e as regras de retenção do respectivo provedor se aplicam. No pedido Perplexity não são habilitadas ferramentas; OpenAI e Perplexity recebem `store: false`.
- A interface não recebe nem persiste o manuscrito completo no relatório. Guarda localmente o provedor/modelo, critérios, trechos citados, observações, horário e impressão digital do texto analisado; relatórios ficam no Mac e as observações aparecem como antigas se o manuscrito mudar.
- A suíte automatizada cobre contratos HTTP simulados dos quatro provedores, autenticação, formato estruturado, seleção explícita de abas, rejeição de citação não verificável/sugestão explícita, perguntas temporárias com âncoras e persistência sem manuscrito integral. Nenhuma chamada real foi feita.

Limite importante: validações estruturais e filtros de linguagem não conseguem provar que uma interpretação está correta nem detectar toda sugestão indireta. Antes de uso pastoral, ainda é necessário avaliar respostas reais de cada provedor com sermões de teste escolhidos pelo usuário. Sincronização do Drive e conexão do documento separado de ideias continuam pendentes.
