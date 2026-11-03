# Próximos passos

Atualizado em 3 de novembro de 2026. O que já existe está em [progresso.md](progresso.md); as dependências externas, em [pendencias-ux.md](pendencias-ux.md); o app de celular, em [app-companheiro-ios.md](app-companheiro-ios.md).

## 1. Passo a passo para lançar o app de computador

1. **Nome e marca.** O nome é **Proper** (seção 3). `productName`, `appId`, títulos e textos já foram trocados no código; faltam o domínio, a marca e o ícone. Vale fechar antes do primeiro instalador público, porque o `appId` e o nome do executável são difíceis de mudar depois.
2. **Revisar e mesclar** a branch `feat/ux-primeiro-uso` (PR com as capturas da conversa).
3. **Ligar a degustação na API** (`ESTEVAO_PUBLIC_PREVIEW=true` na Railway) e fazer o deploy. Conferir `apps/api/dist/admin.js doctor`.
4. **Curar as fontes em português**: 4 a 6 sites e os autores que você recomenda (Preferências › Fontes); eu troco os padrões em `packages/core/src/sources` para que um usuário novo já veja materiais em português.
5. **Credenciais que só você tem**: cliente OAuth do Google (Drive), Asaas em produção (Pix Automático), Resend com domínio verificado, certificados de assinatura (Apple Developer para o macOS; Azure Trusted Signing ou certificado EV para o Windows).
6. **Verificação nos sistemas reais**: `npm run verify` num Mac e num PC; conferir impressão direta, escala do texto, importação de pastas e a atualização automática entre duas versões.
7. **Primeiro release** com `npm run release -w @pregar/desktop`, instalar do zero e passar pelo tour, pelos Primeiros passos e por uma preparação inteira (leituras, manuscrito, revisão, púlpito).
8. **Cinco pregadores de teste** por duas semanas; registrar o que travou (os registros em Sobre ajudam) e ajustar antes de abrir.

## 2. O que ainda falta para atender tudo o que um pregador do lecionário precisa

Ideias, na ordem em que eu as faria, com o tamanho aproximado:

| Ideia | Por quê | Tamanho |
| --- | --- | --- |
| **Companheiro no celular** (iOS primeiro) | A ideia chega no ônibus, não na Mesa; hoje ela mora num Google Doc | ver app-companheiro-ios.md |
| **Séries e tempos litúrgicos** | Ver o Advento ou a Quaresma inteiros numa tela: 4 a 6 domingos lado a lado, tema da série, uma ideia que atravessa os domingos | médio |
| **Caderno de ilustrações e citações** | Histórias, citações e imagens reutilizáveis com fonte e com busca por tema; "Já preguei sobre isto" mostra onde cada uma já foi usada | médio |
| **Arquivo com memória** | Livros e temas mais pregados no ano, lacunas ("nunca preguei em Marcos este ano"), tempo médio, quantas vezes cada passagem | pequeno |
| **Sermão pregado** | Gravar o áudio no culto (pelo celular), transcrever e guardar junto do manuscrito: o que foi dito de fato, para comparar e reaproveitar | médio |
| **Boletim e equipe** | Exportar resumo, leituras e coleta para o boletim ou o site; compartilhar a preparação com outro pregador ou com a catequese | médio |
| **Plano da semana com lembretes** | Segunda ler, terça ruminar, quinta escrever, sábado ensaiar: o cartão do ritmo vira lembretes (desktop e celular) | pequeno |
| **IA para a assembleia** | A partir das leituras: perguntas para o sermão das crianças, orações dos fiéis e um parágrafo para o boletim; sempre como rascunho, nunca o sermão | pequeno |
| **Línguas originais** | Para o texto principal, a palavra-chave em grego ou hebraico com link para o estudo, sem sair da Mesa | pequeno |
| **Comparar lecionários** | LOC 2027, RCL e o lecionário romano lado a lado para quem prega em contextos ecumênicos (depende da Estêvão API) | depende de fora |
| **Biblioteca com EPUB** | Comentários em EPUB além de PDF | médio |
| **Mesa em dois computadores** | Mac na paróquia e notebook em casa com os mesmos sermões, pela conta (hoje só por backup) | grande |
| **Teleprompter no iPad e cronômetro no relógio** | A folha do púlpito rolando no iPad, o tempo no pulso | depois do companheiro |

## 3. Nome: Proper

Decidido em 3 de novembro de 2026: o app chama-se **Proper**. É o "próprio" do dia no lecionário, as partes que mudam com a celebração (coleta e leituras; "Próprio 27" já aparece na Mesa). É curto, fácil de dizer ("abre o Proper") e não tem o problema do verbo comum que "Pregar" tinha. Em inglês também lê como "adequado, como deve ser".

O que já foi trocado no código: nome do produto e do executável, identificador do app (`br.caminhoanglicano.proper`), títulos de janela, menu, textos da interface, e-mails e páginas legais da API e o nome das pastas de backup novas ("Proper Backup …"). A pasta de dados muda de `Pregar` para `Proper`; o app move a antiga sozinho na primeira abertura, sem sobrescrever nada. Ficaram como estavam, por serem internos e invisíveis: os pacotes `@pregar/*`, o canal IPC, os esquemas `pregar-pdf:` e `pregar-asset:`, o arquivo `pregar.sqlite`, as variáveis `PREGAR_*` e o nome do repositório. O app antigo para Mac continua "Pregar para Mac": é outro produto, do qual só importamos o backup.

Ainda com você: domínio (`proper.app`, `proper.com.br`…), busca na App Store e no INPI, ícone, e a conta Apple Developer com o nome final.

As alternativas que estavam na mesa, caso queira voltar: Ambão, Perícope, Lâmpada, Ordo, Púlpito, Rubrica e Homília.

## 4. O que só você pode fazer

- Registrar domínio e marca do Proper, aprovar o ícone.
- Conta Apple Developer (macOS assinado e notarizado; o app de celular depende dela), Azure Trusted Signing ou certificado para o Windows.
- Flags e chaves na Railway, Asaas em produção, Resend com domínio, cliente OAuth do Google.
- Curadoria das fontes e autores em português; o preço e os textos da assinatura.
- Testar nos sistemas de verdade e com pregadores de verdade.
