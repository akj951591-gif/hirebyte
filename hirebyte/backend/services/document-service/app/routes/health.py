from fastapi import APIRouter

from ..extractors.ocr_extractor import ocr_available

router = APIRouter()


@router.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "ocr": ocr_available()}
