import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.errors import INTERNAL_ERROR, VALIDATION_ERROR, ExtractionError
from app.routes import extract, health

settings = get_settings()  # fail fast on bad config
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("document-service")

app = FastAPI(title="HireByte Document Service", version="0.1.0")


def _error(request: Request, status: int, code: str, message: str) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or uuid.uuid4().hex
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "requestId": request_id}},
        headers={"X-Request-ID": request_id},
    )


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(ExtractionError)
async def extraction_error_handler(request: Request, exc: ExtractionError):
    # Log the code only - never file contents or extracted text (PII).
    log.info("extraction failed: %s", exc.code)
    return _error(request, exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return _error(request, 422, VALIDATION_ERROR, "Invalid request. A 'file' upload is required.")


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    log.exception("unhandled error")
    return _error(request, 500, INTERNAL_ERROR, "Unexpected error while processing the document.")


app.include_router(health.router)
app.include_router(extract.router)