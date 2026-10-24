import type { DbOrTx } from './prisma.js';

export function findUserByEmail(db: DbOrTx, email: string) {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

export function findSessionByTokenHash(db: DbOrTx, tokenHash: string) {
  return db.userSession.findUnique({ where: { tokenHash }, include: { user: true } });
}
