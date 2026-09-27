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
- Preferências em quatro áreas conforme a tela 3d. A Estêvão API permanece fixa; livro, idioma, tradução principal e modalidade de leituras ficam localmente.
- Chaves BYOK para OpenAI, Anthropic, Google e Perplexity podem ser guardadas/removidas no Acesso às Chaves. Provedor/modelo de revisão e pesquisa são preferências locais, sem chamadas aos provedores ainda.
- Drive e tablet deixam configurar pasta/documento de ideias, dispositivos e apresentação (Arial 10). OAuth e sincronização ainda não estão ativos. A Biblioteca mostra a pasta de PDFs e os quatro sites favoritos; indexação por passagem e OCR continuam pendentes.

Ainda faltam a navegação de materiais em abas como na tela 3b; indexação de capítulos/passagens dos PDFs, correção manual e OCR; pesquisa e curadoria reais de sites; persistência de ideias; histórico recuperável; chamadas BYOK e revisão segura com evidências; autenticação/sincronização Google Drive e saída de leitura para tablet.

## Host da API

O app inicialmente usava `https://estevao.caminhoanglicano.com.br`, domínio do site que responde com uma página HTML de 404 na rota v2. O deploy e a definição OpenAPI do repositório `estevao-api` identificam `https://api.caminhoanglicano.com.br` como host correto.

O host é uma constante do app e a tela da Estêvão API não permite editá-lo. Um 404 sem corpo JSON informa que a rota v2 não foi encontrada, distinguindo-o de erros JSON produzidos pela própria API.

## Verificação

- Projeto regenerado com XcodeGen após incluir as novas telas.
- `xcodebuild -quiet -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' -derivedDataPath /private/tmp/pregar-prototype-derivedData build` concluiu com código 0.
- Não há suíte automatizada de testes.
- Na primeira tentativa, a cena do SwiftUI não aparecia porque `APISettingsStore.init()` lia o Acesso às Chaves sincronamente no ator principal. A amostragem do processo mostrou a thread principal parada em `SecItemCopyMatching`/descriptografia do chaveiro durante a criação da janela.
- O carregamento de credenciais continua assíncrono, fora da thread principal, com limite de três segundos para a inicialização. Uma tentativa de migrar as consultas para o Data Protection Keychain retornou `errSecMissingEntitlement` na build local ao salvar; essa rota foi removida. O app voltou ao chaveiro padrão que já continha a credencial, sem apagar ou migrar segredos.
- A Mesa abre numa janela dimensionada para os três painéis (mínimo 1220×740; abertura inicial 1600×980). Preferências deixou de ser uma folha limitada pela janela da Mesa: é uma janela nativa própria, inicial de 1120×900, redimensionável e com conteúdo rolável.
- A build atual compilou e abriu via LaunchServices. A inspeção em runtime confirmou a Mesa completa, sem recorte nos três painéis, e Preferências em janela separada com o estado “Chave salva neste Mac”.
- A credencial preexistente no chaveiro padrão foi lida e usada na consulta autenticada: a Mesa carregou as leituras do LOC 2027 para 2026-09-27 e o teste de conexão das Preferências confirmou resposta para 2026-09-26. Não foi possível determinar se a chave digitada pelo usuário na tentativa anterior era uma rotação; portanto, a verificação comprova a credencial preexistente, não uma eventual chave nova.
- O erro `kLSNoExecutableErr` observado ao executar `open` sem elevação era do sandbox de execução: o mesmo erro ocorreu com o app Calculadora do sistema; a abertura elevada da build funcionou.
- O protótipo web publicado foi navegado; nenhuma ação de enviar revisão ou alterar dados externos foi acionada.

## Próximos passos

1. Implementar o Leitor da tela 3b com abas simultâneas, PDF aberto em página física e navegação web persistente.
2. Fazer Biblioteca e Arquivo janelas independentes e aproximar os estados das telas 3e e 3f.
3. Indexar capítulos/passagens dos PDFs, corrigir localizações manualmente e adicionar OCR sob demanda.
4. Implementar chamadas de revisão e Drive, documento de ideias e histórico após validar modelos/contratos e as proteções que impedem alteração do texto do usuário.
5. Validar o fluxo completo numa preparação real e registrar as diferenças restantes contra o protótipo.
