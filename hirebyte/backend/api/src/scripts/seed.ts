import 'dotenv/config';
import { loadEnv } from '../config/env.js';
import { createPrisma } from '../repositories/prisma.js';
import { hashPassword } from '../services/auth/password.js';

/**
 * Creates (or updates) one recruiter account from SEED_RECRUITER_* in backend/api/.env.
 * No credentials live in source control (PRD §10).
 */
async function seed() {
  const env = loadEnv();
  const email = env.SEED_RECRUITER_EMAIL?.trim().toLowerCase();
  const password = env.SEED_RECRUITER_PASSWORD;
  if (!email || !password) {
    console.error('Set SEED_RECRUITER_EMAIL and SEED_RECRUITER_PASSWORD in backend/api/.env, then run npm run db:seed again.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('SEED_RECRUITER_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const db = createPrisma(env.DATABASE_URL);
  try {
    const passwordHash = await hashPassword(password);
    const name = env.SEED_RECRUITER_NAME?.trim() || 'Recruiter';
    await db.user.upsert({
      where: { email },
      update: { name, passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
      create: { email, name, passwordHash, role: 'RECRUITER' },
    });
    console.log(`Seeded recruiter account ${email}.`);
  } finally {
    await db.$disconnect();
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
