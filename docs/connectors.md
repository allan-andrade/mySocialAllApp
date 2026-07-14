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

As implementações reais (`InstagramConnector`, `ThreadsConnector`, `XConnector`,
`FacebookPageConnector`) entram na Fase 5 e serão registradas no mesmo registry.

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
