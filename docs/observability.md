# Observabilidade

## Endpoints

| Endpoint | Descrição |
| --- | --- |
| `GET /health` | Liveness — o processo da API responde. |
| `GET /ready` | Readiness — inclui `SELECT 1` no Postgres; 503 se o banco não responde. |
| `GET /metrics` | Formato Prometheus (prom-client). |

## Correlation ID

Toda requisição tem um `x-request-id`: o valor enviado pelo chamador é aceito
(quando bem-formado) ou um UUID é gerado. Ele volta no header da resposta e
aparece como `reqId` em todas as linhas de log da requisição (Pino). No
pipeline assíncrono, o jobId do BullMQ é gravado como `requestCorrelationId`
em cada `PublicationAttempt` — dá para seguir um destino da API à tentativa
no worker.

## Logs estruturados

- **API**: Pino via Fastify — JSON por linha, com `redact` de
  `cookie`/`authorization`/`set-cookie`. Erros de domínio logam código
  normalizado + path + requestId, nunca tokens ou texto da publicação.
- **Worker**: eventos JSON (`target_processed`, `target_job_failed`) com id do
  destino, tentativa e motivo normalizado (mensagens passam pela redação de
  segredos dos conectores).

## Métricas (`/metrics`)

API e worker são processos separados; as métricas de publicação são derivadas
do **banco no momento do scrape** (fonte única de verdade), e as de fila
diretamente do BullMQ. Apenas agregados — nenhum texto de publicação, token ou
identificador de usuário vira métrica ou label.

| Métrica | Labels | Significado |
| --- | --- | --- |
| `social_publisher_publications` | `status` | Publicações por status geral (inclui `PARTIALLY_PUBLISHED`). |
| `social_publisher_publication_targets` | `provider`, `status` | Destinos por plataforma — taxas de sucesso/falha por provedor via PromQL. |
| `social_publisher_target_errors` | `code` | Destinos com falha por código normalizado (`RATE_LIMITED`, `PROVIDER_REJECTED_CONTENT`, ...). |
| `social_publisher_publication_retries_total` | — | Tentativas além da primeira (retries automáticos + manuais). |
| `social_publisher_publish_duration_seconds_avg` | `provider` | Tempo médio entre criação do destino e publicação. |
| `social_publisher_queue_jobs` | `state` | Fila `publication-targets` por estado (`waiting`, `active`, `delayed`, `failed`, ...). |
| `social_publisher_process_*` / `nodejs_*` | — | Métricas default do prom-client (CPU, memória, event loop). |

Exemplos de PromQL:

```promql
# taxa de sucesso por provedor
sum by (provider) (social_publisher_publication_targets{status="PUBLISHED"})
  / sum by (provider) (social_publisher_publication_targets)

# backlog da fila
social_publisher_queue_jobs{state="waiting"}
```

## Dead-letter queue

Jobs esgotados ou com erro definitivo são copiados para a fila
`publication-targets-dlq` (dados do job + motivo normalizado) para inspeção
manual via Redis/BullMQ.
