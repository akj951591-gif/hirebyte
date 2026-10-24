"""Pydantic schemas. camelCase field names so the Node API consumes them as-is."""
from typing import List, Literal, Optional

from pydantic import BaseModel


class ExtractionResponse(BaseModel):
    filename: str
    fileType: Literal["pdf", "docx"]
    mimeType: str
    pageCount: Optional[int] = None   # None for DOCX (page count is not reliable)
    charCount: int
    text: str
    warnings: List[str] = []          # e.g. TEXT_TRUNCATED, LOW_TEXT_CONTENT


class ErrorBody(BaseModel):
    code: str
    message: str
    requestId: str


class ErrorResponse(BaseModel):
    error: ErrorBody