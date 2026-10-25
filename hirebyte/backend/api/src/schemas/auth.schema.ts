import { z } from 'zod';

export const recruiterLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')).pipe(z.string().max(254)),
  password: z.string().min(1, 'Enter your password.').max(512),
});

/** Long enough but easy to guess: repeats, runs of digits, the email's own name, and a few favourites. */
export function isObviousPassword(password: string, email: string): boolean {
  const p = password.toLowerCase();
  if (/^(.)\1+$/.test(p)) return true;
  if ('01234567890123456789'.includes(p) || '98765432109876543210'.includes(p)) return true;
  if (['password', 'qwertyuiop', 'iloveyou', 'letmein', 'hirebyte', 'welcome'].some((w) => p.startsWith(w) && p.length <= w.length + 4)) return true;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return local.length >= 4 && p.includes(local);
}

/** Self-service recruiter sign-up. The password rules match the seeded account's (12+ characters). */
export const recruiterRegisterSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(100, 'Keep your name under 100 characters.'),
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')).pipe(z.string().max(254)),
    password: z.string().min(12, 'Use at least 12 characters.').max(128, 'Use at most 128 characters.'),
  })
  .superRefine((value, ctx) => {
    if (value.password.length >= 12 && isObviousPassword(value.password, value.email)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Choose a password that is harder to guess.' });
    }
  });

export const candidateAccessSchema = z.object({
  invitationCode: z.string().trim().toUpperCase().min(1, 'Enter your invitation code.').max(32),
  accessCode: z.string().trim().min(1, 'Enter your access code.').max(32),
});
