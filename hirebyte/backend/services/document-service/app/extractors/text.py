import re


def normalize_text(raw: str) -> str:
    """Clean extracted text: drop NULs, unify newlines, collapse whitespace."""
    t = raw.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t\f\v\u00a0]+", " ", t)
    t = re.sub(r" ?\n ?", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()