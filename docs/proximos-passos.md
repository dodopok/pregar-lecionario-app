# Próximos passos

Atualizado em 3 de novembro de 2026. O que já existe está em [progresso.md](progresso.md); as dependências externas, em [pendencias-ux.md](pendencias-ux.md); o app de celular, em [app-companheiro-ios.md](app-companheiro-ios.md).

## 1. Passo a passo para lançar o app de computador

1. **Nome e marca.** Escolher o nome (sugestões abaixo), registrar o domínio e trocar `productName`, `appId`, títulos, textos e ícone. Vale fazer antes do primeiro instalador público, porque o `appId` e o nome do executável são difíceis de mudar depois.
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

## 3. Nomes

"Pregar" descreve, mas é um verbo comum e difícil de achar e de registrar. O nome bom aqui é curto, português, com cheiro de liturgia e fácil de dizer: "abre o ___".

| Nome | Por quê | Atenção |
| --- | --- | --- |
| **Ambão** | O lugar de onde se leem as leituras e se prega. É a palavra que só quem vive o lecionário usa, soa bem e é curta. O companheiro seria "Ambão no bolso" ou só "Ambão" com ícone diferente. | Pouco conhecido fora das igrejas litúrgicas; é exatamente o público. Conferir domínio `ambao.app` e a App Store. |
| **Perícope** | A passagem do lecionário, o objeto central do app. Erudito, memorável. | Pronúncia nem sempre certa; soa técnico. |
| **Ordo** | O calendário litúrgico impresso. Curto, internacional, já aparece no código da API. | Genérico demais, muitos usos. |
| **Púlpito** | Direto; "Levar ao púlpito" já vive na interface. | Comum, provavelmente tomado em lojas e domínios. |
| **Lâmpada** | "Lâmpada para os meus pés" (Salmo 119): quente, português, sem jargão. | Não diz "sermão"; depende do ícone e do subtítulo. |
| **Rubrica** | As instruções em vermelho dos livros litúrgicos; quem é de liturgia sorri. | Em português do dia a dia significa assinatura. |
| **Homília** | O sermão dentro da liturgia. | Mais católico que anglicano; alguns pregadores evitam. |

Minha ordem: Ambão, depois Perícope, depois Lâmpada. Antes de decidir: domínio, busca na App Store e no INPI, e dizer em voz alta "abre o Ambão aí".

## 4. O que só você pode fazer

- Escolher o nome, registrar domínio e marca, aprovar ícone.
- Conta Apple Developer (macOS assinado e notarizado; o app de celular depende dela), Azure Trusted Signing ou certificado para o Windows.
- Flags e chaves na Railway, Asaas em produção, Resend com domínio, cliente OAuth do Google.
- Curadoria das fontes e autores em português; o preço e os textos da assinatura.
- Testar nos sistemas de verdade e com pregadores de verdade.
