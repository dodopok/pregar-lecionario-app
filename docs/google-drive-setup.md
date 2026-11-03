# Integração Google Drive

Atualizado em 3 de novembro de 2026.

O Drive faz parte da Mesa e do fluxo de preparação. A aba Tablet nas Preferências guarda apenas ajustes de leitura. A conexão com Google e as ações de criar, abrir, atualizar e inserir ideias ficam na própria preparação.

## Estado da integração

- OAuth nativo para app macOS, iniciado no navegador padrão e retornando por loopback local com PKCE.
- O fluxo usa apenas o escopo `drive.file`; não solicita acesso irrestrito ao Drive.
- O refresh token fica no Acesso às Chaves. O OAuth Client ID é um identificador público e fica na configuração local da integração.
- O app cria a pasta `Sermões`, um Google Doc por manuscrito e um documento separado `Ideias de sermões`.
- O primeiro envio do sermão é explícito na folha Tablet. Depois de vincular o documento, edições locais são enviadas após uma pausa de dois segundos.
- Antes de substituir conteúdo, o app confere a revisão do Google Doc e também exige essa revisão na operação atômica de escrita. Se o Drive mudou, o texto local é preservado e a substituição exige confirmação.
- A aba Ideias atualiza o documento remoto quando aberta, mostra as notas e permite inserir uma nota no manuscrito sem apagar a origem.

O cliente OAuth e a chave de API foram criados em 3 de novembro de 2026 no projeto Google Cloud "Proper" (Drive API e Docs API ativadas, escopo `drive.file`, cliente do tipo App para computador). Os valores ficam fora do git, em `apps/desktop/.env` para desenvolvimento e `apps/desktop/.env.production.local` para os instaladores. Os testes automatizados continuam simulando as respostas do OAuth/Drive/Docs.

## Importar PDFs de uma pasta pública

Esse é um fluxo separado do OAuth dos sermões e **exige o link de uma pasta pública**. No Drive, compartilhe a pasta como **Qualquer pessoa com o link · Leitor** e copie o link da pasta. Pastas privadas, links de arquivos individuais e links de Google Docs não são aceitos.

Na Biblioteca, use **Drive público…**, cole o link e, na primeira vez, informe uma chave de API Google. Não é preciso entrar na conta Google nem conceder acesso ao Drive inteiro. O Proper usa a Drive API para enumerar a pasta e, se marcado, suas subpastas; baixa os PDFs para uma pasta gerenciada em `Application Support/Proper/Library/Google Drive` e indexa essas cópias. O acervo compartilhado original não é alterado. Ao importar a mesma pasta de novo, os mesmos arquivos locais são atualizados.

Para criar a chave:

1. No Google Cloud, ative **Google Drive API** no projeto.
2. Em APIs e serviços → Credenciais, crie uma **chave de API**. Restrinja a chave à Google Drive API; não a inclua em documentação pública nem a compartilhe.
3. Cole a chave junto com o link no Proper. Depois da validação da pasta, ela fica no Acesso às Chaves deste Mac; em importações seguintes, deixe o campo vazio para reutilizá-la.

A pasta deve continuar pública por link durante listagem e download. A chave de API não torna uma pasta privada acessível. Links compartilhados que exigem `resourcekey` são aceitos e essa chave de recurso é encaminhada ao Google para a pasta, subpastas e arquivos.

Limites deliberados: até 5.000 PDFs por importação e 128 MB por arquivo. A importação pode incluir subpastas, com esse controle ligado por padrão. A extensão ou o MIME type não bastam: o app também verifica a assinatura `%PDF-` antes de guardar o arquivo. A chave e os PDFs reais ainda não foram testados porque falta uma chave de API pessoal e um link de pasta pública de teste.

Referências oficiais:

- [Pesquisar e listar arquivos do Drive](https://developers.google.com/workspace/drive/api/guides/search-files)
- [Chaves de recurso para itens compartilhados por link](https://developers.google.com/workspace/drive/api/guides/resource-keys)

## Configuração Google Cloud

O app usa só o escopo `drive.file` e faz o login no navegador padrão, voltando por `127.0.0.1` com PKCE; não há URL de redirecionamento para cadastrar. O ID e o segredo do cliente vão embutidos no app pelas variáveis de build, como o Google espera de um app instalado (o segredo de um cliente "App para computador" não é tratado como segredo).

1. **Projeto.** Em console.cloud.google.com, crie ou escolha o projeto e ative, em APIs e serviços › Biblioteca, a **Google Drive API** e a **Google Docs API**.
2. **Marca.** Google Auth Platform › Branding: nome Proper, e-mail de suporte, página inicial e os links `https://api.pregar.oficio.app/legal/privacidade` e `https://api.pregar.oficio.app/legal/termos`, domínio autorizado `oficio.app`. Sem logotipo: logotipo exige a verificação de marca.
3. **Público.** Google Auth Platform › Audience: tipo Externo; em teste, adicione os usuários de teste. No modo "Testing" o acesso expira a cada 7 dias; quando o fluxo funcionar, clique em **Publicar app**. Com só o `drive.file` não há formulário de verificação.
4. **Escopo.** Google Auth Platform › Data Access: adicione `https://www.googleapis.com/auth/drive.file`, nada mais.
5. **Cliente.** Google Auth Platform › Clients › Criar cliente: tipo **App para computador**. Copie o ID e o segredo.
6. **Chave de API, opcional.** APIs e serviços › Credenciais › Chave de API, restrita à Google Drive API. Serve só para importar pastas públicas de PDFs na Biblioteca.
7. **No repositório.** Em `apps/desktop/.env` (desenvolvimento) e `apps/desktop/.env.production.local` (instaladores), os dois ignorados pelo git:

   ```sh
   MAIN_VITE_GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
   MAIN_VITE_GOOGLE_CLIENT_SECRET=<segredo>
   MAIN_VITE_DRIVE_API_KEY=<chave, se criada>
   ```

8. **No app.** Preferências › Google Drive › Conectar abre o navegador; depois de autorizar, Levar ao púlpito › Google Doc cria a pasta Sermões e o documento, e a aba Ideias oferece o documento de ideias.

Referências oficiais:

- [OAuth para apps instalados (desktop)](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Escopos da API Google Drive e recomendação de `drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Docs `documents.batchUpdate` e controle por revisão](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate)

## Limites atuais

`drive.file` dá acesso aos arquivos criados pelo Proper ou selecionados explicitamente para ele. Como ainda não há seletor Google Picker, a integração cria um novo documento de ideias; ela não importa por ID um Google Doc antigo, nem se apropria automaticamente de uma pasta `Sermões` já existente. A primeira conexão cria a pasta própria do app.

A sincronização automática é unidirecional, do manuscrito local para o Google Doc. Edições feitas no iPhone no documento de ideias são lidas ao atualizar a aba Ideias. Se alguém editar no Google Docs um sermão já ligado, o app detecta a nova revisão antes do próximo envio, preserva o rascunho local e pede uma decisão explícita.

Google Docs não é um backup completo do app: histórico recuperável, PDFs e marcações da biblioteca continuam locais. A disponibilidade offline do arquivo no tablet continua sendo controlada no aplicativo Google Drive do aparelho.
