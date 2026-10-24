import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Unambiguous characters for human-typed codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Crypto {
  /** High-entropy opaque token for cookies and pairing links. */
  randomToken(bytes?: number): string;
  /** Keyed hash (HMAC-SHA256) used to store tokens and codes without keeping them in plain text. */
  hash(value: string): string;
  /** Constant-time comparison of a value against a stored hash. */
  matches(value: string, storedHash: string): boolean;
  /** AES-256-GCM, for secrets the server must show again later (access codes, pairing links). */
  encrypt(plain: string): string;
  decrypt(payload: string): string;
}

export function createCrypto(secret: string): Crypto {
  const hmacKey = createHash('sha256').update(`${secret}:hmac`).digest();
  const encKey = createHash('sha256').update(`${secret}:enc`).digest();

  const hash = (value: string) => createHmac('sha256', hmacKey).update(value).digest('hex');

  return {
    randomToken: (bytes = 32) => randomBytes(bytes).toString('base64url'),
    hash,
    matches(value, storedHash) {
      const a = Buffer.from(hash(value), 'hex');
      const b = Buffer.from(storedHash, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    },
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    decrypt(payload) {
      const raw = Buffer.from(payload, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', encKey, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/** e.g. HB-7K2M-Q9XA */
export function invitationCode(): string {
  const block = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `HB-${block()}-${block()}`;
}

/** Six-digit access code. */
export function accessCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
