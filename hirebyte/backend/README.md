# HireByte backend

Everything server-side for the HireByte prototype (PRD v2.1):

- **Node API** (`api/`): Node.js + Express + TypeScript, PostgreSQL via Prisma 7, Socket.IO.
  Auth, interview state machine, answers, LiveKit media, R2 recordings, Grok questions and evaluation, PDF export.
- **Document service** (`services/document-service/`): Python + FastAPI + PyMuPDF + python-docx.
  Turns resume PDF/DOCX files into text. It stores nothing and keeps no interview state.

```
backend/
  api/                     Node API (run npm commands here)
    src/
      config/              env validation (fails fast with a clear message)
      routes/ controllers/ URL → middleware → controller → service
      services/            business rules (auth, interviews, recordings, evaluation, PDF…)
      providers/           adapters: LiveKit, R2, Grok, document service (null when not configured)
      realtime/            Socket.IO server and event hub
      repositories/        database helpers, audit log
      schemas/             Zod request validation
      scripts/             seed, OpenAPI generator
    tests/unit/            no database needed
    tests/api/             HTTP + Socket.IO tests against a real Postgres test database
  services/document-service/
    app/                   FastAPI app, extractors, routes
    tests/                 pytest
  contracts/
    api-types.ts           request/response/event types (copied to the frontend)
    openapi.routes.ts      route table used to generate openapi.yaml
    openapi.yaml           GENERATED REST contract
    events.md              Socket.IO events
  prisma/                  schema.prisma + migrations (one steward merges these)
  docker-compose.yml       local Postgres
```

## First-time setup

You need Node.js 20.19+, Python 3.11+ and Docker Desktop (running).

**1. Node API**

```powershell
cd backend/api
Copy-Item .env.example .env      # then fill in SESSION_SECRET and SEED_RECRUITER_*
npm install                      # also generates the Prisma client
npm run db:up                    # Postgres in Docker (databases: hirebyte, hirebyte_test)
npm run db:deploy                # applies migrations
npm run db:seed                  # creates the recruiter from SEED_RECRUITER_EMAIL / _PASSWORD
npm run dev                      # http://localhost:4000 (restarts on file changes)
```

Generate a `SESSION_SECRET` with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**2. Document service** (needed for resume upload)

```powershell
cd backend/services/document-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn app.main:app --port 8001
```

Then set `DOCUMENT_SERVICE_URL=http://127.0.0.1:8001` in `backend/api/.env` and restart the API.
Optionally set the same `DOCUMENT_SERVICE_TOKEN` in both places so only the API can call it.

**3. Grok** (needed for AI questions and evaluation): set `XAI_API_KEY` and `XAI_MODEL` in
`backend/api/.env` (pick a current model name from docs.x.ai) and restart the API.

**4. LiveKit and R2** (live video and recordings): see the comments in `api/.env.example`.

Check what is configured at <http://localhost:4000/api/health>; it reports `database`, `media`,
`storage`, `recording`, `ai` and `documents` without showing any secret. Then run the frontend
(`cd frontend`, `npm run dev`); Vite proxies `/api` (including the WebSocket) to port 4000.

## Everyday commands

From `backend/api`:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the API with auto-reload |
| `npm run typecheck` | TypeScript check |
| `npm test` | All tests (unit + API) |
| `npm run test:unit` / `test:api` | Only unit tests (no database) / only API tests (needs Docker Postgres) |
| `npm run db:up` / `db:down` | Start / stop local Postgres |
| `npm run db:migrate` | Create a migration after editing `schema.prisma` (steward only) |
| `npm run db:deploy` / `db:seed` | Apply migrations / create the seed recruiter |
| `npm run contract:openapi` | Regenerate `contracts/openapi.yaml` (`-- --check` to verify) |

From `backend/services/document-service`: `.venv\Scripts\python -m pytest`.

API tests wipe `TEST_DATABASE_URL` before every test and refuse to run if it equals `DATABASE_URL`.
LiveKit, R2, Grok and the document service are replaced by in-memory fakes, so no keys are needed.

## Configuration rules

All settings are documented in [`api/.env.example`](api/.env.example).

- Every value is server-only. Never copy one into a frontend `VITE_` variable.
- A missing provider means "not configured", and its endpoints say so: LiveKit and R2 give
  `MEDIA_NOT_CONFIGURED` / `RECORDING_UNAVAILABLE`, Grok gives `PROVIDER_UNAVAILABLE`, and the
  document service gives `SERVICE_UNAVAILABLE`. No feature fakes success.
- `RECORDING_ENABLED=true` needs all LiveKit and R2 settings; `XAI_API_KEY` needs `XAI_MODEL`.
  The API refuses to start otherwise.
- LiveKit webhooks are signed with the LiveKit API key/secret. Point them at
  `https://<public-api-host>/api/webhooks/livekit/egress` (local development needs a tunnel; without
  webhooks the API asks LiveKit for recording status when recruiters view recordings).

## How it works

**Sign-in.** Recruiters use email + password (Argon2id). The session is a random token in an
HttpOnly, SameSite=Lax cookie (`hb_session`), and only its hash is stored. Five wrong passwords lock
the account for 15 minutes, and login is rate-limited. Candidates use an invitation code and a
6-digit access code; five wrong codes lock the invitation. Their session (`hb_candidate`, path
`/api`) reaches only that interview's candidate-safe data. Recruiters see only their own interviews
(admins see all), and anything else returns 404.

**Interview lifecycle** (PRD §8.1). Every status change goes through `transitionInterview` in
`src/services/interviews/stateMachine.ts`, which checks the allowed moves and only updates if the
interview is still in the expected state.

```
DRAFT → READY → ONBOARDING → IN_PROGRESS → COMPLETED → EVALUATING → EVALUATED → REVIEWED
                                                              ↘ EVALUATION_FAILED (retry → EVALUATING)
Any status before COMPLETED → CANCELLED (recruiter)
```

| Action | Allowed when | Effect |
| --- | --- | --- |
| Edit (`PATCH /interviews/:id`) | DRAFT | Omitted fields unchanged; `config` merged into the saved config |
| Delete (`DELETE /interviews/:id`) | DRAFT | Removes the draft and its questions |
| Mark ready | DRAFT | Locks questions, issues the invitation |
| Cancel (`POST /interviews/:id/cancel`) | before COMPLETED | Revokes candidate sessions and phone pairing, stops recording, keeps saved answers |

**Answers** are saved before the next question is shown. Each submission carries an idempotency
key, so a network retry never creates a duplicate. Skipped and unanswered questions are stored
separately and are never scored as zero. The time limit (`durationMinutes` plus
`INTERVIEW_GRACE_MINUTES`) is enforced on every candidate request, and a sweep every minute also ends
interviews whose candidate closed the tab.

**Resume upload** (`POST /interviews/:id/resume`, multipart field `resume`, PDF/DOCX up to 5 MB).
The file stays in memory, goes to the document service, and only the extracted text is kept. The
service checks the file's real content, not its name. A refused file is recorded on the resume as
`FAILED` with a reason: `PASSWORD_PROTECTED`, `CORRUPT_FILE`, `NO_TEXT` (for example a scanned PDF;
OCR is not installed) or `SERVICE_UNAVAILABLE`.

**AI questions** (`POST /interviews/:id/questions/generate`, PRD §8.2). Grok receives the job
description, skills, settings and extracted resume. It must return exactly the requested count
(default: the configured count, 10 unless changed) in the chosen categories, without duplicates; one
extra attempt is made, otherwise the API answers 503 and keeps the old questions. The result is saved
as the draft's questions (`source: AI_GENERATED`) for the recruiter to edit.

**AI evaluation** (`POST /interviews/:id/evaluate` → 202, PRD §8.3). A background job scores each
answered question 0–10 against its rubric. Quotes the model cites as evidence are kept only if they
really appear in the transcript. Repeating the request while it runs does nothing. A provider error
moves the interview to `EVALUATION_FAILED` (answers untouched) and it can be retried. Re-running
keeps a reviewer's override. Jobs cut off by a server restart are marked failed at start-up.

**Prompt safety.** Resume text, job descriptions and transcripts are passed to Grok inside
`<untrusted>` tags with an instruction never to follow them. The model is told to judge only
job-related skills, and its output must match a strict JSON schema.

**PDF export** (`GET /interviews/:id/export.pdf`): the same authorized data as the report page.

**Media and recordings.** One LiveKit room per interview, with short-lived, role-scoped tokens (laptop
publishes camera + mic, phone publishes camera only after a one-time QR pairing token, recruiters
watch hidden). Recording needs `RECORDING_ENABLED`, the recruiter's request and the candidate's
consent. LiveKit Egress writes one composite MP4 into the private R2 bucket; the recording becomes
READY only after the file is confirmed there. Playback URLs are signed for 5 minutes and never logged.

**Live updates.** Socket.IO at `/api/socket.io`, authenticated by the same cookies. See
[`contracts/events.md`](contracts/events.md).

## API contract

- `contracts/api-types.ts` holds the request, response and event types. `frontend/src/api/generated/contract.ts`
  must be an exact copy (a test fails otherwise; run `npm run sync:contract` in `frontend/`).
- `contracts/openapi.yaml` is generated from those types and `contracts/openapi.routes.ts`. A test
  fails if it is stale or if any served route is missing from the table.
- Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Known limitations

- Grok and LiveKit/R2 are tested with fakes and offline SDK checks, not against real accounts.
  The first run with real keys should be watched.
- No OCR: scanned PDFs are reported as `NO_TEXT`.
- PDF export uses built-in fonts, so characters outside Western European scripts show as `?`.
- Evaluation jobs run inside the API process (no external queue); a restart marks running jobs as failed.
- `PROCESSING_ANSWER` exists in the lifecycle but is unused, because answers save synchronously.
- Frontend gaps (workstreams A/B): no phone camera page (`/pair`), LiveKit video is not shown yet,
  the "Download PDF" button is behind `VITE_SERVER_PDF_EXPORT`, and pages do not use the live
  events yet (`frontend/src/api/client/realtime.ts` is ready but not wired in).
