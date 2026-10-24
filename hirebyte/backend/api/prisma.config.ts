// Prisma 7 configuration. The schema and migrations live in backend/prisma (shared with the database
// steward, PRD §5); the generated client is written into src/generated/prisma (git-ignored).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: '../prisma/schema.prisma',
  migrations: {
    path: '../prisma/migrations',
    seed: 'tsx src/scripts/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
