import os
from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # When DATA_DIR is set (desktop sidecar launch), never read a stray .env
    # file from the working directory — every setting must come from the
    # explicit env vars the Electron shell passes in.
    model_config = SettingsConfigDict(
        env_file=None if os.environ.get("DATA_DIR") else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database (Pilotbase internal)
    database_url: str = "postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase"

    # Security
    secret_key: str = "change-me"
    encryption_key: str = "change-me-must-be-valid-fernet-key="
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Ollama / AI
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_api_key: str = "ollama"
    ollama_model: str = "deepseek-r1"
    ollama_flash_model: str = "deepseek-v3"

    # Application
    host: str = "0.0.0.0"
    port: int = 8000
    environment: str = "development"
    static_dir: str = "./static"
    backups_dir: str = "./backups"

    # Desktop sidecar mode (see docs/desktop-plan.md) — set by the Electron
    # shell, empty in every other deployment (Docker, bare CLI).
    local_api_token: str = ""
    data_dir: Optional[str] = None

    # External database connections — how long (seconds) to wait when
    # establishing a connection to a user-added database before giving up.
    # Applies to every engine adapter in app.services.db_service.
    db_connect_timeout_seconds: float = 10.0

    # Auth backend identifier — "anon" or a dotted Python path to a custom AuthBackend subclass
    auth_backend: str = "anon"

    # CORS
    cors_origins: Union[List[str], str] = ["http://localhost:5173", "http://localhost:8000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
