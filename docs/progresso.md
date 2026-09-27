# Progresso de implementação

Atualizado em 27 de setembro de 2026.

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
- Painel contextual com abas Materiais, Ideias e Revisão. PDFs são associados à passagem pela leitura dos bookmarks e agrupados como passagem coincidente, sobreposição ou contexto; abrir um resultado leva o Leitor à página física inicial da seção. Working Preacher abre o arquivo do texto, os dois blogs abrem a busca interna por referência e Anglican Compass abre diretamente “Today in the Spirit: Proper N A” quando a data dominical e o tempo litúrgico permitem determinar o Próprio.
- Leitor em janela independente: mantém abas web e PDFs, restaura a seleção e a última localização, navega no WebKit, mostra seções com páginas físicas e contexto e permite corrigir página e marcar material para revisão. A seleção textual pode ser copiada com a origem. Usa seções já indexadas quando disponíveis e carrega seções ausentes em segundo plano, sem OCR.
- Biblioteca local importa PDFs, extrai título/autor dos metadados, gera miniatura da capa e indexa bookmarks com intervalo físico até a próxima seção. A Mesa migra importações antigas em segundo plano; em PDFs sem sumário, tenta cabeçalhos textuais. A versão 2 do índice reprocessa registros anteriores para substituir nomes de arquivo por metadados editoriais e gerar as capas. Páginas digitalizadas continuam sem OCR.
- Biblioteca e Arquivo agora são janelas independentes; Arquivo local lista sermões e busca por título, passagem ou data. Ocasião litúrgica, relações de materiais, comparação/restauração de versões e estado do Drive ainda não estão implementados.
- Folhas de revisão, perguntas e preparação para tablet representam os limites e opções do protótipo, mas enviar à IA e atualizar o Drive ficam desativados até as integrações BYOK e Google Drive existirem.
- Preferências em quatro áreas conforme a tela 3d. A Estêvão API permanece fixa; livro, idioma, tradução principal e modalidade de leituras ficam localmente.
- Chaves BYOK para OpenAI, Anthropic, Google e Perplexity podem ser guardadas/removidas no Acesso às Chaves. Provedor/modelo de revisão e pesquisa são preferências locais, sem chamadas aos provedores ainda.
- Drive e tablet deixam configurar pasta/documento de ideias, dispositivos e apresentação (Arial 10). OAuth e sincronização ainda não estão ativos. A Biblioteca mostra a pasta de PDFs e os quatro sites favoritos; a indexação por passagem está implementada para bookmarks e cabeçalhos detectáveis, enquanto OCR continua pendente.

Ainda faltam OCR e correção manual da localização/metadados dos PDFs; apresentar resultados dos sites dentro do app em vez de abrir suas buscas no Leitor; persistência de ideias; histórico recuperável; chamadas BYOK e revisão segura com evidências; autenticação/sincronização Google Drive e saída de leitura para tablet.

## Host da API

O app inicialmente usava `https://estevao.caminhoanglicano.com.br`, domínio do site que responde com uma página HTML de 404 na rota v2. O deploy e a definição OpenAPI do repositório `estevao-api` identificam `https://api.caminhoanglicano.com.br` como host correto.

O host é uma constante do app e a tela da Estêvão API não permite editá-lo. Um 404 sem corpo JSON informa que a rota v2 não foi encontrada, distinguindo-o de erros JSON produzidos pela própria API.

## Verificação

- Projeto regenerado com XcodeGen após incluir as novas telas.
- `xcodebuild -quiet -project Pregar.xcodeproj -scheme Pregar -destination 'platform=macOS' -derivedDataPath /private/tmp/pregar-prototype-derivedData build` concluiu com código 0.
- Não há suíte automatizada de testes.
- Na primeira tentativa, a cena do SwiftUI não aparecia porque `APISettingsStore.init()` lia o Acesso às Chaves sincronamente no ator principal. A amostragem do processo mostrou a thread principal parada em `SecItemCopyMatching`/descriptografia do chaveiro durante a criação da janela.
- O carregamento de credenciais continua assíncrono, fora da thread principal, com limite de três segundos para a inicialização. Uma tentativa de migrar as consultas para o Data Protection Keychain retornou `errSecMissingEntitlement` na build local ao salvar; essa rota foi removida. O app voltou ao chaveiro padrão que já continha a credencial, sem apagar ou migrar segredos.
- A build estava assinada ad hoc. A permissão “Permitir sempre” do Keychain fica associada à identidade do código; o requisito ad hoc dependia do `cdhash` e mudava ao recompilar. O projeto agora assina com a identidade Apple Development existente e o Team ID do certificado (`R573HPN65Q`); `codesign` confirmou requisito designado estável pelo bundle ID e certificado. A build padrão passou. Como a assinatura mudou, o Keychain pode pedir autorização mais uma vez para cada credencial já salva; deve-se escolher “Permitir sempre” nessa primeira abertura da nova assinatura. A reabertura após essa autorização ainda precisa ser confirmada em runtime.
- A Mesa abre numa janela dimensionada para os três painéis (mínimo 1220×740; abertura inicial 1600×980). Preferências deixou de ser uma folha limitada pela janela da Mesa: é uma janela nativa própria, inicial de 1120×900, redimensionável e com conteúdo rolável.
- A build atual compilou e abriu via LaunchServices. A inspeção em runtime confirmou a Mesa completa, sem recorte nos três painéis, e Preferências em janela separada com o estado “Chave salva neste Mac”.
- A credencial preexistente no chaveiro padrão foi lida e usada na consulta autenticada: a Mesa carregou as leituras do LOC 2027 para 2026-09-27 e o teste de conexão das Preferências confirmou resposta para 2026-09-26. Não foi possível determinar se a chave digitada pelo usuário na tentativa anterior era uma rotação; portanto, a verificação comprova a credencial preexistente, não uma eventual chave nova.
- Leitor, Biblioteca e Arquivo foram registrados como cenas de janela independentes, com dimensões iniciais amplas e redimensionáveis. O menu de janelas mostra as cenas disponíveis.
- Teste em runtime: a nova aba web abriu Anglican Compass no WebKit; uma segunda aba preservou sua própria URL e conteúdo. O teste encontrou reutilização visual incorreta do WebView entre abas; a identidade da view foi vinculada ao ID da aba e, após recompilar/reabrir, ambas as páginas e a aba selecionada foram restauradas corretamente.
- Teste em runtime: uma fonte favorita aberta a partir da Mesa trouxe a janela do Leitor à frente e associou a leitura principal à aba. O endereço genérico inicialmente usado para Working Preacher retornou 404 e foi trocado pela página inicial do site; busca por artigo específico continua pendente.
- Teste em runtime: Biblioteca abre em janela própria e mostra seu estado vazio sem recorte; o carregamento de um PDF real nessa janela ainda aguarda importação explícita pelo usuário.
- O erro `kLSNoExecutableErr` observado ao executar `open` sem elevação era do sandbox de execução: o mesmo erro ocorreu com o app Calculadora do sistema; a abertura elevada da build funcionou.
- O protótipo web publicado foi navegado; nenhuma ação de enviar revisão ou alterar dados externos foi acionada.
- A biblioteca persistida continha 10 PDFs, e os 10 caminhos locais foram abertos pelo indexador. As obras textuais devolveram título editorial, contagem de páginas/bookmarks e miniatura JPEG da primeira página; as três cópias do Feasting v. 1 foram mantidas separadas e identificáveis.
- Após a migração para o índice v2, a janela nativa da Biblioteca mostrou as 10 obras com títulos editoriais, autoria, capas reais e 7.435 páginas/878 seções no conjunto. A validação visual confirmou a capa de Connections e dos quatro volumes do Feasting, sem nomes técnicos dos arquivos na lista.
- A partir da preparação de 27/09/2026, clicar Anglican Compass abriu `https://anglicancompass.com/today-in-the-spirit-proper-21a/`; o leitor exibiu o título “Today in the Spirit: Proper 21A” e o texto do artigo. A data, o domingo e a passagem foram preservados na sessão de leitura.
- A build assinada de 27/09/2026 compilou com `Apple Development` e o Team `R573HPN65Q`; `codesign -dv` confirmou `TeamIdentifier=R573HPN65Q`. Não foi usada assinatura ad hoc nem build unsigned.
- Reabertura da build mais recente: a Mesa carregou as leituras do LOC 2027 e o rascunho local de teste continuou intacto; não surgiu novo diálogo do chaveiro.
- A Biblioteca voltou a apresentar 10 obras com 7.435 páginas e 878 seções. O filtro encontrou `Matthew 21:23–32` em Connections nas páginas físicas 636–643; abrir o resultado mostrou o texto da seção e a página física correta. No Feasting v. 4, a posição restaurada 265 está dentro da seção 263–276.
- O Leitor abriu no WebKit o arquivo específico do Working Preacher para Mateus 21:23–32, com “By What Authority?” entre os resultados. Alternar para um PDF e retornar preservou a página web carregada.
- A referência `Mateus 21.33-46` foi encontrada nos bookmarks do Feasting on the Word v. 4, com páginas físicas 314–327 sob `Proper 22`, e em Connections, páginas 669–676. O intervalo do Feasting termina antes do próximo bookmark, na página 328.
- O parser aceita referências em português e inglês, ponto ou dois-pontos, diferentes traços, intervalos entre capítulos e listas de versículos no mesmo bookmark. A classificação considera intervalo exato/contido, sobreposição parcial e capítulo/contexto; referências em prosa livre e PDFs digitalizados ainda requerem tratamento adicional.
- A Mesa e a Bíblia comparativa preservam suas colunas durante buscas; no painel de leituras, traduções já obtidas ficam em cache e as ausentes mostram carregamento localizado. Ao trocar a data enquanto a API responde, o painel de leituras mantém o conteúdo anterior montado, cobre-o com um estado de atualização não interativo e substitui os dados quando chegam; a cena da Bíblia não é remontada ao mudar a referência.
- As buscas favoritas são URLs específicas: Working Preacher usa o arquivo de comentários por perícope; Anglican Compass consulta o artigo do Próprio por domingo quando identificável; os dois blogs restantes recebem a passagem na busca do próprio site. O app ainda não coleta nem exibe resultados dessas buscas internamente.

## Performance

- Uma amostra de 8 segundos do processo aberto encontrou a thread principal aguardando eventos do AppKit, sem loop ativo durante o intervalo ocioso. O footprint era 68,2 MB naquele instante e o pico desde a abertura era 224,3 MB; é uma fotografia pontual, não um benchmark de rolagem ou troca de abas.
- A inspeção de código encontrou trabalho repetido na UI: a Mesa recalculava os matches de todos os bookmarks até três vezes por render; Biblioteca construía todas as linhas de seções simultaneamente e decodificava capas novamente; o Leitor restaurava e carregava todas as abas PDF/Web de uma vez, reabria documentos ao selecioná-los e reindexava seções durante renders; a posição do PDF era serializada e gravada a cada mudança de página; o contador de palavras decodificava o RTF em cada atualização.
- Os matches agora são calculados em tarefa de baixa prioridade, agrupados uma vez e cancelados quando se troca de texto/painel/filtro. Só a Biblioteca reindexa migrações; a Mesa consome o índice salvo.
- A lista de seções da Biblioteca é virtualizada e as capas usam cache limitado. Abas restauradas são abertas sob demanda, documentos PDF são reutilizados, seções são carregadas em segundo plano e canceladas ao sair da aba; fechar a aba libera seus recursos. O progresso de leitura é salvo após uma pausa curta, e fechar a janela do Leitor força a gravação.
- O contador de palavras agora lê o texto já carregado no NSTextView em vez de decodificar novamente o RTF. Importação e indexação usam prioridade de utilidade.
- A primeira verificação em runtime encontrou o campo de página em `1`, embora o PDF tivesse aberto no trecho certo. O campo agora sincroniza também quando a janela aparece; confirmei `636` em Connections e `265` na posição restaurada do Feasting v. 4.
- Medições exploratórias pela automação da interface, incluindo renderização e captura da árvore de acessibilidade: filtro da Biblioteca ~1,1 s; rolagem de várias dezenas de seções ~1,8 s; troca para uma aba PDF ~1,7 s; primeira abertura da página específica do Working Preacher ~6,4 s; retorno à página web já carregada ~1,3 s. Não observei travamento ou perda de conteúdo. Esses valores incluem a automação e, na primeira navegação web, a rede externa; não são um benchmark controlado.
- A amostra anterior de 8 s em repouso não mostrou loop ativo, mas ainda não há captura do Instruments focada em rolagem ou importação. Não existe suíte automatizada no projeto; uma rodada controlada de profiling e o teste com PDF digitalizado/OCR continuam pendentes.

## Próximos passos

1. Completar a localização de PDFs com mais abreviações, correção manual e OCR sob demanda, usando os casos já analisados como testes.
2. Avaliar a exibição de resultados de sites dentro do app e completar a correspondência por data, sobreposição parcial e fontes de contexto.
3. Aproximar os estados de Biblioteca e Arquivo das telas 3e e 3f, incluindo metadados editáveis, ocasião litúrgica e relações de materiais.
4. Implementar chamadas de revisão e Drive, documento de ideias e histórico após validar modelos/contratos e as proteções que impedem alteração do texto do usuário.
5. Validar o fluxo completo numa preparação real e registrar as diferenças restantes contra o protótipo.
