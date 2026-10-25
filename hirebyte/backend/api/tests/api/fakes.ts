import type { RealtimeEventMap, RealtimeEventName } from '@contracts';
import {
  DocumentRejectedError,
  DocumentServiceUnavailableError,
  type DocumentExtractor,
  type ExtractedDocument,
} from '../../src/providers/documents/documentService.provider.js';
import {
  LlmError,
  type AnswerEvaluation,
  type AnswerEvaluationInput,
  type GeneratedQuestion,
  type InterviewerTurn,
  type InterviewerTurnInput,
  type LlmProvider,
  type QuestionGenerationInput,
} from '../../src/providers/llm/llm.types.js';
import type { EgressProvider, EgressSnapshot } from '../../src/providers/media/egress.provider.js';
import type { MediaProvider, MediaTokenRequest, MediaWebhookEvent, WebhookVerifier } from '../../src/providers/media/livekit.provider.js';
import type { ObjectStorage } from '../../src/providers/object-storage/objectStorage.types.js';
import { createEventHub, type EventHub } from '../../src/realtime/eventHub.js';
import type { Db } from '../../src/repositories/prisma.js';

/** In-memory stand-ins for LiveKit and R2 so API tests exercise the real services offline. */

export class FakeMedia implements MediaProvider {
  readonly url = 'wss://fake.livekit.test';
  tokens: MediaTokenRequest[] = [];
  rooms = new Set<string>();
  async createToken(req: MediaTokenRequest) {
    this.tokens.push(req);
    return `fake-token:${req.identity}`;
  }
  async ensureRoom(room: string) {
    this.rooms.add(room);
  }
}

export class FakeEgress implements EgressProvider {
  started: Array<{ roomName: string; objectKey: string; egressId: string }> = [];
  stopped: string[] = [];
  failStart = false;
  states = new Map<string, EgressSnapshot>();
  private counter = 0;

  async startRoomComposite(roomName: string, objectKey: string): Promise<EgressSnapshot> {
    if (this.failStart) throw new Error('egress unavailable');
    this.counter += 1;
    const egressId = `EG_test${this.counter}`;
    this.started.push({ roomName, objectKey, egressId });
    const snap: EgressSnapshot = { egressId, state: 'STARTING', error: null, file: null };
    this.states.set(egressId, snap);
    return snap;
  }
  async stop(egressId: string): Promise<EgressSnapshot> {
    this.stopped.push(egressId);
    const snap: EgressSnapshot = { egressId, state: 'ENDING', error: null, file: null };
    this.states.set(egressId, snap);
    return snap;
  }
  async get(egressId: string) {
    return this.states.get(egressId) ?? null;
  }
}

export class FakeStorage implements ObjectStorage {
  objects = new Map<string, number>();
  failDelete = false;
  signed: Array<{ key: string; ttl: number }> = [];
  async head(key: string) {
    const size = this.objects.get(key);
    return { exists: size !== undefined, sizeBytes: size ?? null, contentType: size !== undefined ? 'video/mp4' : null };
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('r2 delete failed');
    this.objects.delete(key);
  }
  async signedGetUrl(key: string, ttlSeconds: number) {
    this.signed.push({ key, ttl: ttlSeconds });
    return `https://r2.test/${key}?X-Amz-Expires=${ttlSeconds}&X-Amz-Signature=fake`;
  }
}

export const VALID_SIGNATURE = 'Bearer valid-test-signature';

/** Accepts only VALID_SIGNATURE; the body is the already-normalized event as JSON. */
export class FakeWebhooks implements WebhookVerifier {
  async receive(rawBody: string, authorization: string | undefined): Promise<MediaWebhookEvent> {
    if (authorization !== VALID_SIGNATURE) throw new Error('invalid signature');
    const parsed = JSON.parse(rawBody) as MediaWebhookEvent & { createdAt: string };
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  }
}

/** The real hub (so socket tests deliver events) that also records every publish for assertions. */
export class RecordingEventHub implements EventHub {
  published: Array<{ event: RealtimeEventName; payload: RealtimeEventMap[RealtimeEventName] }> = [];
  private readonly inner: EventHub;

  constructor(db: Db) {
    this.inner = createEventHub(db);
  }
  attach(io: Parameters<EventHub['attach']>[0]) {
    this.inner.attach(io);
  }
  publish<E extends RealtimeEventName>(event: E, payload: RealtimeEventMap[E]) {
    this.published.push({ event, payload });
    this.inner.publish(event, payload);
  }
  flush() {
    return this.inner.flush();
  }
  /** Payloads of one event type, in publish order. */
  of<E extends RealtimeEventName>(event: E): Array<RealtimeEventMap[E]> {
    return this.published.filter((p) => p.event === event).map((p) => p.payload as RealtimeEventMap[E]);
  }
}

/** Document service stand-in: returns `text`, or the configured failure. */
export class FakeDocuments implements DocumentExtractor {
  text = 'Jane Candidate. Five years of Node.js and PostgreSQL. Built payment APIs at Acme.';
  reject: { code: string; message: string; unsupportedType?: boolean } | null = null;
  unavailable = false;
  calls: Array<{ filename: string; mimeType: string; size: number }> = [];
  async extract(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<ExtractedDocument> {
    this.calls.push({ filename: file.filename, mimeType: file.mimeType, size: file.buffer.length });
    if (this.unavailable) throw new DocumentServiceUnavailableError('down');
    if (this.reject) throw new DocumentRejectedError(this.reject.code, this.reject.message, Boolean(this.reject.unsupportedType));
    return { text: this.text, pageCount: 1, truncated: false, warnings: [] };
  }
}

/** Grok stand-in. Questions follow the requested categories; evaluations quote the transcript. */
export class FakeLlm implements LlmProvider {
  questionRequests: QuestionGenerationInput[] = [];
  evaluationRequests: AnswerEvaluationInput[] = [];
  /** Overrides for the next calls (e.g. too few questions, a provider error). */
  nextQuestions: GeneratedQuestion[][] = [];
  failWith: LlmError | null = null;
  /** Lets a test hold an evaluation job open. */
  gate: Promise<void> | null = null;
  turnRequests: InterviewerTurnInput[] = [];
  /** Interviewer turns to return next, in order; then a plain acknowledgement. */
  nextTurns: InterviewerTurn[] = [];
  turnFails = false;

  clarificationRequests: Array<{ question: { text: string }; message: string }> = [];

  async answerCandidateQuestion(input: { jobTitle: string; question: { text: string }; message: string }): Promise<{ reply: string }> {
    this.clarificationRequests.push(input);
    if (this.turnFails) throw new LlmError('PROVIDER_TIMEOUT', 'slow');
    return { reply: `It asks you to explain: ${input.question.text}` };
  }

  async respondToAnswer(input: InterviewerTurnInput): Promise<InterviewerTurn> {
    this.turnRequests.push(input);
    if (this.turnFails) throw new LlmError('PROVIDER_TIMEOUT', 'slow');
    return this.nextTurns.shift() ?? { reply: 'Thank you, that is clear.', followUp: null };
  }

  async generateQuestions(input: QuestionGenerationInput): Promise<GeneratedQuestion[]> {
    this.questionRequests.push(input);
    if (this.failWith) throw this.failWith;
    const next = this.nextQuestions.shift();
    if (next) return next;
    return Array.from({ length: input.count }, (_, i) => ({
      text: `Generated question ${i + 1} about ${input.requiredSkills[0] ?? 'the role'}?`,
      category: input.categories[i % input.categories.length]!,
      difficulty: input.difficulty,
      targetSkills: input.requiredSkills.slice(0, 2),
      evaluationCriteria: ['Correctness', 'Clarity'],
      expectedAnswerPoints: ['A concrete example'],
    }));
  }

  async evaluateAnswer(input: AnswerEvaluationInput): Promise<AnswerEvaluation> {
    this.evaluationRequests.push(input);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const firstWords = input.transcript.split(/\s+/).slice(0, 4).join(' ');
    return {
      score: 7.25,
      criteria: [{ criterion: 'Correctness', score: 7 }],
      evidence: [firstWords, 'a sentence the candidate never said'],
      explanation: 'Covers the main points with one example.',
      strengths: ['Clear structure'],
      gaps: ['No trade-offs discussed'],
    };
  }
}

export { LlmError };
