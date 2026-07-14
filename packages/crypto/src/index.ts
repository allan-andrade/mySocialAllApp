import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Abstração de criptografia de tokens OAuth em repouso. Em desenvolvimento usa
 * AES-256-GCM com chave local (TOKEN_ENCRYPTION_KEY); em produção esta interface
 * pode ser reimplementada sobre um KMS (a chave nunca sai do serviço gerenciado)
 * sem tocar em quem consome — API e worker só conhecem `TokenCipher`.
 */
export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const PAYLOAD_VERSION = 'v1';

export class AesGcmTokenCipher implements TokenCipher {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `Chave de criptografia inválida: esperado ${KEY_LENGTH_BYTES} bytes, recebido ${key.length}.`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      PAYLOAD_VERSION,
      iv.toString('base64'),
      ciphertext.toString('base64'),
      authTag.toString('base64'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) {
      throw new Error('Payload cifrado inválido ou de versão desconhecida.');
    }
    const [, ivB64, ciphertextB64, authTagB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64!, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64!, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64!, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/**
 * Interpreta TOKEN_ENCRYPTION_KEY como base64 ou hex e valida o tamanho (32 bytes).
 */
export function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === KEY_LENGTH_BYTES) {
    return decoded;
  }
  throw new Error(
    'TOKEN_ENCRYPTION_KEY deve conter 32 bytes em base64 ou hex. ' +
      'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  );
}

export function createTokenCipherFromEnv(env: NodeJS.ProcessEnv = process.env): TokenCipher {
  const raw = env['TOKEN_ENCRYPTION_KEY'];
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY não definida no ambiente.');
  }
  return new AesGcmTokenCipher(parseEncryptionKey(raw));
}
