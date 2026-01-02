from __future__ import annotations

from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone

from ..schemas import ComputeRequest, ComputeResponse
from ..utils.geo import geocode_location, timezone_for_coords
from ..providers.prokerala import AstrologyProvider


router = APIRouter(tags=["compute"])


@router.post("/compute", response_model=ComputeResponse)
def compute(payload: ComputeRequest):
    provider = AstrologyProvider()
    b = payload.birth
    # Autocomplete coords from free-text location if provided
    try:
        if (b.latitude is None or b.longitude is None) and b.location:
            geo = geocode_location(b.location)
            if not geo:
                raise HTTPException(status_code=400, detail="Could not geocode location")
            b.latitude = geo["latitude"]
            b.longitude = geo["longitude"]
            # If tzid provided by geocoder, compute offset locally
            tzid = geo.get("timezone") if isinstance(geo, dict) else None
            if (not b.timezone) and tzid:
                from ..utils.geo import offset_from_tzid
                off = offset_from_tzid(b.date, b.time, tzid) or None
                if off:
                    b.timezone = off
        # Derive timezone offset if missing and coords are available
        if (not b.timezone) and (b.latitude is not None and b.longitude is not None):
            tz = timezone_for_coords(b.latitude, b.longitude)
            if tz and tz.get("offset"):
                b.timezone = tz["offset"]
        # If still no timezone, fail fast to avoid wrong charts
        if not b.timezone:
            raise HTTPException(status_code=400, detail="timezone_unresolved: Unable to determine timezone offset. Please confirm location explicitly.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Location resolution failed: {e}")
    dt_iso = payload.transit_datetime or datetime.now(timezone.utc).isoformat()

    # Try advanced; on 403 (plan limit) fall back to basic kundli
    try:
        kundli = provider.kundli_advanced(b.coordinates(), b.iso_datetime(), ayanamsa=b.ayanamsa, la=b.la)
        advanced = True
    except Exception as e:
        # Detect httpx HTTPStatusError 403 and fallback
        msg = str(e)
        advanced = False
        try:
            kundli = provider.kundli_basic(b.coordinates(), b.iso_datetime(), ayanamsa=b.ayanamsa, la=b.la)
        except Exception:
            # If even basic fails, bubble original error
            raise

    divisional = {}
    for chart_type in payload.include_divisional:
        try:
            divisional[chart_type] = provider.divisional(b.coordinates(), b.iso_datetime(), chart_type, ayanamsa=b.ayanamsa, la=b.la)
        except Exception as e:
            # Continue others; report in meta
            divisional[chart_type] = {"error": str(e)}

    transits = None
    if payload.include_transits:
        try:
            transits = provider.transit_planet_position(b.coordinates(), dt_iso, ayanamsa=b.ayanamsa)
        except Exception as e:
            transits = {"error": str(e)}

    return ComputeResponse(
        kundli=kundli,
        divisional=divisional,
        transits=transits,
        meta={
            "provider": "prokerala",
            "ayanamsa": b.ayanamsa,
            "language": b.la,
            "advanced": advanced,
            "birth": {
                "date": b.date,
                "time": b.time if len(b.time.split(":")) == 3 else f"{b.time}:00",
                "timezone": b.timezone,
                "latitude": b.latitude,
                "longitude": b.longitude,
                "location": getattr(b, "location", None),
            },
            "effective_datetime": b.iso_datetime(),
        },
    )
