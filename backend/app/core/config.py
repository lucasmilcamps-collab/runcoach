import json

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "runcoach"

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    garmin_token_encryption_key: str

    # AI plan generation (plan-generator skill). Key never reaches the client.
    # Model is configurable, not hardcoded: default to the current Sonnet for
    # cost on a solo app; switch to claude-opus-4-8 for higher quality.
    anthropic_api_key: str = ""
    plan_model: str = "claude-sonnet-5"

    # Kept as a plain str (not list[str]): pydantic-settings JSON-decodes any
    # complex-typed env var unconditionally, before validators run, so a
    # host dashboard value that isn't strict JSON (e.g. a bare comma list)
    # would crash on startup. Parsing is done ourselves in the property below.
    cors_origins: str = "http://localhost:8081"

    @property
    def cors_origins_list(self) -> list[str]:
        value = self.cors_origins.strip()
        if value.startswith("["):
            return json.loads(value)
        return [origin.strip() for origin in value.split(",") if origin.strip()]


settings = Settings()
