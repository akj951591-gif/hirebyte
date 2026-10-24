"""Domain errors. No framework imports here so extractors stay unit-testable."""


class ExtractionError(Exception):
    """A known, user-safe extraction failure mapped to the standard error shape."""

    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


# Error codes (keep in sync with backend/contracts/openapi.yaml once published)
UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE"          # 415
FILE_TOO_LARGE = "FILE_TOO_LARGE"                        # 413
EMPTY_FILE = "EMPTY_FILE"                                # 422
FILE_CORRUPT = "FILE_CORRUPT"                            # 422
FILE_PASSWORD_PROTECTED = "FILE_PASSWORD_PROTECTED"      # 422
NO_EXTRACTABLE_TEXT = "NO_EXTRACTABLE_TEXT"              # 422
VALIDATION_ERROR = "VALIDATION_ERROR"                    # 422
INTERNAL_ERROR = "EXTRACTION_INTERNAL_ERROR"             # 500