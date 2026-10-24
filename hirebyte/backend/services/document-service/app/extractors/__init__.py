"""Resume / job-description text extraction. The service only extracts text; it never owns interview state."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_CHARS = 50_000


class ExtractionError(Exception):
    """A document that cannot be turned into text. `code` is stable and safe to show to clients."""

    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass
class ExtractedText:
    text: str
    page_count: int
    truncated: bool = False
    warnings: list[str] = field(default_factory=list)


def clean_text(raw: str) -> tuple[str, bool]:
    """Collapse runs of spaces, keep paragraph breaks, and cap the length."""
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in raw.replace("\r\n", "\n").split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS], True
    return text, False


def detect_kind(data: bytes, filename: str) -> str:
    """Decide by content (magic bytes), using the extension only to tell DOCX apart from other ZIPs."""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04") and filename.lower().endswith(".docx"):
        return "docx"
    raise ExtractionError("UNSUPPORTED_TYPE", "Upload a PDF or DOCX file.", status=415)


def extract(data: bytes, filename: str) -> ExtractedText:
    from .docx_extractor import extract_docx
    from .pdf_extractor import extract_pdf

    if not data:
        raise ExtractionError("EMPTY_FILE", "The file is empty.", status=400)
    kind = detect_kind(data, filename)
    return extract_pdf(data) if kind == "pdf" else extract_docx(data)
