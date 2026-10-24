// Central product identity. Pages read branding from here instead of hard-coding it (PRD §7.3).
export const appConfig = {
  productName: 'HireByte',
  tagline: 'AI-assisted interview screening',
  companyName: 'HireByte',
  supportEmail: 'support@hirebyte.test',
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api',
  /** Recruiter live view poll interval when the realtime socket is not connected. */
  monitorPollMs: 5000,
  /** Candidate pairing status poll interval when the realtime socket is not connected. */
  pairingPollMs: 4000,
  /** Slow safety poll while the socket is connected (covers changes that have no event, e.g. laptop camera). */
  realtimeSafetyPollMs: 30_000,
} as const;

export type AppConfig = typeof appConfig;
