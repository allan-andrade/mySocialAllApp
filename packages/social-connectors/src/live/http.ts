import { AppError, ErrorCode } from '@social-publisher/shared';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Remove segredos de qualquer texto que possa acabar em erro/log: tokens em
 * query strings (padrão Meta), client_secret e bearer tokens.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/(access_token=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(client_secret=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(refresh_token=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]');
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface ProviderErrorBody {
  error?: { message?: string; error_user_msg?: string; code?: number; type?: string };
  errors?: Array<{ message?: string; detail?: string }>;
  error_description?: string;
  detail?: string;
  title?: string;
}

function extractProviderMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as ProviderErrorBody;
  return (
    b.error?.error_user_msg ??
    b.error?.message ??
    b.errors?.[0]?.detail ??
    b.errors?.[0]?.message ??
    b.error_description ??
    b.detail ??
    b.title
  );
}

/**
 * Converte uma resposta HTTP de provedor em AppError com código interno
 * normalizado (seção 19) e flag de retry correta (seção 10):
 * 429/5xx/timeout → temporário (retryable); 4xx restantes → definitivo.
 */
export function normalizeProviderHttpError(
  providerLabel: string,
  status: number,
  body: unknown,
): AppError {
  const providerMessage = extractProviderMessage(body);
  const detail = providerMessage ? redactSecrets(truncate(providerMessage)) : `HTTP ${status}`;

  if (status === 429) {
    return new AppError(
      ErrorCode.RATE_LIMITED,
      `${providerLabel}: limite de requisições atingido. (${detail})`,
      429,
      true,
    );
  }
  if (status >= 500) {
    return new AppError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `${providerLabel} indisponível no momento. (${detail})`,
      status,
      true,
    );
  }
  if (status === 401) {
    return new AppError(
      ErrorCode.TOKEN_EXPIRED,
      `Autorização do ${providerLabel} expirou ou foi revogada. Reconecte a conta. (${detail})`,
      401,
      false,
    );
  }
  if (status === 403) {
    return new AppError(
      ErrorCode.INSUFFICIENT_PERMISSION,
      `Sem permissão no ${providerLabel} para esta operação. (${detail})`,
      403,
      false,
    );
  }
  return new AppError(
    ErrorCode.PROVIDER_REJECTED_CONTENT,
    `${providerLabel} rejeitou a requisição. (${detail})`,
    status,
    false,
  );
}

export interface ProviderFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams;
  timeoutMs?: number;
  /** Respostas sem corpo JSON (ex.: 200 vazio de revoke). */
  expectJson?: boolean;
}

/**
 * fetch com timeout, classificação de erros e parsing JSON. Toda chamada externa
 * dos conectores live passa por aqui — nenhum erro cru (possivelmente com token)
 * escapa sem redação.
 */
export async function providerFetch<T = unknown>(
  providerLabel: string,
  url: string,
  options: ProviderFetchOptions = {},
): Promise<T> {
  const { method = 'GET', headers, body, timeoutMs = DEFAULT_TIMEOUT_MS, expectJson = true } =
    options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Timeout e falhas de rede são sempre temporários.
    const reason = error instanceof Error ? redactSecrets(error.message) : 'falha de rede';
    throw new AppError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Não foi possível falar com o ${providerLabel} (${truncate(reason)}).`,
      503,
      true,
    );
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    throw normalizeProviderHttpError(providerLabel, response.status, parsed ?? raw);
  }
  if (!expectJson) {
    return undefined as T;
  }
  if (parsed === undefined) {
    throw new AppError(
      ErrorCode.UNKNOWN_PROVIDER_ERROR,
      `${providerLabel} devolveu uma resposta inesperada (não-JSON).`,
      502,
      true,
    );
  }
  return parsed as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opções comuns aos conectores live (intervalos encurtados nos testes). */
export interface LiveConnectorOptions {
  statusPollIntervalMs?: number;
  statusPollLimit?: number;
}
