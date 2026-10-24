import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from 'livekit-server-sdk';
import type { Env } from '../../config/env.js';
import { livekitHttpUrl, toEgressState, type EgressState } from './livekit.provider.js';

export interface EgressSnapshot {
  egressId: string;
  state: EgressState;
  error: string | null;
  file: { filename: string; sizeBytes: number | null; durationSeconds: number | null } | null;
}

/** LiveKit Egress: one composite MP4 per interview, uploaded by LiveKit straight to the private R2 bucket. */
export interface EgressProvider {
  startRoomComposite(roomName: string, objectKey: string): Promise<EgressSnapshot>;
  stop(egressId: string): Promise<EgressSnapshot>;
  /** Used to reconcile status when webhooks cannot reach this server (e.g. local development). */
  get(egressId: string): Promise<EgressSnapshot | null>;
}

function snapshot(info: {
  egressId: string;
  status: number;
  error: string;
  fileResults?: Array<{ filename: string; size: bigint; duration: bigint }>;
}): EgressSnapshot {
  const file = info.fileResults?.[0];
  return {
    egressId: info.egressId,
    state: toEgressState(info.status),
    error: info.error || null,
    file: file
      ? { filename: file.filename, sizeBytes: file.size ? Number(file.size) : null, durationSeconds: file.duration ? Number(file.duration) / 1e9 : null }
      : null,
  };
}

export function createEgressProvider(env: Env): EgressProvider | null {
  if (!env.livekitConfigured || !env.r2Configured) return null;
  const client = new EgressClient(livekitHttpUrl(env.LIVEKIT_URL!), env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);

  return {
    async startRoomComposite(roomName, objectKey) {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: objectKey,
        output: {
          case: 's3',
          // R2 is S3-compatible. Use an R2 token scoped to this bucket: LiveKit uses it to upload.
          value: new S3Upload({
            accessKey: env.R2_ACCESS_KEY_ID!,
            secret: env.R2_SECRET_ACCESS_KEY!,
            region: env.R2_REGION,
            endpoint: env.R2_ENDPOINT!,
            bucket: env.R2_BUCKET_NAME!,
            forcePathStyle: true,
          }),
        },
      });
      const info = await client.startRoomCompositeEgress(roomName, { file: output }, { layout: 'grid' });
      return snapshot(info);
    },
    async stop(egressId) {
      return snapshot(await client.stopEgress(egressId));
    },
    async get(egressId) {
      const [info] = await client.listEgress({ egressId });
      return info ? snapshot(info) : null;
    },
  };
}
