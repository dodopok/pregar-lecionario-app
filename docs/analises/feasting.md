# Feasting on the Word: levantamento técnico

## Escopo e amostra

Levantamento local, sem rede e sem transcrever conteúdo das fontes. Foram localizados quatro volumes Year A (2010–2011) e três cópias do PDF do Volume 1; as cópias têm hashes distintos, portanto não presumi duplicidade byte a byte. Há também EPUBs, fora do escopo. Inspecionei texto extraído e o sumário do Volume 1 e do Volume 4, além de unidades completas: Psalm 122 (Volume 1), Psalm 26:1–8 (Volume 4) e, após a passagem de teste ser identificada, Romans 13:8–14 (Volume 4). Renderizei e conferi visualmente a página física 31 do Volume 1 e a 34 do Volume 4. Os dois PDFs amostrados são exportações Calibre, tamanho letter (612 × 792 pt), não digitalizações puras.

PDFs locais amostrados: Feasting on the Word, Year A, volumes 1 e 4.

| Arquivo (nome-base em Downloads) | Páginas físicas | Qualidade observada |
|---|---:|---|
| `Feasting-on-the-Word_-Year-A_-Volume-1-…-2010-Westminster.pdf` (3 cópias) | 982 | Texto extraível e legível; espaçamento/ligaturas às vezes degradados na extração (`fi`/`fl`, hífens); layout impresso em uma coluna. |
| `Feasting-on-the-Word_-Year-A_-Volume-2-…-2010-Westminster.pdf` | 1.171 | Texto extraível nas páginas iniciais e amostra do corpo (100–105); qualidade integral não auditada. |
| `Feasting-on-the-Word_-Year-A_-Volume-3-…-2011-Westminster.pdf` | 828 | Início aparentemente sem texto extraível (páginas 1–2), mas corpo com texto extraível (20–25); provável conteúdo misto, não classificado integralmente. |
| `Feasting-on-the-Word_-Year-A_-Volume-4-…-2011-Westminster.pdf` | 761 | Texto extraível e legível; espaçamento/ligaturas às vezes degradados; layout impresso em uma coluna. |

Todos são letter. As contagens são páginas físicas do PDF, não páginas impressas do livro. Volume 1 aparece com sufixos de cópia `(1)` e `(2)` além do nome sem sufixo.

## Estrutura constatada

- O sumário organiza por domingos/tempos litúrgicos e lista quatro leituras bíblicas por entrada. Os títulos das unidades incluem referência e o texto bíblico vem antes das quatro perspectivas.
- A ordem das perspectivas observada é **Theological**, **Pastoral**, **Exegetical**, **Homiletical**. O nome do autor aparece ao final de cada ensaio, em versais; atribuição deve ficar ligada ao ensaio inteiro, não só ao capítulo/passagem.
- Uma unidade pode tratar de várias leituras do mesmo domingo. No Volume 1, o primeiro domingo de Advento inclui Isaiah 2:1–5, Psalm 122, Romans 13:11–14 e Matthew 24:36–44; cada leitura tem seu próprio conjunto de perspectivas. A chave correta precisa ser volume + referência normalizada, não apenas domingo.
- Volume 1, **Psalm 122**: PDF físico 31–42; localizador editorial 8 no índice desta conversão. As quatro perspectivas começam nas físicas 31, 34, 37 e 40. Autores observados ao final: Christian Scharen, David Holmes, Steven S. Tuell e Carol L. Wade, respectivamente.
- Volume 4, **Psalm 26:1–8**: PDF físico 33–44; localizador editorial 8 no índice desta conversão. As quatro perspectivas começam nas físicas 34, 37, 39 e 42. Autores: Mary Elise Lowe, Julie Peeples, Richard A. Puckett e Elizabeth P. Randall.
- **Romanos 13:8–14**, referência recebida para teste, corresponde exatamente ao Volume 4, na entrada Proper 18: começa no PDF físico 96 e termina na 108, onde a próxima leitura começa na mesma página; localizador editorial 38 no índice desta conversão. A página física 96 traz o cabeçalho e o texto bíblico; seguem as perspectivas Theological (97), Pastoral (100), Exegetical (102) e Homiletical (105). A verificação visual de 108 confirma o fim de Homiletical, assinado David L. Bartlett, seguido do título e começo do texto de Mateus 18:15–20 na mesma página. As outras autorias são Eleazar S. Fernandez, Rochelle A. Stackhouse e Christopher R. Hutson. No Volume 1 há Romanos 13:11–14, que se sobrepõe a 13:8–14 nos versículos 11–14, mas não é correspondência exata e não deve ser selecionado como se fosse o intervalo integral.
- **Mateus 21:33–46**, Proper 22 do Volume 4, começa na página física 314, compartilhada com o fechamento do comentário de Filipenses 3:4b–14, e termina na 328 antes da leitura de Isaías 25:1–9, que começa na 329. O teste do indexador confirma os offsets dos componentes: texto bíblico e perspectivas Theological, Pastoral, Exegetical e Homiletical, atribuídas respectivamente a Andrew Purves, Richard E. Spalding, Susan Grove Eastman e Marvin A. McMickle. Neste último ensaio, a assinatura vem antes das notas numeradas; o teste confirmou que ela é extraída sem ser incluída no trecho do comentário.
- As páginas amostradas são uma coluna, com títulos de seção destacados, texto corrido e autor alinhado ao final; não observei tabelas ou multicolunas nessas unidades. Texto e imagem visual concordam, embora a camada textual perca algumas ligaturas e acentos/traços em extrações.
- Sumários e índices remissivos são texto utilizável. Os localizadores editoriais 8 (Psalm 122) e 38 (Romans 13:8–14) constam no índice desta conversão; não foram verificados como paginação da edição comercial impressa. Armazene esse localizador apenas quando verificável e sempre separado da página física, sem calcular por offset fixo.
- A extração textual apresenta artefatos como caracteres perdidos em algumas palavras, por isso referências e títulos precisam de validação visual/estrutural.

## Indexação implementada e validada na amostra

O índice versão 4 representa o texto bíblico e as quatro perspectivas como componentes separados. Cada componente guarda página física e offset UTF-16 de início/fim, além da autoria identificada no fechamento do ensaio. A seção mantém também o método de localização; no volume amostrado, os bookmarks dão confiança alta. O texto bíblico e os ensaios não incluem o cabeçalho do próximo texto nem a linha do autor como prosa. Quando a leitura seguinte começa na mesma página, o intervalo termina no offset exato desse cabeçalho e a página compartilhada permanece no alcance da unidade.

Testes automatizados contra os PDFs locais confirmam Romanos 13:8–14 no Volume 4, páginas físicas 96–108, com as quatro autorias documentadas; Mateus 21:33–46 no Volume 4, páginas físicas 314–328, com as quatro autorias e o início em página compartilhada; e Romanos 13:11–14 no Volume 1 como sobreposição parcial. Um caso sintético cobre os limites dentro da página e a decodificação de registros antigos sem componentes. A indexação não altera os arquivos PDF e não envia conteúdo à rede.

## Próximos passos da indexação

1. Criar manifesto por PDF com ano, volume, caminho, hash, total de páginas físicas e estado de extração/OCR. Resolver também referências pelo sumário e índice remissivo quando os cabeçalhos não bastarem; guardar localizador editorial só quando verificável.
2. Ampliar a validação para outros volumes e avaliar layouts que não sigam a ordem observada. Ajustar limites quando a extração de PDF misturar cabeçalhos, autores ou páginas digitalizadas.
3. Exibir as perspectivas como segmentos selecionáveis e, para contexto de IA futuro, preservar referência, título da perspectiva, autor, volume/ano e páginas. A integração ainda não envia conteúdo do PDF a provedores.

## Limites

Não examinei todos os capítulos nem a integridade de todas as páginas. O texto extraído conserva a sequência linear dos ensaios; as páginas renderizadas mostram uma coluna, o que confirma a ordem nos exemplos amostrados. A extração sozinha não prova a ordem em layouts multicoluna nem permite generalizar para páginas não renderizadas. Não auditei bookmarks ou links internos, então eles não podem ser premissa de navegação. A classificação de páginas escaneadas foi amostral, sobretudo para o Volume 3. Não houve OCR em lote, teste de parser nem implementação no app. O relatório registra observações e estratégia técnica; não interpreta passagens nem propõe conteúdo de sermão.
