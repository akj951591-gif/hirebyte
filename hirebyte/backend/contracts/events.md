# HireByte realtime events (Socket.IO)

PRD v2.1 §11.2. Payload types are `RealtimeEventMap` in [`api-types.ts`](api-types.ts); this file
explains when each event is sent and who receives it. REST endpoints are in [`openapi.yaml`](openapi.yaml).

## Connecting

| | |
| --- | --- |
| URL | Same origin as the API (the Vite dev proxy forwards it) |
| Path | `/api/socket.io` |
| Auth | The existing HttpOnly session cookie. No token is passed in JavaScript. |
| Handshake | `auth: { role: 'recruiter' }` or `auth: { role: 'candidate' }` picks which cookie to check |

```ts
import { io } from 'socket.io-client';
const socket = io({ path: '/api/socket.io', withCredentials: true, auth: { role: 'recruiter' } });
socket.on('interview.status_changed', ({ interviewId, status }) => { /* reload that interview */ });
socket.on('connect_error', (err) => { /* err.message === 'UNAUTHENTICATED': sign in again */ });
```

A handshake without a valid session for the requested role is rejected with `UNAUTHENTICATED`
(Socket.IO does not retry these automatically; call `socket.connect()` after signing in).

## Who receives what

Rooms are joined by the server from the session. The client cannot subscribe to anything else.

| Socket | Receives |
| --- | --- |
| Recruiter | Every event for interviews they own |
| Admin | Every event for every interview |
| Candidate | Only `interview.status_changed`, `media.secondary_connected` and `media.secondary_disconnected`, only for their own interview |

Sessions are re-checked every 30 seconds. A socket whose session ended (sign-out, expiry, interview
cancelled) is disconnected with reason `io server disconnect` and is not reconnected automatically.

## Delivery

- Sent only after the database change has committed, in the order the changes happened.
- Best effort: a client that was disconnected misses events. Treat an event as "reload now", not as
  the data itself. The REST API is always the source of truth, and pages keep a slow fallback poll.
- Never contains signed URLs, object keys, tokens, transcripts, scores or candidate contact details.
- `timestamp` is an ISO-8601 string of when the change happened.

## Events

| Event | Payload | Sent when |
| --- | --- | --- |
| `interview.status_changed` | `interviewId, status, timestamp` | Every state-machine move: READY, ONBOARDING, IN_PROGRESS, COMPLETED (candidate or time limit), CANCELLED, EVALUATING, EVALUATED, EVALUATION_FAILED, REVIEWED |
| `interview.question_changed` | `interviewId, questionId, sequence, timestamp` | The candidate reaches a new question (start, after an answer or skip). Not sent after the last question |
| `answer.saved` | `interviewId, questionId, status, timestamp` | An answer or skip is saved (`ANSWERED` / `SKIPPED`). Not sent for idempotent retries |
| `proctoring.event_created` | `interviewId, eventId, type, sourceCamera, timestamp` | An observation is logged (candidate client, or phone camera connect/disconnect). Observations are for human review only |
| `media.secondary_connected` | `interviewId, status: 'PAIRED', timestamp` | The phone used its pairing link, or joined the LiveKit room |
| `media.secondary_disconnected` | `interviewId, status: 'DISCONNECTED', timestamp` | The phone left the LiveKit room |
| `recording.status_changed` | `interviewId, recordingId, status, failureCode, timestamp` | PENDING, RECORDING, FINALIZING, READY (only after the file is confirmed in R2), FAILED (with a safe code such as `EGRESS_START_FAILED`), DELETED |
| `evaluation.status_changed` | `interviewId, status, timestamp` | Evaluation starts (`EVALUATING`), finishes (`EVALUATED`) or fails (`FAILED`) |

## Changing events

Events are part of the shared contract (PRD §6.1). Add or change the payload in `RealtimeEventMap`,
update this file, copy the contract to the frontend (`npm run sync:contract` in `frontend/`), and
extend `backend/api/tests/api/realtime.test.ts`.
