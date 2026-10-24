import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('API contract', () => {
  it('frontend copy matches backend/contracts/api-types.ts (run `npm run sync:contract` in frontend)', () => {
    const canonical = read('../../../contracts/api-types.ts');
    const frontend = read('../../../../frontend/src/api/generated/contract.ts');
    expect(frontend).toBe(canonical);
  });
});
