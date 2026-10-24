// Public, build-time UI flags only. Server-side policy (e.g. RECORDING_ENABLED) stays authoritative;
// the UI renders whatever the API reports for a given interview.
export const featureFlags = {
  /**
   * FIXTURE transport for isolated UI development (PRD §6.1.6). Never enable for integration
   * acceptance — every screen shows a "fixture data" banner while this is on.
   */
  useFixtures: import.meta.env.VITE_USE_FIXTURES === 'true',
  /** Password reset is not implemented securely yet, so the UI labels it unavailable (PRD §2.2). */
  passwordResetAvailable: false,
  /**
   * Server-generated PDF (GET /api/interviews/:id/export.pdf). Off until the backend implements it
   * (it answers 501 today); print-to-PDF is always offered.
   */
  serverPdfExport: import.meta.env.VITE_SERVER_PDF_EXPORT === 'true' && import.meta.env.VITE_USE_FIXTURES !== 'true',
} as const;
