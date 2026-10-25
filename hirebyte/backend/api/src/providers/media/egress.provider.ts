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
  if (!env.livekitConfigured || !env.storageConfigured) return null;
  const storage = env.storage;
  const client = new EgressClient(livekitHttpUrl(env.LIVEKIT_URL!), env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);

  return {
    async startRoomComposite(roomName, objectKey) {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: objectKey,
        output: {
          case: 's3',
          // Supabase Storage / R2 / S3 all speak the S3 protocol; LiveKit uploads with these keys.
          value: new S3Upload({
            accessKey: storage.accessKeyId!,
            secret: storage.secretAccessKey!,
            region: storage.region!,
            endpoint: storage.endpoint!,
            bucket: storage.bucket!,
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
