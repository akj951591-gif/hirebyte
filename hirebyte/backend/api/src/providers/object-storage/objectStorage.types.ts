/** Storage adapter boundary (PRD §12): R2 today, swappable without changing services or the API. */
export interface ObjectHead {
  exists: boolean;
  sizeBytes: number | null;
  contentType: string | null;
}

export interface ObjectStorage {
  head(key: string): Promise<ObjectHead>;
  delete(key: string): Promise<void>;
  /** Short-lived signed GET URL. Callers must not log or persist it. */
  signedGetUrl(key: string, ttlSeconds: number, opts?: { contentType?: string }): Promise<string>;
}
