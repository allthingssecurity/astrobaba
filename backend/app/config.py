from pydantic import BaseModel
import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


class Settings(BaseModel):
    prokerala_client_id: str | None = os.getenv("PROKERALA_CLIENT_ID")
    prokerala_client_secret: str | None = os.getenv("PROKERALA_CLIENT_SECRET")
    prokerala_base_url: str = os.getenv("PROKERALA_BASE_URL", "https://api.prokerala.com/v2")
    allow_origins: str = os.getenv("ALLOW_ORIGINS", "*")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    locationiq_key: str | None = os.getenv("LOCATIONIQ_KEY")


settings = Settings()
