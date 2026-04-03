from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BRIDGE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    lc0_host: str = "127.0.0.1"
    lc0_port: int = 3187
    lc0_engine_path: str = "lc0"
    lc0_config_path: str = str(BRIDGE_DIR / "lc0.config")
    lc0_default_mode: str = "classic"
    lc0_ready_timeout_ms: int = 10000
    lc0_search_timeout_ms: int = 10000
    lc0_default_movetime_s: float = 0.5
    lc0_api_token: str = ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
