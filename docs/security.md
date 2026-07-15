# Revisão de segurança (Fase 6)

Resumo das medidas implementadas e verificadas, mapeadas à seção 14 do briefing.

## Autenticação e sessão

- Sessão por cookie `httpOnly` + `sameSite=lax` (+ `secure` em produção), com
  token opaco de 256 bits; o banco guarda apenas o **hash SHA-256** — um vazamento
  de banco não permite replay de sessão.
- Senhas com **argon2id**; login/registro com rate limit dedicado
  (5/min registro, 10/min login) além do limite global de 100/min.
- Logout apaga a sessão no banco (revogação imediata, não só expiração).

## CSRF e origem

- `sameSite=lax` bloqueia o CSRF clássico de formulário; o `OriginGuard`
  rejeita requisições mutantes cujo header `Origin` não seja o `APP_URL`
  (navegadores sempre enviam `Origin` em fetch/XHR cross-site).
- CORS restrito ao `APP_URL` com `credentials: true`. Helmet ativo.

## OAuth (seção 15)

- `state` aleatório por fluxo, guardado em Redis com TTL de 10 min e consumo
  **destrutivo** (GETDEL) — replay do callback falha (coberto por teste e2e).
- O state é vinculado ao usuário: o callback de A não pode ser consumido pela
  sessão de B (coberto por teste e2e).
- PKCE S256 para o X (o `code_verifier` nunca sai do backend).
- Redirect URIs sempre derivados de `API_URL` no servidor (allowlist implícita
  — o cliente não escolhe o redirect).

## Tokens de provedores

- Cifrados em repouso com **AES-256-GCM** (IV único por operação, payload
  versionado); a chave vem de `TOKEN_ENCRYPTION_KEY` e a interface
  `TokenCipher` permite trocar por KMS sem tocar nos consumidores.
- Nunca aparecem em respostas da API (nem cifrados) — inclui page tokens do
  Facebook, verificado por teste. Descriptografia apenas no instante do uso
  (API/worker), nunca persistida em claro.
- Logs: Pino com `redact` de cookies/authorization; erros de provedores passam
  por `redactSecrets` (access_token/client_secret/Bearer) antes de qualquer
  mensagem. Desconectar remove os tokens do banco.
- Chamadas autenticadas aos provedores usam header `Authorization`, nunca
  query string.

## Autorização por recurso (IDOR)

- Toda leitura/escrita de conexões, páginas, rascunhos, mídia, publicações e
  destinos filtra por `userId` da sessão e responde **404 uniforme** para
  "não existe" e "não é seu" (sem oráculo de IDs). Coberto por testes de
  isolamento entre usuários em todos os módulos.

## Upload de mídia (seção 13)

- Upload direto ao storage via URL assinada com TTL de 10 min — a API nunca
  recebe o arquivo; `storageKey` é gerado no servidor (UUID), o nome do
  arquivo do cliente nunca vira caminho (sem path traversal).
- MIME real verificado por **magic bytes** no `complete`; conteúdo disfarçado
  é rejeitado e removido do storage. Extensões executáveis nem passam pelo
  schema de entrada (allowlist de MIME types).
- URLs de leitura são temporárias (1h) e emitidas só para o dono; nenhuma URL
  fornecida pelo usuário é buscada pelo servidor (sem SSRF) — o worker só
  baixa do próprio bucket.

## Validação de entrada

- Zod em todos os endpoints (schemas compartilhados com o frontend), limites de
  tamanho em todos os campos de texto, enum fechado de provedores.

## Pontos conhecidos para endurecer em produção

- `/metrics` é público (só agregados); em produção, restringir por rede ou
  auth de scrape.
- CSP do Helmet desabilitada em dev (Next dev server precisa de inline);
  habilitar política adequada no deploy.
- Considerar rotação periódica de `TOKEN_ENCRYPTION_KEY` com re-cifragem
  (o payload versionado `v1.` já suporta migração).
