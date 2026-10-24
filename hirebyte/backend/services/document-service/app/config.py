"""Runtime settings for the document service, read from environment variables.

Read on each call (not cached) so tests can override via monkeypatch.setenv.
Invalid values raise at startup (main.py calls get_settings() once on boot).
"""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    max_upload_bytes: int
    max_text_chars: int
    log_level: str


def get_settings() -> Settings:
    try:
        max_mb = float(os.getenv("DOC_MAX_UPLOAD_MB", "5"))
        max_chars = int(os.getenv("DOC_MAX_TEXT_CHARS", "100000"))
    except ValueError as exc:
        raise RuntimeError(f"Invalid document-service configuration: {exc}") from exc
    if max_mb <= 0 or max_chars <= 0:
        raise RuntimeError("DOC_MAX_UPLOAD_MB and DOC_MAX_TEXT_CHARS must be positive")
    return Settings(
        max_upload_bytes=int(max_mb * 1024 * 1024),
        max_text_chars=max_chars,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )