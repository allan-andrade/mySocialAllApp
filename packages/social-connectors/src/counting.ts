import twitter from 'twitter-text';

export type CountingStrategy = 'simple' | 'unicode-code-points' | 'x-weighted';

/**
 * Conta caracteres segundo a estratégia do provedor:
 *
 * - `simple`: unidades UTF-16 (`string.length`). Suficiente para provedores de
 *   limite altíssimo (Facebook), onde a diferença nunca é o fator decisivo.
 * - `unicode-code-points`: pontos de código Unicode — um emoji fora do BMP conta 1,
 *   não 2. Usado por Threads e Instagram.
 * - `x-weighted`: regras oficiais de contagem ponderada do X via `twitter-text`
 *   (normalização NFC, URLs valem 23, CJK/emoji valem 2, Latin vale 1).
 */
export function countCharacters(text: string, strategy: CountingStrategy): number {
  switch (strategy) {
    case 'simple':
      return text.length;
    case 'unicode-code-points':
      return Array.from(text).length;
    case 'x-weighted':
      return twitter.parseTweet(text).weightedLength;
  }
}

/** Resultado detalhado para o contador do X (inclui validade segundo a lib oficial). */
export function parseXText(text: string): { weightedLength: number; valid: boolean } {
  const parsed = twitter.parseTweet(text);
  return { weightedLength: parsed.weightedLength, valid: parsed.valid };
}
