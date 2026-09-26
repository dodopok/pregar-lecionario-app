# Análise técnica de um sermão no Google Drive

Leitura somente para validar requisitos do app, em 26 de setembro de 2026. Fonte: um Google Doc nativo de referência informado pelo usuário; o identificador foi omitido. O manuscrito não foi copiado para este repositório. Esta análise não avalia conteúdo, interpretação ou qualidade da redação.

## Observado

| Medida | Resultado | Método e alcance |
| --- | ---: | --- |
| Abas | 1 | Estrutura retornada pelo Google Docs API. |
| Parágrafos | 50 | 25 com texto e 25 vazios, intercalados. |
| Palavras | 2.115 | Segmentação lexical do texto extraído; não é contagem de tokens de modelo. |
| Caracteres | 11.474 | Inclui espaços e quebras de linha, em unidades de texto da extração. Sem espaços: 9.320. |
| Parágrafo mais longo | 196 palavras | Há parágrafos substanciais; o menor parágrafo com texto tem 15 palavras. |
| Formatação | Arial 10, estilo `NORMAL_TEXT` nos 50 parágrafos | Um trecho em negrito e 12 trechos em itálico. O documento está em modo de páginas, tamanho A4 e margens de aproximadamente 28,35 pt. |

Não foram encontrados títulos semânticos, listas, notas de rodapé, hiperlinks, tabelas ou imagens neste arquivo. Alguns trechos de citação ou ênfase estão em itálico dentro dos parágrafos, sem um bloco de citação semanticamente distinto. Não há metadados de página calculada na resposta consultada; a contagem de páginas e a duração oral informadas pelo usuário não foram medidas aqui.

O título identifica a passagem central, `Romanos 13:8-14`. O corpo contém outras referências bíblicas em texto livre, entre elas `Romanos 7`, `Salmos 119` e `Romanos 12:2`. A identificação automática de referências precisa distinguir passagem principal, citações no manuscrito e leituras da celebração. Uma amostra de títulos da mesma pasta inclui nomes por passagem (`Mateus 21:23-32`, `Romanos 11:1-2a, 29-32`) e por ocasião (`Porto - 20/09/2026`, `Porto - 13/09/2026`, `Porto - 06/09/2026`). Só os títulos foram consultados; o conteúdo desses arquivos não foi aberto. A mistura impede tratar o nome do arquivo como campo canônico único para busca por passagem e data.

## Implicações propostas

- Guardar passagem principal, ocasião/data, demais leituras e referências citadas como campos distintos. Preservar também o título original e permitir correção manual da extração de referências.
- Representar o manuscrito com blocos estáveis e marcas de formatação em trechos. A revisão pode apontar um intervalo real dentro de um bloco; observações globais de estrutura não precisam apontar um trecho arbitrário. Associar cada revisão à versão do manuscrito e ao contexto bíblico recebido.
- Não depender de títulos formatados para reconhecer começo, desenvolvimento ou conclusão. Este exemplo usa somente parágrafos normais e espaçamento por linhas vazias. Na importação e exportação, conferir a manutenção dessas separações, da ordem dos blocos e dos trechos em negrito/itálico.
- Manter o editor e a exportação capazes de títulos, listas, notas de rodapé e citações, conforme os requisitos confirmados no [plano de produto](../plano-produto.md). A preservação desses elementos exige outro documento de teste, pois estão ausentes nesta amostra. Também testar se uma citação marcada apenas por itálico deve continuar assim na importação, sem conversão automática para bloco de citação.
- Nas revisões de ortografia, fidelidade, estrutura, clareza e tom, enviar o manuscrito completo quando solicitado e produzir observações ancoradas no texto existente. As perguntas de emergência permanecem ação separada. A ferramenta não deve alterar o documento, sugerir redação, aplicações ou ideias novas, conforme o [contrato de IA](../ia-byok.md).

## Custo e limites da medição

As 2.115 palavras e os 11.474 caracteres medem somente este manuscrito. Não equivalem a tokens faturáveis. O cenário de 20.000 tokens de entrada e 5.000 de saída por revisão em `ia-byok.md` continua hipotético: inclui passagem, traduções, comentários, instruções e possivelmente raciocínio cobrado na saída. Esta amostra sugere medir separadamente a contribuição de cada parte do pacote real antes de ajustar o cenário; o tamanho dos comentários pode dominar a entrada. Nenhuma API de modelo foi chamada e nenhum custo real foi medido.

Esta é uma amostra de um sermão, sem validação de sincronização bidirecional, edição externa, exportação para tablet, recuperação por ocasião, listas, títulos, notas ou paginação final. O Google Doc foi apenas lido; não houve alteração, comentário ou exportação no Drive.
