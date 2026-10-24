import { beforeEach, describe, expect, it } from 'vitest';
import type { CandidateAccessResponse, CurrentQuestionResponse } from '@/api/generated/contract';
import { FIXTURE_RECRUITER, FIXTURE_RECRUITER_PASSWORD } from '@/api/client/fixtures';
import { fixtureControls, mockTransport } from '@/api/client/mockTransport';
import { ApiError } from '@/api/client/http';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => mockTransport.request<T>({ method, path, body });

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await promise.catch((e: ApiError) => expect(e.code).toBe(code));
}

describe('fixture transport (keeps fixture mode honest to the provisional contract)', () => {
  beforeEach(() => fixtureControls.reset());

  it('protects recruiter routes until sign-in', async () => {
    await expectCode(call('GET', '/interviews'), 'UNAUTHENTICATED');
    await expectCode(call('POST', '/auth/recruiter/login', { email: FIXTURE_RECRUITER.email, password: 'nope' }), 'INVALID_CREDENTIALS');
    await call('POST', '/auth/recruiter/login', { email: FIXTURE_RECRUITER.email, password: FIXTURE_RECRUITER_PASSWORD });
    const list = await call<{ items: unknown[] }>('GET', '/interviews');
    expect(list.items.length).toBeGreaterThan(0);
  });

  it('maps special invitation codes to their error states', async () => {
    await expectCode(call('POST', '/candidate/access', { invitationCode: 'HB-EXPIRED-01', accessCode: '1' }), 'INVITATION_EXPIRED');
    await expectCode(call('POST', '/candidate/access', { invitationCode: 'HB-DONE-0001', accessCode: '1' }), 'INTERVIEW_COMPLETED');
    await expectCode(call('POST', '/candidate/access', { invitationCode: 'HB-NOPE-0000', accessCode: '1' }), 'INVITATION_INVALID');
  });

  it('runs a candidate session without duplicate answers', { timeout: 20_000 }, async () => {
    const { sessionId } = await call<CandidateAccessResponse>('POST', '/candidate/access', { invitationCode: 'HB-DEMO-0001', accessCode: '246810' });
    await expectCode(call('POST', `/candidate/sessions/${sessionId}/start`), 'CONSENT_REQUIRED');
    await call('POST', `/candidate/sessions/${sessionId}/consent`, { recordingConsent: false, proctoringConsent: true });
    const first = await call<CurrentQuestionResponse>('POST', `/candidate/sessions/${sessionId}/start`);
    expect(first.question?.sequence).toBe(1);

    const answer = { questionId: first.question!.id, transcript: 'My answer', durationSeconds: 10, inputMode: 'TEXT', idempotencyKey: 'k1' };
    const second = await call<CurrentQuestionResponse>('POST', `/candidate/sessions/${sessionId}/answers`, answer);
    const retried = await call<CurrentQuestionResponse>('POST', `/candidate/sessions/${sessionId}/answers`, answer);
    expect(second.question?.sequence).toBe(2);
    expect(retried.progress.answered).toBe(1);

    const done = await call<{ status: string; progress: { answered: number; total: number } }>('POST', `/candidate/sessions/${sessionId}/complete`);
    expect(done.status).toBe('COMPLETED');
    expect(done.progress.answered).toBe(1);
  });

  it('never hands out a playback URL in fixture mode', async () => {
    await call('POST', '/auth/recruiter/login', { email: FIXTURE_RECRUITER.email, password: FIXTURE_RECRUITER_PASSWORD });
    await expectCode(call('POST', '/recordings/rec_int_1001/playback-url'), 'RECORDING_UNAVAILABLE');
    await expectCode(call('POST', '/recordings/rec_int_1007/playback-url'), 'RECORDING_DELETED');
  });
});
