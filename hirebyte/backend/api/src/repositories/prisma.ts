import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the client itself or an interactive transaction. */
export type DbOrTx = Db | Tx;

export function createPrisma(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export { Prisma };
