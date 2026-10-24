"""Optional OCR for scanned PDFs (PRD §3: optional Tesseract).

OCR is not installed in this prototype, so scanned PDFs are reported as NO_TEXT instead of guessing.
To add it: install Tesseract and `pytesseract`, render each page with PyMuPDF
(`page.get_pixmap(dpi=300)`), and return the recognised text here.
"""

from __future__ import annotations


def ocr_available() -> bool:
    return False


def ocr_pdf(data: bytes) -> str | None:  # noqa: ARG001 - kept for the future implementation
    """Text read from a scanned PDF, or None when OCR is not available."""
    return None
