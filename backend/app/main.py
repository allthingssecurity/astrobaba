from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import compute, analyze, chat
from .routers import shadbala
from .routers import geo
from .config import settings

app = FastAPI(title="Parasara Hora AI", version="0.1.0")

allow_origins = [o.strip() for o in settings.allow_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(compute.router, prefix="/api")
app.include_router(analyze.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(shadbala.router, prefix="/api")
app.include_router(geo.router, prefix="/api")
