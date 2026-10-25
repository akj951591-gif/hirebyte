import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Keyboard, Mic, RotateCcw, SkipForward, Square, Volume2, Send, Flag, Loader2 } from 'lucide-react';
import { api, type CandidateQuestion, type CurrentQuestionResponse } from '@/api/client';
import { toApiError, useAsync } from '@/api/client/useAsync';
import { useCandidateOutlet } from '@/app/CandidateRouteGuard';
import { useLocalMedia, usePublishToRoom } from '@/features/media';
import { createBrowserStt, createBrowserTts } from '@/features/voice';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/PageState';
import { QuestionCard } from '@/components/QuestionCard';
import { StatusBadge } from '@/components/StatusBadge';
import { VideoPanel } from '@/components/VideoPanel';
import { CandidateAlerts, FullscreenGate, useCameraObservations, useCandidateAlerts, useFullscreenGuard, useTabObservations } from '@/features/proctoring';
import { ConversationPanel } from '@/features/conversation';
import { cn } from '@/components/cn';
import { formatClock, humanize, newIdempotencyKey } from '@/utils/format';

/** Client-side view of the engine loop: ASKING → LISTENING → (review) → SAVING → next question (PRD §8.4). */
type Phase = 'asking' | 'ready' | 'listening' | 'review' | 'saving';

const phaseLabel: Record<Phase, string> = {
  asking: 'Reading the question',
  ready: 'Ready for your answer',
  listening: 'Listening',
  review: 'Review your answer',
  saving: 'Saving your answer',
};

function useElapsedSeconds(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return startedAt ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;
}

export function InterviewRoomPage() {
  const { session, setSession } = useCandidateOutlet();
  const navigate = useNavigate();
  const { data: current, error: loadError, loading, reload, setData } = useAsync(
    (signal) => api.candidate.currentQuestion(session.sessionId, signal),
    [session.sessionId],
  );

  const media = useLocalMedia({ autoStart: true });
  const conversation = useAsync((signal) => api.candidate.conversation(session.sessionId, signal), [session.sessionId]);
  // Camera and tab checks, reported as observations for the recruiter to review (PRD §13).
  const observing = current?.status === 'IN_PROGRESS' || current?.status === 'PROCESSING_ANSWER';
  const reportObservation = useCallback(
    (body: Parameters<typeof api.proctoring.log>[1]) => api.proctoring.log(session.interviewId, body),
    [session.interviewId],
  );
  // The same observations the recruiter reviews are also shown to the candidate while they happen.
  const { alerts, onLiveChange } = useCandidateAlerts();
  const cameraChecks = useCameraObservations({ stream: media.stream, enabled: observing, camera: 'PRIMARY', report: reportObservation, onLiveChange });
  useTabObservations({ enabled: observing, report: reportObservation, onLiveChange });
  // Laptop camera + microphone into the interview room for the recruiter's live view and recording.
  // The laptop also receives the candidate's own phone camera, so they can see what it shows.
  const phoneCameraUsed = session.secondaryCamera !== 'OFF';
  const getLaptopToken = useCallback(() => api.media.token(session.interviewId, { device: 'primary' }), [session.interviewId]);
  const room = usePublishToRoom({ getToken: getLaptopToken, stream: media.stream, enabled: observing, watchPhone: phoneCameraUsed });
  const tts = useMemo(() => createBrowserTts(), []);
  const stt = useMemo(() => createBrowserStt(), []);

  const [phase, setPhase] = useState<Phase>('ready');
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [inputMode, setInputMode] = useState<'VOICE' | 'TEXT'>(stt.isSupported ? 'VOICE' : 'TEXT');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [sttError, setSttError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'skip' | 'end' | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const answerStartRef = useRef<number | null>(null);
  /** One idempotency key per question, reused for retries so the server never stores a duplicate. */
  const keysRef = useRef(new Map<string, string>());
  const keyFor = (questionId: string) => {
    if (!keysRef.current.has(questionId)) keysRef.current.set(questionId, newIdempotencyKey());
    return keysRef.current.get(questionId)!;
  };

  const question: CandidateQuestion | null = current?.question ?? null;
  const elapsed = useElapsedSeconds(current?.startedAt ?? null);
  const remaining = (current?.durationMinutes ?? 0) * 60 - elapsed;

  useEffect(() => tts.subscribe((s) => setTtsSpeaking(s === 'speaking')), [tts]);

  /** Reads the question aloud, after the interviewer's reply to the previous answer when there is one. */
  const speakQuestion = useCallback(
    (q: CandidateQuestion, interviewerReply?: string | null) => {
      if (!tts.isSupported) {
        setPhase('ready');
        return;
      }
      setPhase('asking');
      tts.speak(interviewerReply ? `${interviewerReply} ${q.text}` : q.text, { onEnd: () => setPhase((p) => (p === 'asking' ? 'ready' : p)) });
    },
    [tts],
  );

  // New question from the backend → reset the answer and read it aloud.
  useEffect(() => {
    if (!question) return;
    setTranscript('');
    setInterim('');
    setSttError(null);
    setSaveError(null);
    answerStartRef.current = null;
    speakQuestion(question, current?.interviewerReply);
    // A new question means the interviewer just said something: refresh the conversation.
    void conversation.reload({ silent: true });
  }, [question?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      tts.stop();
      stt.stopCapture();
    },
    [tts, stt],
  );

  // The backend may finish the interview on its own (e.g. time limit). Follow it; the guard redirects.
  const serverStatus = current?.status;
  useEffect(() => {
    if (serverStatus && serverStatus !== 'IN_PROGRESS' && serverStatus !== 'PROCESSING_ANSWER') {
      setSession((s) => ({ ...s, status: serverStatus }));
    }
  }, [serverStatus, setSession]);

  const startListening = () => {
    tts.stop();
    setSttError(null);
    setInterim('');
    answerStartRef.current ??= Date.now();
    setPhase('listening');
    const base = transcript;
    stt.startCapture({
      onResult: (r) => {
        setTranscript([base, r.transcript].filter(Boolean).join(' '));
        setInterim(r.interim);
      },
      onError: (_code, message) => setSttError(message),
      onEnd: () => {
        setInterim('');
        setPhase((p) => (p === 'listening' ? 'review' : p));
      },
    });
  };

  const stopListening = () => {
    stt.stopCapture();
    setPhase('review');
  };

  const switchToTyping = () => {
    stt.stopCapture();
    tts.stop();
    setInputMode('TEXT');
    answerStartRef.current ??= Date.now();
    setPhase('review');
  };

  const applyResponse = (next: CurrentQuestionResponse) => {
    setData(next);
    if (next.question?.id === question?.id) setPhase('review');
  };

  const handleMutationError = async (err: unknown) => {
    const error = toApiError(err);
    if (error.code === 'CONFLICT' || error.code === 'DUPLICATE_SUBMISSION') {
      // The backend already moved on (e.g. another tab or a retried request). Resync from it;
      // if the question changed, the new-question effect takes over from here.
      setPhase('review');
      await reload({ silent: true });
      return;
    }
    setSaveError(`${error.message} Your answer is still here — try again.`);
    setPhase('review');
  };

  const submitAnswer = async () => {
    if (!question) return;
    const text = transcript.trim();
    if (!text) {
      setSaveError('Your answer is empty. Record or type an answer first, or skip the question.');
      return;
    }
    stt.stopCapture();
    setSaveError(null);
    setPhase('saving');
    try {
      const next = await api.candidate.submitAnswer(session.sessionId, {
        questionId: question.id,
        transcript: text,
        durationSeconds: answerStartRef.current ? (Date.now() - answerStartRef.current) / 1000 : 0,
        inputMode,
        idempotencyKey: keyFor(question.id),
      });
      applyResponse(next);
    } catch (err) {
      await handleMutationError(err);
    }
  };

  const skipQuestion = async () => {
    if (!question) return;
    setActionPending(true);
    stt.stopCapture();
    tts.stop();
    try {
      const next = await api.candidate.skip(session.sessionId, { questionId: question.id, idempotencyKey: `skip-${keyFor(question.id)}` });
      applyResponse(next);
    } catch (err) {
      await handleMutationError(err);
    } finally {
      setActionPending(false);
      setConfirm(null);
    }
  };

  const completeInterview = async () => {
    setActionPending(true);
    stt.stopCapture();
    tts.stop();
    // Finishing on purpose: handing the screen back is not leaving full screen.
    fullscreen.release();
    try {
      const result = await api.candidate.complete(session.sessionId);
      media.stop();
      setSession((s) => ({ ...s, status: result.status }));
      navigate('/candidate/complete', { replace: true });
    } catch (err) {
      setSaveError(toApiError(err).message);
      setActionPending(false);
      setConfirm(null);
    }
  };

  /** Leaving full screen ends the interview: saved answers are submitted and the candidate is told why. */
  const endingForFullscreenRef = useRef(false);
  const endForFullscreenExit = async () => {
    if (endingForFullscreenRef.current) return;
    endingForFullscreenRef.current = true;
    stt.stopCapture();
    tts.stop();
    // A note on the recruiter's timeline, sent first because events are refused once the interview is over.
    await reportObservation({
      type: 'TAB_HIDDEN',
      occurredAt: new Date().toISOString(),
      durationSeconds: 0,
      sourceCamera: 'PRIMARY',
      description: 'The candidate left full screen, so the interview was ended.',
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await api.candidate.complete(session.sessionId);
        media.stop();
        setSession((s) => ({ ...s, status: result.status }));
        navigate('/candidate/complete', { replace: true, state: { endedBy: 'fullscreen' } });
        return;
      } catch (err) {
        // Already finished on the server (e.g. the time limit): follow it to the end screen.
        if (toApiError(err).code === 'CONFLICT') {
          navigate('/candidate/complete', { replace: true, state: { endedBy: 'fullscreen' } });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
    }
    endingForFullscreenRef.current = false;
    setSaveError('You left full screen, but we could not end the interview automatically. Check your connection, then choose End interview.');
  };
  const fullscreen = useFullscreenGuard({ enabled: observing, onExit: () => void endForFullscreenExit() });

  if (loading && !current) return <LoadingState label="Loading your next question…" />;
  if (loadError || !current) {
    return (
      <div className="card mx-auto max-w-xl">
        <ErrorState
          message={loadError?.message ?? 'We could not load your interview.'}
          code={loadError?.code}
          requestId={loadError?.requestId}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const { progress } = current;
  const done = progress.answered + progress.skipped;
  const percent = progress.total ? Math.round((done / progress.total) * 100) : 0;
  const unanswered = progress.total - done;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {fullscreen.required && <FullscreenGate onEnter={() => void fullscreen.enter()} />}
      <div className="space-y-4">
        <CandidateAlerts alerts={alerts} />
        {question ? (
          <>
            {current.interviewerReply && (
              <p className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-ink" aria-live="polite">
                <span className="font-semibold">Interviewer: </span>
                {current.interviewerReply}
              </p>
            )}
            <QuestionCard
              sequence={question.sequence}
              total={progress.total}
              text={question.text}
              tags={question.isFollowUp ? ['Follow-up', humanize(question.category)] : [humanize(question.category)]}
              size="lg"
              actions={
                tts.isSupported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => speakQuestion(question)}
                    disabled={phase === 'listening' || phase === 'saving'}
                    icon={<Volume2 className="h-4 w-4" aria-hidden />}
                  >
                    Repeat
                  </Button>
                )
              }
            />

            <ConversationPanel
              turns={conversation.data?.turns ?? []}
              canAsk={phase !== 'listening' && phase !== 'saving'}
              onAsk={async (message) => {
                const res = await api.candidate.ask(session.sessionId, { questionId: question.id, message });
                conversation.setData((cur) => ({ turns: [...(cur?.turns ?? []), res.question, res.reply] }));
                if (tts.isSupported) {
                  tts.stop();
                  tts.speak(res.reply.text);
                }
              }}
            />

            <section className="card p-5" aria-labelledby="answer-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="answer-heading" className="font-semibold text-ink">
                  Your answer
                </h2>
                <StatusBadge
                  tone={phase === 'listening' ? 'danger' : phase === 'saving' ? 'warning' : phase === 'asking' ? 'info' : 'neutral'}
                  live={phase === 'listening' || phase === 'asking' || phase === 'saving'}
                >
                  {phase === 'asking' && !ttsSpeaking ? phaseLabel.ready : phaseLabel[phase]}
                </StatusBadge>
              </div>

              {inputMode === 'VOICE' ? (
                <div
                  className={cn(
                    'mt-4 min-h-[120px] rounded border p-4 text-sm leading-relaxed',
                    phase === 'listening' ? 'border-danger/40 bg-danger-soft/30' : 'border-line bg-surface-muted',
                  )}
                  aria-live="polite"
                >
                  {transcript || interim ? (
                    <p className="text-ink">
                      {transcript} <span className="text-ink-subtle">{interim}</span>
                    </p>
                  ) : (
                    <p className="text-ink-subtle">
                      {phase === 'listening' ? 'Listening… start speaking.' : 'Press “Start answering” and speak your answer. Your words appear here.'}
                    </p>
                  )}
                </div>
              ) : null}

              {(inputMode === 'TEXT' || phase === 'review' || phase === 'saving') && (
                <div className="mt-4">
                  <label htmlFor="answer-text" className="text-sm font-medium text-ink">
                    {inputMode === 'TEXT' ? 'Type your answer' : 'Check and correct the transcript if needed'}
                  </label>
                  <textarea
                    id="answer-text"
                    className="input mt-1.5 min-h-[140px] resize-y"
                    value={transcript}
                    onChange={(e) => {
                      answerStartRef.current ??= Date.now();
                      setTranscript(e.target.value);
                    }}
                    disabled={phase === 'saving'}
                    placeholder="Write your answer here…"
                  />
                </div>
              )}

              {sttError && (
                <Alert tone="warning" className="mt-4">
                  {sttError}
                </Alert>
              )}
              {saveError && (
                <Alert tone="danger" className="mt-4">
                  {saveError}
                </Alert>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {inputMode === 'VOICE' && phase !== 'listening' && phase !== 'saving' && (
                  <Button onClick={startListening} icon={<Mic className="h-4 w-4" aria-hidden />}>
                    {transcript ? 'Continue speaking' : 'Start answering'}
                  </Button>
                )}
                {phase === 'listening' && (
                  <Button variant="danger" onClick={stopListening} icon={<Square className="h-4 w-4" aria-hidden />}>
                    Stop
                  </Button>
                )}
                {(phase === 'review' || phase === 'saving' || inputMode === 'TEXT') && (
                  <Button
                    onClick={submitAnswer}
                    loading={phase === 'saving'}
                    disabled={!transcript.trim()}
                    icon={<Send className="h-4 w-4" aria-hidden />}
                    variant={inputMode === 'VOICE' ? 'secondary' : 'primary'}
                  >
                    {phase === 'saving' ? 'Saving…' : 'Submit answer'}
                  </Button>
                )}
                {inputMode === 'VOICE' && transcript && phase === 'review' && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setTranscript('');
                      answerStartRef.current = null;
                    }}
                    icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                  >
                    Clear
                  </Button>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                  {inputMode === 'VOICE' && phase !== 'saving' && (
                    <Button variant="ghost" size="sm" onClick={switchToTyping} icon={<Keyboard className="h-4 w-4" aria-hidden />}>
                      Type instead
                    </Button>
                  )}
                  {inputMode === 'TEXT' && stt.isSupported && phase !== 'saving' && (
                    <Button variant="ghost" size="sm" onClick={() => setInputMode('VOICE')} icon={<Mic className="h-4 w-4" aria-hidden />}>
                      Answer by voice
                    </Button>
                  )}
                  {current.allowSkip && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirm('skip')}
                      disabled={phase === 'saving' || phase === 'listening'}
                      icon={<SkipForward className="h-4 w-4" aria-hidden />}
                    >
                      Skip
                    </Button>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="card flex flex-col items-center gap-4 p-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold text-ink">You have answered every question</h1>
              <p className="mt-1 text-sm text-ink-muted">Submit the interview to finish. You cannot change answers after submitting.</p>
            </div>
            {saveError && <Alert tone="danger">{saveError}</Alert>}
            <Button size="lg" onClick={completeInterview} loading={actionPending}>
              Submit interview
            </Button>
          </section>
        )}
      </div>

      <aside className="space-y-4">
        <VideoPanel
          label="You"
          stream={media.stream}
          mirrored
          status={
            media.state === 'ready' ? (
              <StatusBadge tone="danger" live>
                Live
              </StatusBadge>
            ) : undefined
          }
          placeholder={media.state === 'requesting' ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <span>{media.errorMessage}</span>}
        />
        {phoneCameraUsed && (
          <VideoPanel
            label="Your phone camera"
            stream={room.phone}
            status={
              room.phone ? (
                <StatusBadge tone="danger" live>
                  Live
                </StatusBadge>
              ) : undefined
            }
            placeholder={<span>Phone camera not connected. You can add it by scanning the QR code on the device check step.</span>}
          />
        )}
        {observing && cameraChecks !== 'off' && (
          <p className="text-xs text-ink-muted" role="status">
            {cameraChecks === 'active'
              ? 'Camera checks are on, as described in the notice.'
              : cameraChecks === 'loading'
                ? 'Starting camera checks…'
                : 'Camera checks are unavailable on this device. Your interview continues normally.'}
          </p>
        )}
        {media.errorMessage && (
          <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={() => void media.start()}>Reconnect camera</Button>}>
            {media.errorMessage}
          </Alert>
        )}

        <section className="card space-y-4 p-5" aria-label="Interview progress">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-ink">Progress</span>
              <span className="text-ink-muted">
                {done} of {progress.total} done
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Questions completed"
            >
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            {progress.skipped > 0 && <p className="mt-1.5 text-xs text-ink-muted">{progress.skipped} skipped</p>}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">Time</span>
            <span className={cn('font-mono tabular-nums', remaining < 0 ? 'text-danger' : remaining < 120 ? 'text-warning' : 'text-ink-muted')}>
              {remaining >= 0 ? `${formatClock(remaining)} left` : `${formatClock(-remaining)} over`}
            </span>
          </div>
        </section>

        <Button variant="secondary" className="w-full" onClick={() => setConfirm('end')} icon={<Flag className="h-4 w-4" aria-hidden />}>
          End interview
        </Button>
      </aside>

      <ConfirmDialog
        open={confirm === 'skip'}
        title="Skip this question?"
        confirmLabel="Skip question"
        loading={actionPending}
        onConfirm={skipQuestion}
        onCancel={() => setConfirm(null)}
      >
        Skipped questions are marked as unanswered. You will not be able to come back to it.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'end'}
        title="End the interview now?"
        confirmLabel="End and submit"
        confirmVariant="danger"
        loading={actionPending}
        onConfirm={completeInterview}
        onCancel={() => setConfirm(null)}
      >
        {unanswered > 0
          ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} still unanswered and will be submitted as unanswered. Saved answers are kept.`
          : 'Your saved answers will be submitted.'}{' '}
        You cannot return to the interview afterwards.
      </ConfirmDialog>
    </div>
  );
}
