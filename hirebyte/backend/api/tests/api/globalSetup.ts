import { execSync } from 'node:child_process';
import 'dotenv/config';

/** Applies migrations to the test database once per run. The test DB is wiped between tests. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see backend/api/.env.example).');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL: tests delete all data.');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
