import { z } from 'zod';

/** Empty strings in .env mean "not set". */
const optional = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().optional());
const bool = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v), z.boolean());
const int = (fallback: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().positive().default(fallback));
const optionalInt = z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().positive().optional());
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const LLM_BASE_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
} as const;

export interface LlmSettings {
  provider: keyof typeof LLM_BASE_URLS;
  apiKey: string | undefined;
  model: string | undefined;
  baseUrl: string;
}

/** Resolved recording storage: any S3-compatible service (Supabase Storage, Cloudflare R2, AWS S3...). */
export interface StorageSettings {
  provider: 'supabase' | 'r2' | 's3';
  endpoint: string | undefined;
  region: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucket: string | undefined;
  signedUrlTtlSeconds: number;
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    APP_BASE_URL: z.string().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Shown to candidates as the hiring company. */
    COMPANY_NAME: z.string().default('HireByte'),

    RECRUITER_SESSION_TTL_HOURS: int(8),
    CANDIDATE_SESSION_TTL_MINUTES: int(180),
    INVITATION_TTL_DAYS: int(7),
    /** Extra time after the interview duration in which answers are still accepted. */
    INTERVIEW_GRACE_MINUTES: int(2),
    MEDIA_TOKEN_TTL_SECONDS: int(600),
    PAIRING_TOKEN_TTL_MINUTES: int(10),

    // LiveKit (server-only)
    LIVEKIT_URL: optional,
    LIVEKIT_API_KEY: optional,
    LIVEKIT_API_SECRET: optional,

    // Recording storage (server-only, private bucket): any S3-compatible provider
    STORAGE_PROVIDER: z.preprocess(blankToUndefined, z.enum(['supabase', 'r2', 's3']).optional()),
    /** Supabase only: the project ref; the S3 endpoint is derived from it. */
    SUPABASE_PROJECT_REF: optional,
    STORAGE_ENDPOINT: optional,
    STORAGE_REGION: optional,
    STORAGE_ACCESS_KEY_ID: optional,
    STORAGE_SECRET_ACCESS_KEY: optional,
    STORAGE_BUCKET: optional,
    STORAGE_SIGNED_URL_TTL_SECONDS: optionalInt,

    // Older Cloudflare R2 names, still accepted when the STORAGE_* value is not set
    R2_ACCOUNT_ID: optional,
    R2_ACCESS_KEY_ID: optional,
    R2_SECRET_ACCESS_KEY: optional,
    R2_BUCKET_NAME: optional,
    R2_ENDPOINT: optional,
    R2_REGION: optional,
    R2_SIGNED_URL_TTL_SECONDS: optionalInt,

    // Recording policy
    RECORDING_ENABLED: bool.default(false),
    RECORDING_MODE: z.enum(['composite']).default('composite'),
    RECORDING_RETENTION_DAYS: z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),

    // AI (server only): questions, evaluation and the interviewer conversation.
    // Any OpenAI-compatible chat API: Google Gemini (default), xAI Grok or Groq.
    LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(['gemini', 'xai', 'groq']).optional()),
    LLM_API_KEY: optional,
    /** Required with an API key; check the provider's docs for current model names. */
    LLM_MODEL: optional,
    /** Optional: defaults to the provider's OpenAI-compatible endpoint. */
    LLM_BASE_URL: optional,
    // Older xAI names, still accepted
    XAI_API_KEY: optional,
    XAI_MODEL: optional,
    XAI_BASE_URL: optional,
    LLM_TIMEOUT_MS: int(60_000),
    /** The interviewer's reply must be quick; slower replies are skipped so the interview moves on. */
    CONVERSATION_TIMEOUT_MS: int(8_000),

    // Python document service (resume text extraction)
    DOCUMENT_SERVICE_URL: optional,
    /** Shared secret sent as X-Service-Token; set the same value in the document service. */
    DOCUMENT_SERVICE_TOKEN: optional,
    DOCUMENT_TIMEOUT_MS: int(30_000),

    // Seed script only
    SEED_RECRUITER_EMAIL: optional,
    SEED_RECRUITER_PASSWORD: optional,
    SEED_RECRUITER_NAME: optional,
  })
  .transform((e) => {
    const usesR2Names = Boolean(e.R2_ACCOUNT_ID || e.R2_ENDPOINT || e.R2_BUCKET_NAME || e.R2_ACCESS_KEY_ID);
    const provider = e.STORAGE_PROVIDER ?? (usesR2Names ? 'r2' : 's3');
    const storage: StorageSettings = {
      provider,
      endpoint:
        e.STORAGE_ENDPOINT ??
        (provider === 'supabase' && e.SUPABASE_PROJECT_REF ? `https://${e.SUPABASE_PROJECT_REF}.storage.supabase.co/storage/v1/s3` : undefined) ??
        e.R2_ENDPOINT ??
        (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined),
      // R2 always uses "auto"; Supabase and S3 need the real region.
      region: e.STORAGE_REGION ?? e.R2_REGION ?? (provider === 'r2' ? 'auto' : undefined),
      accessKeyId: e.STORAGE_ACCESS_KEY_ID ?? e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY ?? e.R2_SECRET_ACCESS_KEY,
      bucket: e.STORAGE_BUCKET ?? e.R2_BUCKET_NAME,
      signedUrlTtlSeconds: e.STORAGE_SIGNED_URL_TTL_SECONDS ?? e.R2_SIGNED_URL_TTL_SECONDS ?? 300,
    };
    const livekitConfigured = Boolean(e.LIVEKIT_URL && e.LIVEKIT_API_KEY && e.LIVEKIT_API_SECRET);
    const storageConfigured = Boolean(storage.endpoint && storage.region && storage.accessKeyId && storage.secretAccessKey && storage.bucket);
    const llmProvider = e.LLM_PROVIDER ?? (e.XAI_API_KEY ? 'xai' : 'gemini');
    const useXaiNames = llmProvider === 'xai';
    const llm: LlmSettings = {
      provider: llmProvider,
      apiKey: e.LLM_API_KEY ?? (useXaiNames ? e.XAI_API_KEY : undefined),
      model: e.LLM_MODEL ?? (useXaiNames ? e.XAI_MODEL : undefined),
      baseUrl: (e.LLM_BASE_URL ?? (useXaiNames ? e.XAI_BASE_URL : undefined) ?? LLM_BASE_URLS[llmProvider]).replace(/\/$/, ''),
    };
    const llmConfigured = Boolean(llm.apiKey && llm.model);
    const documentsConfigured = Boolean(e.DOCUMENT_SERVICE_URL);
    return {
      ...e,
      storage,
      llm,
      livekitConfigured,
      storageConfigured,
      llmConfigured,
      documentsConfigured,
      isProduction: e.NODE_ENV === 'production',
    };
  })
  .superRefine((e, ctx) => {
    // PRD §12: validate required settings at startup instead of failing at the first recording.
    if (e.RECORDING_ENABLED && !(e.livekitConfigured && e.storageConfigured)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RECORDING_ENABLED'],
        message: 'RECORDING_ENABLED=true needs LIVEKIT_URL/API_KEY/API_SECRET and the STORAGE_* settings (endpoint or project ref, region, access key, secret, bucket).',
      });
    }
    // Only complain once Supabase is being filled in; all-empty simply means "storage not configured".
    const supabaseStarted = Boolean(e.SUPABASE_PROJECT_REF || e.STORAGE_REGION || e.storage.accessKeyId || e.storage.secretAccessKey);
    if (e.STORAGE_PROVIDER === 'supabase' && supabaseStarted) {
      if (!e.storage.endpoint) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_PROJECT_REF'], message: 'Set SUPABASE_PROJECT_REF (or STORAGE_ENDPOINT) for Supabase Storage.' });
      }
      if (!e.storage.region) {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_REGION'], message: 'STORAGE_REGION is required for Supabase (Storage > S3 connection shows it, e.g. ap-south-1).' });
      }
    }
    if (e.llm.apiKey && !e.llm.model) {
      ctx.addIssue({ code: 'custom', path: ['LLM_MODEL'], message: 'LLM_MODEL (or XAI_MODEL) is required when an AI API key is set, e.g. a current Gemini model name.' });
    }
    if (e.LIVEKIT_URL && !/^wss?:\/\//.test(e.LIVEKIT_URL)) {
      ctx.addIssue({ code: 'custom', path: ['LIVEKIT_URL'], message: 'LIVEKIT_URL must start with wss:// (or ws:// for a local server).' });
    }
  });

export type Env = z.infer<typeof schema>;

export class ConfigError extends Error {}

/** Parses and validates configuration. Messages name the variable but never echo its value. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Safe summary for logs and the health endpoint. */
export function describeEnv(env: Env) {
  return {
    nodeEnv: env.NODE_ENV,
    media: env.livekitConfigured ? 'configured' : 'not_configured',
    storage: env.storageConfigured ? 'configured' : 'not_configured',
    recording: env.RECORDING_ENABLED ? 'enabled' : 'disabled',
    ai: env.llmConfigured ? 'configured' : 'not_configured',
    documents: env.documentsConfigured ? 'configured' : 'not_configured',
  } as const;
}
