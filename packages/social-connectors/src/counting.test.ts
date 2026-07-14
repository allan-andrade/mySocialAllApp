import { describe, expect, it } from 'vitest';

import { countCharacters, parseXText } from './counting';

describe('countCharacters — x-weighted (regras oficiais do X)', () => {
  it('conta texto Latin com peso 1', () => {
    expect(countCharacters('a'.repeat(280), 'x-weighted')).toBe(280);
  });

  it('texto exatamente no limite é válido; um caractere acima não é', () => {
    expect(parseXText('a'.repeat(280)).valid).toBe(true);
    expect(parseXText('a'.repeat(281)).valid).toBe(false);
    expect(countCharacters('a'.repeat(281), 'x-weighted')).toBe(281);
  });

  it('emojis pesam 2', () => {
    expect(countCharacters('😀', 'x-weighted')).toBe(2);
    // 140 emojis * 2 = 280 → exatamente no limite.
    expect(parseXText('😀'.repeat(140)).valid).toBe(true);
    expect(parseXText('😀'.repeat(141)).valid).toBe(false);
  });

  it('caracteres CJK pesam 2', () => {
    expect(countCharacters('こんにちは', 'x-weighted')).toBe(10); // 5 kana * 2
    expect(countCharacters('中文字', 'x-weighted')).toBe(6); // 3 hanzi * 2
  });

  it('URLs valem 23 independentemente do comprimento', () => {
    const short = 'https://x.co';
    const long = 'https://example.com/um/caminho/extremamente/longo?com=query&e=parametros';
    expect(countCharacters(short, 'x-weighted')).toBe(23);
    expect(countCharacters(long, 'x-weighted')).toBe(23);
    expect(countCharacters(`veja ${long} aqui`, 'x-weighted')).toBe(5 + 23 + 5);
  });

  it('acentos compostos são normalizados (NFC) antes de contar', () => {
    const composed = 'é'; // U+00E9
    const decomposed = 'é'; // e + combining acute
    expect(countCharacters(composed, 'x-weighted')).toBe(1);
    expect(countCharacters(decomposed, 'x-weighted')).toBe(1);
  });

  it('hashtags e quebras de linha contam como texto normal', () => {
    expect(countCharacters('#social', 'x-weighted')).toBe(7);
    expect(countCharacters('linha1\nlinha2', 'x-weighted')).toBe(13);
  });

  it('texto vazio conta 0', () => {
    expect(countCharacters('', 'x-weighted')).toBe(0);
  });
});

describe('countCharacters — unicode-code-points (Threads/Instagram)', () => {
  it('emojis fora do BMP contam 1 (não 2 como string.length)', () => {
    expect('😀'.length).toBe(2); // o que string.length faria de errado
    expect(countCharacters('😀', 'unicode-code-points')).toBe(1);
  });

  it('CJK conta 1 por caractere', () => {
    expect(countCharacters('こんにちは', 'unicode-code-points')).toBe(5);
  });

  it('combinações Unicode contam por ponto de código (sem normalizar)', () => {
    expect(countCharacters('é', 'unicode-code-points')).toBe(1);
    expect(countCharacters('é', 'unicode-code-points')).toBe(2);
    // Emoji de família (ZWJ): vários pontos de código.
    expect(countCharacters('👨‍👩‍👧', 'unicode-code-points')).toBe(5);
  });

  it('URLs contam pelo comprimento real (sem peso especial)', () => {
    const url = 'https://example.com/abc';
    expect(countCharacters(url, 'unicode-code-points')).toBe(url.length);
  });
});

describe('countCharacters — simple (Facebook)', () => {
  it('usa unidades UTF-16', () => {
    expect(countCharacters('abc', 'simple')).toBe(3);
    expect(countCharacters('😀', 'simple')).toBe(2);
  });
});
