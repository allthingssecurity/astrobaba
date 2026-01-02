from __future__ import annotations

from typing import Optional, Dict, Any, Tuple
import httpx
from ..config import settings  # type: ignore
from datetime import datetime
try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None  # type: ignore

_GEO_CACHE: Dict[str, Tuple[float, float, str]] = {}
_TZ_CACHE: Dict[str, Tuple[str, str]] = {}

def format_offset(seconds: int) -> str:
    sign = '+' if seconds >= 0 else '-'
    sec = abs(int(seconds))
    hh = sec // 3600
    mm = (sec % 3600) // 60
    return f"{sign}{hh:02d}:{mm:02d}"


def geocode_location(location: str) -> Optional[Dict[str, Any]]:
    # Preferred: LocationIQ if key available (better reliability)
    if settings.locationiq_key:
        try:
            r = httpx.get(
                "https://us1.locationiq.com/v1/search",
                params={
                    "key": settings.locationiq_key,
                    "q": location,
                    "format": "json",
                    "limit": 1,
                },
                timeout=20,
            )
            r.raise_for_status()
            arr = r.json()
            if arr:
                item = arr[0]
                out = {
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                    "display_name": item.get("display_name"),
                }
                _GEO_CACHE[location] = (out["latitude"], out["longitude"], out.get("display_name") or location)
                return out
        except httpx.HTTPError:
            pass
    if location in _GEO_CACHE:
        lat, lon, name = _GEO_CACHE[location]
        return {"latitude": lat, "longitude": lon, "display_name": name}
    # Try OpenStreetMap Nominatim first (requires a valid UA per usage policy)
    headers = {
        "User-Agent": "parasara-hora-ai/0.1 (+https://allthingssecurity.github.io; contact: admin@allthingssecurity.github.io)",
    }
    params = {
        "q": location,
        "format": "json",
        "addressdetails": 1,
        "limit": 1,
    }
    try:
        with httpx.Client(timeout=20, headers=headers) as client:
            r = client.get("https://nominatim.openstreetmap.org/search", params=params)
            r.raise_for_status()
            arr = r.json()
            if arr:
                item = arr[0]
                res = {
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                    "display_name": item.get("display_name"),
                }
                _GEO_CACHE[location] = (res["latitude"], res["longitude"], res.get("display_name") or location)
                return res
    except httpx.HTTPError:
        pass

    # Fallback: Open-Meteo Geocoding API (no key required)
    try:
        r = httpx.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": location, "count": 1},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        if data and data.get("results"):
            item = data["results"][0]
            out: Dict[str, Any] = {
                "latitude": float(item["latitude"]),
                "longitude": float(item["longitude"]),
                "display_name": item.get("name"),
            }
            if item.get("timezone"):
                out["timezone"] = item.get("timezone")
            _GEO_CACHE[location] = (out["latitude"], out["longitude"], out.get("display_name") or location)
            return out
    except httpx.HTTPError:
        pass
    return None


def offset_from_tzid(date_str: str, time_str: str, tzid: str) -> Optional[str]:
    if ZoneInfo is None:
        return None
    t = time_str if len(time_str.split(":")) == 3 else f"{time_str}:00"
    try:
        dt = datetime.fromisoformat(f"{date_str}T{t}")
        tz = ZoneInfo(tzid)
        aware = dt.replace(tzinfo=tz)
        off = aware.utcoffset()
        if off is None:
            return None
        return format_offset(int(off.total_seconds()))
    except Exception:
        return None


def timezone_for_coords(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    key = f"{lat:.6f},{lon:.6f}"
    if key in _TZ_CACHE:
        tzid, off = _TZ_CACHE[key]
        return {"timeZone": tzid, "offset": off}
    # 1) LocationIQ Timezone (authoritative, if key present)
    if settings.locationiq_key:
        try:
            r = httpx.get(
                "https://us1.locationiq.com/v1/timezone.php",
                params={
                    "key": settings.locationiq_key,
                    "lat": lat,
                    "lon": lon,
                    "format": "json",
                },
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()
            # Examples fields: 'timezone': {'name': 'Asia/Kolkata'}, 'utc_offset': '+05:30', or gmt_offset seconds
            tz = None
            off = None
            tz = data.get("timezone") or data.get("zone_name") or data.get("timeZone")
            if isinstance(tz, dict):
                tz = tz.get("name") or tz.get("zone_name")
            off = data.get("utc_offset") or data.get("offset")
            if off is None:
                # Try seconds based offsets
                sec = data.get("gmt_offset") or data.get("raw_offset")
                if isinstance(sec, (int, float)):
                    off = format_offset(int(sec))
            if tz and off:
                _TZ_CACHE[key] = (tz, off)
                return {"timeZone": tz, "offset": off}
        except httpx.HTTPError:
            pass
    # timeapi.io free endpoint
    try:
        r = httpx.get(
            "https://timeapi.io/api/TimeZone/coordinate",
            params={"latitude": lat, "longitude": lon},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        tz = data.get("timeZone")
        offset_sec = data.get("standardUtcOffset", {}).get("seconds")
        if tz and offset_sec is not None:
            off = format_offset(int(offset_sec))
            _TZ_CACHE[key] = (tz, off)
            return {"timeZone": tz, "offset": off}
        offset_sec = data.get("currentUtcOffset", {}).get("seconds")
        if tz and offset_sec is not None:
            off = format_offset(int(offset_sec))
            _TZ_CACHE[key] = (tz, off)
            return {"timeZone": tz, "offset": off}
    except httpx.HTTPError:
        pass
    # Fallback: Open‑Meteo timezone endpoint
    try:
        r = httpx.get(
            "https://api.open-meteo.com/v1/timezone",
            params={"latitude": lat, "longitude": lon},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        tz = data.get("timezone")
        offset_sec = data.get("utc_offset_seconds")
        if tz and offset_sec is not None:
            off = format_offset(int(offset_sec))
            _TZ_CACHE[key] = (tz, off)
            return {"timeZone": tz, "offset": off}
    except httpx.HTTPError:
        pass
    # Secondary fallback: use tzid from Open‑Meteo geocode if available
    try:
        r = httpx.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": f"{lat},{lon}", "count": 1},
            timeout=20,
        )
        if r.status_code == 200:
            data = r.json()
            if data and data.get("results"):
                tz = data["results"][0].get("timezone")
                if tz:
                    # Best effort: India has +05:30; for general case, fallback to +00:00 if offset unknown
                    off = "+05:30" if tz == "Asia/Kolkata" else None
                    if not off:
                        # Try to compute offset at current time using zoneinfo if available
                        try:
                            from datetime import datetime
                            from zoneinfo import ZoneInfo  # type: ignore
                            aware = datetime.now(ZoneInfo(tz))
                            sec = int(aware.utcoffset().total_seconds())  # type: ignore
                            off = format_offset(sec)
                        except Exception:
                            off = "+00:00"
                    _TZ_CACHE[key] = (tz, off)
                    return {"timeZone": tz, "offset": off}
    except httpx.HTTPError:
        pass
    # Country-specific hardening: India footprint → IST
    try:
        if 6.0 <= float(lat) <= 37.5 and 68.0 <= float(lon) <= 98.0:
            tz = "Asia/Kolkata"; off = "+05:30"
            _TZ_CACHE[key] = (tz, off)
            return {"timeZone": tz, "offset": off}
    except Exception:
        pass
    return None
