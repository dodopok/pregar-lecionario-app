# Pendências do estudo de UX que dependem de você ou de outro repositório

Atualizado em 3 de novembro de 2026. Tudo o que não está aqui foi implementado na branch `feat/ux-primeiro-uso` (ver [progresso.md](progresso.md)).

## API do Pregar (Railway)

1. **Ligar a degustação.** Defina `ESTEVAO_PUBLIC_PREVIEW=true` no serviço da API e faça o deploy. Opcionais: `ESTEVAO_PREVIEW_DAYS` (padrão 35, máximo 120) e `LIMIT_ESTEVAO_PREVIEW_PER_MINUTE` (padrão 20, por IP). `ESTEVAO_APP_INTERNAL_ID` continua obrigatório; sem ele a rota responde 503. Enquanto a flag estiver desligada, o app mostra "As leituras ainda não estão conectadas" para quem não tem conta nem chave, exatamente como antes.
2. **Rodar os testes da API.** `apps/api/test/estevao-public.test.ts` (9 cenários) precisa de um PostgreSQL de verdade, que não existe neste ambiente. Rode `npm run test` com o banco disponível (ou o `npm run verify`) antes de publicar.
3. **Limite por IP em memória.** O `WindowLimiter` da degustação é por instância, como o do proxy autenticado. Se a API rodar com mais de uma réplica, o limite real é multiplicado.

## Estêvão API (outro repositório)

4. **Versos dos salmos.** O recuo pendente da poesia depende de quebras de linha (`\n`) dentro do texto de cada versículo nos salmos. Se a API não devolver quebras, os salmos aparecem como prosa (nada quebra; só perde o desenho em versos).
5. **Festas na listagem por intervalo.** "Próximas celebrações" no Calendário lê `celebration`, `is_holy_day` e `color` de `GET /api/v2/days?from&to`. Se o intervalo devolver só `sunday_name`, a lista mostra apenas os domingos. Vale conferir se os campos vêm no intervalo como vêm no dia único.

## Decisões de produto e conteúdo

6. **Fontes em português.** O filtro "Em português" e os chips de idioma existem, mas as fontes favoritas padrão são em inglês. Para um usuário novo ver materiais em português desde o primeiro dia, é preciso curar sites e autores em português em Preferências › Fontes (ou mudar o padrão em `packages/core/src/sources`).
7. **Preço na folha Conectar.** O valor "A partir de R$ … por mês" vem de `GET /v1/billing/plans`. Confirme as ofertas cadastradas na API antes do lançamento.
8. **Preparação avulsa (sem data do lecionário) e mais de uma preparação por data.** Não foi implementada: a chave de todos os registros é a data (`yyyy-MM-dd`), e o sufixo proposto no estudo tocaria calendário, Arquivo, histórico, revisões, Drive, backup e a validação de todos os canais. Se quiser seguir, o caminho desenhado é `yyyy-MM-dd-xxxx` com `kind: 'free'`, validações compartilhadas em `shared/` e o calendário e o Arquivo mostrando as avulsas junto da data. A importação hoje exige uma data para cada arquivo (casamentos e funerais entram pela data em que foram pregados).
9. **Google Drive.** Continua dependendo do cliente OAuth do app (ver [google-drive-setup.md](google-drive-setup.md)); sem ele, a aba Ideias funciona só com as ideias locais e a folha do púlpito oferece só impressão, PDF e texto simples.

## Verificar nos sistemas de verdade

10. **Tamanho do texto da interface** (Preferências › Aparência e texto) usa o `zoomFactor` da janela. Conferir no macOS com tela Retina e no Windows com escala de 125 %/150 % que os pontos de quebra da Mesa (1100 e 1280 px) continuam bons.
11. **Imprimir direto** usa `webContents.print` com o diálogo do sistema. Conferir no macOS e no Windows (no Linux, depende do GTK/CUPS).
12. **Importar sermões antigos** escolhe arquivos e pastas no mesmo diálogo só no macOS; no Windows e no Linux o diálogo aceita vários arquivos. Conferir também um `.docx` real do Word com imagens e estilos próprios (o conversor avisa o que descartou).
13. **Instalação limpa.** O tour e a degustação só aparecem na primeira abertura (`onboarding.tourDone`). Teste com a pasta de dados vazia.

## Repositório

14. **Dependência nova.** `packages/editor` passou a declarar `@tiptap/extension-blockquote` e `apps/desktop` recebeu `mammoth` (devDependencies, empacotadas pelo electron-vite). Depois de puxar a branch, rode `npm install`.
15. **Branch.** As mudanças estão em `feat/ux-primeiro-uso`, sem commit; decida o commit e o PR.
16. **Estudo.** O documento, as telas desenhadas e o PDF do estudo ficaram nos links e arquivos entregues na conversa; não há cópia no repositório.
