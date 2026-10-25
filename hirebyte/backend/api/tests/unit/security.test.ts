import { describe, expect, it } from 'vitest';
import { accessCode, createCrypto, invitationCode } from '../../src/lib/crypto.js';
import { ConfigError, loadEnv } from '../../src/config/env.js';
import { hashPassword, verifyPassword } from '../../src/services/auth/password.js';

const crypto = createCrypto('unit-test-secret-unit-test-secret-1234');

describe('token hashing and encryption', () => {
  it('stores tokens as keyed hashes and compares in constant time', () => {
    const token = crypto.randomToken();
    const stored = crypto.hash(token);
    expect(stored).not.toContain(token);
    expect(crypto.matches(token, stored)).toBe(true);
    expect(crypto.matches(`${token}x`, stored)).toBe(false);
    expect(createCrypto('a-different-secret-a-different-secret').matches(token, stored)).toBe(false);
  });

  it('round-trips encrypted values and rejects tampering', () => {
    const sealed = crypto.encrypt('482913');
    expect(sealed).not.toContain('482913');
    expect(crypto.decrypt(sealed)).toBe('482913');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('generates readable invitation codes and six-digit access codes', () => {
    expect(invitationCode()).toMatch(/^HB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(accessCode()).toMatch(/^\d{6}$/);
  });
});

describe('passwords', () => {
  it('hashes with Argon2id', async () => {
    const hash = await hashPassword('a long enough password');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'a long enough password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('configuration (PRD §12)', () => {
  const base = { DATABASE_URL: 'postgresql://x', SESSION_SECRET: 's'.repeat(40) };

  it('refuses to enable recording without LiveKit and R2 settings', () => {
    expect(() => loadEnv({ ...base, RECORDING_ENABLED: 'true' })).toThrow(ConfigError);
  });

  it('treats empty provider settings as not configured', () => {
    const env = loadEnv({ ...base, LIVEKIT_URL: '', R2_BUCKET_NAME: '', STORAGE_PROVIDER: '' });
    expect(env.livekitConfigured).toBe(false);
    expect(env.storageConfigured).toBe(false);
  });

  it('derives the Supabase S3 endpoint from the project ref and requires the region', () => {
    const supabase = { ...base, STORAGE_PROVIDER: 'supabase', SUPABASE_PROJECT_REF: 'abcdref', STORAGE_ACCESS_KEY_ID: 'k', STORAGE_SECRET_ACCESS_KEY: 's', STORAGE_BUCKET: 'recordings' };
    const env = loadEnv({ ...supabase, STORAGE_REGION: 'ap-south-1' });
    expect(env.storage).toMatchObject({ provider: 'supabase', endpoint: 'https://abcdref.storage.supabase.co/storage/v1/s3', region: 'ap-south-1', bucket: 'recordings', signedUrlTtlSeconds: 300 });
    expect(env.storageConfigured).toBe(true);
    expect(() => loadEnv(supabase)).toThrow(/STORAGE_REGION/);
    expect(() => loadEnv({ ...supabase, SUPABASE_PROJECT_REF: '', STORAGE_REGION: 'ap-south-1' })).toThrow(/SUPABASE_PROJECT_REF/);
  });

  it('still accepts the older R2_* names', () => {
    const env = loadEnv({ ...base, R2_ACCOUNT_ID: 'abc123', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'b' });
    expect(env.storage).toMatchObject({ provider: 'r2', endpoint: 'https://abc123.r2.cloudflarestorage.com', region: 'auto' });
    expect(env.storageConfigured).toBe(true);
  });

  it('names the missing variable without echoing secret values', () => {
    try {
      loadEnv({ DATABASE_URL: 'postgresql://x', SESSION_SECRET: 'too-short-secret' });
      throw new Error('expected failure');
    } catch (err) {
      expect((err as Error).message).toContain('SESSION_SECRET');
      expect((err as Error).message).not.toContain('too-short-secret');
    }
  });
});
