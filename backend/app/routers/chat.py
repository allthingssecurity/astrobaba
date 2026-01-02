from __future__ import annotations

from fastapi import APIRouter, HTTPException
from ..schemas import ChatRequest, ChatResponse
from ..config import settings

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None  # type: ignore


router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest):
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OpenAI key not configured")
    if OpenAI is None:
        raise HTTPException(status_code=500, detail="OpenAI SDK unavailable")

    client = OpenAI(api_key=settings.openai_api_key)

    system = (
        "You are an expert Vedic astrologer assistant. Answer the user's question using the provided context when available. "
        "Keep answers grounded in the chart data and avoid making health/financial guarantees."
    )
    messages = [
        {"role": "system", "content": system},
    ]
    if payload.context:
        messages.append({"role": "user", "content": f"Context: {payload.context.model_dump()}"})
    messages.append({"role": "user", "content": payload.message})

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.7,
    )
    text = completion.choices[0].message.content
    return ChatResponse(reply=text or "")

