from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class RawExtraction:
    text: str
    page_count: Optional[int] = None
    warnings: List[str] = field(default_factory=list)


@dataclass
class ExtractionOutcome:
    filename: str
    file_type: str
    mime_type: str
    page_count: Optional[int]
    text: str
    warnings: List[str]