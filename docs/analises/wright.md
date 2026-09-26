# Inventário e amostragem: N. T. Wright / For Everyone

Análise exploratória para orientar a abertura de comentário por passagem. Limitada à estrutura e qualidade dos PDFs; não é interpretação bíblica nem revisão de sermão.

## Arquivos localizados

Inventário dos PDFs locais da série For Everyone. Há seis volumes distintos, incluindo duas partes de John e Romans Part 2, além de uma cópia extra de Matthew Part 2. Outros títulos gerais de Wright não foram tratados como comentários versículo a versículo.

| Volume | Páginas físicas | Texto e estrutura observados |
|---|---|---|
| John for Everyone, Part 1 (chapters 1-10) | 194 | Sumário e 51 bookmarks; texto extraível nas páginas de conteúdo; inclui texto bíblico e comentário em páginas separadas. |
| John for Everyone, Part 2 (chapters 11-21) | 202 | Sumário e 52 bookmarks; texto extraível; páginas do texto bíblico e do comentário se distinguem por layout e numeração impressa. |
| Luke for Everyone | 336 | Sumário e 97 bookmarks; texto extraível nas páginas de conteúdo; uma entrada por perícope. |
| Matthew for Everyone, Part 1 (chapters 1-15) | 238 | Sumário e 63 bookmarks; texto extraível; seções por perícope. |
| Matthew for Everyone, Part 2 (chapters 16-28) | 242; uma cópia duplicada | Sumário e 60 bookmarks; texto extraível; seções por perícope. |
| Paul for Everyone: Romans Part 2 | 184 | Sem bookmarks; texto extraível nas páginas de conteúdo; sumário e cabeçalhos repetidos delimitam perícopes. Seção Romans 13.8-14 amostrada abaixo. |

Títulos gerais encontrados, fora da série prioritária: `Surpreendido pela esperança` e `Como Deus se tornou rei`. Não foi feita amostragem integral dessas obras.

## Amostra verificável

PDF local examinado visualmente: John for Everyone, Part 2.

| Referência / função | Página física PDF (1-based) | Página impressa | Evidência |
|---|---:|---:|---|
| Sumário | 7 | preliminar | Lista `John 11.1-16` e página impressa 1. |
| John 11.1-16, texto bíblico | 15 | 1 | Cabeçalho `JOHN 11.1-16`; texto em bloco vertical destacado. |
| John 11.1-16, comentário | 16 | 2 | Mesmo cabeçalho corrente, subtítulo `Why didn't they do something?`; prosa corrida. |
| John 11.17-27, comentário começa | 19 | 5 | Bookmark aponta à página física 19; texto impresso anterior encerra a seção 11.1-16. |

As páginas físicas 15 e 16 foram renderizadas e inspecionadas. A página física 15 contém somente a passagem bíblica nesta amostra; a 16 abre o comentário. A extração via pypdf preservou cabeçalho, passagem/prosa e a numeração impressa para essas páginas. Pequenos artefatos de hifenização e espaços aparecem na extração, portanto texto extraído serve para localizar, não como substituto visual/fonte de citação.

Checagem adicional de Luke for Everyone: bookmark `Luke 1.1-4` aponta à página física 17; o sumário (página física 9) dá página impressa 1. Na amostra textual, física 17 traz a passagem e a 18 continua o comentário, ambos com o cabeçalho da perícope. Isso reforça que o começo da seção corresponde ao texto bíblico e o comentário segue, mas a fronteira pode atravessar mais de uma página.

### Consulta direcionada: Romanos 13:8-14

No volume local Romans Part 2, há uma seção dedicada e exata, não apenas menções incidentais: título `Romans 13.8-14 — Love, the Law and the Coming Day`. O sumário, página física 7, a lista na página impressa 88. Este PDF não tem bookmarks. O título de seção e o cabeçalho corrente repetido nas páginas de comentário confirmam o bloco; o texto da passagem aparece sob o mesmo título.

| Função | Página física PDF (1-based) | Página impressa | Evidência |
|---|---:|---:|---|
| Sumário da seção | 7 | preliminar | Lista `Romans 13.8-14`, `Love, the Law and the Coming Day`, página impressa 88. |
| Início da seção e texto bíblico | 102 | 88 | Cabeçalho corrente 13.8-14; título em destaque; texto bíblico vv. 8-14 em bloco; comentário começa abaixo na mesma página. |
| Continuação do comentário | 103-107 | 89-93 | Cabeçalho da seção repetido. A página impressa 93 tem número pouco legível na extração, mas a página seguinte confirma 94. |
| Próxima perícope, Romans 14.1-6 | 108 | 94 | Novo título/cabeçalho e texto bíblico iniciam a seção seguinte; encerra o intervalo anterior. |

A página física 102 foi renderizada e inspecionada. Ela começa com o final do comentário da seção anterior (Romans 13.1-7), depois exibe o título `ROMANS 13.8-14`, o bloco bíblico completo e o início do comentário. Para abrir a seção exata, usar PDF página 102 / impressa 88, avisando que há algumas linhas da perícope anterior no topo. O bloco dedicado termina antes do novo cabeçalho Romans 14.1-6 na página física 108; não existe subdivisão dedicada a 13:8 dentro deste volume.

## Implicações para indexação e abertura

- Indexar por livro bíblico, capítulo/versículos, volume/parte, página física e página impressa. Guardar também a origem do localizador (bookmark, sumário ou texto detectado) e um nível de confiança.
- Nos volumes amostrados, os bookmarks do tipo `John 11.1-16` apontam ao início da perícope e concordam com o sumário. Para uma referência que caia dentro do intervalo, buscar a perícope que a contém e abrir na página física do bookmark; mostrar também a página impressa indicada pelo sumário.
- Não equiparar número impresso a índice PDF: John 11.1-16 começa em física 15 / impressa 1; há 14 páginas preliminares. A interface deve usar índice físico internamente e apresentar “p. impressa” como localizador humano, preservando ambos.
- Não classificar toda menção extraída a uma referência bíblica como comentário dedicado. A unidade dedicada é delimitada pelo título de seção/bookmark e seu intervalo até a próxima seção dedicada. Menções dentro da prosa não devem gerar novas unidades. Se não houver bookmark (como Romans 2 observado), recorrer a sumário e cabeçalhos repetidos; não inferir trecho dedicado apenas por correspondência de referência no corpo.
- Separar a página bíblica inicial do comentário quando o layout indicar essa fronteira; não descartar a página bíblica, pois ela faz parte do bloco dedicado e orienta a navegação. Na amostra, ambas compartilham a referência/título corrente.
- Não copiar texto integral dos PDFs para o repositório. Armazenar metadados/localizadores e extratos mínimos necessários para busca; abrir o PDF de origem na página física localizada.

## Método e limites

Metadados de páginas obtidos com `pdfinfo`; bookmarks, texto e localização física com `pypdf` do runtime empacotado. John Part 2 páginas 15-16 e Romans Part 2 página 102 foram renderizadas com Poppler (`pdftoppm`) do sistema e inspecionadas. Dependências estavam disponíveis no runtime (`pypdf 6.10.0`, `pdfplumber 0.11.9`); nada instalado. A amostragem de estrutura/texto abrange os seis volumes da série listados; a inspeção visual cobre as páginas indicadas de John Part 2 e Romans Part 2. Não valida OCR/extratividade de cada página de todos os arquivos, nem estabelece direitos/licença para uso ou redistribuição do conteúdo.
