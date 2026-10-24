import type * as Api from '@contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../context.js';
import type { InterviewStatus, Prisma } from '../../generated/prisma/client.js';
import { accessCode, invitationCode } from '../../lib/crypto.js';
import { AppError, Errors } from '../../lib/errors.js';
import { publishStatus } from '../../realtime/eventHub.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import { isUniqueViolation, type DbOrTx } from '../../repositories/prisma.js';
import {
  interviewConfigSchema,
  type createInterviewSchema,
  type InterviewConfig,
  type listInterviewsQuerySchema,
  type updateInterviewSchema,
} from '../../schemas/interview.schema.js';
import type { AuthUser } from '../auth/auth.service.js';
import type { RecordingService } from '../recordings/recording.service.js';
import { detailInclude, parseConfig, summaryInclude, toDetail, toSummary } from './dto.js';
import {
  CANCELLABLE_STATUSES,
  canTransition,
  FINISHED_STATUSES,
  LIVE_STATUSES,
  PENDING_REVIEW_STATUSES,
  transitionInterview,
} from './stateMachine.js';

/** Recruiters see only their own interviews; admins see all (PRD §2.2 ownership policy). */
export function ownershipScope(user: AuthUser): Prisma.InterviewWhereInput {
  return user.role === 'ADMIN' ? {} : { recruiterId: user.id };
}

/** Returns 404 (not 403) for interviews the user may not see, so existence is not leaked. */
export async function findInterviewForUser(db: DbOrTx, user: AuthUser, id: string) {
  const interview = await db.interview.findFirst({ where: { id, ...ownershipScope(user) } });
  if (!interview) throw Errors.notFound('Interview');
  return interview;
}

export function createInterviewService(deps: AppDeps, recordings: RecordingService) {
  const { db, env, crypto, now, events } = deps;

  function assertCameraPolicy(config: InterviewConfig) {
    if (config.secondaryCamera === 'REQUIRED' && !env.livekitConfigured) {
      throw Errors.validation('A phone camera cannot be required because live video is not configured on this server.', {
        secondaryCamera: 'Live video (LiveKit) is not configured.',
      });
    }
  }

  async function detail(user: AuthUser, id: string): Promise<Api.InterviewDetail> {
    const interview = await db.interview.findFirst({ where: { id, ...ownershipScope(user) }, include: detailInclude });
    if (!interview) throw Errors.notFound('Interview');
    return toDetail(interview, crypto, env);
  }

  return {
    detail,

    async create(user: AuthUser, input: z.infer<typeof createInterviewSchema>): Promise<Api.InterviewDetail> {
      const config = interviewConfigSchema.parse(input.config);
      assertCameraPolicy(config);
      const created = await db.interview.create({
        data: {
          recruiterId: user.id,
          candidateName: input.candidateName,
          candidateEmail: input.candidateEmail,
          jobTitle: input.jobTitle,
          jobDescription: input.jobDescription,
          requiredSkills: input.requiredSkills,
          config,
        },
      });
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.created', resourceType: 'interview', resourceId: created.id });
      return detail(user, created.id);
    },

    /** Edits a draft; `config` is merged into the saved config. Setup locks once the invitation is issued. */
    async update(user: AuthUser, id: string, input: z.infer<typeof updateInterviewSchema>): Promise<Api.InterviewDetail> {
      const interview = await findInterviewForUser(db, user, id);
      if (interview.status !== 'DRAFT') {
        throw Errors.conflict('Only draft interviews can be edited. Setup is locked once the invitation is issued.');
      }
      const { config: configPatch, ...fields } = input;
      const config = configPatch ? interviewConfigSchema.parse({ ...parseConfig(interview.config), ...configPatch }) : undefined;
      if (config) assertCameraPolicy(config);

      const { count } = await db.interview.updateMany({ where: { id, status: 'DRAFT' }, data: { ...fields, ...(config ? { config } : {}) } });
      if (count === 0) throw Errors.conflict('This interview changed while you were editing it. Reload and try again.');
      const changed = Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key);
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.updated', resourceType: 'interview', resourceId: id, metadata: { fields: changed.join(',') } });
      return detail(user, id);
    },

    /** Deletes a draft. Anything already issued to a candidate is cancelled instead, so its history is kept. */
    async remove(user: AuthUser, id: string): Promise<void> {
      const interview = await findInterviewForUser(db, user, id);
      if (interview.status !== 'DRAFT') {
        throw Errors.conflict('Only drafts can be deleted. Cancel this interview instead so its history is kept.');
      }
      const { count } = await db.interview.deleteMany({ where: { id, status: 'DRAFT' } });
      if (count === 0) throw Errors.conflict('This interview changed. Reload and try again.');
      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.deleted', resourceType: 'interview', resourceId: id });
    },

    /**
     * Cancels an unfinished interview: ends candidate access, invalidates phone pairing and stops any
     * recording. Answers already saved are kept. Cancelling twice is harmless.
     */
    async cancel(user: AuthUser, id: string): Promise<Api.InterviewDetail> {
      const interview = await findInterviewForUser(db, user, id);
      if (interview.status === 'CANCELLED') return detail(user, id);
      if (!canTransition(interview.status, 'CANCELLED')) {
        throw Errors.conflict('A finished interview cannot be cancelled. Its answers and report are kept for review.');
      }

      const cancelled = await db.$transaction(async (tx) => {
        const moved = await transitionInterview(tx, id, CANCELLABLE_STATUSES, 'CANCELLED', interview.startedAt ? { endedAt: now() } : {});
        if (!moved) return false;
        await tx.candidateSession.updateMany({ where: { interviewId: id, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
        await tx.mediaSession.updateMany({ where: { interviewId: id }, data: { pairingTokenHash: null, pairingTokenEncrypted: null, pairingExpiresAt: null, phoneDeviceTokenHash: null } });
        return true;
      });
      if (!cancelled) throw Errors.conflict('This interview changed while you were cancelling it. Reload and try again.');
      publishStatus(events, id, 'CANCELLED', now());

      await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.cancelled', resourceType: 'interview', resourceId: id, metadata: { fromStatus: interview.status } });
      await recordings.finalizeForInterview(id);
      return detail(user, id);
    },

    async list(user: AuthUser, query: z.infer<typeof listInterviewsQuerySchema>): Promise<Api.ListInterviewsResponse> {
      const scope = ownershipScope(user);
      const statusFilter: InterviewStatus[] | undefined =
        query.status === 'IN_PROGRESS' ? ['IN_PROGRESS', 'PROCESSING_ANSWER'] : query.status ? [query.status] : undefined;
      const where: Prisma.InterviewWhereInput = {
        ...scope,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
        ...(query.search
          ? {
              OR: [
                { jobTitle: { contains: query.search, mode: 'insensitive' } },
                { candidateName: { contains: query.search, mode: 'insensitive' } },
                { candidateEmail: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, groups] = await Promise.all([
        db.interview.findMany({ where, include: summaryInclude, orderBy: { createdAt: 'desc' }, take: 200 }),
        db.interview.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      ]);
      const count = (statuses: readonly InterviewStatus[]) =>
        groups.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
      return {
        items: items.map(toSummary),
        stats: {
          total: groups.reduce((n, g) => n + g._count._all, 0),
          inProgress: count(LIVE_STATUSES),
          completed: count(FINISHED_STATUSES),
          pendingReview: count(PENDING_REVIEW_STATUSES),
        },
      };
    },

    /** Marks a draft READY and issues the invitation + access code (PRD §11 POST /interviews/:id/ready). */
    async markReady(user: AuthUser, id: string): Promise<Api.MarkReadyResponse> {
      const interview = await findInterviewForUser(db, user, id);
      if (interview.status !== 'DRAFT' && interview.status !== 'READY') {
        throw Errors.conflict('This interview has already started, so its setup is locked.');
      }
      const questionCount = await db.question.count({ where: { interviewId: id } });
      if (questionCount === 0) throw Errors.validation('Save at least one approved question first.');

      if (interview.status === 'DRAFT') {
        for (let attempt = 0; ; attempt += 1) {
          const code = invitationCode();
          const plainAccessCode = accessCode();
          try {
            await db.$transaction(async (tx) => {
              if (!(await transitionInterview(tx, id, 'DRAFT', 'READY'))) {
                throw Errors.conflict('This interview changed while you were saving. Reload and try again.');
              }
              await tx.invitation.upsert({
                where: { interviewId: id },
                update: {},
                create: {
                  interviewId: id,
                  code,
                  accessCodeHash: crypto.hash(plainAccessCode),
                  accessCodeEncrypted: crypto.encrypt(plainAccessCode),
                  expiresAt: new Date(now().getTime() + env.INVITATION_TTL_DAYS * 86_400_000),
                },
              });
            });
            break;
          } catch (err) {
            // Retry only on an invitation-code collision.
            if (!isUniqueViolation(err) || attempt >= 4) throw err;
          }
        }
        publishStatus(events, id, 'READY', now());
        await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'interview.ready', resourceType: 'interview', resourceId: id });
      }

      const result = await detail(user, id);
      if (!result.invitation) throw new AppError(500, 'INTERNAL_ERROR', 'The invitation could not be created.');
      return { interview: result, invitation: result.invitation };
    },
  };
}

export type InterviewService = ReturnType<typeof createInterviewService>;
