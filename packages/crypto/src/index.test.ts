import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AesGcmTokenCipher, createTokenCipherFromEnv, parseEncryptionKey } from './index';

describe('AesGcmTokenCipher', () => {
  const cipher = new AesGcmTokenCipher(randomBytes(32));

  it('round-trips a token', () => {
    const token = 'oauth-access-token-with-unicode-çãé-😀';
    const payload = cipher.encrypt(token);

    expect(payload).not.toContain(token);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(payload)).toBe(token);
  });

  it('uses a unique IV per encryption (same plaintext, different payloads)', () => {
    const a = cipher.encrypt('same-token');
    const b = cipher.encrypt('same-token');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe(cipher.decrypt(b));
  });

  it('rejects tampered payloads', () => {
    const payload = cipher.encrypt('token');
    const [v, iv, ct, tag] = payload.split('.');
    const tamperedCt = Buffer.from(ct!, 'base64');
    tamperedCt[0] = tamperedCt[0]! ^ 0xff;
    const tampered = [v, iv, tamperedCt.toString('base64'), tag].join('.');

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('rejects payloads from another key', () => {
    const other = new AesGcmTokenCipher(randomBytes(32));
    const payload = other.encrypt('token');
    expect(() => cipher.decrypt(payload)).toThrow();
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new AesGcmTokenCipher(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('parseEncryptionKey', () => {
  it('accepts 32 bytes in base64', () => {
    const key = randomBytes(32);
    expect(parseEncryptionKey(key.toString('base64'))).toEqual(key);
  });

  it('accepts 32 bytes in hex', () => {
    const key = randomBytes(32);
    expect(parseEncryptionKey(key.toString('hex'))).toEqual(key);
  });

  it('rejects short keys', () => {
    expect(() => parseEncryptionKey('short')).toThrow(/32 bytes/);
  });
});

describe('createTokenCipherFromEnv', () => {
  it('builds a working cipher from the env var', () => {
    const env = { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv;
    const cipher = createTokenCipherFromEnv(env);
    expect(cipher.decrypt(cipher.encrypt('abc'))).toBe('abc');
  });

  it('fails fast when the key is missing', () => {
    expect(() => createTokenCipherFromEnv({} as NodeJS.ProcessEnv)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
