from fastapi import APIRouter, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.config import get_settings
from app.errors import FILE_TOO_LARGE, ExtractionError
from app.extractors import extract_document
from app.schemas import ExtractionResponse

router = APIRouter()


@router.post("/extract", response_model=ExtractionResponse)
async def extract(file: UploadFile = File(...)):
    settings = get_settings()
    # Read at most limit+1 bytes so oversized uploads are rejected without loading everything.
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        limit_mb = settings.max_upload_bytes / (1024 * 1024)
        raise ExtractionError(
            FILE_TOO_LARGE, f"File exceeds the {limit_mb:g} MB size limit.", 413
        )

    # PyMuPDF / python-docx are blocking; keep the event loop free.
    outcome = await run_in_threadpool(
        extract_document, file.filename or "", data, settings.max_text_chars
    )
    return ExtractionResponse(
        filename=outcome.filename,
        fileType=outcome.file_type,
        mimeType=outcome.mime_type,
        pageCount=outcome.page_count,
        charCount=len(outcome.text),
        text=outcome.text,
        warnings=outcome.warnings,
    )