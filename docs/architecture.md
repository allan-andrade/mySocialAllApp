# Arquitetura (Fase 1 — Fundação)

## Monorepo

```
apps/
  web/      Next.js 14 (App Router) — frontend
  api/      NestJS 11 + Fastify — backend REST, versão /api/v1
  worker/   Processo BullMQ standalone (placeholder nesta fase)

packages/
  database/          Prisma schema + client (User, Session)
  shared/             Tipos e códigos de erro comuns a frontend/backend
  validation/          Schemas Zod compartilhados (register/login)
  social-connectors/    Contrato SocialConnector (sem implementação ainda)
  ui/                 Componentes shadcn/ui compartilhados
  config/             tsconfig e preset Tailwind compartilhados
```

Gerenciado com pnpm workspaces + Turborepo. Cada pacote/app roda `build`,
`dev`, `lint`, `typecheck` e `test` de forma independente; o Turborepo cuida
da ordem (`^build` garante que os packages compilem antes dos apps que os
consomem) e do cache.

## Autenticação

Sessão em cookie `httpOnly`, não JWT:

1. `POST /api/v1/auth/register` ou `/login` cria um `User` (senha com
   `argon2id`) e uma `Session` no Postgres, guardando apenas o **hash SHA-256**
   do token — o token bruto só existe no cookie do navegador.
2. O cookie `sp_session` (`httpOnly`, `sameSite=lax`, `secure` em produção)
   carrega o token bruto.
3. Rotas protegidas usam `SessionAuthGuard`, que hasheia o cookie recebido e
   busca a sessão correspondente no banco.
4. `POST /api/v1/auth/logout` apaga a `Session` do banco e limpa o cookie.

Proteções adicionais: rate limiting (`@nestjs/throttler`) mais restritivo em
`/auth/register` e `/auth/login`; `OriginGuard` rejeitando requisições
mutantes cujo header `Origin` não bate com `APP_URL` (defesa CSRF de
baixo custo, complementar ao `sameSite=lax`); Helmet; CORS restrito a
`APP_URL` com `credentials: true`; erros normalizados via `AllExceptionsFilter`
(nunca vaza stack trace nem dado sensível ao cliente); logs estruturados em
JSON via Fastify/Pino com `redact` de cookies e headers de autorização.

No frontend, `apps/web/lib/auth.ts` lê o cookie da requisição recebida
(`next/headers`) e o repassa manualmente para `GET /auth/me` em componentes de
servidor — `fetch` no Node não herda cookies do request automaticamente como
o `fetch` do navegador faz.

## Banco de dados

Postgres via Prisma (`packages/database/prisma/schema.prisma`). Nesta fase
apenas `User` e `Session` existem — o schema de domínio completo (
`SocialConnection`, `Publication`, `MediaAsset` etc.) entra na Fase 2.

## Design system

Tailwind CSS + shadcn/ui (Radix primitives) em `packages/ui`, consumido como
código-fonte TS/TSX diretamente pelo Next.js via `transpilePackages` — sem
build próprio, então qualquer mudança nos componentes reflete imediatamente
no `next dev`. Tema claro/escuro via `next-themes` com toggle no header.

## Por que essas escolhas

- **NestJS + Fastify** em vez de Fastify puro: módulos, DI, guards e Swagger
  nativos ajudam a organizar os muitos domínios que vêm a seguir (conexões,
  mídia, publicações, um módulo por conector).
- **Zod em vez de class-validator**: os mesmos schemas de
  `packages/validation` validam no frontend (React Hook Form) e no backend
  (`ZodValidationPipe`), sem duplicar regras.
- **Sessão em Postgres em vez de JWT**: permite revogar uma sessão
  individualmente (obrigatório para "desconectar dispositivo") sem esperar
  expiração de token, e bate com o schema `Session` pedido no briefing.
