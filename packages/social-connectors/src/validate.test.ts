import { ErrorCode } from '@social-publisher/shared';
import { describe, expect, it } from 'vitest';

import { describeInstagramComposition, getProviderPolicy } from './policies';
import { validatePostAgainstPolicy } from './validate';

const jpeg = { mimeType: 'image/jpeg', sizeBytes: 1024 };

function codes(result: { errors: { code: string }[] }): string[] {
  return result.errors.map((e) => e.code);
}

describe('validatePostAgainstPolicy — texto', () => {
  it('um texto de 300 caracteres invalida apenas o X (critérios de aceite 8 e 9)', () => {
    const post = { text: 'a'.repeat(300), media: [] };

    const x = validatePostAgainstPolicy(post, getProviderPolicy('x'));
    expect(x.valid).toBe(false);
    expect(codes(x)).toContain(ErrorCode.TEXT_TOO_LONG);
    expect(x.errors.find((e) => e.code === ErrorCode.TEXT_TOO_LONG)?.message).toContain(
      'Remova 20 caracteres',
    );

    const threads = validatePostAgainstPolicy(post, getProviderPolicy('threads'));
    expect(threads.valid).toBe(true);
    expect(threads.characterCount).toBe(300);
    expect(threads.maxCharacters).toBe(500);
  });

  it('X: 280 ponderado passa, 281 não passa', () => {
    const at = validatePostAgainstPolicy({ text: 'a'.repeat(280), media: [] }, getProviderPolicy('x'));
    expect(at.valid).toBe(true);
    expect(at.characterCount).toBe(280);

    const over = validatePostAgainstPolicy({ text: 'a'.repeat(281), media: [] }, getProviderPolicy('x'));
    expect(over.valid).toBe(false);
    expect(over.errors[0]?.message).toContain('Remova 1 caractere');
  });

  it('X: emojis contam ponderado (141 emojis estouram o limite)', () => {
    const ok = validatePostAgainstPolicy({ text: '😀'.repeat(140), media: [] }, getProviderPolicy('x'));
    expect(ok.valid).toBe(true);

    const over = validatePostAgainstPolicy({ text: '😀'.repeat(141), media: [] }, getProviderPolicy('x'));
    expect(over.valid).toBe(false);
  });

  it('Threads: 500 pontos de código no limite; emoji conta 1', () => {
    const atLimit = validatePostAgainstPolicy(
      { text: '😀'.repeat(500), media: [] },
      getProviderPolicy('threads'),
    );
    expect(atLimit.valid).toBe(true);
    expect(atLimit.characterCount).toBe(500);

    const over = validatePostAgainstPolicy(
      { text: '😀'.repeat(501), media: [] },
      getProviderPolicy('threads'),
    );
    expect(over.valid).toBe(false);
  });

  it('conteúdo totalmente vazio exige texto ou mídia', () => {
    const result = validatePostAgainstPolicy({ text: '   ', media: [] }, getProviderPolicy('threads'));
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain(ErrorCode.TEXT_REQUIRED);
  });
});

describe('validatePostAgainstPolicy — mídia', () => {
  it('texto sem mídia invalida o Instagram, mas não Threads/X/Facebook (critério 10)', () => {
    const post = { text: 'olá mundo', media: [] };

    const instagram = validatePostAgainstPolicy(post, getProviderPolicy('instagram'));
    expect(instagram.valid).toBe(false);
    expect(codes(instagram)).toEqual([ErrorCode.MEDIA_REQUIRED]);

    for (const provider of ['threads', 'x', 'facebook_page'] as const) {
      expect(validatePostAgainstPolicy(post, getProviderPolicy(provider)).valid).toBe(true);
    }
  });

  it('Instagram com imagem passa', () => {
    const result = validatePostAgainstPolicy(
      { text: 'legenda', media: [jpeg] },
      getProviderPolicy('instagram'),
    );
    expect(result.valid).toBe(true);
  });

  it('quantidade acima do máximo aponta MEDIA_TOO_MANY só nas plataformas afetadas', () => {
    const fiveImages = { text: '', media: Array(5).fill(jpeg) };

    const x = validatePostAgainstPolicy(fiveImages, getProviderPolicy('x')); // máx 4
    expect(codes(x)).toContain(ErrorCode.MEDIA_TOO_MANY);

    const threads = validatePostAgainstPolicy(fiveImages, getProviderPolicy('threads')); // máx 10
    expect(threads.valid).toBe(true);
  });

  it('limite combinado do Threads: 10 mídias válidas (imagens+vídeos), 11 estoura', () => {
    const mp4 = { mimeType: 'video/mp4', sizeBytes: 1024 };
    const tenMixed = { text: '', media: [...Array(7).fill(jpeg), ...Array(3).fill(mp4)] };
    expect(validatePostAgainstPolicy(tenMixed, getProviderPolicy('threads')).valid).toBe(true);

    const eleven = { text: '', media: Array(11).fill(jpeg) };
    const result = validatePostAgainstPolicy(eleven, getProviderPolicy('threads'));
    expect(codes(result)).toContain(ErrorCode.MEDIA_TOO_MANY);
    expect(result.errors[0]?.message).toContain('no máximo 10 mídias');
  });

  it('X: 4 imagens ok; 5 estoura; 1 vídeo ok; 2 vídeos estouram', () => {
    const mp4 = { mimeType: 'video/mp4', sizeBytes: 1024 };
    expect(validatePostAgainstPolicy({ text: '', media: Array(4).fill(jpeg) }, getProviderPolicy('x')).valid).toBe(true);
    expect(
      codes(validatePostAgainstPolicy({ text: '', media: Array(5).fill(jpeg) }, getProviderPolicy('x'))),
    ).toContain(ErrorCode.MEDIA_TOO_MANY);

    expect(validatePostAgainstPolicy({ text: '', media: [mp4] }, getProviderPolicy('x')).valid).toBe(true);
    const twoVideos = validatePostAgainstPolicy({ text: '', media: [mp4, mp4] }, getProviderPolicy('x'));
    expect(twoVideos.valid).toBe(false);
    expect(twoVideos.errors.some((e) => e.message.includes('no máximo 1 vídeo'))).toBe(true);
  });

  it('X não permite misturar imagem e vídeo; Threads/Instagram permitem', () => {
    const mixed = { text: '', media: [jpeg, { mimeType: 'video/mp4', sizeBytes: 1024 }] };

    const x = validatePostAgainstPolicy(mixed, getProviderPolicy('x'));
    expect(x.valid).toBe(false);
    expect(x.errors.some((e) => e.message.includes('misturar imagens e vídeos'))).toBe(true);

    expect(validatePostAgainstPolicy(mixed, getProviderPolicy('threads')).valid).toBe(true);
    expect(validatePostAgainstPolicy(mixed, getProviderPolicy('instagram')).valid).toBe(true);
  });

  it('formato não aceito gera MEDIA_NOT_SUPPORTED apenas onde não é aceito', () => {
    const gif = { text: '', media: [{ mimeType: 'image/gif', sizeBytes: 1024 }] };

    const instagram = validatePostAgainstPolicy(gif, getProviderPolicy('instagram'));
    expect(codes(instagram)).toContain(ErrorCode.MEDIA_NOT_SUPPORTED);

    const x = validatePostAgainstPolicy(gif, getProviderPolicy('x'));
    expect(x.valid).toBe(true);
  });

  it('arquivo acima do tamanho máximo gera MEDIA_TOO_LARGE', () => {
    const huge = { text: '', media: [{ mimeType: 'image/jpeg', sizeBytes: 2048 * 1024 * 1024 }] };
    const result = validatePostAgainstPolicy(huge, getProviderPolicy('threads'));
    expect(codes(result)).toContain(ErrorCode.MEDIA_TOO_LARGE);
  });

  it('vídeo acima da duração máxima gera MEDIA_DURATION_EXCEEDED só onde estoura', () => {
    const video200s = { text: '', media: [{ mimeType: 'video/mp4', sizeBytes: 1024, durationSeconds: 200 }] };

    const x = validatePostAgainstPolicy(video200s, getProviderPolicy('x')); // máx 140s
    expect(codes(x)).toContain(ErrorCode.MEDIA_DURATION_EXCEEDED);

    const threads = validatePostAgainstPolicy(video200s, getProviderPolicy('threads')); // máx 300s
    expect(threads.valid).toBe(true);
  });

  it('erros de texto e mídia se acumulam de forma independente', () => {
    const result = validatePostAgainstPolicy(
      { text: 'a'.repeat(300), media: Array(5).fill(jpeg) },
      getProviderPolicy('x'),
    );
    expect(codes(result)).toEqual(
      expect.arrayContaining([ErrorCode.TEXT_TOO_LONG, ErrorCode.MEDIA_TOO_MANY]),
    );
  });
});

describe('describeInstagramComposition', () => {
  it('0 mídias = vazio, 1 = publicação única, 2+ = carrossel', () => {
    expect(describeInstagramComposition(0)).toBe('empty');
    expect(describeInstagramComposition(1)).toBe('single');
    expect(describeInstagramComposition(2)).toBe('carousel');
    expect(describeInstagramComposition(10)).toBe('carousel');
  });
});
