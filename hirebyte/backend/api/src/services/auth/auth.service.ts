import type { SafeUser } from '@contracts';
import type { AppDeps } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { isUniqueViolation } from '../../repositories/prisma.js';
import { findSessionByTokenHash, findUserByEmail } from '../../repositories/user.repository.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';

export const RECRUITER_COOKIE = 'hb_session';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** Refresh lastSeenAt at most this often, to avoid a write on every request. */
const SEEN_REFRESH_MS = 5 * 60_000;

export type AuthUser = SafeUser;

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

export function createAuthService({ db, crypto, env, now }: AppDeps) {
  return {
    /** Recruiter email + password login (PRD §2.2). Returns the raw session token for the cookie. */
    async login(email: string, password: string): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
      const user = await findUserByEmail(db, email);
      if (!user || user.status !== 'ACTIVE') {
        await burnPasswordCheck(password);
        await recordAudit(db, { actorRole: 'ANONYMOUS', action: 'auth.login_failed', resourceType: 'user', metadata: { reason: 'unknown_or_disabled' } });
        throw invalidCredentials();
      }
      if (user.lockedUntil && user.lockedUntil > now()) {
        throw new AppError(423, 'ACCOUNT_LOCKED', 'This account is temporarily locked after too many failed sign-ins.');
      }

      if (!(await verifyPassword(user.passwordHash, password))) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await db.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(now().getTime() + LOCK_MINUTES * 60_000) }
            : { failedLoginCount: failed },
        });
        await recordAudit(db, { actorId: user.id, actorRole: user.role, action: lock ? 'auth.account_locked' : 'auth.login_failed', resourceType: 'user', resourceId: user.id });
        throw invalidCredentials();
      }

      const token = crypto.randomToken();
      const expiresAt = new Date(now().getTime() + env.RECRUITER_SESSION_TTL_HOURS * 3_600_000);
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } }),
        db.userSession.create({ data: { userId: user.id, tokenHash: crypto.hash(token), expiresAt } }),
      ]);
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'auth.login', resourceType: 'user', resourceId: user.id });
      return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token, expiresAt };
    },

    /**
     * Self-service sign-up: creates a recruiter account and signs it in. Saying "email taken" cannot
     * be avoided here, so the route is rate-limited; RECRUITER_SIGNUP_ENABLED=false turns it off.
     */
    async register(name: string, email: string, password: string): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
      if (!env.RECRUITER_SIGNUP_ENABLED) {
        throw new AppError(403, 'SIGNUP_DISABLED', 'Creating accounts is turned off. Ask your administrator for an account.');
      }
      const taken = () => new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Sign in instead.');
      if (await findUserByEmail(db, email)) {
        await recordAudit(db, { actorRole: 'ANONYMOUS', action: 'auth.register_failed', resourceType: 'user', metadata: { reason: 'email_taken' } });
        throw taken();
      }

      const passwordHash = await hashPassword(password);
      let created;
      try {
        created = await db.user.create({ data: { email, name, passwordHash, role: 'RECRUITER' } });
      } catch (err) {
        // Another request registered the same email between the check and the insert.
        if (isUniqueViolation(err)) throw taken();
        throw err;
      }

      const token = crypto.randomToken();
      const expiresAt = new Date(now().getTime() + env.RECRUITER_SESSION_TTL_HOURS * 3_600_000);
      await db.userSession.create({ data: { userId: created.id, tokenHash: crypto.hash(token), expiresAt } });
      await recordAudit(db, { actorId: created.id, actorRole: created.role, action: 'auth.register', resourceType: 'user', resourceId: created.id });
      return { user: { id: created.id, email: created.email, name: created.name, role: created.role }, token, expiresAt };
    },

    /** Resolves a session cookie to a user, or null if missing/expired/revoked. */
    async authenticate(token: string | undefined): Promise<AuthUser | null> {
      if (!token) return null;
      const session = await findSessionByTokenHash(db, crypto.hash(token));
      if (!session || session.revokedAt || session.expiresAt <= now() || session.user.status !== 'ACTIVE') return null;
      if (now().getTime() - session.lastSeenAt.getTime() > SEEN_REFRESH_MS) {
        await db.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now() } });
      }
      const { user } = session;
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },

    async logout(token: string | undefined): Promise<void> {
      if (!token) return;
      const { count } = await db.userSession.updateMany({
        where: { tokenHash: crypto.hash(token), revokedAt: null },
        data: { revokedAt: now() },
      });
      if (count) await recordAudit(db, { actorRole: 'RECRUITER', action: 'auth.logout', resourceType: 'user_session' });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
