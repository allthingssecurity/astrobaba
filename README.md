# Parasara Hora AI (Scaffold)

A starter backend to build a Vedic astrology app that computes divisional charts (D1–D9), Shadbala, transits, Vimshottari Dasha/Antardasha, and detects yogas from free or free‑tier APIs; plus analysis via OpenAI and a follow‑up Q&A chat.

This scaffold focuses on:
- Clean provider abstraction for plugging different astrology data sources
- Clear endpoints for compute, analyze, and conversational Q&A
- Safe schema and prompts so you can iterate quickly

You can add a web UI (Next.js/React/Flutter) later against the provided API.

## Stack
- Backend: FastAPI (Python)
- HTTP: httpx
- AI: OpenAI API (optional, for analysis + chat)

## Endpoints (summary)
- `POST /api/compute` — given DOB, time, location; returns structured charts, dasha, shadbala, yogas, transits (provider-backed; mock by default)
- `POST /api/analyze` — runs OpenAI analysis over compute payload to produce human‑readable reading
- `POST /api/chat` — follow‑up Q&A with conversation state keyed by `session_id`

## Provider strategy
This project integrates Prokerala Astrology API v2 for real data. You can add more providers under `backend/app/providers/` if needed.

## Getting started
1) Python 3.10+ recommended.
2) Create a virtualenv and install deps:
```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
3) Copy `.env.example` to `.env` and set keys as needed. OpenAI is optional but required for `/api/analyze` and `/api/chat`.
4) Run the API:
```
uvicorn app.main:app --reload
```
5) Open docs at http://127.0.0.1:8000/docs

### Sample request
POST http://127.0.0.1:8000/api/compute
```
{
  "birth": {
    "date": "1990-05-10",
    "time": "14:25:00",
    "timezone": "+05:30",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "ayanamsa": 1,
    "la": "en"
  },
  "include_divisional": ["lagna", "navamsa", "drekkana", "dasamsa"],
  "include_transits": true
}
```

The response includes `kundli` (advanced; with yogas + dasha), `divisional` entries for each requested chart, and `transits`.

## Data model (high level)
- Input: birth `date`, `time`, `timezone`, `latitude`, `longitude`, plus optional `ayanamsa` and computation `settings`.
- Output: 
  - `charts`: D1–D9 divisional placements (signs, lord, degrees, houses)
  - `shadbala`: via PDF report module (see Notes)
  - `dasha`: Vimshottari dasha tree with start/end times; antardasha nested
  - `transits`: current transits vs natal (aspects, houses)
  - `yogas`: detected yogas with criteria flags
  - `meta`: provider + ayanamsa + computation metadata

## OpenAI analysis
- `POST /api/analyze` accepts the same compute payload and returns a structured, comprehensive reading covering houses, strengths, yogas, dasha highlights, and transits.
- `POST /api/chat` enables follow‑ups grounded in the computed chart. Provide a `session_id` to keep context.

## Roadmap to full fidelity
- Implement precise D1–D9 computation and ayanamsa alignment if doing local math.
- Flesh out `yogas.py` rules (e.g., Pancha Maha Purusha, Gaja Kesari, Neecha Bhanga, Parivartana, Raj/Lakshmi yogas).
- Expand dasha support: conditional systems (e.g., Jaimini) if desired.
- Add caching and persistence (e.g., Postgres/SQLite) for charts and chat sessions.
- Add a frontend: show divisional chart wheels, tables, and an AI chat panel.

## Notes
- Prokerala shadbala numeric scores are available in the Personal Reading PDF module (`/v2/report/personal-reading/instant` with module `shadbala-table`). The JSON API does not expose shadbala at this time; you can return the PDF as a file or base64 from a dedicated endpoint if required.
- Transit endpoints under Western section support `ayanamsa` to get sidereal positions; we pass Lahiri (`ayanamsa=1`) by default to align with Vedic.
- Be mindful of API rate limits and data licensing.
