from tests.conftest import DOCX_MIME, make_docx, make_pdf


def post(client, name, data, mime="application/octet-stream"):
    return client.post("/extract", files={"file": (name, data, mime)})


def assert_error(res, status, code):
    assert res.status_code == status, res.text
    body = res.json()
    assert set(body.keys()) == {"error"}
    assert body["error"]["code"] == code
    assert body["error"]["message"]
    assert body["error"]["requestId"]


# ---------- success paths ----------

def test_docx_success_paragraphs_and_table(client):
    data = make_docx(
        paragraphs=["Jane Doe - Senior Software Engineer. Built distributed systems in Go and Python."],
        table_rows=[["Skill", "Years"], ["Python", "6"]],
    )
    res = post(client, "resume.docx", data, DOCX_MIME)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["fileType"] == "docx"
    assert body["mimeType"] == DOCX_MIME
    assert body["pageCount"] is None
    assert "Jane Doe" in body["text"]
    assert "Python | 6" in body["text"]
    assert body["charCount"] == len(body["text"])


def test_pdf_success_multi_page(client):
    data = make_pdf(["Page one: backend engineer with Node.js experience.",
                     "Page two: led a team of five engineers."])
    res = post(client, "resume.pdf", data, "application/pdf")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["fileType"] == "pdf"
    assert body["pageCount"] == 2
    assert "Node.js" in body["text"]
    assert "team of five" in body["text"]


def test_uppercase_extension_accepted(client):
    data = make_pdf(["A reasonably long line of resume text for the extractor to read."])
    assert post(client, "RESUME.PDF", data).status_code == 200


def test_text_truncated_warning(client, monkeypatch):
    monkeypatch.setenv("DOC_MAX_TEXT_CHARS", "60")
    data = make_docx(paragraphs=["word " * 100])
    res = post(client, "long.docx", data, DOCX_MIME)
    assert res.status_code == 200
    body = res.json()
    assert "TEXT_TRUNCATED" in body["warnings"]
    assert body["charCount"] <= 60


def test_low_text_warning(client):
    res = post(client, "tiny.docx", make_docx(paragraphs=["Hi there"]), DOCX_MIME)
    assert res.status_code == 200
    assert "LOW_TEXT_CONTENT" in res.json()["warnings"]


# ---------- failure paths (PRD section 14) ----------

def test_scanned_pdf_has_no_extractable_text(client):
    res = post(client, "scan.pdf", make_pdf([""]), "application/pdf")
    assert_error(res, 422, "NO_EXTRACTABLE_TEXT")


def test_empty_docx_has_no_extractable_text(client):
    res = post(client, "blank.docx", make_docx(), DOCX_MIME)
    assert_error(res, 422, "NO_EXTRACTABLE_TEXT")


def test_password_protected_pdf(client):
    data = make_pdf(["Secret resume content that should not be readable."], encrypt_with="hunter2")
    res = post(client, "locked.pdf", data, "application/pdf")
    assert_error(res, 422, "FILE_PASSWORD_PROTECTED")


def test_corrupt_pdf(client):
    res = post(client, "bad.pdf", b"%PDF-1.4\nthis is not a real pdf body", "application/pdf")
    assert_error(res, 422, "FILE_CORRUPT")


def test_corrupt_docx(client):
    res = post(client, "bad.docx", b"PK\x03\x04 definitely not a zip archive", DOCX_MIME)
    assert_error(res, 422, "FILE_CORRUPT")


def test_unsupported_extension(client):
    res = post(client, "resume.txt", b"plain text resume", "text/plain")
    assert_error(res, 415, "UNSUPPORTED_FILE_TYPE")


def test_extension_content_mismatch(client):
    # A text file renamed to .pdf must not be trusted.
    res = post(client, "fake.pdf", b"just some text pretending to be a pdf", "application/pdf")
    assert_error(res, 415, "UNSUPPORTED_FILE_TYPE")


def test_empty_file(client):
    res = post(client, "empty.pdf", b"", "application/pdf")
    assert_error(res, 422, "EMPTY_FILE")


def test_file_too_large(client, monkeypatch):
    monkeypatch.setenv("DOC_MAX_UPLOAD_MB", "0.001")  # ~1 KB
    data = make_docx(paragraphs=["x" * 5000])
    res = post(client, "big.docx", data, DOCX_MIME)
    assert_error(res, 413, "FILE_TOO_LARGE")


def test_missing_file_field_uses_standard_error_shape(client):
    res = client.post("/extract")
    assert_error(res, 422, "VALIDATION_ERROR")


def test_error_does_not_leak_file_content(client):
    secret = "TOP-SECRET-CANDIDATE-DATA"
    res = post(client, "bad.pdf", f"%PDF-1.4 {secret}".encode(), "application/pdf")
    assert secret not in res.text