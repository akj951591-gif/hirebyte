import { createHash } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { createLiveKitProvider, createLiveKitWebhookVerifier, livekitHttpUrl } from '../../src/providers/media/livekit.provider.js';
import { createObjectStorage, recordingObjectKey } from '../../src/providers/object-storage/s3Storage.provider.js';

// Real SDKs with fake credentials: tokens, signatures and presigned URLs are computed offline.
const KEY = 'APIfakekey';
const SECRET = 'fake-secret-fake-secret-fake-secret-123';
const env = loadEnv({
  DATABASE_URL: 'postgresql://x',
  SESSION_SECRET: 's'.repeat(40),
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: KEY,
  LIVEKIT_API_SECRET: SECRET,
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'r2-access',
  R2_SECRET_ACCESS_KEY: 'r2-secret',
  R2_BUCKET_NAME: 'hirebyte-recordings',
  R2_SIGNED_URL_TTL_SECONDS: '300',
});

describe('LiveKit tokens (PRD §9.1)', () => {
  const media = createLiveKitProvider(env)!;
  const verifier = new TokenVerifier(KEY, SECRET);

  it('gives the phone a camera-only, publish-only grant for one room', async () => {
    const jwt = await media.createToken({ room: 'hb-1', identity: 'candidate-secondary:1', canPublish: true, canSubscribe: false, sources: ['camera'], ttlSeconds: 600 });
    const claims = await verifier.verify(jwt);
    expect(claims.sub).toBe('candidate-secondary:1');
    expect(claims.video).toMatchObject({ room: 'hb-1', roomJoin: true, canPublish: true, canSubscribe: false });
    expect(claims.video?.canPublishSources).toEqual(['camera']);
    expect((claims.exp ?? 0) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
  });

  it('gives recruiters a hidden, subscribe-only grant', async () => {
    const jwt = await media.createToken({ room: 'hb-1', identity: 'recruiter:u1', canPublish: false, canSubscribe: true, hidden: true, ttlSeconds: 600 });
    const claims = await verifier.verify(jwt);
    expect(claims.video).toMatchObject({ canPublish: false, canSubscribe: true, hidden: true });
  });

  it('maps the websocket URL to the HTTPS API host', () => {
    expect(livekitHttpUrl('wss://example.livekit.cloud')).toBe('https://example.livekit.cloud');
  });
});

describe('LiveKit webhook verification (PRD §4.1)', () => {
  const verifier = createLiveKitWebhookVerifier(env)!;
  const body = JSON.stringify({
    event: 'egress_ended',
    id: 'EV_123',
    createdAt: '1760000000',
    egressInfo: {
      egressId: 'EG_1',
      roomName: 'hb-1',
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'recordings/i/r/composite.mp4', size: '2048', duration: '5000000000' }],
    },
  });

  async function sign(payload: string) {
    const token = new AccessToken(KEY, SECRET);
    token.sha256 = createHash('sha256').update(payload).digest('base64');
    return token.toJwt();
  }

  it('accepts a correctly signed body and normalizes it', async () => {
    const evt = await verifier.receive(body, await sign(body));
    expect(evt.id).toBe('EV_123');
    expect(evt.egress).toMatchObject({ egressId: 'EG_1', state: 'COMPLETE', file: { sizeBytes: 2048, durationSeconds: 5 } });
  });

  it('rejects a tampered body, a missing header and a foreign key', async () => {
    const signature = await sign(body);
    await expect(verifier.receive(body.replace('EG_1', 'EG_2'), signature)).rejects.toThrow();
    await expect(verifier.receive(body, undefined)).rejects.toThrow();
    const foreign = new AccessToken('OTHERKEY', 'other-secret-other-secret-other-secret');
    foreign.sha256 = createHash('sha256').update(body).digest('base64');
    await expect(verifier.receive(body, await foreign.toJwt())).rejects.toThrow();
  });
});

describe('R2 storage (PRD §9.3)', () => {
  it('uses opaque object keys without personal data', () => {
    expect(recordingObjectKey('int-1', 'rec-2')).toBe('recordings/int-1/rec-2/composite.mp4');
  });

  it('issues short-lived signed URLs for the private bucket', async () => {
    const storage = createObjectStorage(env)!;
    const url = new URL(await storage.signedGetUrl('recordings/a/b/composite.mp4', 300));
    expect(url.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/hirebyte-recordings/recordings/a/b/composite.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.toString()).not.toContain('r2-secret');
  });
});

describe('Supabase Storage (S3 protocol)', () => {
  it('signs private-bucket URLs against the Supabase S3 endpoint', async () => {
    const supabase = loadEnv({
      DATABASE_URL: 'postgresql://x',
      SESSION_SECRET: 's'.repeat(40),
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_PROJECT_REF: 'projref',
      STORAGE_REGION: 'ap-south-1',
      STORAGE_ACCESS_KEY_ID: 'sb-access',
      STORAGE_SECRET_ACCESS_KEY: 'sb-secret',
      STORAGE_BUCKET: 'recordings',
      STORAGE_SIGNED_URL_TTL_SECONDS: '120',
    });
    const url = new URL(await createObjectStorage(supabase)!.signedGetUrl('recordings/i/r/composite.mp4', supabase.storage.signedUrlTtlSeconds));
    expect(url.host).toBe('projref.storage.supabase.co');
    expect(url.pathname).toBe('/storage/v1/s3/recordings/recordings/i/r/composite.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^sb-access\/\d{8}\/ap-south-1\/s3\/aws4_request$/);
    expect(url.toString()).not.toContain('sb-secret');
  });
});
