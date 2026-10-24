"""File-type validation by extension AND content signature (never trust the extension alone)."""
import os

from app.errors import EMPTY_FILE, UNSUPPORTED_FILE_TYPE, ExtractionError

ALLOWED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx"}

MIME_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def detect_file_type(filename: str, data: bytes) -> str:
    """Return 'pdf' or 'docx', or raise ExtractionError."""
    if not data:
        raise ExtractionError(EMPTY_FILE, "The uploaded file is empty.", 422)

    ext = os.path.splitext(filename or "")[1].lower()
    file_type = ALLOWED_EXTENSIONS.get(ext)
    if file_type is None:
        raise ExtractionError(
            UNSUPPORTED_FILE_TYPE,
            "Unsupported file type. Please upload a PDF or DOCX file.",
            415,
        )

    # PDF spec allows the header anywhere in the first 1024 bytes.
    if file_type == "pdf":
        signature_ok = b"%PDF-" in data[:1024]
    else:  # DOCX is a ZIP container
        signature_ok = data[:4] == b"PK\x03\x04"

    if not signature_ok:
        raise ExtractionError(
            UNSUPPORTED_FILE_TYPE,
            "File content does not match its extension. Please upload a valid PDF or DOCX file.",
            415,
        )
    return file_type