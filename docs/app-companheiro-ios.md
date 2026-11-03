# App companheiro iOS: ideias que chegam à Mesa pelo sermão certo

Proposta de produto e de arquitetura para substituir o documento de ideias do Google Drive por um app de celular (primeiro iOS) que guarda ideias já ligadas ao sermão. As telas desenhadas estão no canvas "Companheiro iOS de ideias" (entregue na conversa); este documento é a parte que não cabe num desenho.

## O que o app faz (e só isso)

1. **Guardar uma ideia em segundos**, por texto, ditado ou trecho compartilhado de outro app, escolhendo o sermão de destino entre as próximas preparações do computador (domingos, avulsas) ou "sem sermão".
2. **Ver as ideias por sermão**, marcar como usada e apagar. O que foi usado no manuscrito, no computador, aparece como usada no celular.
3. **Entrar na mesma conta** do app de computador (código por e-mail) e sincronizar sozinho, com fila offline.
4. Fora do app: widget na tela de bloqueio, extensão de compartilhar e Siri/Atalhos (telas no canvas).

Não faz: editar o manuscrito, ler leituras, revisar. Isso continua na Mesa. O companheiro é um caderno de bolso, não uma segunda Mesa.

## Como as ideias viajam

```
iPhone (SwiftData, fila offline)  ⇄  API do Pregar (PostgreSQL, por conta)  ⇄  App de computador (SQLite, aba Ideias)
```

- A **conta** é a mesma: o token de sessão do iPhone é mais uma sessão em Preferências › Conta › Sessões.
- O **computador publica** só os metadados das próximas preparações para o celular saber os destinos: chave (`2026-11-08` ou `2026-11-14-k3x9`), ocasião, texto principal e estado. Nunca o manuscrito.
- As **ideias** sobem do iPhone com `id` (UUID gerado no aparelho), texto, chave do sermão (ou nula), passagem, origem (`ios`, `share`, `siri`, `widget`), `createdAt`, `updatedAt`, `done`, `deletedAt`.
- O computador **puxa** as ideias novas (`?since=`) a cada 2 minutos com a janela em foco e ao abrir a aba Ideias; as grava na tabela `ideas` local com `source: 'ios'`; **empurra** `done` e exclusões. Ideias anotadas na Mesa também sobem, para aparecerem no celular (a lista "anotada na Mesa, no computador" nas telas).
- Conflito: vence o `updatedAt` mais recente (campo a campo não é necessário: cada ideia é pequena). Exclusão é lógica (`deletedAt`) por 30 dias para o outro lado apagar.
- Conta gratuita também sincroniza? Proposta: sim, com limite (por exemplo 200 ideias ativas), porque é o gancho natural para o Pro. Decisão de produto.

## API (apps/api)

| Rota | Função |
| --- | --- |
| `GET /v1/ideas?since=<iso>` | Ideias da conta alteradas desde `since` (inclui excluídas), paginadas |
| `PUT /v1/ideas/:id` | Cria ou atualiza uma ideia (idempotente pelo `id` do aparelho) |
| `DELETE /v1/ideas/:id` | Exclusão lógica |
| `PUT /v1/sermons/upcoming` | O computador publica as próximas preparações (chave, ocasião, passagem, estado) |
| `GET /v1/sermons/upcoming` | O celular lê os destinos |
| `DELETE /v1/ideas` | Apaga tudo (LGPD; o botão "Apagar as ideias deste iPhone e do servidor") |

Tabelas: `ideas` (id uuid pk, user_id, sermon_key, text, reference, source, done, created_at, updated_at, deleted_at) e `sermon_summaries` (user_id, sermon_key pk, occasion, reference, state, updated_at). Entram na exportação da conta (`/v1/account/export`) e somem com a exclusão da conta. Limites por conta como os demais recursos.

## App de computador

- Serviço `ideas-sync` no processo principal: puxa e empurra pela `PregarAPIClient`; usa o `kv` para o `since`; `ideas:changed` já atualiza a aba.
- A tabela `ideas` ganha `remote_id`/`updated_at` por aparelho? Não: o `id` local já é UUID; basta `synced_at` e `source`.
- Preferências › Conta mostra "Companheiro no iPhone: última sincronização às 14:05" e Preferências › Ritmo não muda.
- O documento do Google Drive continua opcional, só como importação.

## iOS

- SwiftUI + SwiftData, iOS 17+. Login por código (as rotas de `auth` existentes), token no Keychain.
- Telas: Início (próximo sermão + Nova ideia + recentes), Nova ideia (texto, ditado do sistema, foto do livro com Live Text, escolha do sermão, passagem), Ideias do sermão (abertas/usadas, deslizar para usar ou apagar), Conta (sessão, sincronização, privacidade).
- WidgetKit: widget pequeno "Nova ideia" e médio com o próximo sermão. Share Extension: texto e endereço viram ideia com a fonte. App Intents: "Guardar ideia", "Ideias do próximo sermão", "Marcar como usada".
- Sincronização ao abrir, ao guardar e em segundo plano (Background Tasks); notificação silenciosa opcional quando o computador marca uma ideia como usada.
- Nada de IA no celular na primeira versão.

## Ordem de trabalho e tamanho

| Etapa | O que | Quem |
| --- | --- | --- |
| 0 | Nome do app, conta Apple Developer, bundle id, ícone | você |
| 1 | API: tabelas, rotas, exportação e exclusão, testes | eu (1 a 2 dias) |
| 2 | Computador: serviço de sincronização, publicação das próximas preparações, Preferências | eu (1 dia) |
| 3 | iOS: app com as quatro telas, login e sincronização offline | eu (1 semana) |
| 4 | Widget, compartilhar e Siri | eu (2 a 3 dias) |
| 5 | TestFlight com 3 a 5 pregadores, ajustes, App Store | você + eu |
| 6 | Android (Kotlin ou Flutter) se houver demanda | depois |

## Decisões em aberto

- Gratuito sincroniza ou é só Pro?
- Ideias cifradas de ponta a ponta (chave derivada da conta) ou só em trânsito? Ponta a ponta impede recursos futuros no servidor (busca), mas é um argumento forte de privacidade para quem anota coisas pastorais.
- O celular mostra as leituras do próximo sermão (só leitura) ou fica estritamente nas ideias? Sugestão: só o texto principal como contexto, sem leituras, na primeira versão.
