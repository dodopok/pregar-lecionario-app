# Progresso de implementação

Atualizado em 26 de setembro de 2026.

## Referência visual

O protótipo navegável indicado pelo usuário é [Pregar para macOS](https://marvelous-syrniki-65b530.netlify.app/pregar-macos.html). A página foi aberta no Chrome e seus seis estados e folhas interativas foram inspecionados. As capturas anexadas permanecem a referência visual de detalhe.

- 3a Mesa: calendário, leituras, editor, materiais/ideias/revisão e folhas de revisão, perguntas de emergência, tablet e versões.
- 3b Leitor: abas simultâneas para PDFs e sites, localização física e editorial, confiança, correção e inclusão na revisão.
- 3c Bíblia: perícope/capítulo e comparação alinhada de traduções.
- 3d Preferências: Estêvão API, IA, Drive/tablet e Biblioteca.
- 3e Biblioteca: importação, metadados e seções por obra.
- 3f Arquivo: busca por passagem, ocasião ou data.

Os textos, contagens, nomes de obras abertas e estados de conexão que aparecem no protótipo são demonstrativos, não dados persistidos pelo app. O endereço exibido no protótipo também é ilustrativo: por decisão explícita do usuário, a Estêvão API fica fixa em `https://api.caminhoanglicano.com.br` e não é editável nas Preferências. A cor de acento da interface acompanha a cor litúrgica retornada para o dia; o verde das capturas não é uma cor permanente.

## Fatia atual

O projeto é um app nativo para macOS, com armazenamento local e consumo da Estêvão API v2.

- Mesa em três painéis: calendário e navegação, leituras, manuscrito e painel contextual.
- Navegação por data no LOC 2027; Evangelho selecionado por padrão quando há rascunho novo, sem impedir a escolha de outra leitura.
- Leituras, coletas, comemorações e cor vêm da API. O acento litúrgico é aplicado dinamicamente.
- Editor local em RTF, com negrito, itálico, título, citação, lista e inserção de marcador/área de nota de rodapé.
- Comparação de uma passagem em duas traduções pela Estêvão API v2, com alternância entre perícope e capítulo.
- Painel contextual com abas Materiais, Ideias e Revisão. As quatro fontes favoritas abrem num WKWebView embutido; ainda não há busca automática por passagem nem leitor web com abas persistentes.
- Biblioteca local permite importar PDFs, ler páginas com PDFKit, mostrar metadados básicos e bookmarks do sumário. Ainda não indexa referências bíblicas por texto/cabeçalho, corrige páginas nem faz OCR.
- Arquivo local lista sermões e busca por título, passagem ou data. Ocasião litúrgica, relações de materiais, comparação/restauração de versões e estado do Drive ainda não estão implementados.
- Folhas de revisão, perguntas e preparação para tablet representam os limites e opções do protótipo, mas enviar à IA e atualizar o Drive ficam desativados até as integrações BYOK e Google Drive existirem.
- Chave da Estêvão API guardada no Acesso às Chaves do macOS. Livro, idioma, tradução principal e modalidade de leituras ficam localmente.

Ainda faltam a navegação de materiais em abas como na tela 3b; as quatro áreas completas de Preferências; indexação de capítulos/passagens dos PDFs, correção manual e OCR; pesquisa e curadoria reais de sites; persistência de ideias; histórico recuperável; BYOK para OpenAI, Anthropic, Google e Perplexity; revisão segura com evidências; autenticação/sincronização Google Drive e saída de leitura para tablet.

## Host da API

O app inicialmente usava `https://estevao.caminhoanglicano.com.br`, domínio do site que responde com uma página HTML de 404 na rota v2. O deploy e a definição OpenAPI do repositório `estevao-api` identificam `https://api.caminhoanglicano.com.br` como host correto.

O host é uma constante do app e a tela da Estêvão API não permite editá-lo. Um 404 sem corpo JSON informa que a rota v2 não foi encontrada, distinguindo-o de erros JSON produzidos pela própria API.

## Verificação

- Projeto regenerado com XcodeGen após incluir as novas telas.
- `xcodebuild -quiet -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' -derivedDataPath /private/tmp/pregar-prototype-derivedData build` concluiu com código 0.
- Não há suíte automatizada de testes.
- A abertura da build recém-compilada por LaunchServices falhou com `kLSNoExecutableErr`, apesar do executável estar presente no bundle. Portanto a nova interface ainda não teve conferência visual dentro do app. A compilação não valida a renderização em runtime.
- O protótipo web publicado foi navegado; nenhuma ação de enviar revisão ou alterar dados externos foi acionada.

## Próximos passos

1. Conferir a Mesa compilada em runtime e ajustar a hierarquia e as dimensões comparando com a tela 3a.
2. Fazer Biblioteca e Arquivo janelas independentes e aproximar os estados das telas 3e e 3f.
3. Implementar o leitor com abas simultâneas, abertura PDF na página física e navegação web persistida conforme 3b.
4. Completar Preferências em quatro painéis, mantendo o host da Estêvão API fixo, e guardar chaves BYOK no Acesso às Chaves.
5. Implementar Drive, documento de ideias, histórico e revisão apenas após definir os contratos de autenticação e validação que protegem o texto do usuário.
6. Validar o fluxo completo numa preparação real e registrar as diferenças restantes contra o protótipo.
