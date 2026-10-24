from __future__ import annotations

import pymupdf

from . import ExtractedText, ExtractionError, clean_text
from .ocr_extractor import ocr_pdf

# Fewer visible characters than this per page means a scanned (image-only) PDF; real pages have hundreds.
MIN_CHARS_PER_PAGE = 10


def extract_pdf(data: bytes) -> ExtractedText:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises FileDataError and friends for damaged files.
        raise ExtractionError("CORRUPT_FILE", "This PDF is damaged or not a real PDF.") from exc

    with doc:
        if doc.needs_pass:
            raise ExtractionError("PASSWORD_PROTECTED", "This PDF is password-protected. Upload a version without a password.")
        if doc.page_count == 0:
            raise ExtractionError("NO_TEXT", "This PDF has no pages.")
        raw = "\n\n".join(page.get_text("text") for page in doc)
        page_count = doc.page_count

    text, truncated = clean_text(raw)
    warnings: list[str] = []
    visible_chars = len("".join(raw.split()))
    if visible_chars < MIN_CHARS_PER_PAGE * page_count:
        scanned = ocr_pdf(data)
        if scanned is None:
            raise ExtractionError(
                "NO_TEXT",
                "This PDF looks scanned and has no selectable text. Upload a text-based PDF or a DOCX file.",
            )
        text, truncated = clean_text(scanned)
        warnings.append("Text was read with OCR and may contain mistakes.")
    if truncated:
        warnings.append("The document was long, so only the beginning was kept.")
    return ExtractedText(text=text, page_count=page_count, truncated=truncated, warnings=warnings)
