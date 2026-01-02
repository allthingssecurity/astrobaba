from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class BirthInput(BaseModel):
    date: str = Field(..., description="YYYY-MM-DD")
    time: str = Field(..., description="HH:MM or HH:MM:SS")
    timezone: str | None = Field(None, description="Offset like +05:30; if missing will be derived from location")
    latitude: float | None = None
    longitude: float | None = None
    location: str | None = Field(None, description="Free-text place name, e.g., City, Country")
    ayanamsa: int = 1
    la: str = "en"

    def iso_datetime(self) -> str:
        if not self.timezone:
            raise ValueError("timezone missing")
        t = self.time if len(self.time.split(":")) == 3 else f"{self.time}:00"
        return f"{self.date}T{t}{self.timezone}"

    def coordinates(self) -> str:
        if self.latitude is None or self.longitude is None:
            raise ValueError("coordinates missing")
        return f"{self.latitude},{self.longitude}"


class ComputeRequest(BaseModel):
    birth: BirthInput
    include_divisional: List[str] = Field(default_factory=lambda: [
        "lagna", "navamsa", "drekkana", "chaturthamsa", "dasamsa", "saptamsa", "dwadasamsa", "shodasamsa", "vimsamsa",
    ])
    include_transits: bool = True
    transit_datetime: Optional[str] = None  # ISO if provided; defaults now


class ComputeResponse(BaseModel):
    kundli: Dict[str, Any]
    divisional: Dict[str, Any]
    transits: Optional[Dict[str, Any]] = None
    meta: Dict[str, Any]


class AnalyzeRequest(BaseModel):
    compute: ComputeResponse
    question: Optional[str] = None


class AnalyzeResponse(BaseModel):
    analysis: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: Optional[ComputeResponse] = None


class ChatResponse(BaseModel):
    reply: str
