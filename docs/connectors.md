# Arquitetura de conectores

Cada rede social é um adapter que implementa a interface `SocialConnector`
definida em [`packages/social-connectors/src/types.ts`](../packages/social-connectors/src/types.ts):

```ts
export interface SocialConnector {
  provider: SocialProvider;
  getAuthorizationUrl(input: AuthorizationInput): Promise<string>;
  exchangeAuthorizationCode(input: AuthorizationCodeInput): Promise<SocialTokenResult>;
  refreshAccessToken(connection: SocialConnection): Promise<SocialTokenResult>;
  revokeConnection(connection: SocialConnection): Promise<void>;
  getProfile(connection: SocialConnection): Promise<SocialProfile>;
  getCapabilities(connection: SocialConnection): Promise<ProviderCapabilities>;
  validatePost(input: ProviderPostInput, capabilities: ProviderCapabilities): Promise<ProviderValidationResult>;
  publish(input: ProviderPostInput, connection: SocialConnection): Promise<ProviderPublishResult>;
  getPublishStatus?(externalPublicationId: string, connection: SocialConnection): Promise<ProviderPublishStatus>;
}
```

Nenhuma regra específica de plataforma (limite de caracteres, formatos de mídia,
fluxo OAuth) deve vazar para controllers, componentes de UI ou serviços
genéricos — tudo fica encapsulado dentro do conector correspondente.

**Status na Fase 2**: além do contrato, o pacote já contém:

- `policies.ts` — configuração central `ProviderPolicy` por provedor (limites de
  texto, estratégia de contagem, regras de mídia). Nenhum limite vive fora daqui.
- `counting.ts` — estratégias `simple`, `unicode-code-points` e `x-weighted`
  (contagem ponderada oficial do X via `twitter-text`; nunca `string.length`).
- `validate.ts` — `validatePostAgainstPolicy`, a mesma função executada no
  frontend, no backend e no worker.
- `fake/fake-connector.ts` — conector mock determinístico usado em
  `SOCIAL_CONNECTOR_MODE=mock`. Marcadores no texto simulam cenários:
  `[[mock:fail]]` (rejeição definitiva), `[[mock:ratelimit]]` (429 retryable),
  `[[mock:unavailable]]` (503 retryable) e `[[mock:slow]]` (processamento
  demorado no `getPublishStatus`). IDs e URLs gerados são claramente mock
  (`mock-<provider>-<hash>` / `https://mock.social/...`).
- `registry.ts` — `createConnectorRegistry('mock' | 'live')`. Em `live`, um
  provedor sem implementação real falha explicitamente; nunca há fallback
  silencioso para mock.

**Status na Fase 5**: os quatro conectores reais existem em `src/live/`:

| Conector | API | Publicação |
| --- | --- | --- |
| `ThreadsConnector` | graph.threads.net | container TEXT/IMAGE/VIDEO/CAROUSEL → polling de status → `threads_publish` → permalink |
| `InstagramConnector` | Instagram Graph API (via Facebook Login) | resolve a conta profissional por `/me/accounts`; container em `/{ig}/media` (Reels para vídeo, CAROUSEL para 2+) → `status_code` → `media_publish` |
| `FacebookPageConnector` | Graph API | `listPages` com page tokens; texto em `/feed`, foto em `/photos`, multi-foto via `attached_media`, vídeo em `/videos` — sempre com o token da Página |
| `XConnector` | X API v2 | OAuth 2.0 + PKCE (S256), upload de mídia em chunks (INIT/APPEND/FINALIZE + STATUS) ANTES do post, `POST /2/tweets`, refresh e revoke |

Pontos em comum: tokens sempre em header `Authorization` (nunca em URL),
erros normalizados pelos códigos internos com retryability correta
(429/5xx/timeout → temporário; 4xx → definitivo), mensagens com
`access_token`/`client_secret`/`Bearer` **redigidos** antes de qualquer log,
e OAuth da Meta compartilhado em `meta-oauth.ts` (short-lived →
`fb_exchange_token` long-lived).

Em modo live, `liveConfigFromEnv` registra apenas os conectores cujas
credenciais existem no ambiente (`META_APP_ID/SECRET`,
`THREADS_APP_ID/SECRET`, `X_CLIENT_ID[/SECRET]`); os demais permanecem
desabilitados com erro explícito.

> ⚠️ **Não validado contra as APIs reais**: os conectores foram implementados
> a partir da documentação oficial e testados com HTTP mockado (endpoints,
> parâmetros, ordem do fluxo de container, classificação de erros). O
> exercício com credenciais reais — incluindo App Review da Meta e nível de
> acesso do X — ainda precisa ser feito antes de considerar as integrações
> funcionais em produção (ver [oauth.md](./oauth.md)).

## Modo mock vs. live

Controlado por `SOCIAL_CONNECTOR_MODE`:

- **`mock`** (padrão): simula OAuth e publicação sem nenhuma credencial real,
  incluindo cenários de sucesso, erro, rate limit e processamento demorado.
  Os fake connectors nunca são usados silenciosamente em produção.
- **`live`**: exige as credenciais reais de cada provedor (ver
  [oauth.md](./oauth.md) e [environment.md](./environment.md)). Se faltar
  credencial de um provedor específico, apenas aquele conector fica
  indisponível — o sistema não cai para mock automaticamente.

## Limites e capacidades

Nenhum limite de caracteres ou regra de mídia deve ser um número solto no
meio do código. A partir da Fase 2, esses valores vivem numa configuração
central por provedor (`ProviderPolicy`), consumida tanto no frontend (feedback
instantâneo) quanto no backend (antes de criar jobs) e no worker (imediatamente
antes de chamar a API externa) — nunca confiando apenas na validação do
frontend.
