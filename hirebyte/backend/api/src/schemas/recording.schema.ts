import { z } from 'zod';

/**
 * POST /interviews/:id/media-token. The caller is a recruiter (cookie), the candidate's laptop
 * (candidate cookie) or the paired phone (one-time pairing token, no cookie).
 */
export const mediaTokenSchema = z.object({
  device: z.enum(['primary', 'secondary', 'viewer']).default('primary'),
  pairingToken: z.string().min(20).max(200).optional(),
  /** Returned when the phone pairs; lets it rejoin after a reload. */
  deviceToken: z.string().min(20).max(200).optional(),
});
