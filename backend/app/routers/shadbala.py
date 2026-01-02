from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from io import BytesIO
from typing import Dict, Any, List
from pdfminer.high_level import extract_text

from ..providers.prokerala import AstrologyProvider
from ..schemas import BirthInput

router = APIRouter(tags=["shadbala"])


class ShadbalaRequest(BirthInput):
    name: str
    gender: str = "male"
    place: str | None = None


@router.post("/shadbala/pdf")
def shadbala_pdf(payload: ShadbalaRequest):
    if not payload.location and (payload.latitude is None or payload.longitude is None):
        raise HTTPException(status_code=400, detail="location or coordinates required")
    provider = AstrologyProvider()
    try:
        pdf = provider.shadbala_pdf(
            first_name=payload.name,
            gender=payload.gender,
            coordinates=f"{payload.latitude},{payload.longitude}",
            dt_iso=payload.iso_datetime(),
            place=payload.place or payload.location or "",
            la=payload.la,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return StreamingResponse(BytesIO(pdf), media_type="application/pdf")


def _parse_shadbala_text(txt: str) -> List[Dict[str, Any]]:
    # naive parser: look for lines like "Sun 6.5" etc.
    planets = ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn"]
    results: List[Dict[str,Any]] = []
    for line in txt.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        name = parts[0].capitalize()
        if name in planets:
            # find first number token
            score = None
            for token in parts[1:]:
                try:
                    score = float(token)
                    break
                except ValueError:
                    continue
            if score is not None:
                results.append({"planet": name, "score": score})
    return results


@router.post("/shadbala/json")
def shadbala_json(payload: ShadbalaRequest):
    if not payload.location and (payload.latitude is None or payload.longitude is None):
        raise HTTPException(status_code=400, detail="location or coordinates required")
    provider = AstrologyProvider()
    try:
        pdf = provider.shadbala_pdf(
            first_name=payload.name,
            gender=payload.gender,
            coordinates=f"{payload.latitude},{payload.longitude}",
            dt_iso=payload.iso_datetime(),
            place=payload.place or payload.location or "",
            la=payload.la,
        )
        text = extract_text(BytesIO(pdf))
        data = _parse_shadbala_text(text)
        return JSONResponse({"shadbala": data})
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
