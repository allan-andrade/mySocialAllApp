# Configurando OAuth com os provedores reais

Estas integrações ainda não estão implementadas (chegam na Fase 5), mas os
apps já precisam existir nos portais de desenvolvedores antes disso, pois a
revisão de permissões costuma levar dias. Este guia cobre a criação dos apps
e o preenchimento das variáveis em [environment.md](./environment.md).

## Meta for Developers (Instagram, Threads, Facebook Pages)

1. Crie um app em https://developers.facebook.com/apps (tipo "Business").
2. Adicione os produtos **Facebook Login**, **Instagram Graph API** e, se for
   usar a Threads API separadamente, o produto **Threads API**.
3. Em **Configurações > Básico**, copie o `App ID` e o `App Secret` para
   `META_APP_ID` / `META_APP_SECRET` (e `THREADS_APP_ID` / `THREADS_APP_SECRET`
   se o app da Threads for distinto).
4. Em **Facebook Login > Configurações**, cadastre o redirect URI exato em
   "URIs de redirecionamento OAuth válidos". Em desenvolvimento local, use o
   valor de `META_REDIRECT_URI` no `.env.example`
   (`http://localhost:4000/api/v1/social-connections/facebook_page/callback`).
5. Permissões necessárias (mínimo, mais restritivo possível):
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` — para
     listar Páginas administradas e publicar nelas.
   - `instagram_basic`, `instagram_content_publish` — para contas profissionais
     do Instagram vinculadas a uma Página.
   - Escopos da Threads API conforme a documentação oficial do produto.
6. **Revisão do app**: qualquer permissão além do modo de desenvolvimento
   (testado só com usuários/admins do próprio app) exige App Review da Meta,
   com vídeo de demonstração do fluxo de uso de cada permissão solicitada.
   Planeje esse tempo — normalmente alguns dias úteis.
7. Requisitos de conta: Instagram exige conta profissional (criador ou
   empresa) vinculada a uma Página do Facebook; contas pessoais não são
   suportadas pela API — a aplicação deve comunicar isso claramente ao usuário
   (ver seção de UX de conexões no briefing do produto).

## X Developer Platform

1. Crie um projeto e um app em https://developer.x.com/en/portal/dashboard.
2. Em **User authentication settings**, ative **OAuth 2.0** com tipo de app
   "Web App" e marque **PKCE** (obrigatório, sem client secret exposto no
   frontend).
3. Cadastre o **Callback URI** exatamente igual a `X_REDIRECT_URI`
   (`http://localhost:4000/api/v1/social-connections/x/callback` em dev).
4. Copie `Client ID` e `Client Secret` para `X_CLIENT_ID` / `X_CLIENT_SECRET`.
5. Scopes mínimos: `tweet.read`, `tweet.write`, `users.read` e `offline.access`
   (necessário para receber `refresh_token`).
6. O nível de acesso da API (Free/Basic/Pro) determina limites de publicação
   e se contas Premium podem usar posts longos — a integração real deve
   detectar a capacidade da conta em vez de assumir um limite fixo (ver
   [connectors.md](./connectors.md)).

## Checklist ao trocar de mock para live

- [ ] `SOCIAL_CONNECTOR_MODE=live`
- [ ] Credenciais preenchidas para cada provedor que será usado
- [ ] Redirect URIs cadastrados nos portais batendo exatamente com as
      variáveis `*_REDIRECT_URI` (incluindo protocolo e ausência de barra final)
- [ ] App aprovado nas permissões necessárias (Meta) / nível de acesso
      adequado (X)
