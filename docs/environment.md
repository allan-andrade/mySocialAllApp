# Variáveis de ambiente

Copie `.env.example` para `.env` na raiz do projeto. Os valores do exemplo já
correspondem aos defaults do `docker-compose.yml`, então o app funciona localmente
sem alterar nada.

| Variável | Descrição |
| --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production`. |
| `API_PORT` | Porta HTTP da API NestJS (padrão `4000`). |
| `WEB_PORT` | Porta do Next.js (padrão `3000`, hardcoded nos scripts `dev`/`start`). |
| `APP_URL` | Origem do frontend. Usada em CORS e na verificação de `Origin` (proteção CSRF). |
| `API_URL` | Origem da API, usada pelo frontend para chamadas server-side. |
| `SOCIAL_CONNECTOR_MODE` | `mock` (padrão, nenhuma credencial real necessária) ou `live`. Ver [connectors.md](./connectors.md). |
| `DATABASE_URL` | String de conexão Postgres usada pelo Prisma. |
| `REDIS_URL` | Usada pelo worker (BullMQ) e, futuramente, por rate limiting/filas na API. |
| `SESSION_SECRET` | Segredo local. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `TOKEN_ENCRYPTION_KEY` | Chave para criptografar tokens OAuth em repouso (AES-256-GCM) a partir da Fase 2. Em produção, substitua por uma chave gerenciada por KMS. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credenciais do MinIO local (armazenamento de mídia, usado a partir da Fase 3). |
| `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI` | App do Meta for Developers (Instagram, Threads*, Facebook Pages). Ver [oauth.md](./oauth.md). |
| `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI` | App específico da Threads API. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | App do X Developer Platform (OAuth 2.0 + PKCE). |

`packages/database/.env` também precisa existir com `DATABASE_URL` — é lido
diretamente pelo Prisma CLI (`prisma generate`/`migrate`), que procura um `.env`
ao lado da pasta `prisma/`, e não herda o `.env` da raiz automaticamente.

`apps/web/.env.local` guarda apenas `NEXT_PUBLIC_API_URL`, pois o Next.js só
carrega `.env*` do diretório do próprio app.

Nenhum destes arquivos `.env*` (exceto `.env.example`) é versionado.
