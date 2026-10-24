"""Single entry point used by the route: validate -> extract -> normalize -> cap."""
from app.errors import NO_EXTRACTABLE_TEXT, ExtractionError

from .docx_extractor import extract_docx
from .pdf_extractor import extract_pdf
from .text import normalize_text
from .types import ExtractionOutcome
from .validation import MIME_TYPES, detect_file_type

LOW_TEXT_THRESHOLD = 50  # chars; below this we warn the recruiter


def extract_document(filename: str, data: bytes, max_chars: int) -> ExtractionOutcome:
    file_type = detect_file_type(filename, data)
    raw = extract_pdf(data) if file_type == "pdf" else extract_docx(data)

    text = normalize_text(raw.text)
    if not text:
        if file_type == "pdf":
            msg = (
                "No extractable text found. This PDF looks like a scanned image. "
                "Upload a text-based PDF or DOCX (OCR is not enabled)."
            )
        else:
            msg = "The DOCX contains no extractable text."
        raise ExtractionError(NO_EXTRACTABLE_TEXT, msg, 422)

    warnings = list(raw.warnings)
    if len(text) > max_chars:
        text = text[:max_chars].rstrip()
        warnings.append("TEXT_TRUNCATED")
    if len(text) < LOW_TEXT_THRESHOLD:
        warnings.append("LOW_TEXT_CONTENT")

    return ExtractionOutcome(
        filename=filename,
        file_type=file_type,
        mime_type=MIME_TYPES[file_type],
        page_count=raw.page_count,
        text=text,
        warnings=warnings,
    )