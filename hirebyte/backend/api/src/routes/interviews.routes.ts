import { Router } from 'express';
import type { RouteContext } from './index.js';
import multer from 'multer';
import { interviewsController } from '../controllers/interviews.controller.js';
import { MAX_RESUME_BYTES } from '../services/interviews/resume.service.js';

/** Resume uploads stay in memory (max 5 MB, one file) and are never written to disk. */
const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_BYTES, files: 1 } }).single('resume');

export function interviewRoutes({ services, requireRecruiter }: RouteContext): Router {
  const c = interviewsController(services);
  const r = Router();
  r.post('/interviews', requireRecruiter, c.create);
  r.get('/interviews', requireRecruiter, c.list);
  r.get('/interviews/:id', requireRecruiter, c.get);
  r.patch('/interviews/:id', requireRecruiter, c.update);
  r.delete('/interviews/:id', requireRecruiter, c.remove);
  r.post('/interviews/:id/cancel', requireRecruiter, c.cancel);
  // Authenticate before reading the upload, so anonymous requests are never buffered.
  r.post('/interviews/:id/resume', requireRecruiter, resumeUpload, c.uploadResume);
  r.post('/interviews/:id/questions/generate', requireRecruiter, c.generateQuestions);
  r.patch('/interviews/:id/questions', requireRecruiter, c.updateQuestions);
  r.post('/interviews/:id/ready', requireRecruiter, c.ready);
  r.post('/interviews/:id/evaluate', requireRecruiter, c.evaluate);
  r.get('/interviews/:id/report', requireRecruiter, c.report);
  r.get('/interviews/:id/export.pdf', requireRecruiter, c.exportPdf);
  return r;
}
