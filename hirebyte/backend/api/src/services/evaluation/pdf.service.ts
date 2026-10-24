import PDFDocument from 'pdfkit';
import type * as Api from '@contracts';
import type { AuthUser } from '../auth/auth.service.js';
import type { ReportService } from './report.service.js';

const INK = '#1f2937';
const MUTED = '#6b7280';
const BRAND = '#0f5f8c';

/**
 * PDFKit's built-in fonts only cover Latin-1 (WinAnsi). Typographic punctuation is mapped to plain
 * equivalents and anything else becomes "?" so the PDF never shows broken glyphs.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -​ ]/g, ' ')
    .replace(/[^\n\t -~¡-ÿ]/g, '?');
}

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
const when = (iso: string | null) => (iso ? new Date(iso).toUTCString().replace(' GMT', ' UTC') : '-');
const score = (value: number | null, max = 10) => (value === null ? 'Not scored' : `${value} / ${max}`);

function render(report: Api.InterviewReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'HireByte interview report', Producer: 'HireByte' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const text = (value: string, opts: PDFKit.Mixins.TextOptions & { size?: number; color?: string; bold?: boolean } = {}) => {
    const { size = 10, color = INK, bold = false, ...rest } = opts;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color).text(pdfSafe(value), rest);
  };
  const heading = (value: string) => {
    doc.moveDown(0.8);
    text(value, { size: 13, bold: true, color: BRAND });
    doc.moveDown(0.3);
  };
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    text(title, { bold: true });
    for (const item of items) text(`- ${item}`, { indent: 10 });
  };

  const { interview } = report;
  text('Interview report', { size: 20, bold: true, color: BRAND });
  text(`${interview.candidateName} - ${interview.jobTitle}`, { size: 13 });
  text(`${interview.candidateEmail} | Status: ${label(interview.status)} | Started ${when(interview.startedAt)}`, { color: MUTED });
  doc.moveDown(0.5);
  text('AI-assisted assessment for human review. It is not a hiring decision.', { color: MUTED, oblique: true });

  heading('Summary');
  const answers = report.items.map((i) => i.answer?.status ?? 'UNANSWERED');
  text(`Overall score: ${score(report.overall?.score ?? null)}`, { bold: true });
  text(`Answered ${answers.filter((s) => s === 'ANSWERED').length} | Skipped ${answers.filter((s) => s === 'SKIPPED').length} | No answer ${answers.filter((s) => s === 'UNANSWERED').length} | Evaluation: ${label(report.evaluationStatus)}`);
  text(`Skills assessed: ${interview.requiredSkills.join(', ') || '-'} | Recording: ${label(interview.recordingStatus)}`);
  if (report.overall) {
    doc.moveDown(0.3);
    text(report.overall.summary, { color: MUTED });
    list('Strengths', report.overall.strengths);
    list('Gaps', report.overall.gaps);
  }

  heading('Questions and answers');
  for (const item of report.items) {
    const { question, answer, evaluation } = item;
    doc.moveDown(0.4);
    text(`Question ${question.sequence} (${label(question.category)}, ${label(question.difficulty)})`, { bold: true });
    text(question.text);
    doc.moveDown(0.2);
    if (answer?.status === 'ANSWERED') {
      text(`Answer (${answer.inputMode === 'TEXT' ? 'typed' : 'spoken'}):`, { color: MUTED });
      text(answer.transcript || '-', { indent: 10 });
    } else {
      text(answer?.status === 'SKIPPED' ? 'Skipped - not scored.' : 'No answer - not scored.', { color: MUTED });
    }
    if (evaluation) {
      const override = evaluation.override;
      text(
        override
          ? `Score: ${score(override.score, evaluation.maxScore)} (reviewer override by ${override.reviewerName}; AI score ${score(evaluation.score, evaluation.maxScore)})`
          : `Score: ${score(evaluation.score, evaluation.maxScore)}${evaluation.reviewStatus === 'CONFIRMED' ? ' (confirmed by reviewer)' : ' (AI only, not yet reviewed)'}`,
        { bold: true },
      );
      if (override) text(`Override reason: ${override.reason}`, { color: MUTED });
      text(evaluation.explanation);
      list('Evidence from the answer', evaluation.evidence.map((e) => `"${e}"`));
      list('Strengths', evaluation.strengths);
      list('Gaps', evaluation.gaps);
    }
  }

  heading('Observation timeline');
  text('Automated observations for a reviewer to look at in context. They are not evidence of cheating.', { color: MUTED });
  if (!report.proctoringEvents.length) text('No observations were logged.');
  for (const e of report.proctoringEvents) {
    text(`${when(e.occurredAt)} - ${label(e.type)} (${label(e.sourceCamera)} camera): ${e.description} [${label(e.reviewStatus)}]`);
  }

  doc.moveDown(1);
  text(`Generated ${when(report.generatedAt)} by HireByte.`, { size: 8, color: MUTED });
  doc.end();
  return done;
}

/** GET /interviews/:id/export.pdf: the same authorized data as the report page (PRD §15.1). */
export function createPdfService(reports: ReportService) {
  return {
    async export(user: AuthUser, interviewId: string): Promise<{ filename: string; pdf: Buffer }> {
      const report = await reports.report(user, interviewId);
      return { filename: `hirebyte-report-${interviewId.slice(0, 8)}.pdf`, pdf: await render(report) };
    },
  };
}

export type PdfService = ReturnType<typeof createPdfService>;
