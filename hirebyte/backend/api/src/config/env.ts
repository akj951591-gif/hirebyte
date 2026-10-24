import { z } from 'zod';

/** Empty strings in .env mean "not set". */
const optional = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().optional());
const bool = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v), z.boolean());
const int = (fallback: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().positive().default(fallback));

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

    // Cloudflare R2 (server-only)
    R2_ACCOUNT_ID: optional,
    R2_ACCESS_KEY_ID: optional,
    R2_SECRET_ACCESS_KEY: optional,
    R2_BUCKET_NAME: optional,
    R2_ENDPOINT: optional,
    R2_REGION: z.string().default('auto'),
    R2_SIGNED_URL_TTL_SECONDS: int(300),

    // Recording policy
    RECORDING_ENABLED: bool.default(false),
    RECORDING_MODE: z.enum(['composite']).default('composite'),
    RECORDING_RETENTION_DAYS: z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().positive().optional()),

    // xAI / Grok (server only): question generation and evaluation
    XAI_API_KEY: optional,
    /** Required with XAI_API_KEY; check docs.x.ai for current model names. */
    XAI_MODEL: optional,
    XAI_BASE_URL: z.string().default('https://api.x.ai/v1'),
    LLM_TIMEOUT_MS: int(60_000),

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
    const r2Endpoint = e.R2_ENDPOINT ?? (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
    const livekitConfigured = Boolean(e.LIVEKIT_URL && e.LIVEKIT_API_KEY && e.LIVEKIT_API_SECRET);
    const r2Configured = Boolean(r2Endpoint && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET_NAME);
    const llmConfigured = Boolean(e.XAI_API_KEY && e.XAI_MODEL);
    const documentsConfigured = Boolean(e.DOCUMENT_SERVICE_URL);
    return {
      ...e,
      R2_ENDPOINT: r2Endpoint,
      livekitConfigured,
      r2Configured,
      llmConfigured,
      documentsConfigured,
      isProduction: e.NODE_ENV === 'production',
    };
  })
  .superRefine((e, ctx) => {
    // PRD §12: validate required settings at startup instead of failing at the first recording.
    if (e.RECORDING_ENABLED && !(e.livekitConfigured && e.r2Configured)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RECORDING_ENABLED'],
        message: 'RECORDING_ENABLED=true needs LIVEKIT_URL/API_KEY/API_SECRET and R2 access key, secret, bucket and endpoint (or account id).',
      });
    }
    if (e.XAI_API_KEY && !e.XAI_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['XAI_MODEL'], message: 'XAI_MODEL is required when XAI_API_KEY is set (e.g. a current Grok model name from docs.x.ai).' });
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
    storage: env.r2Configured ? 'configured' : 'not_configured',
    recording: env.RECORDING_ENABLED ? 'enabled' : 'disabled',
    ai: env.llmConfigured ? 'configured' : 'not_configured',
    documents: env.documentsConfigured ? 'configured' : 'not_configured',
  } as const;
}
