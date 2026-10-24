# HireByte frontend (Workstreams A and B)

React + Vite + TypeScript + Tailwind CSS + Lucide. This folder holds the **candidate experience
(Workstream A)** and the **recruiter dashboard (Workstream B)** from PRD v2.1.

## Run it

Requires Node.js 20.19+ or 22.12+ (Vite 8). Stack versions: Vite 8, Tailwind CSS 4 (via `@tailwindcss/postcss`,
theme in `tailwind.config.ts` loaded with `@config`), React Router 7, Vitest 5.

```bash
npm install
npm run dev:fixtures   # UI with in-browser fixture data, no backend needed
npm run dev            # UI against the real API (proxies /api to API_PROXY_TARGET, default http://localhost:4000)
npm run typecheck
npm test
npm run build
```

Copy `.env.example` to `.env.local` to change settings. Never put secrets in `VITE_` variables.

## Pages and routes

| Route | Page | Workstream |
| --- | --- | --- |
| `/candidate/login` (`?code=` prefills the code) | Candidate sign-in with invitation code + access code | A |
| `/candidate/lobby` | Instructions, recording and observation notices, consent | A |
| `/candidate/device-check` | Camera/mic permission + preview, mic meter, speaker test, speech support, phone QR pairing | A |
| `/candidate/interview` | Spoken/text question, repeat, voice or typed answer, transcript preview, progress, timer, skip, safe end | A |
| `/candidate/complete` | Submission status and thank-you (no scores) | A |
| `/recruiter/login` | Recruiter email + password sign-in | B |
| `/recruiter` | Overview: totals, in progress, completed, pending review, recent interviews with search/filter | B |
| `/recruiter/interviews` | All interviews with status filter, plus analytics | B |
| `/recruiter/interviews/new` | Create interview: role, JD, skills, level, difficulty, duration, count (default 10), categories, skip/follow-up/phone camera/recording | B |
| `/recruiter/interviews/:id/setup` | Resume upload, generate/edit/reorder questions, mark ready, invitation codes | B |
| `/recruiter/interviews/:id/monitor` | Live status, camera connection status, question progress, observation timeline | B |
| `/recruiter/interviews/:id/report` | Summary, Watch Recording, per-question transcript/rubric/evidence, overrides, observation review, PDF | B |

Both login pages share one frame with Candidate / Recruiter tabs, but they are separate routes
backed by separate API calls, as PRD §2 requires.

## How it is organised

```
src/
  api/client/        typed API client (index.ts), fetch transport (http.ts), useAsync/usePolling,
                     FIXTURE transport + data (mockTransport.ts, fixtures.ts) for fixture mode only
  api/generated/     contract.ts: PROVISIONAL DTOs (see below)
  app/               router, layouts, route guards (UX only; the API authorizes)
  components/        shared presentational controls (Button, FormField, StatusBadge, DataTable, ...)
  config/            product name, API base URL, feature flags
  features/          auth, interviews, questions, resume, voice, media, recordings, proctoring, evaluation, reports
  pages/candidate/   Workstream A pages
  pages/recruiter/   Workstream B pages
  theme/tokens.css   design tokens (colors, radius, fonts) used through Tailwind
```

## Contract status: please read before integrating

`backend/contracts/openapi.yaml` was empty when this was built, so the request and response shapes in
`src/api/generated/contract.ts` are **this frontend's proposal**, written from the PRD §11 route table.
Every route path matches §11. Additions the backend owner should review:

- `GET /auth/me` returns `{ user }`. Login and candidate access rely on HttpOnly cookies; the
  frontend never stores tokens.
- `POST /candidate/access` returns `{ sessionId, expiresAt }`. Only the opaque session ID is kept, in
  `sessionStorage`.
- `GET /candidate/sessions/:id` returns the candidate-safe `CandidateSessionView`: notices,
  consent state, phone pairing URL and status. It has no rubric, scores or notes.
- Answer and skip calls send an `idempotencyKey` and return the next `CurrentQuestionResponse`.
- `GET /interviews` returns `{ items, stats }`. `GET /interviews/:id` adds `live` (progress, camera
  status, recent events) for the monitor until Socket.IO events are published.
- `POST /interviews/:id/ready` returns the invitation (`code`, `accessCode`, `url`, `expiresAt`).
- Error bodies follow PRD §11.1. The UI branches on the codes listed in `ApiErrorCode`.

When the integrator publishes `openapi.yaml`, generate types into `src/api/generated/` and fix call
sites. Pages only import types through `@/api/client`.

## Fixture mode

`npm run dev:fixtures` sets `VITE_USE_FIXTURES=true`. A yellow banner is shown on every page while
it is on. Fixture data lives in `localStorage`, so a recruiter tab and a candidate tab in the same
browser see the same interviews. Use **Reset demo data** in the banner to start over.

Fixture sign-in values (sample data only; not real accounts):

| What | Value |
| --- | --- |
| Recruiter | `recruiter@hirebyte.test` / `HireByte-demo-2026` |
| Candidate, working invite | code `HB-DEMO-0001`, access code `246810` |
| Expired invitation | `HB-EXPIRED-01` (any access code) |
| Already completed | `HB-DONE-0001` |
| Locked session | `HB-LOCKED-01` |
| Service error | `HB-ERROR-500` |

Five wrong attempts trigger the rate-limited state. Fixture mode never fakes a playable recording
(PRD §4.1). Pressing **Watch recording** on a READY recording shows the "unavailable" state. There
is also a fixture-only button to simulate the phone camera connecting.

## Known limitations

- **Live video tiles** on the monitor show connection status only. Video needs the LiveKit
  integration from Workstream D (`features/media/useLiveKitRoom.ts` is still empty).
- **Phone pairing**: the device check shows the backend-issued pairing URL as a QR code. The phone-side
  page that publishes the camera belongs to the media workstream.
- **Live updates** use polling (`appConfig.monitorPollMs`) until `backend/contracts/events.md` defines
  the Socket.IO events.
- **Proctoring detection** (MediaPipe, `features/proctoring/faceDetector.ts`) is not part of A/B. The UI
  shows and reviews observations that the backend reports.
- **Speech**: TTS and STT use browser APIs behind adapters (`features/voice`). Where SpeechRecognition is
  missing (e.g. Firefox), candidates type their answers.
- **PDF**: "Print / save PDF" always works through the browser. "Download PDF" calls
  `GET /interviews/:id/export.pdf` and is hidden in fixture mode.
