# Progresso de implementação

Atualizado em 26 de setembro de 2026.

## Fatia inicial

O projeto começou como um protótipo nativo para macOS, mantendo a implementação pequena enquanto valida a consulta litúrgica e a escrita local.

- Navegação por data com livro `loc_2027`.
- Consulta da Estêvão API v2, com a NVT como tradução principal, idioma e tipo de leitura configuráveis.
- Host fixo da API: `https://api.caminhoanglicano.com.br`. O painel exibe o servidor, sem permitir editá-lo.
- Chave da API guardada no Acesso às Chaves do macOS; as demais preferências ficam localmente.
- Exibição das leituras, coletas, comemorações e cores do dia.
- Rascunho de sermão local por data, com editor formatado básico e salvamento automático.
- Cliente da API v2 preparado para buscar uma passagem bíblica isolada por tradução, base da comparação futura.
- Projeto gerado pelo XcodeGen, com a definição versionada em `project.yml`.

O app ainda não inclui biblioteca de PDFs, leitores de sites, revisão por IA, integração com Google Drive nem importação das ideias do iPhone. Esses itens continuam no escopo documentado, mas serão construídos depois de validar a base e seus contratos.

## Host da API

O app inicialmente usava o domínio do site, `https://estevao.caminhoanglicano.com.br`. A rota v2 nesse host responde com uma página HTML de 404. A configuração de deploy e a definição OpenAPI no repositório `estevao-api` identificam o host correto da API: `https://api.caminhoanglicano.com.br`.

O host agora é uma constante do app. Um 404 sem corpo JSON da API informa que a rota v2 não foi encontrada, o que ajuda a distinguir um erro do site de um erro de validação produzido pela própria API.

## Verificação

- Geração do projeto XcodeGen concluída.
- Compilação do app concluída com Xcode 26.1.1.
- O relatório de falha anexado correspondeu à execução direta do binário do app, que aborta durante o registro do processo no AppKit. A abertura do bundle via LaunchServices (`open Pregar.app`) iniciou a interface normalmente; o erro não se reproduziu nesse fluxo.
- A rota no host do site foi consultada sem chave e retornou a página HTML de 404 do site. Depois de fixar o host da API e abrir o bundle atualizado pelo LaunchServices, o app carregou leituras e coleta do LOC 2027 para 27/09/2026, confirmando a conexão autenticada.
- Ainda não há suíte automatizada de testes.

## Próximos passos

1. Implementar a comparação de traduções e consulta de capítulos completos. O cliente de passagens está pronto; a tela aguarda a referência visual do protótipo, solicitada em 26/09/2026.
2. Completar o editor local e acertar recuperação e apresentação do manuscrito.
3. Importar os PDFs, localizar capítulos por passagem e abrir na página física correta.
4. Integrar os sites favoritos num espaço de pesquisa com navegação interna.
5. Sincronizar sermões com o Drive e importar o documento separado de ideias do iPhone.
6. Implementar a revisão BYOK dentro dos limites de autoria definidos no plano de produto.
