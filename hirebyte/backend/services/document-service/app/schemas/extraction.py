from pydantic import BaseModel, Field


class ExtractionResponse(BaseModel):
    text: str
    page_count: int = Field(serialization_alias="pageCount")
    char_count: int = Field(serialization_alias="charCount")
    truncated: bool
    warnings: list[str]


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    """Same shape as the Node API's errors (PRD §11.1)."""

    error: ErrorDetail
