"""HireByte document service: turns resume / job-description files into plain text (PRD §3).

Run: uvicorn app.main:app --port 8001   (from backend/services/document-service)
Only the Node API calls this service; it stores nothing and keeps no interview state.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .extractors import ExtractionError
from .routes import extract, health

logger = logging.getLogger("document-service")

app = FastAPI(title="HireByte document service", version="0.1.0", docs_url=None, redoc_url=None)
app.include_router(health.router)
app.include_router(extract.router)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.exception_handler(ExtractionError)
async def extraction_error(_: Request, exc: ExtractionError) -> JSONResponse:
    # Log the code only: never document contents or file names (PRD §13).
    logger.info("extraction refused: %s", exc.code)
    return _error(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return _error(400, "VALIDATION_ERROR", "Send the document as multipart form field 'file'.")


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logger.error("unexpected extraction failure: %s", type(exc).__name__)
    return _error(500, "INTERNAL_ERROR", "The document could not be processed.")
