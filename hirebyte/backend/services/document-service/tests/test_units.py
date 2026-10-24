import pytest

from app.errors import ExtractionError
from app.extractors.text import normalize_text
from app.extractors.validation import detect_file_type


def test_normalize_collapses_whitespace_and_newlines():
    raw = "Hello   world\r\n\r\n\r\n\r\nNext\tline \x00end  "
    assert normalize_text(raw) == "Hello world\n\nNext line end"


def test_normalize_empty():
    assert normalize_text("   \n\n  ") == ""


@pytest.mark.parametrize("name,data,expected", [
    ("a.pdf", b"%PDF-1.7 ...", "pdf"),
    ("a.docx", b"PK\x03\x04rest", "docx"),
])
def test_detect_ok(name, data, expected):
    assert detect_file_type(name, data) == expected


@pytest.mark.parametrize("name,data,code", [
    ("a.pdf", b"", "EMPTY_FILE"),
    ("a.exe", b"MZ....", "UNSUPPORTED_FILE_TYPE"),
    ("a", b"%PDF-1.7", "UNSUPPORTED_FILE_TYPE"),
    ("a.pdf", b"PK\x03\x04", "UNSUPPORTED_FILE_TYPE"),
    ("a.docx", b"%PDF-1.7", "UNSUPPORTED_FILE_TYPE"),
])
def test_detect_rejects(name, data, code):
    with pytest.raises(ExtractionError) as exc:
        detect_file_type(name, data)
    assert exc.value.code == code