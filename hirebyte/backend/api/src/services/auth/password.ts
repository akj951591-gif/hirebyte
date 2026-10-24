import { hash, verify } from '@node-rs/argon2';

// Argon2id (the library default) with OWASP-recommended minimums: 19 MiB memory, 2 iterations.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Spend the same work for unknown emails so response time does not reveal which accounts exist. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('hirebyte-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
