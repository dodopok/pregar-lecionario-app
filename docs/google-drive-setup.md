# Integração Google Drive

Atualizado em 27 de setembro de 2026.

O Drive faz parte da Mesa e do fluxo de preparação. A aba Tablet nas Preferências guarda apenas ajustes de leitura. A conexão com Google e as ações de criar, abrir, atualizar e inserir ideias ficam na própria preparação.

## Estado da integração

- OAuth nativo para app macOS, iniciado no navegador padrão e retornando por loopback local com PKCE.
- O fluxo usa apenas o escopo `drive.file`; não solicita acesso irrestrito ao Drive.
- O refresh token fica no Acesso às Chaves. O OAuth Client ID é um identificador público e fica na configuração local da integração.
- O app cria a pasta `Sermões`, um Google Doc por manuscrito e um documento separado `Ideias de sermões`.
- O primeiro envio do sermão é explícito na folha Tablet. Depois de vincular o documento, edições locais são enviadas após uma pausa de dois segundos.
- Antes de substituir conteúdo, o app confere a revisão do Google Doc e também exige essa revisão na operação atômica de escrita. Se o Drive mudou, o texto local é preservado e a substituição exige confirmação.
- A aba Ideias atualiza o documento remoto quando aberta, mostra as notas e permite inserir uma nota no manuscrito sem apagar a origem.

Ainda não houve autenticação real: falta criar o OAuth Client ID do app, e o usuário confirmou que ainda não tem um. Os testes atuais simulam respostas do OAuth/Drive/Docs e não enviam dados para a conta Google.

## Configuração Google Cloud

1. Crie ou escolha um projeto no Google Cloud e ative **Google Drive API** e **Google Docs API**.
2. Configure a tela de consentimento OAuth e inclua sua conta Google como usuária de teste enquanto o app estiver em desenvolvimento.
3. Crie um cliente OAuth do tipo **Desktop app** e copie o **Client ID**. Não crie nem cole um client secret: o app instalado usa PKCE e não precisa de segredo embutido.
4. Na Mesa, clique no estado do Drive na barra inferior (ou escolha Google Doc/Ideias) e informe o Client ID em **Conectar Google Drive**.
5. Autorize a conta no navegador. Depois do retorno à Mesa, use o Google Doc ou abra **Ideias de sermões** no app Google Docs do iPhone.

Referências oficiais:

- [OAuth para apps instalados (desktop)](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Escopos da API Google Drive e recomendação de `drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Docs `documents.batchUpdate` e controle por revisão](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate)

## Limites atuais

`drive.file` dá acesso aos arquivos criados pelo Pregar ou selecionados explicitamente para ele. Como ainda não há seletor Google Picker, a integração cria um novo documento de ideias; ela não importa por ID um Google Doc antigo, nem se apropria automaticamente de uma pasta `Sermões` já existente. A primeira conexão cria a pasta própria do app.

A sincronização automática é unidirecional, do manuscrito local para o Google Doc. Edições feitas no iPhone no documento de ideias são lidas ao atualizar a aba Ideias. Se alguém editar no Google Docs um sermão já ligado, o app detecta a nova revisão antes do próximo envio, preserva o rascunho local e pede uma decisão explícita.

Google Docs não é um backup completo do app: histórico recuperável, PDFs e marcações da biblioteca continuam locais. A disponibilidade offline do arquivo no tablet continua sendo controlada no aplicativo Google Drive do aparelho.
