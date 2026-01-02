from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any

from ..utils.geo import geocode_location, timezone_for_coords

router = APIRouter(tags=["geo"])


@router.get("/geo/resolve")
def resolve_location(q: str = Query(..., description="Free-text place name")) -> Dict[str, Any]:
    """Resolve a free-text location to coordinates + timezone offset.
    Returns a single best match with lat/lon, display_name, and offset (+HH:MM).
    """
    geo = geocode_location(q)
    if not geo:
        raise HTTPException(status_code=404, detail="no_match")
    lat = float(geo["latitude"])  # type: ignore
    lon = float(geo["longitude"])  # type: ignore
    tz = timezone_for_coords(lat, lon)
    if not tz or not tz.get("offset"):
        raise HTTPException(status_code=400, detail="timezone_unresolved")
    return {
        "display_name": geo.get("display_name") or q,
        "latitude": lat,
        "longitude": lon,
        "offset": tz["offset"],
        "timeZone": tz.get("timeZone"),
    }

