import path from 'node:path';
import type * as Api from '@contracts';
import type { AppDeps } from '../../context.js';
import { AppError, Errors } from '../../lib/errors.js';
import { DocumentRejectedError, DocumentServiceUnavailableError } from '../../providers/documents/documentService.provider.js';
import { recordAudit } from '../../repositories/auditEvent.repository.js';
import type { AuthUser } from '../auth/auth.service.js';
import { toResume } from './dto.js';
import { findInterviewForUser } from './interview.service.js';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Keeps only the base name, without control characters, for display. */
function safeFilename(name: string): string {
  const base = path.posix.basename(name.replace(/\\/g, '/'));
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'resume';
}

/**
 * Resume upload (PRD §7.2): the file goes to the document service for text extraction and only the
 * text is kept. The original file is not stored (PRD §13: minimise retention).
 */
export function createResumeService({ db, documents }: AppDeps) {
  return {
    async upload(user: AuthUser, interviewId: string, file: UploadedFile | undefined): Promise<Api.UploadResumeResponse> {
      const interview = await findInterviewForUser(db, user, interviewId);
      if (interview.status !== 'DRAFT') throw Errors.conflict('The resume can only be changed while the interview is a draft.');
      if (!file) throw Errors.validation('Choose a resume file to upload.', { resume: 'Choose a PDF or DOCX file.' });

      const filename = safeFilename(file.originalname);
      const mimeType = TYPES[path.extname(filename).toLowerCase()];
      if (!mimeType) throw new AppError(415, 'RESUME_UNSUPPORTED', 'Upload a PDF or DOCX file.');
      if (!documents) {
        throw Errors.notConfigured('SERVICE_UNAVAILABLE', 'Resume processing (document service) is not set up on this server yet. You can still add questions manually.');
      }

      const pending = { filename, mimeType, sizeBytes: file.size, storageKey: null, extractedText: null, failureCode: null, extractionStatus: 'PROCESSING' as const };
      await db.resume.upsert({ where: { interviewId }, create: { interviewId, ...pending }, update: pending });

      const fail = (failureCode: string) => db.resume.update({ where: { interviewId }, data: { extractionStatus: 'FAILED', failureCode } });
      try {
        const result = await documents.extract({ buffer: file.buffer, filename, mimeType });
        const saved = await db.resume.update({ where: { interviewId }, data: { extractionStatus: 'COMPLETED', extractedText: result.text } });
        await recordAudit(db, {
          actorId: user.id,
          actorRole: user.role,
          action: 'resume.extracted',
          resourceType: 'interview',
          resourceId: interviewId,
          metadata: { pages: result.pageCount, truncated: result.truncated },
        });
        return { resume: toResume(saved) };
      } catch (err) {
        if (err instanceof DocumentRejectedError) {
          await fail(err.unsupportedType ? 'RESUME_UNSUPPORTED' : err.code);
          await recordAudit(db, { actorId: user.id, actorRole: user.role, action: 'resume.rejected', resourceType: 'interview', resourceId: interviewId, metadata: { code: err.code } });
          if (err.unsupportedType) throw new AppError(415, 'RESUME_UNSUPPORTED', 'Upload a PDF or DOCX file.');
          throw new AppError(422, 'RESUME_UNREADABLE', err.message, { failureCode: err.code });
        }
        if (err instanceof DocumentServiceUnavailableError) {
          await fail('SERVICE_UNAVAILABLE');
          throw Errors.notConfigured('SERVICE_UNAVAILABLE', 'Resume processing is temporarily unavailable. Try again shortly, or add questions manually.');
        }
        throw err;
      }
    },
  };
}

export type ResumeService = ReturnType<typeof createResumeService>;
