import { describe, expect, it } from 'vitest';

import {
  computePublishBlockers,
  countForProvider,
  detectLinks,
  textForProvider,
  validateForProvider,
} from './composer-logic';

describe('textForProvider', () => {
  it('usa a personalização apenas na plataforma dona dela', () => {
    const overrides = { x: 'versão curta pro X' };
    expect(textForProvider('texto principal', overrides, 'x')).toBe('versão curta pro X');
    expect(textForProvider('texto principal', overrides, 'threads')).toBe('texto principal');
  });
});

describe('validateForProvider', () => {
  it('um texto de 300 caracteres invalida o X, mas a personalização curta resolve', () => {
    const longText = 'a'.repeat(300);

    const without = validateForProvider('x', longText, {}, []);
    expect(without.valid).toBe(false);

    const withOverride = validateForProvider('x', longText, { x: 'curto' }, []);
    expect(withOverride.valid).toBe(true);
  });
});

describe('countForProvider', () => {
  it('conta com a estratégia da plataforma (X ponderado, Threads por code points)', () => {
    expect(countForProvider('x', '😀', {})).toEqual({ count: 2, max: 280 });
    expect(countForProvider('threads', '😀', {})).toEqual({ count: 1, max: 500 });
  });
});

describe('computePublishBlockers', () => {
  const base = {
    selectedProviders: ['threads' as const],
    validations: { threads: { valid: true, errors: [] } },
    hasUploadInProgress: false,
    hasUnprocessedMedia: false,
    baseText: 'olá',
    mediaCount: 0,
  };

  it('libera quando tudo está válido', () => {
    expect(computePublishBlockers(base)).toEqual([]);
  });

  it('bloqueia sem plataforma selecionada', () => {
    expect(computePublishBlockers({ ...base, selectedProviders: [] })).toContainEqual(
      expect.stringContaining('ao menos uma plataforma'),
    );
  });

  it('bloqueia com upload em andamento', () => {
    expect(computePublishBlockers({ ...base, hasUploadInProgress: true })).toContainEqual(
      expect.stringContaining('uploads em andamento'),
    );
  });

  it('bloqueia com conteúdo vazio', () => {
    expect(computePublishBlockers({ ...base, baseText: '  ', mediaCount: 0 })).toContainEqual(
      expect.stringContaining('Escreva um texto'),
    );
  });

  it('bloqueia quando uma plataforma selecionada está inválida', () => {
    const blockers = computePublishBlockers({
      ...base,
      validations: { threads: { valid: false, errors: [{ code: 'TEXT_TOO_LONG', message: 'x' }] } },
    });
    expect(blockers).toContainEqual(expect.stringContaining('threads'));
  });
});

describe('detectLinks', () => {
  it('detecta URLs http/https no texto', () => {
    expect(detectLinks('veja https://a.com e http://b.org/x aqui')).toHaveLength(2);
    expect(detectLinks('sem links')).toHaveLength(0);
  });
});
