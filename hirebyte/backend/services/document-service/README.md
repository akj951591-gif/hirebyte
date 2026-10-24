# Document Service (Workstream E)

FastAPI service that extracts text from resume / JD files (PDF, DOCX).
It owns **no** interview state. Only the Node API calls it (via `DOCUMENT_SERVICE_URL`).

## Setup

```bash
cd backend/services/document-service
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8001
```
Set `DOCUMENT_SERVICE_URL=http://localhost:8001` in the Node API `.env`.

## Test

```bash
pytest -v
```

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/extract` | multipart field `file` (.pdf / .docx) -> extracted text |

Success (200):
```json
{ "filename": "resume.pdf", "fileType": "pdf", "mimeType": "application/pdf",
  "pageCount": 2, "charCount": 1834, "text": "...", "warnings": [] }
```

Errors use the standard shape `{ "error": { "code", "message", "requestId" } }`:

| Code | HTTP | Meaning |
|---|---|---|
| UNSUPPORTED_FILE_TYPE | 415 | Wrong extension, or content doesn't match extension |
| FILE_TOO_LARGE | 413 | Over `DOC_MAX_UPLOAD_MB` |
| EMPTY_FILE | 422 | Zero bytes |
| FILE_CORRUPT | 422 | Cannot be parsed |
| FILE_PASSWORD_PROTECTED | 422 | Encrypted PDF |
| NO_EXTRACTABLE_TEXT | 422 | Scanned/image-only PDF or empty DOCX |
| VALIDATION_ERROR | 422 | Missing `file` field |
| EXTRACTION_INTERNAL_ERROR | 500 | Unexpected failure (no details leaked) |

## Config (env)

| Variable | Default | Purpose |
|---|---|---|
| `DOC_MAX_UPLOAD_MB` | 5 | Max upload size |
| `DOC_MAX_TEXT_CHARS` | 100000 | Extracted text cap (adds `TEXT_TRUNCATED` warning) |
| `LOG_LEVEL` | info | Logging level |

## Known limitations
- No OCR yet: scanned PDFs return `NO_EXTRACTABLE_TEXT`. (Optional Tesseract OCR is a later add-on.)
- DOCX `pageCount` is `null` (not reliable without rendering).
- Legacy `.doc` is not supported.