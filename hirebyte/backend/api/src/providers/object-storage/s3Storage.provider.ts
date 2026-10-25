import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.js';
import type { ObjectStorage } from './objectStorage.types.js';

/** Opaque key that never contains candidate names or emails (PRD §9.3). */
export function recordingObjectKey(interviewId: string, recordingId: string): string {
  return `recordings/${interviewId}/${recordingId}/composite.mp4`;
}

/**
 * Private bucket on any S3-compatible service: Supabase Storage (S3 protocol), Cloudflare R2 or AWS
 * S3, chosen by the STORAGE_* settings. Path-style addressing works for all three.
 */
export function createObjectStorage(env: Env): ObjectStorage | null {
  if (!env.storageConfigured) return null;
  const { endpoint, region, accessKeyId, secretAccessKey, bucket } = env.storage;
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });
  const Bucket = bucket!;

  return {
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { exists: true, sizeBytes: res.ContentLength ?? null, contentType: res.ContentType ?? null };
      } catch (err) {
        if (err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === 'NotFound')) {
          return { exists: false, sizeBytes: null, contentType: null };
        }
        throw err;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async signedGetUrl(key, ttlSeconds, opts) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key: key, ResponseContentType: opts?.contentType ?? 'video/mp4' }),
        { expiresIn: ttlSeconds },
      );
    },
  };
}
