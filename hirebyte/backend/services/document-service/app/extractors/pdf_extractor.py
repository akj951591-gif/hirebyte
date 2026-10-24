from app.errors import FILE_CORRUPT, FILE_PASSWORD_PROTECTED, ExtractionError

from .types import RawExtraction


def _open_pdf(data: bytes):
    try:
        import pymupdf  # PyMuPDF >= 1.24.3
    except ImportError:  # pragma: no cover
        import fitz as pymupdf
    return pymupdf.open(stream=data, filetype="pdf")


def extract_pdf(data: bytes) -> RawExtraction:
    """Extract the text layer of a PDF with PyMuPDF (no OCR in this version)."""
    try:
        doc = _open_pdf(data)
    except Exception as exc:
        raise ExtractionError(
            FILE_CORRUPT, "The PDF file is corrupt or could not be opened.", 422
        ) from exc

    try:
        if doc.needs_pass:
            raise ExtractionError(
                FILE_PASSWORD_PROTECTED,
                "The PDF is password-protected. Please upload an unprotected copy.",
                422,
            )
        if doc.page_count == 0:
            raise ExtractionError(
                FILE_CORRUPT, "The PDF file has no readable pages.", 422
            )
        pages = [page.get_text("text") for page in doc]
        return RawExtraction(text="\n\n".join(pages), page_count=doc.page_count)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError(
            FILE_CORRUPT, "The PDF file is corrupt or could not be read.", 422
        ) from exc
    finally:
        doc.close()