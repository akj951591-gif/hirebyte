import { z } from 'zod';

export const recruiterLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')).pipe(z.string().max(254)),
  password: z.string().min(1, 'Enter your password.').max(512),
});

export const candidateAccessSchema = z.object({
  invitationCode: z.string().trim().toUpperCase().min(1, 'Enter your invitation code.').max(32),
  accessCode: z.string().trim().min(1, 'Enter your access code.').max(32),
});
