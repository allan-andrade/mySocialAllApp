# social-publisher

Aplicativo para escrever uma publicação e enviá-la simultaneamente para
várias redes sociais conectadas (Instagram, Threads, X e Páginas do
Facebook no MVP). Monorepo pnpm + Turborepo, TypeScript estrito de ponta a
ponta, sem scraping ou automação de navegador — só APIs oficiais.

**Status**: Fases 1–4 concluídas e verificadas em modo mock (fluxo completo:
compor → fila por plataforma → worker com retries/DLQ → resultado parcial →
histórico com retry isolado). **Fase 5 implementada**: conectores reais de
Threads, Instagram, Facebook Pages e X (`packages/social-connectors/src/live/`),
registrados por credencial em `SOCIAL_CONNECTOR_MODE=live` — porém **ainda não
exercitados contra as APIs reais** (exigem apps criados nos portais e revisão
de permissões; ver [docs/oauth.md](./docs/oauth.md)). Resta a Fase 6
(observabilidade completa, E2E Playwright) — ver
[docs/architecture.md](./docs/architecture.md) e
[docs/connectors.md](./docs/connectors.md).

## Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, shadcn/ui,
  React Hook Form + Zod, TanStack Query.
- **Backend**: NestJS 11 + Fastify, Zod, Swagger, API versionada em `/api/v1`.
- **Dados**: PostgreSQL + Prisma, Redis, BullMQ (worker), armazenamento
  compatível com S3 (MinIO local).
- **Infra local**: Docker Compose.

## Pré-requisitos

- Node.js ≥ 20.9 e pnpm ≥ 9 (`corepack enable` habilita a versão pinada em `packageManager`)
- Docker Desktop (ou outro daemon Docker compatível)

## Rodando localmente (um único fluxo)

```bash
# 1. Instale as dependências
pnpm install

# 2. Configure o ambiente (os defaults já batem com o docker-compose.yml)
cp .env.example .env
cp .env.example packages/database/.env   # o Prisma CLI lê o .env ao lado de prisma/, não o da raiz
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > apps/web/.env.local

# 3. Suba Postgres, Redis e MinIO
docker compose up -d

# 4. Rode as migrations
pnpm db:migrate

# 5. Suba web + api + worker juntos
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000 (Swagger em `/api/docs`, health em `/health`, `/ready`)
- MinIO console: http://localhost:9001 (usuário/senha em `.env.example`)

> **Porta do Postgres**: o compose expõe Postgres em `localhost:5433` (não
> `5432`) para não colidir com uma instalação nativa de PostgreSQL que já
> esteja rodando na máquina — comum em ambientes de desenvolvimento Windows.
> Se sua máquina não tiver esse conflito, pode trocar para `5432:5432` em
> [`docker-compose.yml`](./docker-compose.yml) e ajustar `DATABASE_URL`.

## Scripts

Executados a partir da raiz, orquestrados pelo Turborepo:

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Sobe `web`, `api` e `worker` em modo watch |
| `pnpm build` | Builda todos os packages e apps, respeitando dependências |
| `pnpm lint` | ESLint em todo o monorepo |
| `pnpm typecheck` | `tsc --noEmit` em todo o monorepo |
| `pnpm test` | Vitest em todo o monorepo (unit + e2e da API) |
| `pnpm db:migrate` | `prisma migrate dev` em `packages/database` |
| `pnpm db:studio` | Abre o Prisma Studio |

## Estrutura

```
apps/
  web/      Next.js (App Router) — compositor, conexões, histórico (fases seguintes)
  api/      NestJS + Fastify — REST /api/v1
  worker/   Processo BullMQ (placeholder nesta fase)
packages/
  database/          Prisma (schema, client)
  shared/             Tipos e códigos de erro comuns
  validation/          Schemas Zod compartilhados
  social-connectors/    Contrato SocialConnector (sem implementação ainda)
  ui/                 Componentes shadcn/ui compartilhados
  config/             tsconfig e preset Tailwind compartilhados
```

Mais detalhes: [docs/architecture.md](./docs/architecture.md) ·
[docs/connectors.md](./docs/connectors.md) ·
[docs/environment.md](./docs/environment.md) ·
[docs/oauth.md](./docs/oauth.md).

## Testes

- **Unitários**: um por package/app (`errors.test.ts`, `auth.test.ts`,
  `config.test.ts`, `button.test.tsx`, etc.), cobrindo os casos que já
  existem nesta fase (validação de registro/login, contrato do conector,
  hashing de sessão).
- **Integração de API** (`apps/api/test/*.e2e.spec.ts`): sobe a aplicação
  NestJS real contra Postgres/Redis/MinIO do `docker-compose` — auth, fluxo
  OAuth mock completo (com replay e roubo de state), Páginas do Facebook,
  drafts, upload com magic bytes, criação de publicação idempotente, guards
  de retry/cancel, paginação por cursor e isolamento entre usuários.
- **Worker** (`apps/worker/src/*.test.ts`): processor executado diretamente
  contra o banco real — sucesso, falha definitiva sem retry, erro temporário
  esgotando tentativas, instabilidade com sucesso na 2ª tentativa, container
  lento (`WAITING_PROCESSING`), resultado parcial, skip de cancelados e
  idempotência na reentrega de jobs.
- Nenhum teste depende de APIs externas reais — tudo roda sobre os fake
  connectors determinísticos.

## Limitações conhecidas desta fase

- Sem compositor de publicação, conexões de rede social, upload de mídia,
  filas de publicação ou histórico — isso é o escopo das Fases 2 a 6.
- `apps/worker` só prova que a conexão com Redis/BullMQ funciona
  (fila `system.heartbeat` vazia); as filas reais de publicação entram na
  Fase 4.
- CSRF é mitigado com verificação de `Origin` + `sameSite=lax`; um fluxo de
  token de CSRF dedicado pode ser adicionado depois se surgir a necessidade
  de formulários não-JS.
