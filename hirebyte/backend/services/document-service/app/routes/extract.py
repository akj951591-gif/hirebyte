from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, File, Header, UploadFile
from starlette.concurrency import run_in_threadpool

from ..extractors import ExtractionError, extract
from ..schemas.extraction import ExtractionResponse

MAX_BYTES = int(os.getenv("DOCUMENT_MAX_BYTES", str(5 * 1024 * 1024)))

router = APIRouter()


def _check_token(provided: str | None) -> None:
    """Only the Node API should call this service. When a token is configured, require it."""
    expected = os.getenv("DOCUMENT_SERVICE_TOKEN", "")
    if expected and not hmac.compare_digest(provided or "", expected):
        raise ExtractionError("UNAUTHENTICATED", "Missing or invalid service token.", status=401)


@router.post("/extract", response_model=ExtractionResponse, response_model_by_alias=True)
async def extract_document(
    file: UploadFile = File(...),
    x_service_token: str | None = Header(default=None),
) -> ExtractionResponse:
    _check_token(x_service_token)
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ExtractionError("FILE_TOO_LARGE", f"The file is larger than {MAX_BYTES // (1024 * 1024)} MB.", status=413)
    # PDF parsing is CPU-bound; keep the event loop free for other requests.
    result = await run_in_threadpool(extract, data, file.filename or "")
    return ExtractionResponse(
        text=result.text,
        page_count=result.page_count,
        char_count=len(result.text),
        truncated=result.truncated,
        warnings=result.warnings,
    )
