import io
import zipfile

from docx import Document
from docx.opc.exceptions import PackageNotFoundError
from docx.table import Table
from docx.text.paragraph import Paragraph

from app.errors import FILE_CORRUPT, ExtractionError

from .types import RawExtraction


def extract_docx(data: bytes) -> RawExtraction:
    """Extract text from a DOCX in document order (paragraphs and tables)."""
    try:
        doc = Document(io.BytesIO(data))
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError, ValueError) as exc:
        raise ExtractionError(
            FILE_CORRUPT, "The DOCX file is corrupt or not a valid Word document.", 422
        ) from exc

    lines = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            lines.append(Paragraph(child, doc).text)
        elif tag == "tbl":
            table = Table(child, doc)
            for row in table.rows:
                cells, seen = [], set()
                for cell in row.cells:
                    if id(cell._tc) in seen:  # merged cells repeat the same cell
                        continue
                    seen.add(id(cell._tc))
                    value = cell.text.strip()
                    if value:
                        cells.append(value)
                if cells:
                    lines.append(" | ".join(cells))

    return RawExtraction(text="\n".join(lines), page_count=None)