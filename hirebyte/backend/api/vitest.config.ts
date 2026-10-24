import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *  - unit: pure logic and provider adapters, no database (npm run test:unit)
 *  - api:  HTTP tests against a real PostgreSQL test database (TEST_DATABASE_URL), wiped per test
 */
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/globalSetup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
